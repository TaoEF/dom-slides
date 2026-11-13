import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { browserOptions } from './export.mjs';
import { createPreviewServer } from './server.mjs';
import { shapeMarkup } from './src/shapes.js';
import { collectEditableSlide } from './pptx.mjs';
import { elementGeometry } from './src/geometry.js';

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
    assert.equal(await p.locator('[data-act=export]').evaluate(n => getComputedStyle(n).fontSize), '13px');
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
    await adjust.evaluate(n => { n.value = '32'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await shapes.first().locator('rect').getAttribute('rx'), '32', 'slider previews before release');
    await adjust.dispatchEvent('change');
    assert.equal(await shapes.first().getAttribute('data-shape-adjust'), '32');
    await p.locator('[data-act=undo]').click();
    assert.equal(await shapes.first().getAttribute('data-shape-adjust'), '12');
    await p.locator('[data-act=redo]').click();
    assert.equal(await shapes.first().getAttribute('data-shape-adjust'), '32');
    await p.locator('[data-shape-prop=fill]').fill('#e03131');
    assert.equal(await shapes.first().locator('rect').getAttribute('fill'), '#e03131');
    assert.equal(await p.locator('.shape-fill-color .shape-swatch').evaluate(n => getComputedStyle(n).borderRadius), '50%');
    assert.equal(await p.locator('.shape-fill-color .shape-swatch').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(224, 49, 49)');
    await p.locator('[data-shape-prop=width]').fill('0');
    await p.locator('[data-shape-prop=stroke]').fill('#19a974');
    assert.equal(await shapes.first().getAttribute('data-shape-width'), '2', 'changing a hidden stroke makes it visible');
    assert.equal(await shapes.first().locator('rect').getAttribute('stroke'), '#19a974');
    assert.equal(await p.locator('.shape-number-field').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(56, 56, 56)');
    await p.locator('[data-act=shape-width-up]').click();
    assert.equal(await shapes.first().getAttribute('data-shape-width'), '3');
    await p.locator('[data-act=shape-width-down]').click();
    assert.equal(await shapes.first().getAttribute('data-shape-width'), '2');
    assert.equal(await p.locator('.shape-stroke-color .shape-swatch').evaluate(n => getComputedStyle(n).borderRadius), '50%');
    assert.equal(await p.locator('.shape-stroke-color .shape-swatch').evaluate(n => getComputedStyle(n).borderTopColor), 'rgb(25, 169, 116)');
    assert.equal(await p.locator('.shape-stroke-color .shape-swatch').evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
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

test('every inserted shape responds to its visible controls', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await p.setContent(shell(''));
    await p.addScriptTag({ content: editor });
    await p.locator('[data-act=edit]').click();
    for (const kind of ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow', 'blockArrow']) {
      await p.locator('[data-act=add-shape]').click();
      await p.locator(`[data-shape-kind=${kind}]`).click();
      const shape = p.locator(`svg[data-shape=${kind}]`);
      assert.ok(await p.locator('.shape-tools').isVisible(), `${kind} controls visible`);
      if (kind !== 'line' && kind !== 'arrow') {
        const gap = await shape.evaluate(n => {
          const box = n.getBoundingClientRect(), path = n.firstElementChild, b = path.getBBox(), m = path.getScreenCTM();
          const a = new DOMPoint(b.x, b.y).matrixTransform(m), z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
          return Math.max(a.x - box.left, a.y - box.top, box.right - z.x, box.bottom - z.y);
        });
        assert.ok(gap < 4, `${kind} fills its selection frame (gap ${gap}px)`);
      }
      await p.locator('[data-shape-prop=stroke]').fill('#ef4444');
      assert.equal(await shape.locator(':scope > *').getAttribute('stroke'), '#ef4444', `${kind} stroke`);
      await p.locator('[data-shape-prop=width]').fill('5');
      assert.equal(await shape.locator(':scope > *').getAttribute('stroke-width'), '5', `${kind} width`);
      assert.equal(await shape.locator(':scope > *').getAttribute('vector-effect'), null, `${kind} stroke follows canvas zoom`);
      if (kind !== 'line' && kind !== 'arrow') {
        await p.locator('[data-shape-prop=fill]').fill('#22c55e');
        assert.equal(await shape.locator(':scope > *').getAttribute('fill'), '#22c55e', `${kind} fill`);
      }
      if (['rect', 'star', 'arrow', 'blockArrow'].includes(kind)) {
        const before = await shape.innerHTML();
        await p.locator('[data-shape-prop=adjust]').evaluate(n => {
          n.value = '42'; n.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.notEqual(await shape.innerHTML(), before, `${kind} geometry previews`);
        await p.locator('[data-shape-prop=adjust]').dispatchEvent('change');
      }
    }
  } finally { await p.close(); }
});

test('AI shape markup materializes editable parameters and visible geometry', async () => {
  const markup = shapeMarkup({ id: 'p1-ai-rect', kind: 'rect', fill: '#112233', stroke: '#ee4433', strokeWidth: 6, adjust: 24, width: 300, height: 90 });
  const p = await browser.newPage();
  try {
    await p.setContent(shell(markup));
    const shape = p.locator('[data-el=p1-ai-rect]');
    assert.equal(await shape.locator('rect').getAttribute('rx'), '24');
    assert.equal(await shape.locator('rect').getAttribute('stroke-width'), '6');
    assert.equal(await shape.locator('rect').getAttribute('vector-effect'), null);
    assert.equal(await shape.getAttribute('viewBox'), '0 0 300 90');
    await p.addScriptTag({ content: `globalThis.__htmlDesignGeometry = ${elementGeometry.toString()};` });
    const exported = await p.evaluate(collectEditableSlide, await p.locator('[data-artboard=p1]').elementHandle());
    const native = exported.items.find(item => item.name === 'p1-ai-rect');
    assert.ok(Math.abs(native.radiusScale - 1) < .01, `PPTX radius matches HTML pixels: ${native.radiusScale}`);
    await p.addScriptTag({ content: editor });
    await p.locator('[data-act=edit]').click();
    await shape.evaluate(n => {
      n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 }));
      n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0 }));
    });
    assert.equal(await p.locator('[data-shape-prop=fill]').inputValue(), '#112233');
    assert.equal(await p.locator('[data-shape-prop=stroke]').inputValue(), '#ee4433');
    assert.equal(await p.locator('[data-shape-prop=width]').inputValue(), '6');
    assert.equal(await p.locator('[data-shape-prop=adjust]').inputValue(), '24');
    assert.equal(await p.locator('.rotate-handle').isVisible(), true, 'shape retains the current editor rotation handle');
  } finally { await p.close(); }
});

