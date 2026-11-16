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
.plain{height:180px;display:flex;padding:20px}
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
