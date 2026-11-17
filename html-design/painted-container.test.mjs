import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './export.mjs';

let browser, editor;
before(async () => { browser = await chromium.launch(browserOptions()); editor = await readFile('html-design/editor.js', 'utf8'); });
after(async () => { await browser?.close(); });

const html = `<!doctype html><html><head><style>
body{margin:0}[data-artboard]{position:relative;width:800px;height:450px;background:white}
.layout{display:grid;grid-template-columns:240px 240px;gap:20px;padding:40px}
.card{height:180px;background:#f4f0e9;border:2px solid #aaa;border-radius:16px;padding:20px}
.plain{height:180px;display:flex;padding:20px;box-shadow:0 0 0 0 rgba(0,0,0,0)}
.card span,.plain span{display:block;margin-top:80px}
</style></head><body><main data-stage><section data-artboard="p1" data-mode="flow">
<div class="layout"><div id="card" class="card"><span data-el="inner">Inner object</span></div>
<div id="plain" class="plain"><span data-el="other">Other object</span></div></div>
</section></main></body></html>`;

async function open(extraStyle = '') {
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  await p.setContent(html.replace('</style>', `${extraStyle}</style>`));
  await p.addScriptTag({ content: editor });
  await p.locator('[data-act=edit]').click();
  return p;
}

test('clicking a painted card marks and selects it; layout-only div stays unmarked', async () => {
  const p = await open();
  try {
    await p.locator('#plain').click({ position: { x: 10, y: 10 } });
    assert.equal(await p.locator('#plain').getAttribute('data-el'), null);
    await p.locator('#plain').evaluate(el => { el.style.boxShadow = '0 0 0 0 #000'; });
    await p.locator('#plain').click({ position: { x: 10, y: 10 } });
    assert.equal(await p.locator('#plain').getAttribute('data-el'), null);
    await p.locator('[data-el=inner]').click();
    assert.equal(await p.locator('#card').getAttribute('data-el'), null);
    const before = await p.locator('#card').boundingBox();
    await p.locator('#card').click({ position: { x: 10, y: 10 } });
    const id = await p.locator('#card').getAttribute('data-el');
    assert.match(id, /^p1-container-\d+$/);
    assert.equal(await p.locator('.tbar').isVisible(), true);
    const after = await p.locator('#card').boundingBox();
    for (const axis of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(after[axis] - before[axis]) < .05);
    await p.locator('[data-act=undo]').click();
    assert.equal(await p.locator('#card').getAttribute('data-el'), null);
    await p.locator('[data-act=redo]').click();
    assert.equal(await p.locator('#card').getAttribute('data-el'), id);
    await p.locator('[data-el=inner]').click();
    assert.equal(await p.locator('#card').getAttribute('data-el'), id);
    await p.locator('#card').click({ position: { x: 10, y: 10 } });
    await p.keyboard.press('Control+d');
    const cardIds = await p.locator('.card[data-el]').evaluateAll(nodes => nodes.map(n => n.dataset.el));
    assert.equal(cardIds.length, 2);
    assert.equal(new Set(cardIds).size, 2);
    await p.locator('[data-act=export]').click();
    const pending = p.waitForEvent('download');
    await p.locator('[data-act=download]').click();
    const saved = await readFile(await (await pending).path(), 'utf8');
    assert.match(saved, new RegExp(`data-el="${id}"`));
    const reopened = await browser.newPage();
    try {
      await reopened.setContent(saved);
      assert.equal(await reopened.locator('.card[data-el]').count(), 2);
      assert.equal(await reopened.locator('#card').getAttribute('data-el'), id);
    } finally { await reopened.close(); }
  } finally { await p.close(); }
});