test('small shapes keep valid geometry with the maximum stroke width', async () => {
  const p = await browser.newPage();
  try {
    await p.setContent(shell(['rect', 'ellipse', 'star'].map((kind, i) =>
      shapeMarkup({ id: `p1-tiny-${i}`, kind, width: 8, height: 8, strokeWidth: 16 })
    ).join('')));
    for (const shape of await p.locator('svg[data-shape]').all()) {
      const bounds = await shape.locator(':scope > *').evaluate(n => {
        const { width, height } = n.getBBox(); return { width, height };
      });
      assert.ok(bounds.width > 0 && bounds.height > 0, `valid ${await shape.getAttribute('data-shape')} geometry`);
    }
  } finally { await p.close(); }
});

test('PPTX keeps a rotated shape at its local size and angle', async () => {
  const p = await browser.newPage();
  try {
    await p.setContent(shell(shapeMarkup({ id: 'p1-rotated', kind: 'rect', width: 200, height: 100 }) ));
    await p.locator('[data-el=p1-rotated]').evaluate(n => { n.style.rotate = '45deg'; });
    await p.addScriptTag({ content: `globalThis.__htmlDesignGeometry = ${elementGeometry.toString()};` });
    const exported = await p.evaluate(collectEditableSlide, await p.locator('[data-artboard=p1]').elementHandle());
    const native = exported.items.find(item => item.name === 'p1-rotated');
    assert.ok(Math.abs(native.w - 200) < 1 && Math.abs(native.h - 100) < 1, `local size: ${native.w}×${native.h}`);
    assert.ok(Math.abs(native.rotation - 45) < .01, `angle: ${native.rotation}`);
  } finally { await p.close(); }
});

