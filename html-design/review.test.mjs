import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, stat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reviewDiff, restorePage, restoreDocument } from './review-html.mjs';
import { createDocumentStore, revisionOf } from './documents.mjs';
const page = (id, text = id) => `<section data-artboard="${id}" data-mode="flow"><h1 data-el="${id}-title">${text}</h1></section>`;
const html = (pages = page('p1') + page('p2'), css = 'body{margin:0}', extra = '') => `<!DOCTYPE html><html lang="en"><head><title>Review</title><style>${css}</style></head><body><main data-stage>${pages}</main>${extra}<script data-editor>/*runtime*/</script></body></html>`;
const rejected = p => assert.rejects(p, e => e.status === 409);
async function fixture(t, options = {}, initial = html()) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'design-review-')));
  const file = path.join(root, 'test.html'); await writeFile(file, initial);
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = createDocumentStore(root, options), owner;
  const call = (action, body = {}) => store.handle(action, { path: '/test.html', token: owner?.token, ...body });
  const open = async () => owner = await call('open', { revision: revisionOf(await readFile(file)) });
  await open();
  async function ai(transform) {
    const begin = await call('ai/begin');
    if (!begin.ready) {
      const s = await call('sync'); await call('yield', { requestId: s.pending.id, revision: s.revision });
    }
    const ready = await call('ai/status', { token: begin.token });
    const body = { token: begin.token, revision: ready.revision, html: transform(ready.html) };
    return { result: await call('ai/commit', body), body };
  }
  const current = () => call('sync');
  const review = async (action, scope = 'all', overrides = {}) => {
    const s = await current(); return call('review/' + action, { revision: s.revision, generation: s.review.generation, scope, ...overrides });
  };
  return { root, file, call, ai, current, review, restart: async () => { store = createDocumentStore(root, options); await open(); }, open };
}

test('A01/A02: tree semantics ignore derived fields and editor upgrades but preserve text/style whitespace', () => {
  const a = html();
  const b = a.replace('<main data-stage>', '<main data-element-seq="9" data-stage="" data-page-seq="8">').replace('<h1 data-el="p1-title">', "<h1 data-bbox='1,2,3,4' data-el='p1-title'>").replace('/*runtime*/', 'new runtime');
  assert.equal(reviewDiff(a, b).items.length, 0);
  assert.equal(reviewDiff(a, a.replace('>p1</h1>', '>p1 </h1>')).items[0].id, 'p1');
  assert.equal(reviewDiff(a, a.replace('<h1 ', '<h1 style="color:red" ')).scope, 'pages');
  assert.ok(reviewDiff(a, a.replace('>p1</h1>', '><pre>a  b</pre></h1>')).items.length);
  assert.equal(reviewDiff(a, a.replace('<!DOCTYPE html>', '')).scope, 'document');
  assert.equal(reviewDiff(html(undefined, undefined, '<pre> </pre>'), html(undefined, undefined, '<pre>  </pre>')).scope, 'document');
});

test('A03/A04/A05: additions/deletions are local; globals/scripts/order/ambiguous trees require whole document', () => {
  const a = html(), b = html(page('p1') + page('p3'));
  assert.deepEqual(reviewDiff(a, b).items.map(i => [i.id, i.kind]), [['p2', 'deleted'], ['p3', 'added']]);
  for (const changed of [a.replace('margin:0', 'margin:1px'), a.replace('lang="en"', 'lang="zh"'), a.replace('</main>', '</main><aside>global</aside>'), html(page('p2') + page('p1')), html(page('p1') + page('p1')), html(page('p1') + '<div>' + page('p2') + '</div>'), a.replace('>p1</h1>', '>p1<script>window.foo=1</script></h1>')]) assert.equal(reviewDiff(a, changed).scope, 'document');
  const nested = html(page('p1', '<span><b>x</b></span>') + page('p2'));
  assert.match(restorePage(nested.replace('<b>x</b>', '<b>new</b>'), nested, 'p1'), /<b>x<\/b>/);
});