test('unmarked visible text gains an editable marker on click without marking its layout wrapper', async () => {
  const p = await open();
  try {
    await p.locator('[data-artboard=p1]').evaluate(board => board.insertAdjacentHTML('beforeend',
      '<div id="text-layout" style="position:absolute;left:540px;top:40px;width:230px"><p id="plain-text" style="color:#777">A visible note with <strong>emphasis</strong>.</p><div id="direct-text">Direct text</div></div>'));
    const note = p.locator('#plain-text'), before = await note.boundingBox();
    await note.locator('strong').click();
    const id = await note.getAttribute('data-el');
    assert.match(id, /^p1-text-\d+$/);
    assert.equal(await note.getAttribute('data-text-box'), '');
    assert.equal(await p.locator('#text-layout').getAttribute('data-el'), null);
    assert.equal(await note.locator('strong').getAttribute('data-el'), null);
    const after = await note.boundingBox();
    for (const axis of ['x','y','width','height']) assert.ok(Math.abs(after[axis] - before[axis]) < .05);
    await note.dblclick();
    assert.equal(await note.getAttribute('contenteditable'), 'true');
    await p.keyboard.press('Escape');
    await p.locator('#direct-text').click();
    assert.match(await p.locator('#direct-text').getAttribute('data-el'), /^p1-text-\d+$/);
    await p.locator('[data-act=undo]').click();
    assert.equal(await p.locator('#direct-text').getAttribute('data-el'), null);
    await p.locator('[data-act=redo]').click();
    assert.match(await p.locator('#direct-text').getAttribute('data-el'), /^p1-text-\d+$/);
  } finally { await p.close(); }
});

test('author CSS depending on an automatically marked text box rolls back the marker', async () => {
  const p = await open('#plain-text[data-text-box]{font-size:40px!important}');
  try {
    await p.locator('[data-artboard=p1]').evaluate(board => board.insertAdjacentHTML('beforeend',
      '<p id="plain-text" style="position:absolute;left:520px;top:35px;font-size:18px">Unmarked text</p>'));
    const before = await p.locator('#plain-text').evaluate(node => node.outerHTML);
    await p.locator('#plain-text').click();
    assert.equal(await p.locator('#plain-text').evaluate(node => node.outerHTML), before);
  } finally { await p.close(); }
});

test('a CSS rule that changes a newly marked card is rejected without partial changes', async () => {
  const p = await open('#card[data-el]{background:red;border-width:12px}');
  try {
    const board = p.locator('[data-artboard=p1]');
    const before = await board.evaluate(n => n.outerHTML);
    const sequence = await p.locator('[data-stage]').getAttribute('data-element-seq');
    await p.locator('#card').click({ position: { x: 10, y: 10 } });
    assert.equal(await board.evaluate(n => n.outerHTML), before);
    assert.equal(await p.locator('[data-stage]').getAttribute('data-element-seq'), sequence);
    assert.equal(await p.locator('#card').getAttribute('data-el'), null);
  } finally { await p.close(); }
});

test('visible shadows can be selected while transparent shadow resets stay layout-only', async () => {
  const p = await open();
  try {
    await p.locator('#plain').click({ position: { x: 10, y: 10 } });
    assert.equal(await p.locator('#plain').getAttribute('data-el'), null);
    await p.locator('[data-artboard=p1]').evaluate(board => board.insertAdjacentHTML('beforeend',
      '<div id="shadow" style="position:absolute;left:560px;top:300px;width:80px;height:80px;box-shadow:0 0 12px #333"></div>'));
    await p.locator('#shadow').click({ position: { x: 40, y: 40 } });
    assert.match(await p.locator('#shadow').getAttribute('data-el'), /^p1-container-\d+$/);
  } finally { await p.close(); }
});

test('a dense page marks a card without running a full-page hit-test probe', async () => {
  const p = await open();
  try {
    await p.locator('[data-artboard=p1]').evaluate(board => {
      const dense = document.createElement('div');
      dense.style.cssText = 'position:absolute;left:0;top:250px;display:grid;grid-template-columns:repeat(40,12px)';
      dense.innerHTML = Array.from({ length: 400 }, (_, i) =>
        `<span data-el="dense-${i}" style="width:10px;height:10px">${i}</span>`).join('');
      board.append(dense);
    });
    const result = await p.locator('#card').evaluate(card => {
      const r = card.getBoundingClientRect();
      const event = new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, button: 0,
        clientX: r.x + 10, clientY: r.y + 10,
      });
      const start = performance.now();
      card.dispatchEvent(event);
      return { elapsed: performance.now() - start, id: card.dataset.el };
    });
    assert.match(result.id, /^p1-container-\d+$/);
    assert.ok(result.elapsed < 250, `Card click took ${result.elapsed.toFixed(1)}ms`);
  } finally { await p.close(); }
});