test('resizing a shape keeps its stroke and corner radius while recomputing geometry', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await p.setContent(shell(shapeMarkup({ id: 'p1-resize', kind: 'rect', strokeWidth: 8, adjust: 18, width: 200, height: 120 })));
    await p.addScriptTag({ content: editor });
    await p.locator('[data-act=edit]').click();
    await p.locator('[data-el=p1-resize]').click();
    const handle = await p.locator('[data-h=e]').boundingBox();
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + 100, y, { steps: 5 });
    await p.mouse.up();
    const shape = p.locator('[data-el=p1-resize]');
    const resized = (await shape.getAttribute('viewBox')).split(' ').map(Number);
    assert.ok(resized[2] > 250 && Math.abs(resized[3] - 120) < .01, `viewBox follows the stretched frame: ${resized}`);
    assert.equal(await shape.locator('rect').getAttribute('rx'), '18');
    assert.equal(await shape.locator('rect').getAttribute('stroke-width'), '8');
    assert.equal(await shape.locator('rect').getAttribute('vector-effect'), null);
    await p.locator('[data-act=undo]').click();
    assert.equal(await shape.getAttribute('viewBox'), '0 0 200 120');
    assert.equal(await shape.locator('rect').getAttribute('width'), '192');
    await p.locator('[data-act=redo]').click();
    assert.equal(await shape.locator('rect').getAttribute('width'), String(resized[2] - 8));
  } finally { await p.close(); }
});

test('undo during an uncommitted slider preview restores the parameter without deleting the shape', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await p.setContent(shell(''));
    await p.addScriptTag({ content: editor });
    await p.locator('[data-act=edit]').click();
    await p.locator('[data-act=add-shape]').click();
    await p.locator('[data-shape-kind=rect]').click();
    await p.locator('[data-shape-prop=adjust]').evaluate(n => {
      n.focus(); n.value = '40'; n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await p.locator('svg[data-shape=rect] rect').getAttribute('rx'), '40');
    await p.keyboard.press('ControlOrMeta+z');
    assert.equal(await p.locator('svg[data-shape=rect]').count(), 1);
    assert.equal(await p.locator('svg[data-shape=rect] rect').getAttribute('rx'), '12');
  } finally { await p.close(); }
});

test('saving during an active slider preview keeps the value and its undo boundary', async () => {
  const p = await browser.newPage({ acceptDownloads: true });
  try {
    await p.setContent(shell(''));
    await p.addScriptTag({ content: editor });
    await p.locator('[data-act=edit]').click();
    await p.locator('[data-act=add-shape]').click();
    await p.locator('[data-shape-kind=rect]').click();
    await p.locator('[data-shape-prop=adjust]').evaluate(n => {
      n.focus(); n.value = '40'; n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const download = p.waitForEvent('download');
    await p.keyboard.press('ControlOrMeta+s');
    assert.match(await readFile(await (await download).path(), 'utf8'), /data-shape-adjust="40"/);
    await p.locator('[data-act=undo]').click();
    assert.equal(await p.locator('svg[data-shape=rect]').count(), 1);
    assert.equal(await p.locator('svg[data-shape=rect] rect').getAttribute('rx'), '12');
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
  assert.ok(widthOf(2) > 179 && widthOf(2) < 181, `line arrow uses its editable frame: ${widthOf(2)}`);
  assert.ok(widthOf(4) > 179 && widthOf(4) < 181, `star uses its editable frame: ${widthOf(4)}`);
});
