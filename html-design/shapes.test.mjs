import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { browserOptions } from './export.mjs';
import { createPreviewServer } from './server.mjs';

let browser, editor, server, origin;
before(async () => {
  editor = await readFile('html-design/editor.js', 'utf8');
  browser = await chromium.launch(browserOptions());
  server = await createPreviewServer({ port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

const shell = content => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}[data-artboard]{width:800px;height:450px;background:#fff;padding:30px;box-sizing:border-box}</style></head><body><main data-stage><section data-artboard="p1" data-title="形状" data-mode="artboard">${content}</section></main></body></html>`;

test('shape palette inserts eight persistent, individually editable elements; parameters undo and reopen', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  try {
    await p.setContent(shell(''));
    await p.addScriptTag({ content: editor });
    await p.locator('[data-act=edit]').click();
    const kinds = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow', 'blockArrow'];
    for (const kind of kinds) {
      await p.locator('[data-act=add-shape]').click();
      assert.equal(await p.locator('[data-menu=shape] button').count(), 8);
      assert.equal((await p.locator('[data-menu=shape]').innerText()).trim(), '');
      await p.locator(`[data-act=shape-insert][data-shape-kind=${kind}]`).click();
    }
    const shapes = p.locator('[data-artboard=p1] svg[data-shape]');
    assert.equal(await shapes.count(), 8);
    const ids = await shapes.evaluateAll(nodes => nodes.map(n => n.dataset.el));
    assert.equal(new Set(ids).size, 8);
    const lineCoverage = await p.locator('svg[data-shape=line]').evaluate(n => {
      const path = n.firstElementChild, b = path.getBBox(), m = path.getScreenCTM();
      return b.width * m.a / n.getBoundingClientRect().width;
    });
    assert.ok(lineCoverage > .85, `line spans its selection box: ${lineCoverage}`);
    await shapes.first().evaluate(n => {
      n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 }));
      n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0 }));
    });
    const adjust = p.locator('[data-shape-prop=adjust]');
    await adjust.evaluate(n => { n.value = '32'; n.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await shapes.first().getAttribute('data-shape-adjust'), '32');
    await p.locator('[data-act=undo]').click();
    assert.equal(await shapes.first().getAttribute('data-shape-adjust'), '12');
    await p.locator('[data-act=redo]').click();
    assert.equal(await shapes.first().getAttribute('data-shape-adjust'), '32');
    const saved = await p.locator('[data-artboard=p1]').innerHTML();
    const reopened = await browser.newPage();
    try {
      await reopened.setContent(shell(saved));
      await reopened.addScriptTag({ content: editor });
      assert.equal(await reopened.locator('svg[data-shape]').count(), 8);
      assert.equal(await reopened.locator('svg[data-shape=rect] rect').getAttribute('rx'), '32');
    } finally { await reopened.close(); }
    assert.deepEqual(errors, []);
  } finally { await p.close(); }
});

test('PPTX exports inserted primitives as native editable shapes, without raster pictures', async () => {
  const nodes = [
    ['rect', '<rect x="10" y="10" width="180" height="100"/>'],
    ['ellipse', '<ellipse cx="100" cy="60" rx="89" ry="49"/>'],
    ['arrow', '<path d="M10 60H190"/>'],
    ['blockArrow', '<polygon points="10,20 130,20 130,5 190,60 130,115 130,100 10,100"/>'],
    ['star', '<polygon points="100,10 112,44 148,44 119,67 129,105 100,83 71,105 81,67 52,44 88,44"/>'],
  ].map(([kind, inner], i) => `<svg data-el="p1-shape-${i}" data-shape="${kind}" data-shape-fill="#ff3b30" data-shape-stroke="#1d1d1f" data-shape-width="2" data-shape-adjust="12" viewBox="0 0 200 120" style="width:180px;height:90px">${inner}</svg>`).join('');
  const response = await fetch(`${origin}/__html-design/export/pptx`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ html: shell(nodes), baseUrl: `${origin}/demos/toy-history.html`, title: 'Shapes', filename: 'Shapes' }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.equal((xml.match(/<p:pic>/g) || []).length, 0);
  for (let i = 0; i < 5; i++) assert.match(xml, new RegExp(`name="p1-shape-${i}"`));
  assert.match(xml, /<a:prstGeom prst="ellipse"/);
  assert.match(xml, /<a:prstGeom prst="rightArrow"/);
  assert.match(xml, /tailEnd type="triangle"|headEnd type="triangle"/);
  const native = [...xml.matchAll(/<p:sp>.*?<\/p:sp>/gs)].map(m => m[0]);
  const widthOf = index => Number(native.find(s => s.includes(`name="p1-shape-${index}"`)).match(/<a:ext cx="(\d+)"/)[1]) / 9525;
  assert.ok(widthOf(2) > 125 && widthOf(2) < 145, `line arrow uses drawn width: ${widthOf(2)}`);
  assert.ok(widthOf(4) > 60 && widthOf(4) < 100, `star uses drawn width: ${widthOf(4)}`);
});
