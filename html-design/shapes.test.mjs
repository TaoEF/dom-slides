import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { browserOptions } from './export.mjs';
import { createPreviewServer } from './server.mjs';
import { shapeMarkup } from './src/shapes.js';
import { arrowShapeKinds, arrowShapeMarkup, connectorKinds, connectorMarkup, arrowMarkup } from './src/line-arrow.js';
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

async function drag(p, from, to) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, {steps: 5});
  await p.mouse.up();
}
async function drawArrow(p, start = [.65, .7], end = [.32, .35]) {
  const b = await p.locator('[data-artboard=p1]').boundingBox();
  const point = ([x, y]) => ({x: b.x + b.width * x, y: b.y + b.height * y});
  await drag(p, point(start), point(end));
  return {start: point(start), end: point(end)};
}

test('shape palette inserts its three rows as persistent, individually editable elements; parameters undo and reopen', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  try {
    await p.setContent(shell(''));
    await p.addScriptTag({ content: editor });
    await p.locator('[data-act=edit]').click();
    assert.equal(await p.locator('[data-act=export]').evaluate(n => getComputedStyle(n).fontSize), '13px');
    const kinds = ['rect', 'ellipse', 'triangle', 'diamond', 'star', ...connectorKinds, ...arrowShapeKinds];
    for (const kind of kinds) {
      await p.locator('[data-act=add-shape]').click();
      assert.deepEqual(await p.locator('.shape-row').evaluateAll(rows => rows.map(row => row.querySelectorAll('button').length)), [5,4,6]);
      assert.equal((await p.locator('[data-menu=shape]').innerText()).trim(), '');
      await p.locator(`[data-act=shape-insert][data-shape-kind=${kind}]`).click();
      if (connectorKinds.includes(kind)) await drawArrow(p, [.35,.75], [.64,.75]);
    }
    const shapes = p.locator('[data-artboard=p1] svg[data-shape]');
    assert.equal(await shapes.count(), kinds.length);
    const ids = await shapes.evaluateAll(nodes => nodes.map(n => n.dataset.el));
    assert.equal(new Set(ids).size, kinds.length);
    const lineCoverage = await p.locator('svg[data-shape=line]').evaluate(n => {
      const path = n.querySelector('[data-shape-ink]'), b = path.getBBox(), m = path.getScreenCTM();
      return b.width * m.a / n.getBoundingClientRect().width;
    });
    assert.ok(lineCoverage > .85, `line spans its selection box: ${lineCoverage}`);
    await shapes.first().evaluate(n => {
      n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 }));
      n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0 }));
    });
    const adjust = p.locator('[data-shape-prop=radius]');
    await adjust.evaluate(n => { n.value = '32'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await shapes.first().locator('rect').getAttribute('rx'), '32', 'slider previews before release');
    await adjust.dispatchEvent('change');
    assert.equal(await shapes.first().getAttribute('data-shape-radius'), '32');
    await p.locator('[data-act=undo]').click();
    assert.equal(await shapes.first().getAttribute('data-shape-radius'), '12');
    await p.locator('[data-act=redo]').click();
    assert.equal(await shapes.first().getAttribute('data-shape-radius'), '32');
    await p.locator('[data-act=shape-fill-color]').click();
    await p.locator('[data-palette-custom]').click();
    await p.locator('.palette-hex').fill('#e03131');
    await p.locator('.palette-hex-form button').click();
    assert.equal(await shapes.first().locator('rect').getAttribute('fill'), '#E03131');
    assert.equal(await p.locator('.shape-fill-color .shape-swatch').evaluate(n => getComputedStyle(n).borderRadius), '50%');
    assert.equal(await p.locator('.shape-fill-color .shape-swatch').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(224, 49, 49)');
    await p.locator('[data-shape-prop=width]').fill('0');
    await p.locator('[data-act=shape-stroke-color]').click();
    await p.locator('[data-palette-custom]').click();
    await p.locator('.palette-hex').fill('#19a974');
    await p.locator('.palette-hex-form button').click();
    assert.equal(await shapes.first().getAttribute('data-shape-width'), '2', 'changing a hidden stroke makes it visible');
    assert.equal(await shapes.first().locator('rect').getAttribute('stroke'), '#19A974');
    assert.equal(await p.locator('.shape-tools .number-stepper').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(56, 56, 56)');
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
      assert.equal(await reopened.locator('svg[data-shape]').count(), kinds.length);
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
      if (connectorKinds.includes(kind)) await drawArrow(p);
      const shape = p.locator(`svg[data-shape=${kind}]`);
      const ink = shape.locator(connectorKinds.includes(kind) || arrowShapeKinds.includes(kind) ? '[data-shape-ink]' : ':scope > *');
      assert.ok(await p.locator('.shape-tools').isVisible(), `${kind} controls visible`);
      if (kind !== 'line' && kind !== 'arrow') {
        const gap = await shape.evaluate(n => {
          const box = n.getBoundingClientRect(), path = n.firstElementChild, b = path.getBBox(), m = path.getScreenCTM();
          const a = new DOMPoint(b.x, b.y).matrixTransform(m), z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
          return Math.max(a.x - box.left, a.y - box.top, box.right - z.x, box.bottom - z.y);
        });
        assert.ok(gap < 4, `${kind} fills its selection frame (gap ${gap}px)`);
      }
      await p.locator('[data-act=shape-stroke-color]').click();
      await p.locator('[data-palette-custom]').click();
      await p.locator('.palette-hex').fill('#ef4444');
      await p.locator('.palette-hex-form button').click();
      assert.equal(await ink.getAttribute('stroke'), '#EF4444', `${kind} stroke`);
      await p.locator('[data-shape-prop=width]').fill('5');
      assert.equal(await ink.getAttribute('stroke-width'), '5', `${kind} width`);
      assert.equal(await ink.getAttribute('vector-effect'), null, `${kind} stroke follows canvas zoom`);
      if (kind !== 'line' && kind !== 'arrow') {
        await p.locator('[data-act=shape-fill-color]').click();
        await p.locator('[data-palette-custom]').click();
        await p.locator('.palette-hex').fill('#22c55e');
        await p.locator('.palette-hex-form button').click();
        assert.equal(await shape.locator(':scope > *').getAttribute('fill'), '#22C55E', `${kind} fill`);
      }
      if (['rect', 'triangle', 'diamond', 'star', 'blockArrow'].includes(kind)) {
        const before = await shape.innerHTML();
        await p.locator('[data-shape-prop=radius]').evaluate(n => {
          n.value = '24'; n.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.notEqual(await shape.innerHTML(), before, `${kind} rounded contour previews`);
        await p.locator('[data-shape-prop=radius]').dispatchEvent('change');
      }
      if (kind === 'star') {
        const before = await shape.innerHTML();
        await shape.dispatchEvent('contextmenu', { button: 2 });
        assert.equal(await p.locator('[data-menu=element]').isVisible(), true);
        assert.equal(await p.locator('.shape-more-section').isVisible(), true);
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
  const markup = shapeMarkup({ id: 'p1-ai-rect', kind: 'rect', fill: '#112233', stroke: '#ee4433', strokeWidth: 6, radius: 24, width: 300, height: 90 });
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
    assert.equal(await p.locator('[data-shape-prop=radius]').inputValue(), '24');
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
    await p.locator('[data-shape-prop=radius]').evaluate(n => {
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
    await p.locator('[data-shape-prop=radius]').evaluate(n => {
      n.focus(); n.value = '40'; n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const download = p.waitForEvent('download');
    await p.keyboard.press('ControlOrMeta+s');
    assert.match(await readFile(await (await download).path(), 'utf8'), /data-shape-radius="40"/);
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


test('drawn arrow endpoints are independent, with fixed ink geometry and one undo per gesture', async () => {
  const p = await browser.newPage({viewport:{width:1440,height:900}});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const arrow = p.locator('svg[data-shape-endpoints]');
  const handle = index => p.locator(`[data-arrow-end="${index}"]`);
  const points = () => arrow.evaluate(n => n.dataset.shapeEndpoints.split(' ').map(Number).reduce((out, value, i, a) => {
    if (!(i % 2)) {
      const {x, y} = new DOMPoint(value, a[i+1]).matrixTransform(n.getScreenCTM());
      out.push({x,y});
    }
    return out;
  }, []));
  const near = (a, b) => assert.ok(Math.hypot(a.x-b.x,a.y-b.y) < 2, JSON.stringify([a,b]));
  const arm = async () => {
    await p.locator('[data-act=add-shape]').click();
    await p.locator('[data-shape-kind=arrow]').click();
  };
  try {
    await p.setContent(shell(''));
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    await arm();
    await p.keyboard.press('Escape');
    const b = await p.locator('[data-artboard=p1]').boundingBox();
    await drag(p,{x:b.x+100,y:b.y+100},{x:b.x+200,y:b.y+200});
    assert.equal(await arrow.count(),0);
    await arm();
    const original = await drawArrow(p);
    const originalPoints = await points();
    near(originalPoints[0], original.start);
    near(originalPoints[1], original.end);
    assert.ok(await handle(0).isVisible() && await handle(1).isVisible());
    assert.equal(await p.locator('.sel').isVisible(), false);
    const originalMarkup = await arrow.evaluate(n => n.outerHTML);
    const newTip = {x:original.start.x, y:original.end.y - 25};
    await drag(p,originalPoints[1],newTip);
    const next = await points();
    near(next[0],originalPoints[0]); near(next[1],newTip);
    const dimensions = await arrow.evaluate(n => {
      const path = n.querySelector('[data-shape-ink]');
      const pts = path.getAttribute('d').match(/-?[\d.]+/g).map(Number);
      return [Number(path.getAttribute('stroke-width')),Math.hypot(pts[4]-pts[8],pts[5]-pts[9]),Math.abs((pts[4]+pts[8])/2-pts[6])+Math.abs((pts[5]+pts[9])/2-pts[7])];
    });
    assert.deepEqual(dimensions.map(Math.round), [4,18,16]);
    const movedMarkup = await arrow.evaluate(n => n.outerHTML);
    await drag(p,next[0],{x:newTip.x + 180,y:newTip.y});
    const reversed = await points();
    near(reversed[1],next[1]);
    assert.ok(reversed[0].x > reversed[1].x && Math.abs(reversed[0].y-reversed[1].y) < 2);
    await p.locator('[data-act=undo]').click();
    assert.equal(await arrow.evaluate(n => n.outerHTML),movedMarkup);
    await p.locator('[data-act=undo]').click();
    assert.equal(await arrow.evaluate(n => n.outerHTML),originalMarkup);
    await p.locator('[data-act=redo]').click();
    assert.equal(await arrow.evaluate(n => n.outerHTML),movedMarkup);
    const saved = await p.locator('[data-artboard=p1]').evaluate(b => ({style:b.getAttribute('style'),content:b.innerHTML}));
    const reopened = await browser.newPage();
    try {
      await reopened.setContent(shell(saved.content));
      await reopened.locator('[data-artboard=p1]').evaluate((n,style)=>n.setAttribute('style',style),saved.style);
      const ink = reopened.locator('[data-shape-ink]');
      assert.ok(await ink.isVisible());
      await reopened.addScriptTag({content:editor});
      await reopened.locator('[data-act=edit]').click();
      await ink.dispatchEvent('pointerdown',{button:0,pointerId:1});
      await ink.dispatchEvent('pointerup',{button:0,pointerId:1});
      assert.ok(await reopened.locator('[data-arrow-end="1"]').isVisible());
    } finally { await reopened.close(); }
    assert.deepEqual(errors,[]);
  } finally { await p.close(); }
});

test('diagonal arrow exports as a native directed PowerPoint line', async () => {
  const html = shell('<svg data-el="native-arrow" data-shape="arrow" data-shape-endpoints="260 160 10 10" viewBox="0 0 280 180" style="display:block;width:280px;height:180px"><path data-shape-ink="" d="M260 160L10 10" stroke="#164056" fill="none" stroke-width="4"/></svg>');
  const response = await fetch(`${origin}/__html-design/export/pptx`, {
    method: 'POST', headers: {'Content-Type':'application/json',Origin:origin},
    body: JSON.stringify({html,title:'Directed arrow'}),
  });
  assert.equal(response.status,200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /name="native-arrow"/);
  assert.match(xml, /<a:xfrm[^>]*flipH="1"[^>]*flipV="1"/);
  assert.match(xml, /prst="line"/);
  assert.match(xml, /<a:tailEnd type="arrow"/);
  assert.doesNotMatch(xml, /<p:pic>/);
});

test('drawing on a static board leaves existing absolute content in place', async () => {
  const p = await browser.newPage({viewport:{width:1440,height:900}});
  try {
    await p.setContent(shell('<div data-el="label" style="position:absolute;left:10px;top:10px">Stage-relative label</div>'));
    const board = p.locator('[data-artboard=p1]');
    // A border separates the static board's padding origin from the stage origin.
    await board.evaluate(n => {n.style.border='32px solid #ccc';});
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    const label = p.locator('[data-el=label]');
    const before = await label.boundingBox();
    await p.locator('[data-act=add-shape]').click();
    await p.locator('[data-shape-kind=arrow]').click();
    await drawArrow(p);
    assert.equal(await p.locator('svg[data-shape-endpoints]').count(),0);
    assert.deepEqual(await label.boundingBox(),before);
    assert.equal(await board.evaluate(n=>getComputedStyle(n).position),'static');
    assert.equal(await p.locator('[data-stage]').getAttribute('data-element-seq'),null);
  } finally { await p.close(); }
});


test('arrow endpoints match the mouse on a scrolled artboard', async () => {
  const p = await browser.newPage({viewport:{width:1440,height:900}});
  try {
    await p.setContent(shell('<div style="height:1200px;width:1300px"></div>'));
    const board = p.locator('[data-artboard=p1]');
    await board.evaluate(n => Object.assign(n.style,{overflow:'auto',position:'relative'}));
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    await board.evaluate(n=>n.scrollTo(100,180));
    await p.locator('[data-act=add-shape]').click();
    await p.locator('[data-shape-kind=arrow]').click();
    const {start,end} = await drawArrow(p);
    const endpoints = await p.locator('svg[data-shape-endpoints]').evaluate(n => {
      const [x1,y1,x2,y2] = n.dataset.shapeEndpoints.split(' ').map(Number), m = n.getScreenCTM();
      return [[x1,y1],[x2,y2]].map(([x,y]) => {
        const point = new DOMPoint(x,y).matrixTransform(m);
        return {x:point.x,y:point.y};
      });
    });
    for (const [index, expected] of [start,end].entries())
      assert.ok(Math.hypot(endpoints[index].x-expected.x,endpoints[index].y-expected.y) < 2);
  } finally { await p.close(); }
});


test('parameter presets materialize rounded elbows, both ends, and repeated arrowheads offline', async () => {
  const p = await browser.newPage();
  try {
    const start={x:100,y:60},end={x:300,y:180};
    const markup = [
      connectorMarkup({id:'elbow',kind:'arrowElbow',start,end,radius:15}),
      connectorMarkup({id:'double',kind:'arrowDouble',start,end,strokeWidth:8}),
      arrowShapeMarkup({id:'heads',kind:'doubleChevron',headLength:44,gap:19,radius:6}),
    ];
    await p.setContent(shell(markup.join('')));
    const path = id => p.locator(`[data-el=${id}] [data-shape-ink]`);
    assert.equal((await path('elbow').getAttribute('d')).match(/Q/g).length,2);
    assert.equal((await path('double').getAttribute('d')).match(/M/g).length,3);
    assert.equal(await path('double').getAttribute('stroke-width'),'8');
    assert.equal((await path('heads').getAttribute('d')).match(/Z/g).length,2);
    assert.equal(await p.locator('[data-el=heads]').getAttribute('data-shape-gap'),'19');
  } finally { await p.close(); }
});

test('stretching a block arrow changes the shaft while preserving its arrowhead', async () => {
  const p = await browser.newPage({viewport:{width:1440,height:900}});
  try {
    await p.setContent(shell(arrowShapeMarkup({id:'block',kind:'blockArrow',headLength:60,headWidth:86,shaftWidth:29})));
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    const shape=p.locator('[data-el=block]');
    await shape.click();
    const geometry = () => shape.evaluate(n => {
      const d=n.querySelector('path').getAttribute('d').match(/-?[\d.]+/g).map(Number);
      return {width:parseFloat(n.style.width), headLength:Math.round((d[6]-d[4])*1000)/1000, headWidth:d[9]-d[5], stroke:n.querySelector('path').getAttribute('stroke-width')};
    });
    const before = await geometry();
    assert.equal(await p.locator('[data-h=s]').isVisible(),false);
    const handle = await p.locator('[data-h=e]').boundingBox();
    const from={x:handle.x+handle.width/2,y:handle.y+handle.height/2};
    await drag(p,from,{x:from.x+100,y:from.y});
    const after=await geometry();
    assert.ok(after.width > before.width + 50);
    assert.deepEqual({...after,width:before.width},before);
    await p.locator('[data-act=undo]').click();
    assert.deepEqual(await geometry(),before);
  } finally { await p.close(); }
});

test('PPTX exports double-ended lines and rounded elbows as editable native objects', async () => {
  const start={x:100,y:100},end={x:480,y:280};
  const html=shell(connectorMarkup({id:'double',kind:'arrowDouble',start,end})+
    connectorMarkup({id:'elbow',kind:'arrowElbow',start:{x:120,y:125},end})+
    arrowShapeMarkup({id:'chevrons',kind:'doubleChevron'}));
  const response=await fetch(`${origin}/__html-design/export/pptx`,{
    method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({html,title:'Arrow variants'}),
  });
  assert.equal(response.status,200);
  const zip=await JSZip.loadAsync(await response.arrayBuffer());
  const xml=await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml,/<a:headEnd type="arrow"/);
  assert.match(xml,/<a:tailEnd type="arrow"/);
  assert.equal((xml.match(/<a:custGeom>/g)||[]).length,2);
  assert.match(xml,/<a:quadBezTo>/);
  assert.doesNotMatch(xml,/<p:pic>/);
});


test('dragging an elbow endpoint recalculates its route and keeps the other endpoint anchored', async () => {
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  try {
    await p.setContent(shell(''));
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    await p.locator('[data-act=add-shape]').click();
    await p.locator('[data-shape-kind=arrowElbow]').click();
    const {start,end}=await drawArrow(p);
    const arrow=p.locator('svg[data-shape=arrowElbow]');
    const ink=arrow.locator('[data-shape-ink]');
    const before=await ink.getAttribute('d');
    assert.equal(before.match(/Q/g).length,2);
    const to={x:end.x+45,y:end.y+80};
    await drag(p,end,to);
    const points=await arrow.evaluate(n=>{
      const [x,y,u,v]=n.dataset.shapeEndpoints.split(' ').map(Number);
      return [[x,y],[u,v]].map(([a,b]) => new DOMPoint(a,b).matrixTransform(n.getScreenCTM()).toJSON());
    });
    assert.ok(Math.hypot(points[0].x-start.x,points[0].y-start.y)<2);
    assert.ok(Math.hypot(points[1].x-to.x,points[1].y-to.y)<2);
    assert.notEqual(await ink.getAttribute('d'),before);
    await p.locator('[data-act=undo]').click();
    assert.equal(await ink.getAttribute('d'),before);
  } finally { await p.close(); }
});

async function dragHandle(p,selector,dx,dy) {
  const box=await p.locator(selector).boundingBox();
  const from={x:box.x+box.width/2,y:box.y+box.height/2};
  await drag(p,from,{x:from.x+dx,y:from.y+dy});
}

test('double chevron gap is a signed menu and DSL parameter independent of its corner handle', async () => {
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  try {
    await p.setContent(shell(arrowMarkup({id:'heads',kind:'doubleChevron',headLength:50,gap:-8})));
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    const heads=p.locator('[data-el=heads]');
    await heads.click();
    assert.equal(await p.locator('[data-h=e]').isVisible(),false);
    assert.equal(await heads.evaluate(n=>n.offsetWidth || parseFloat(n.style.width)),92);
    await dragHandle(p,'[data-h=se]',30,30);
    assert.equal(await heads.getAttribute('data-shape-gap'),'-8');
    await heads.click({button:'right'});
    const gap=p.locator('[data-arrow-param=gap]');
    const before = await heads.evaluate(n=>parseFloat(n.style.width));
    await gap.fill('-20');
    await gap.dispatchEvent('change');
    assert.equal(await heads.getAttribute('data-shape-gap'),'-20');
    assert.ok(Math.abs(await heads.evaluate(n=>parseFloat(n.style.width))-before+12)<.01);
    await p.keyboard.press('Escape');
    await p.locator('[data-act=undo]').click();
    assert.equal(await heads.getAttribute('data-shape-gap'),'-8');
  } finally { await p.close(); }
});

test('the elbow middle handle edits bend DSL and preserves both endpoints', async () => {
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  const start={x:120,y:300},end={x:560,y:100};
  try {
    await p.setContent(shell(arrowMarkup({id:'elbow',kind:'arrowElbow',start,end,bend:.6,bendAxis:'vertical',radius:18})));
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    const arrow=p.locator('[data-el=elbow]');
    const ink = arrow.locator('[data-shape-ink]');
    await ink.dispatchEvent('pointerdown',{button:0,bubbles:true,pointerId:1});
    await ink.dispatchEvent('pointerup',{button:0,bubbles:true,pointerId:1});
    const endpoints = await arrow.getAttribute('data-shape-endpoints');
    const d = await ink.getAttribute('d');
    await dragHandle(p,'[data-arrow-bend]',-65,0);
    assert.equal(await arrow.getAttribute('data-shape-endpoints'),endpoints);
    assert.ok(Number(await arrow.getAttribute('data-shape-bend'))<.6);
    assert.equal(await arrow.getAttribute('data-shape-bend-axis'),'vertical');
    assert.notEqual(await ink.getAttribute('d'),d);
    const hit=await arrow.evaluate(n=>{
      const [x,y]=n.dataset.shapeEndpoints.split(' ').map(Number);
      return new DOMPoint(x+20,y).matrixTransform(n.getScreenCTM()).toJSON();
    });
    await p.mouse.click(hit.x,hit.y,{button:'right'});
    const field=p.locator('[data-arrow-param=bend]');
    await field.fill('35');
    assert.equal(await arrow.getAttribute('data-shape-bend'),'0.35');
    await p.locator('[data-act=arrow-reset-bend]').click();
    assert.equal(await arrow.getAttribute('data-shape-bend'),'0.5');
    assert.equal(await arrow.getAttribute('data-shape-bend-axis'),'auto');
    await p.locator('[data-act=undo]').click();
    assert.equal(await arrow.getAttribute('data-shape-bend'),'0.35');
  } finally { await p.close(); }
});

test('shaft corner changes head dimensions at a fixed tip and triangle sides stretch width only', async () => {
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  try {
    const block = arrowMarkup({id:'block',kind:'blockArrow',width:250,headLength:60,headWidth:82,strokeWidth:3,shaftWidth:35});
    const triangle = arrowMarkup({id:'triangle',kind:'triangleHead',headLength:75,headWidth:90});
    await p.setContent(shell(block+triangle));
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    const shaft=p.locator('[data-el=block]');
    await shaft.click();
    const tip=()=>shaft.evaluate(n=>{
      const {width,height}=n.viewBox.baseVal;
      return new DOMPoint(width-Number(n.dataset.shapeWidth)/2,height/2).matrixTransform(n.getScreenCTM()).toJSON();
    });
    const before=await tip();
    await dragHandle(p,'[data-h=se]',24,35);
    const after=await tip();
    assert.ok(Math.hypot(before.x-after.x,before.y-after.y)<1);
    const shape=await shaft.evaluate(n=>({width:parseFloat(n.style.width),headLength:Number(n.dataset.shapeHeadLength),headWidth:Number(n.dataset.shapeHeadWidth),strokeWidth:Number(n.dataset.shapeWidth)}));
    assert.equal(shape.width,250);
    assert.equal(shape.strokeWidth,3);
    assert.ok(shape.headLength>60 && shape.headWidth>82);
    await dragHandle(p,'[data-h=se]',-145,-165);
    const shaftThickness=await shaft.locator('[data-shape-ink]').evaluate(n=>{
      const points=n.getAttribute('d').match(/-?[\d.]+/g).map(Number);
      return points.at(-1)-points[1];
    });
    assert.equal(shaftThickness,35);
    const head=p.locator('[data-el=triangle]');
    await head.click();
    await dragHandle(p,'[data-h=e]',50,0);
    assert.equal(await head.getAttribute('data-shape-head-width'),'90');
    assert.ok(Number(await head.getAttribute('data-shape-head-length'))>75);
  } finally { await p.close(); }
});


test('a paint-only edit preserves the centering of a legacy widened arrowhead', async () => {
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  try {
    const legacy=arrowMarkup({id:'legacy',kind:'triangleHead',radius:0,headLength:86,headWidth:96})
      .replace('viewBox="0 0 86 96"','viewBox="0 0 200 96"').replace('width:86px','width:200px')
      .replace('d="M0 0L86 48L0 96Z"','d="M57 0L143 48L57 96Z"');
    await p.setContent(shell(legacy));
    await p.addScriptTag({content:editor});
    await p.locator('[data-act=edit]').click();
    const shape=p.locator('[data-el=legacy]'), ink=shape.locator('[data-shape-ink]');
    assert.match(await ink.getAttribute('d'),/^M57/);
    await shape.click();
    await p.locator('[data-act=shape-fill-color]').click();
    await p.locator('[data-palette-custom]').click();
    await p.locator('.palette-hex').fill('#326ACC');
    await p.locator('.palette-hex-form button').click();
    assert.equal(await ink.getAttribute('fill'),'#326ACC');
    assert.equal(await shape.getAttribute('viewBox'),'0 0 200 96');
    assert.equal(await ink.getAttribute('d'),'M57 0L143 48L57 96Z');
  } finally { await p.close(); }
});
