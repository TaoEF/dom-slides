import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { checkFile } from './qa.mjs';
import { measureDocumentText } from './text-measure.mjs';
import { createResourceServer } from './saved-file.mjs';

let dir;
before(async () => { dir = await realpath(await mkdtemp(path.join(tmpdir(), 'dom-qa-'))); });
after(async () => { await rm(dir, { recursive: true, force: true }); });
const wrap = (body, css = '', extra = '') => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
body{margin:0}[data-artboard]{width:800px;height:600px;position:relative}p{font:20px/28px Arial,"PingFang SC",sans-serif;word-break:break-all;line-break:anywhere;overflow-wrap:break-word;margin:0;width:400px} ${css}
</style>${extra}</head><body><main data-stage><section data-artboard="p1">${body}</section></main></body></html>`;
const qa = html => measureDocumentText({ mode: 'qa', html });
const codes = r => r.issues.map(i => i.code);
test('painted divs without data-el are located; layout-only wrappers are not reported', async () => {
  const result = await qa(wrap('<div class="layout"><div class="card"><span data-el="child">Object</span></div><div class="plain"><span data-el="other">Other</span></div></div>', '.layout{display:grid;grid-template-columns:200px 200px;gap:10px}.card{height:80px;background:#eee;border:1px solid #aaa}.plain{height:80px;display:flex;padding:10px}'));
  const unmarked = result.issues.filter(i => i.code === 'VISUAL_CONTAINER_UNMARKED');
  assert.equal(unmarked.length, 1, JSON.stringify(result));
  assert.equal(unmarked[0].pageId, 'p1');
  assert.deepEqual(unmarked[0].evidence.path, [0, 0]);
  assert.equal(result.coverage.containers.unmarked, 1);
  const ignored = await qa(wrap('<div class="card" data-qa-ignore="VISUAL_CONTAINER_UNMARKED"><span data-el="child">Object</span></div>', '.card{background:#eee;width:200px;height:80px}'));
  assert.ok(!codes(ignored).includes('VISUAL_CONTAINER_UNMARKED'));
});
function command(args, env = {}, onStart) {
  const child = spawn(process.execPath, ['html-design/qa.mjs', ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('QA CLI exceeded 45 seconds.')); }, 45000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err, result: JSON.parse(out || err) }); });
    onStart?.(child);
  });
}

test('QA CLI reuses one prepared document, checks real soft lines and returns bounded source/coverage facts without writes', async () => {
  const original = wrap('<p data-el="orphan" style="width:5em">方案已经确定。</p><p data-el="punct" style="width:6em">方案已经确定。</p><p data-el="start" style="width:5em">我们一起走，继续</p><p data-el="end" style="width:4em">我们去（这是标题内容</p>');
  const file = path.join(dir, '中文 设计.html'); await writeFile(file, original);
  const { code, result, err } = await command(['check', file]);
  assert.equal(code, 2); assert.equal(err, ''); assert.equal(result.schemaVersion, 1); assert.equal(result.units, 'css-px');
  for (const expected of ['LINE_ORPHAN_CJK', 'LINE_ORPHAN_PUNCTUATION', 'LINE_START_PROHIBITED', 'LINE_END_PROHIBITED']) assert.ok(codes(result).includes(expected), JSON.stringify(result));
  const orphan = result.issues.find(i => i.code === 'LINE_ORPHAN_CJK' && i.elementId === 'orphan');
  assert.equal(orphan.evidence.text, '定。'); assert.equal(orphan.evidence.line, 2); assert.equal(orphan.severity, 'warning');
  assert.equal(result.coverage.text.checked, 4); assert.equal(result.coverage.text.linesChecked, 4); assert.equal(result.truncated, false);
  assert.equal(result.source.path, file); assert.equal(result.source.revision, createHash('sha256').update(original).digest('hex'));
  assert.equal(await readFile(file, 'utf8'), original); assert.equal(result.pageCount, 1);
  await mkdir('.export-test', { recursive: true }); await writeFile('.export-test/issue21-qa-example.json', JSON.stringify(result, null, 2));
});

test('explicit breaks and scoped exemptions retain author intent; mixed baselines and columns report coverage instead of guessed lines', async () => {
  const explicit = await qa(wrap('<p data-el="br">方案已经确<br>定。</p><p data-el="pre" style="white-space:pre-wrap">方案已经确\n定。</p><p data-el="poem" style="width:5em" data-qa-ignore="LINE_ORPHAN_CJK">方案已经确定。</p>'));
  assert.equal(explicit.status, 'ok', JSON.stringify(explicit)); assert.deepEqual(explicit.issues, []); assert.equal(explicit.coverage.suppressed, 1);
  const mixed = await qa(wrap('<p data-el="rich">Mix <span style="font-size:12px;vertical-align:super">base</span> 中文</p><p data-el="columns" style="column-count:2">中文多栏内容</p><p data-el="vertical" style="writing-mode:vertical-rl">中文竖排</p>'));
  assert.equal(mixed.status, 'issues'); assert.ok(codes(mixed).includes('LINE_UNSUPPORTED')); assert.ok(codes(mixed).includes('TEXT_UNSUPPORTED'));
  assert.ok(!mixed.issues.some(i => i.code.startsWith('LINE_ORPHAN'))); assert.equal(mixed.coverage.text.linesChecked, 0);
  const forged = await qa(wrap('<p data-el="same" data-qa-ignore="ID_INVALID">One</p><p data-el="same" data-qa-ignore="ID_INVALID">Two</p>'));
  assert.equal(forged.status, 'issues'); assert.ok(forged.issues.some(i => i.code === 'ID_INVALID' && i.elementId === null));
});

test('bounds cover non-text nodes, text overflow and ancestor clipping; hidden/unmarked/invalid IDs cannot pass', async () => {
  const result = await qa(wrap('<div data-el="shape" style="position:absolute;left:790px;width:30px;height:20px"></div><div data-el="clip" style="width:100px;height:20px;overflow:hidden"><p data-el="text" style="width:200px;height:60px">A longer line</p></div><p data-el="tiny" style="width:70px;height:10px;overflow:hidden">Text overflows its box</p><div style="opacity:0"><p data-el="hidden">Hidden</p></div><p>Unmarked</p><div data-el="" style="height:20px"></div>'));
  for (const code of ['ELEMENT_OUT_OF_BOUNDS', 'TEXT_OVERFLOW', 'ANCESTOR_CLIP', 'HIDDEN_CONTENT', 'TEXT_UNMARKED', 'ID_INVALID']) assert.ok(codes(result).includes(code), JSON.stringify(result));
  const noIgnore = await qa(wrap('<p data-el="hidden" style="display:none" data-qa-ignore="HIDDEN_CONTENT">Hidden</p>'));
  assert.equal(noIgnore.status, 'issues'); assert.equal(noIgnore.coverage.suppressed, 0);
});

test('Flex/Grid layout and CSS pixel facts are invariant under editor stage zoom; translated nodes remain measurable', async () => {
  const body = '<div data-el="grid" style="display:grid;grid-template-columns:200px 200px;gap:20px"><p data-el="left" style="width:200px">English and 中文。</p><div data-el="flex" style="display:flex"><p data-el="right" style="width:200px;translate:4px 0">Text</p></div></div>';
  const results = [];
  for (const scale of [.5, 1, 2]) results.push(await qa(wrap(body, `[data-stage]{transform:scale(${scale});zoom:${scale}}`)));
  for (const r of results) { assert.equal(r.status, 'ok', JSON.stringify(r)); assert.equal(r.coverage.text.linesChecked, 2); }
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
  const rotated = await qa(wrap('<p data-el="rotated" style="transform:rotate(30deg)">Uncertain geometry</p>'));
  assert.equal(rotated.status, 'issues'); assert.ok(codes(rotated).includes('LINE_UNSUPPORTED')); assert.equal(rotated.coverage.text.linesChecked, 0);
  assert.equal(rotated.coverage.elements.checked, 1); assert.ok(codes(rotated).includes('ELEMENT_OUT_OF_BOUNDS'), 'rotated BCR still provides reliable page-boundary facts');
});

test('temporary resources and explicit original base load CSS/images; broken images/fonts and outside-root symlinks stay visible', async () => {
  const resources = path.join(dir, 'resources'); await mkdir(resources);
  await writeFile(path.join(resources, 'style.css'), 'p{width:70px!important;height:10px;overflow:hidden}');
  await writeFile(path.join(resources, 'pixel.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
  await writeFile(path.join(dir, 'outside.css'), 'body{color:red}');
  await symlink(path.join(dir, 'outside.css'), path.join(resources, 'outside.css'));
  const source = wrap('<p data-el="text">Relative resource layout check</p><p data-el="font" style="font-family:MissingFont">Missing font</p><img data-el="image" src="pixel.svg" width="10" height="10"><img data-el="bad" src="missing.png" width="20" height="20">', '', '<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="outside.css"><style>@font-face{font-family:MissingFont;src:url(missing.woff2)}</style>');
  const file = path.join(resources, 'deck.html'); await writeFile(file, source);
  const result = await checkFile(file);
  assert.ok(codes(result).includes('TEXT_OVERFLOW')); assert.ok(codes(result).includes('IMAGE_LOAD_FAILED')); assert.ok(result.issues.some(i => i.code === 'RESOURCE_FAILED' && i.evidence.type === 'font')); assert.ok(result.issues.some(i => i.code === 'RESOURCE_FAILED' && i.evidence.status === 403));
  const server = await createResourceServer(resources);
  try {
    const copy = path.join(dir, 'work.html'); await writeFile(copy, source.replace('<link rel="stylesheet" href="outside.css">', ''));
    const checked = await command(['check', copy, '--base-url', `${server.origin}/deck.html`]);
    assert.equal(checked.code, 2); assert.equal(checked.result.coverage.elements.checked, 4); assert.ok(!checked.result.issues.some(i => i.code === 'IMAGE_LOAD_FAILED' && i.elementId === 'image'));
    assert.equal((await fetch(`${server.origin}/pixel.svg`)).status, 200);
  } finally { await server.close(); }
});

test('scan limits and oversized text remain bounded and cannot report clean', async () => {
  const many = await qa(wrap(Array.from({ length: 501 }, (_, i) => `<p data-el="t${i}" style="display:none">Text</p>`).join('')));
  assert.equal(many.truncated, true); assert.equal(many.status, 'issues'); assert.ok(many.issues.length <= 500); assert.ok(many.coverage.issuesOmitted > 0);
  const long = await qa(wrap(`<p data-el="long">${'文'.repeat(20001)}</p>`, '[data-artboard]{height:100000px}'));
  assert.equal(long.truncated, true); assert.ok(codes(long).includes('SCAN_LIMIT')); assert.equal(long.coverage.text.linesChecked, 0);
  const elements = await qa(wrap(Array.from({ length: 2001 }, (_, i) => `<i data-el="s${i}"></i>`).join('')));
  assert.equal(elements.truncated, true); assert.equal(elements.coverage.elements.checked, 2000);
});

test('scripts/navigation stay disabled and regular-file/size/URL input errors fail before browser launch', async () => {
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; res.writeHead(200); res.end(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/file.html`;
    const result = await qa(wrap('<p data-el="safe">Safe content.</p><script>document.body.remove();fetch("/ran")</script>'));
    assert.equal(result.status, 'ok');
    await assert.rejects(measureDocumentText({ mode: 'qa', html: wrap('<p data-el="safe">Safe</p>', '', `<meta http-equiv="refresh" content="0;url=${baseUrl}">`), baseUrl }), /navigation/i);
    assert.equal(requests, 0);
  } finally { await new Promise(r => server.close(r)); }
  const fifo = path.join(dir, 'pipe.html'); await promisify(execFile)('mkfifo', [fifo]);
  const rejected = await command(['check', fifo], { HTML_DESIGN_CHROME: '/not-a-browser' });
  assert.equal(rejected.code, 1); assert.equal(rejected.out, ''); assert.match(rejected.result.error.message, /regular HTML/);
  const huge = path.join(dir, 'huge.html'); const file = await import('node:fs/promises').then(m => m.open(huge, 'w')); await file.truncate(32 * 1024 * 1024 + 1); await file.close();
  const tooBig = await command(['check', huge], { HTML_DESIGN_CHROME: '/not-a-browser' }); assert.equal(tooBig.code, 1); assert.match(tooBig.result.error.message, /32 MiB/);
  const external = await command(['check', huge, '--base-url', 'https://example.com/']); assert.equal(external.code, 1); assert.match(external.result.error.message, /loopback/);
});