test('A03/A06/A07: restore preserves neighbors, unrelated bytes, current runtime, references and monotonic IDs', () => {
  const before = html(page('p1') + page('p2', '<svg><defs><path id="shape"/></defs><use href="#shape"/></svg>') + page('p3'));
  let current = html(page('p1', 'changed') + page('p3')).replace('<main data-stage>', '<main data-stage data-page-seq="20" data-element-seq="50">').replace('/*runtime*/', 'latest');
  const restored = restorePage(current, before, 'p2');
  assert.ok(restored.indexOf('data-artboard="p1"') < restored.indexOf('data-artboard="p2"'));
  assert.ok(restored.indexOf('data-artboard="p2"') < restored.indexOf('data-artboard="p3"'));
  assert.match(restored, /changed/); assert.match(restored, /href="#shape"/); assert.match(restored, /data-page-seq="20"/);
  const whole = restoreDocument(current, before);
  assert.match(whole, /latest/); assert.doesNotMatch(whole, /\/\*runtime\*\//); assert.match(whole, /data-element-seq="50"/);
});

test('B02/B03/B04: aggregate baseline survives repeat AI and partial accept before global changes', async t => {
  const f = await fixture(t);
  await f.ai(h => h.replace('>p1<', '>p1 AI1<').replace('>p2<', '>p2 AI1<'));
  await f.ai(h => h.replace('p1 AI1', 'p1 AI2'));
  let before = await f.review('read', 'p1'); assert.match(before.html, />p1</); assert.doesNotMatch(before.html, /AI1/);
  const revision = (await f.current()).revision;
  await f.review('accept', 'p1'); assert.equal((await f.current()).revision, revision);
  await f.ai(h => h.replace('margin:0', 'margin:5px'));
  assert.equal((await f.current()).review.scope, 'document');
  const pending = await readFile(f.file, 'utf8');
  await assert.rejects(f.review('undo', 'document'), e => e.status === 409 && /明确确认/.test(e.message));
  await rejected(f.review('undo', 'all'));
  await rejected(f.review('undo', 'p2', { confirmDocumentUndo: true }));
  assert.equal(await readFile(f.file, 'utf8'), pending);
  await f.review('undo', 'document', { confirmDocumentUndo: true });
  const restored = await readFile(f.file, 'utf8');
  assert.match(restored, /p1 AI2/); assert.match(restored, />p2</); assert.match(restored, /margin:0/);
  assert.equal((await f.current()).review.items.length, 0);
});

test('B03/B05: accepted pages get fresh before; added/deleted aggregate changes leave no ghost items', async t => {
  const f = await fixture(t);
  await f.ai(h => h.replace('>p1<', '>first<'));
  await f.review('accept', 'p1');
  await f.ai(h => h.replace('>first<', '>second<'));
  assert.match((await f.review('read', 'p1')).html, />first</);
  await f.review('undo', 'p1');
  await f.ai(h => h.replace('</main>', page('p3') + '</main>'));
  await f.ai(h => h.replace(page('p3'), ''));
  assert.equal((await f.current()).review.items.length, 0);
  await f.ai(h => h.replace(page('p2'), ''));
  assert.equal((await f.current()).review.items[0].kind, 'deleted');
  await f.review('undo', 'p2'); assert.match(await readFile(f.file, 'utf8'), /data-artboard="p2"/);
});

test('B06: no-op, editor upgrade and cancel do not create pending review', async t => {
  const f = await fixture(t);
  await f.ai(h => h); assert.equal((await f.current()).review.items.length, 0);
  await f.ai(h => h.replace('/*runtime*/', '/*new*/')); assert.equal((await f.current()).review.items.length, 0);
  const pending = await f.call('ai/begin'); await f.call('ai/cancel', { token: pending.token });
  assert.equal((await f.current()).review.items.length, 0);
});

test('C01/C02/C04: manual edits accept only changed scopes, preserve other baselines and invalidate stale generation', async t => {
  const f = await fixture(t);
  await f.ai(h => h.replace('>p1<', '>AI p1<').replace('>p2<', '>AI p2<'));
  const stale = await f.current();
  let saved = await f.call('save', { revision: stale.revision, html: (await readFile(f.file, 'utf8')).replace('AI p1', 'human p1') });
  assert.deepEqual(saved.implicitAccepted, ['p1']); assert.deepEqual(saved.review.items.map(i => i.id), ['p2']);
  await rejected(f.call('review/undo', { revision: stale.revision, generation: stale.review.generation, scope: 'p1' }));
  const derived = (await readFile(f.file, 'utf8')).replace('<main data-stage>', '<main data-stage data-page-seq="99">');
  saved = await f.call('save', { revision: saved.revision, html: derived });
  assert.deepEqual(saved.implicitAccepted, []); assert.equal(saved.review.items.length, 1);
  await f.review('undo', 'p2'); assert.match(await readFile(f.file, 'utf8'), /human p1/);
  await f.ai(h => h.replace('margin:0', 'margin:2px'));
  const s = await f.current();
  saved = await f.call('save', { revision: s.revision, html: (await readFile(f.file, 'utf8')).replace('human p1', 'later human') });
  assert.deepEqual(saved.implicitAccepted, ['document']); assert.equal(saved.review.items.length, 0);
});

test('C04/D01/D02: accept is byte-preserving; stale, viewer, lock, wrong scopes fail closed; generation protects same revision', async t => {
  const f = await fixture(t);
  await f.ai(h => h.replace('>p1<', '>AI p1<').replace('>p2<', '>AI p2<'));
  const s = await f.current(), bytes = await readFile(f.file);
  const viewer = await f.call('open', { revision: s.revision });
  await rejected(f.call('review/accept', { token: viewer.token, revision: s.revision, generation: s.review.generation, scope: 'p1' }));
  await rejected(f.review('undo', 'missing')); await rejected(f.review('undo', 'p1', { revision: 'stale' }));
  await f.review('accept', 'p1'); assert.deepEqual(await readFile(f.file), bytes);
  await rejected(f.call('review/undo', { revision: s.revision, generation: s.review.generation, scope: 'p2' }));
  const begin = await f.call('ai/begin'); await rejected(f.review('accept', 'p2')); await f.call('ai/cancel', { token: begin.token });
  await f.review('accept'); assert.deepEqual(await readFile(f.file), bytes);
});

test('E01/E02/E06: baselines outlive store restarts and 10-save rotation; completed AI/accept retries are idempotent', async t => {
  const f = await fixture(t);
  const ai = await f.ai(h => h.replace('>p1<', '>AI p1<'));
  assert.equal((await f.call('ai/commit', ai.body)).revision, ai.result.revision);
  for (let i = 0; i < 12; i++) {
    const s = await f.current(); await f.call('save', { revision: s.revision, html: (await readFile(f.file, 'utf8')).replace(/>p2(?: \d+)?</, `>p2 ${i}<`) });
  }
  await f.restart(); assert.equal((await f.current()).review.items[0].id, 'p1');
  await f.review('undo', 'p1'); assert.match(await readFile(f.file, 'utf8'), />p1</); assert.match(await readFile(f.file, 'utf8'), />p2 11</);
  await f.ai(h => h.replace('>p1<', '>new AI<'));
  const s = await f.current(), body = { revision: s.revision, generation: s.review.generation, scope: 'p1', requestId: 'accept-once' };
  await f.call('review/accept', body); await f.call('review/accept', body);
  const dirs = await readdir(path.join(f.root, '.html-design/reviews'));
  const reviewFile = path.join(f.root, '.html-design/reviews', dirs[0], 'state.json');
  assert.equal((await stat(reviewFile)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(reviewFile)).state.baselineHTML, null);
});

for (const point of ['before-review-prepare', 'after-review-prepare', 'before-html-rename', 'after-html-rename', 'before-review-finalize', 'after-review-finalize']) {
  test(`E03/E04/E05/E06: crash recovery at ${point} chooses actual HTML revision`, async t => {
    let armed = false;
    const f = await fixture(t, { reviewFault: async p => { if (armed && p === point) { armed = false; throw new Error('simulated crash'); } } });
    armed = true;
    await assert.rejects(f.ai(h => h.replace('>p1<', '>after crash<')), /simulated crash/);
    await f.restart();
    const s = await f.current(), committed = ['after-html-rename', 'before-review-finalize', 'after-review-finalize'].includes(point);
    assert.equal(s.review.items.length, committed ? 1 : 0);
    assert.equal((await readFile(f.file, 'utf8')).includes('after crash'), committed);
    if (committed) { await f.review('undo', 'p1'); assert.match(await readFile(f.file, 'utf8'), />p1</); }
  });
}

test('D02/E05: prepared transaction plus third-party disk revision preserves evidence and blocks mutation', async t => {
  let armed = false;
  const f = await fixture(t, { reviewFault: async p => { if (armed && p === 'after-html-rename') { armed = false; throw new Error('crash'); } } });
  armed = true; await assert.rejects(f.ai(h => h.replace('>p1<', '>AI<')));
  await writeFile(f.file, html(page('p1', 'external') + page('p2')));
  await f.restart(); assert.ok((await f.current()).review.conflict);
  await rejected(f.review('undo')); await rejected(f.call('ai/begin'));
  assert.match(await readFile(f.file, 'utf8'), /external/);
});

test('D01/E06: expired owner cannot accept/undo; metadata failure keeps byte-identical design and original pending baseline', async t => {
  let clock = 1000, failMetadata = false;
  const f = await fixture(t, { now: () => clock, leaseMs: 100, reviewFault: async p => { if (failMetadata && p === 'before-review-metadata') throw new Error('disk full'); } });
  await f.ai(h => h.replace('>p1<', '>AI<'));
  const before = await f.current(), bytes = await readFile(f.file);
  clock += 101;
  await rejected(f.call('review/undo', { revision: before.revision, generation: before.review.generation, scope: 'p1' }));
  await f.open(); failMetadata = true;
  await assert.rejects(f.review('accept', 'p1'), /disk full/);
  assert.deepEqual(await readFile(f.file), bytes); assert.equal((await f.current()).review.generation, before.review.generation);
  failMetadata = false; await f.review('undo', 'p1'); assert.match(await readFile(f.file, 'utf8'), />p1</);
});

test('D02/E06: concurrent partial actions serialize; explicit Undo retry cannot overwrite a later revision', async t => {
  const f = await fixture(t);
  await f.ai(h => h.replace('>p1<', '>AI<').replace('>p2<', '>AI2<'));
  const s = await f.current(); let body = { revision: s.revision, generation: s.review.generation, scope: 'p1', requestId: 'undo-once' };
  const results = await Promise.allSettled([f.call('review/undo', body), f.call('review/accept', { ...body, scope: 'p2', requestId: 'accept-stale' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  // Path canonicalization is asynchronous; either contender may enter first.
  let undone = results[0].value;
  if (!undone) { const latest = await f.current(); body = { ...body, revision: latest.revision, generation: latest.review.generation }; undone = await f.call('review/undo', body); }
  const retry = await f.call('review/undo', body); assert.equal(retry.revision, undone.revision);
  await f.ai(h => h.replace('>p1<', '>new AI<'));
  await rejected(f.call('review/undo', body)); assert.match(await readFile(f.file, 'utf8'), /new AI/);
});

test('E07: embedded-image baseline stays private and heartbeat contains only lightweight summary', async t => {
  const image = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024);
  const f = await fixture(t, {}, html(page('p1', `<img src="${image}">original`) + page('p2')));
  await f.ai(h => h.replace('original', 'changed'));
  await f.restart();
  const s = await f.current(); assert.ok(JSON.stringify(s).length < 2000); assert.equal(s.review.items.length, 1);
  assert.equal((await f.review('read', 'p1')).html.includes(image), true);
  await f.review('undo', 'p1'); assert.match(await readFile(f.file, 'utf8'), /original/);
});

test('F06: independent seeded demo refuses any overwrite and includes two real pending pages', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'review-demo-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(root, 'html-design')); await mkdir(path.join(root, 'demos'));
  await writeFile(path.join(root, 'html-design/editor.js'), '/* test runtime */');
  const { createReviewDemo } = await import('./review-demo.mjs');
  const demo = await createReviewDemo(root, 'demos/trial.html'), bytes = await readFile(demo.file);
  const store = createDocumentStore(root), state = await store.handle('open', { path: demo.path, revision: revisionOf(bytes) });
  assert.equal(state.review.items.length, 2);
  await assert.rejects(createReviewDemo(root, 'demos/trial.html'), e => e.code === 'EEXIST'); assert.deepEqual(await readFile(demo.file), bytes);
});

test('B06/D03: AI expiry creates no pending review; symlink alias shares owner, baseline and scope generation', async t => {
  let clock = 1000;
  const f = await fixture(t, { now: () => clock, aiLeaseMs: 100 });
  const { symlink } = await import('node:fs/promises');
  await symlink('test.html', path.join(f.root, 'alias.html'));
  const s = await f.current(), alias = await f.call('open', { path: '/alias.html', revision: s.revision });
  assert.equal(alias.role, 'viewer');
  const ai = await f.call('ai/begin'), p = await f.current(); await f.call('yield', { requestId: p.pending.id, revision: p.revision });
  const ready = await f.call('ai/status', { token: ai.token }); clock += 101;
  await rejected(f.call('ai/commit', { token: ai.token, revision: ready.revision, html: ready.html.replace('>p1<', '>expired<') }));
  assert.equal((await f.current()).review.items.length, 0);
  await f.ai(h => h.replace('>p1<', '>pending<'));
  const a = await f.call('open', { path: '/alias.html', revision: (await f.current()).revision }), current = await f.current();
  assert.deepEqual(a.review, current.review); assert.equal(a.review.items.length, 1);
  await writeFile(f.file, (await readFile(f.file, 'utf8')).replace('>pending<', '>external<'));
  assert.ok((await f.current()).review.conflict); await rejected(f.review('undo', 'p1'));
  assert.match(await readFile(f.file, 'utf8'), /external/);
});

test('H01: page-contained style and stylesheet nodes remain global; manual edits protect all affected pages', async t => {
  const initial = html(page('p1', '<style>[data-artboard] h1{color:red}</style>p1') + page('p2'));
  for (const [before, after] of [
    [initial, initial.replace('color:red', 'color:blue')],
    [html(page('p1', '<link rel="stylesheet" href="a.css">p1') + page('p2')), html(page('p1', '<link rel="stylesheet" href="b.css">p1') + page('p2'))],
    [html(), html(page('p1', '<style>h1{color:blue}</style>p1') + page('p2'))],
  ]) assert.equal(reviewDiff(before, after).scope, 'document');
  const f = await fixture(t, {}, initial);
  await f.ai(h => h.replace('>p2<', '>accepted p2<')); await f.review('accept', 'p2');
  await f.ai(h => h.replace('color:red', 'color:blue'));
  assert.equal((await f.current()).review.scope, 'document');
  await f.review('undo', 'document', { confirmDocumentUndo: true }); assert.match(await readFile(f.file, 'utf8'), /accepted p2/);
  await f.ai(h => h.replace('color:red', 'color:blue'));
  const stale = await f.current();
  const saved = await f.call('save', { revision: stale.revision, html: (await readFile(f.file, 'utf8')).replace('accepted p2', 'manual p2') });
  assert.deepEqual(saved.implicitAccepted, ['document']); assert.equal(saved.review.items.length, 0);
  await rejected(f.call('review/undo', { revision: stale.revision, generation: stale.review.generation, scope: 'document' }));
  assert.match(await readFile(f.file, 'utf8'), /color:blue/); assert.match(await readFile(f.file, 'utf8'), /manual p2/);
});

test('H02: stage whitespace retains layout meaning; removing only a page with unchanged whitespace remains local', () => {
  const before = html(page('p1') + '\n' + page('p2')).replace('<main data-stage>', '<main data-stage style="white-space:pre">');
  assert.equal(reviewDiff(before, before.replace('</section>\n<section', '</section> <section')).scope, 'document');
  const deleted = before.replace(page('p1'), '');
  assert.deepEqual(reviewDiff(before, deleted).items.map(i => [i.id, i.kind]), [['p1', 'deleted']]);
  assert.equal(reviewDiff(before, deleted).scope, 'pages');
  assert.equal(reviewDiff(before, before.replace('data-stage style="white-space:pre"', "style='white-space:pre' data-stage='' ")).items.length, 0);
  const svg = html(page('p1', '<svg><text>first</text><text>second</text></svg>') + page('p2'));
  assert.equal(reviewDiff(svg, svg.replace('second', 'changed')).items[0].id, 'p1', 'merging adjacent HTML text must not collapse SVG text elements');
});

test('L01/L02/L04: summary page ordinals derive from after/baseline order independently of stable IDs',()=>{
  const before=html(page('p8','One')+page('p12','Two')), after=html(page('p8','Changed')+page('p50','New'));
  assert.deepEqual(reviewDiff(before,after).items.map(i=>[i.id,i.kind,i.currentPage,i.originalPage]),[['p8','updated',1,1],['p12','deleted',null,2],['p50','added',2,null]]);
  const restored=restorePage(after,before,'p12');
  assert.equal(reviewDiff(before,restored).items.find(i=>i.id==='p50').currentPage,3);
  const document=reviewDiff(before,after.replace('margin:0','margin:1px')); assert.equal(document.scope,'document'); assert.equal(document.items[0].currentPage,undefined);
});