test('QA interruption closes a pending browser resource and exits with one error result', async () => {
  let terminate;
  const server = http.createServer((req, res) => {
    if (req.url === '/pending.css') terminate();
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const file = path.join(dir, 'interrupt.html'); await writeFile(file, wrap('<p data-el="title">Unchanged</p>', '', '<link rel="stylesheet" href="pending.css">'));
  try {
    const result = await command(['check', file, '--base-url', `http://127.0.0.1:${server.address().port}/deck.html`], {}, child => { terminate = () => child.kill('SIGTERM'); });
    assert.equal(result.code, 1); assert.equal(result.out, ''); assert.equal(result.result.status, 'error');
    assert.equal(await readFile(file, 'utf8'), wrap('<p data-el="title">Unchanged</p>', '', '<link rel="stylesheet" href="pending.css">'));
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('column-width alone remains unsupported even when deliberate overflow is suppressed', async () => {
  const result = await qa(wrap('<p data-el="columns" data-qa-ignore="TEXT_OVERFLOW" style="width:400px;height:28px;column-width:100px;column-gap:0">一二三四五六七八九十甲乙</p>'));
  assert.equal(result.status, 'issues');
  assert.ok(codes(result).includes('LINE_UNSUPPORTED'));
  assert.equal(result.coverage.text.linesChecked, 0);
  assert.equal(result.coverage.text.unsupported, 1);
});

test('oversized target and clipping identifiers become null with invalid-ID facts before bounded issue admission', async () => {
  const long = '标'.repeat(16384);
  const amplified = await qa(wrap(Array.from({ length: 250 }, (_, i) => `<p data-el="t${i}" style="display:none">Text</p>`).join('')).replace('data-artboard="p1"', `data-artboard="${long}"`));
  assert.ok(amplified.issues.some(i => i.code === 'ID_INVALID' && i.evidence.length === long.length));
  assert.ok(amplified.issues.every(i => i.pageId === null));
  assert.ok(Buffer.byteLength(JSON.stringify(amplified)) < 140000);
  assert.equal(amplified.status, 'issues');
  const clip = await qa(wrap(`<div id="${long}" data-el="${long}" style="width:30px;height:10px;overflow:hidden"><p data-el="child" style="width:100px">Clipped content</p></div>`));
  assert.ok(clip.issues.some(i => i.code === 'ID_INVALID' && i.elementId === null));
  const ancestors = clip.issues.find(i => i.code === 'ANCESTOR_CLIP').evidence.clippedBy;
  assert.equal(ancestors[0].elementId, null); assert.equal(ancestors[0].id, null);
  assert.ok(!JSON.stringify(clip).includes(long));
  const validId = '合'.repeat(256);
  const valid = await qa(wrap(`<div data-el="${validId}" style="position:absolute;left:790px;width:20px;height:20px"></div>`));
  assert.equal(valid.issues[0].elementId, validId, 'bounded valid IDs remain exact locators');
  const budgeted = await qa(wrap(Array.from({ length: 250 }, (_, i) => `<div data-el="${i}-${'合'.repeat(250)}" style="position:absolute;left:790px;width:20px;height:20px"></div>`).join('')).replace('data-artboard="p1"', `data-artboard="${validId}"`));
  assert.equal(budgeted.truncated, true); assert.equal(budgeted.status, 'issues');
  assert.ok(budgeted.coverage.issuesOmitted > 0); assert.ok(budgeted.coverage.issueBytes <= 128 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(budgeted)) < 140000, 'valid identifier repetition is bounded at issue admission too');
  let deep = '<p data-el="deep" style="width:400px">Nested clipping</p>';
  for (let i = 0; i < 35; i++) deep = `<div style="width:100px;height:20px;overflow:hidden">${deep}</div>`;
  const clipped = await qa(wrap(deep));
  assert.equal(clipped.truncated, true); assert.ok(clipped.coverage.evidenceOmitted >= 3);
  assert.equal(clipped.issues.find(i => i.code === 'ANCESTOR_CLIP').evidence.clippedBy.length, 32);
});
