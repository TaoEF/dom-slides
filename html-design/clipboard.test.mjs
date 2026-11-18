import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './export.mjs';
import { shapeMarkup } from './src/shapes.js';

let browser, editor;
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#f55"/></svg>');
const fixture = `<!doctype html><html><head><style>
body{margin:0}[data-stage]{display:flex;flex-direction:column;gap:30px}
[data-artboard]{width:800px;height:450px;position:relative;background:white;padding:30px;box-sizing:border-box}
h1{font:40px/1.2 Arial;margin:0}img{display:block;width:120px;height:80px;object-fit:cover}
</style></head><body><main data-stage>
<section data-artboard="p1" data-mode="flow" data-title="One">
<h1 data-el="title">Hello</h1><img data-el="image" src="${image}" alt="red">
${shapeMarkup({id:'shape',kind:'triangle',fill:'#ff6655',stroke:'#223344',strokeWidth:4,radius:9,width:90,height:75})}
<input id="native-input" value="native text">
</section>
<section data-artboard="p2" data-mode="flow" data-title="Two"><h1 data-el="other">Other</h1></section>
</main></body></html>`;
before(async () => { editor = await readFile('html-design/editor.js', 'utf8'); browser = await chromium.launch(browserOptions()); });
after(async () => { await browser?.close(); });
async function open(context, html = fixture) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.errors = errors;
  await page.setContent(html);
  await page.addScriptTag({ content: editor });
  await page.locator('[data-act=edit]').click();
  return page;
}
async function context() { return browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }); }

test('object clipboard pastes on the same page with new IDs and one undo step', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-el=title]').click();
    await p.keyboard.press('ControlOrMeta+C');
    await p.keyboard.press('ControlOrMeta+V');
    const titles = p.locator('[data-artboard=p1] h1[data-el]');
    assert.equal(await titles.count(), 2);
    assert.deepEqual(await titles.evaluateAll(nodes => nodes.map(n => n.dataset.el).sort()), ['p1-copy-1', 'title']);
    await p.locator('[data-act=undo]').click();
    assert.equal(await titles.count(), 1);
    await p.locator('[data-act=redo]').click();
    assert.equal(await titles.count(), 2);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('Cut removes selected objects once, restores them on Undo, and pastes on another page', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-el=shape]').click();
    await p.locator('[data-el=image]').click({ modifiers: ['Shift'] });
    await p.keyboard.press('ControlOrMeta+X');
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), 1);
    assert.match(await p.locator('.toast').textContent(), /已剪切元素/);
    await p.locator('[data-act=undo]').click();
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), 3);
    await p.locator('[data-act=redo]').click();
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), 1);
    await p.locator('.thumb[data-page-id=p2] .thumb-main').click();
    await p.keyboard.press('ControlOrMeta+V');
    assert.equal(await p.locator('[data-artboard=p2] [data-el]').count(), 3);
    assert.equal(await p.locator('[data-artboard=p2] svg[data-shape=triangle]').count(), 1);
    assert.equal(await p.locator('[data-artboard=p2] img').getAttribute('src'), image);
    await p.locator('[data-act=undo]').click();
    assert.equal(await p.locator('[data-artboard=p2] [data-el]').count(), 1);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('context menu Copy and Cut use the clipboard; duplicate remains in place', async () => {
  const c = await context(), p = await open(c);
  const menu = async action => {
    await p.locator('[data-act=element-more]').click();
    await p.locator(`[data-menu=element] [data-act=${action}]`).click();
  };
  try {
    await p.locator('[data-el=title]').click();
    await menu('element-copy');
    assert.equal(await p.locator('[data-artboard=p1] h1[data-el]').count(), 1);
    await p.locator('.thumb[data-page-id=p2] .thumb-main').click();
    await p.keyboard.press('ControlOrMeta+V');
    assert.equal(await p.locator('[data-artboard=p2] h1[data-el]').count(), 2);
    await p.locator('.thumb[data-page-id=p1] .thumb-main').click();
    await p.locator('[data-el=title]').click();
    await menu('element-cut');
    assert.equal(await p.locator('[data-artboard=p1] h1[data-el]').count(), 0);
    await p.locator('[data-act=undo]').click();
    assert.equal(await p.locator('[data-artboard=p1] h1[data-el]').count(), 1);
    await p.locator('[data-el=title]').click();
    await menu('element-duplicate');
    assert.equal(await p.locator('[data-artboard=p1] h1[data-el]').count(), 2);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('right click exposes Cut and a cut object pastes into another tab', async () => {
  const c = await context(), source = await open(c), target = await open(c);
  try {
    await source.locator('[data-el=image]').click({ button: 'right' });
    assert.equal(await source.locator('[data-menu=element]').isVisible(), true);
    assert.equal(await source.locator('[data-menu=element] [data-act=element-cut]').isVisible(), true);
    await source.locator('[data-menu=element] [data-act=element-cut]').click();
    assert.equal(await source.locator('[data-artboard=p1] img[data-el]').count(), 0);
    await target.locator('.thumb[data-page-id=p2] .thumb-main').click();
    await target.keyboard.press('ControlOrMeta+V');
    assert.equal(await target.locator('[data-artboard=p2] img[data-el]').count(), 1);
    assert.equal(await target.locator('[data-artboard=p2] img').getAttribute('src'), image);
    await source.locator('[data-act=undo]').click();
    assert.equal(await source.locator('[data-artboard=p1] img[data-el]').count(), 1);
    assert.deepEqual(source.errors, []);
    assert.deepEqual(target.errors, []);
  } finally { await c.close(); }
});

test('failed Cut keeps the source; native text input still cuts its own text', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-artboard=p1]').evaluate((board, src) => {
      board.insertAdjacentHTML('beforeend', `<picture><source srcset="${src}"><img data-el="picture-image" src="${src}" alt="picture"></picture>`);
    }, image);
    await p.locator('[data-el=picture-image]').click();
    await p.keyboard.press('ControlOrMeta+X');
    assert.equal(await p.locator('[data-el=picture-image]').count(), 1);
    assert.match(await p.locator('.toast').textContent(), /暂不能单独跨页复制/);
    const input = p.locator('#native-input');
    await input.focus();
    await input.press('ControlOrMeta+A');
    await input.press('ControlOrMeta+X');
    assert.equal(await input.inputValue(), '');
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), 4);
    await p.locator('[data-el=title]').dblclick();
    await p.keyboard.press('ControlOrMeta+A');
    await p.keyboard.press('ControlOrMeta+X');
    assert.equal(await p.locator('[data-el=title]').count(), 1);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('pasted text remains editable by double click', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-el=title]').click();
    await p.keyboard.press('ControlOrMeta+C');
    await p.keyboard.press('ControlOrMeta+V');
    const pasted = p.locator('[data-el=p1-copy-1]');
    assert.equal(await pasted.evaluate(node => node.style.getPropertyValue('-webkit-user-modify')), '');
    await pasted.dblclick();
    assert.equal(await pasted.getAttribute('contenteditable'), 'true');
    await p.keyboard.type(' edited');
    assert.match(await pasted.textContent(), /edited/);
    await p.keyboard.press('Escape');
    await pasted.evaluate(node => node.style.setProperty('-webkit-user-modify', 'read-only'));
    await pasted.dblclick();
    await p.keyboard.type(' again');
    assert.match(await pasted.textContent(), /again/);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('copied text grows when narrowed, including an older fixed-height copy', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-el=title]').evaluate(node => { node.textContent = 'Copied text should wrap across several lines'; });
    await p.locator('[data-el=title]').click();
    await p.keyboard.press('ControlOrMeta+C');
    await p.keyboard.press('ControlOrMeta+V');
    const copied = p.locator('[data-el=p1-copy-1]');
    assert.equal(await copied.evaluate(node => node.style.height), 'auto');
    const initial = (await copied.boundingBox()).height;
    await copied.evaluate(node => { node.style.width = '140px'; });
    assert.ok((await copied.boundingBox()).height > initial * 2);
    await copied.evaluate((node, h) => {
      node.style.width = '740px'; node.style.height = `${h}px`; node.style.blockSize = `${h}px`;
    }, initial);
    await copied.click();
    const handle = await p.locator('.sel [data-h=e]').boundingBox();
    await p.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await p.mouse.down();
    await p.mouse.move(handle.x + handle.width / 2 - 600, handle.y + handle.height / 2, { steps: 5 });
    await p.mouse.up();
    assert.equal(await copied.evaluate(node => node.style.height), 'auto');
    assert.ok((await copied.boundingBox()).height > initial * 2);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('multi-object clipboard crosses pages and survives closing the source tab', async () => {
  const c = await context(), source = await open(c), target = await open(c);
  try {
    await source.locator('[data-el=shape]').click();
    await source.locator('[data-el=image]').click({ modifiers: ['Shift'] });
    await source.keyboard.press('ControlOrMeta+C');
    await source.close();
    await target.locator('.thumb[data-page-id=p2] .thumb-main').click();
    assert.equal(await target.evaluate(() => document.querySelector('html-design-editor').shadowRoot.activeElement?.classList.contains('thumb-main')), true);
    await target.keyboard.press('ControlOrMeta+V');
    assert.equal(await target.locator('[data-artboard=p2] [data-el]').count(), 3);
    assert.equal(await target.locator('[data-artboard=p2] svg[data-shape=triangle]').count(), 1);
    assert.equal(await target.locator('[data-artboard=p2] img').getAttribute('src'), image);
    assert.equal(await target.locator('[data-artboard=p2] svg[data-shape=triangle]').getAttribute('data-shape-radius'), '9');
    await target.locator('[data-act=undo]').click();
    assert.equal(await target.locator('[data-artboard=p2] [data-el]').count(), 1);
    await target.locator('[data-act=redo]').click();
    assert.equal(await target.locator('[data-artboard=p2] [data-el]').count(), 3);
    assert.deepEqual(target.errors, []);
  } finally { await c.close(); }
});

test('native input copy and paste keep their ordinary text behavior', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-el=title]').click();
    const input = p.locator('#native-input');
    await input.focus();
    await input.press('ControlOrMeta+A');
    await input.press('ControlOrMeta+C');
    await input.press('ControlOrMeta+V');
    assert.equal(await input.inputValue(), 'native text');
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), 3);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('text editing and preview do not paste canvas objects', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-el=image]').click();
    await p.keyboard.press('ControlOrMeta+C');
    await p.locator('[data-el=title]').dblclick();
    await p.keyboard.press('ControlOrMeta+V');
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), 3);
    await p.keyboard.press('Escape');
    await p.locator('[data-act=done]').click();
    await p.keyboard.press('ControlOrMeta+V');
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), 3);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('malformed clipboard data and conflicting target CSS leave no partial objects', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.evaluate(() => {
      const data = new DataTransfer();
      data.setData('application/x-dom-slides-objects+json', '{bad');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), 3);
    await p.locator('[data-el=title]').click();
    await p.keyboard.press('ControlOrMeta+C');
    await p.evaluate(() => { const style = document.createElement('style'); style.textContent = '[data-artboard=p2] h1{font-size:90px!important}'; document.head.append(style); });
    await p.locator('.footer [data-act=next]').click();
    await p.keyboard.press('ControlOrMeta+V');
    assert.equal(await p.locator('[data-artboard=p2] [data-el]').count(), 1);
    assert.match(await p.locator('.toast').textContent(), /保留原样/);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('cropped image stays one editable object and survives serialized reopen', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-artboard=p1]').evaluate((board, src) => {
      board.insertAdjacentHTML('beforeend', `<span data-el="crop" data-crop-frame="1" style="display:inline-block;width:120px;height:80px;overflow:clip;border-radius:12px"><img id="crop-original" data-crop-image="" src="${src}" style="width:100%;height:100%;object-fit:cover"></span>`);
    }, image);
    await p.locator('[data-el=crop]').click();
    await p.keyboard.press('ControlOrMeta+C');
    await p.locator('.footer [data-act=next]').click();
    await p.keyboard.press('ControlOrMeta+V');
    const frame = p.locator('[data-artboard=p2] [data-crop-frame]');
    assert.equal(await frame.count(), 1, await p.locator('.toast').textContent());
    assert.equal(await frame.locator('img[data-crop-image]').count(), 1);
    assert.match(await frame.locator('img').getAttribute('id'), /^p2-copy-\d+-crop-original$/);
    assert.equal(await frame.locator('img').getAttribute('data-el'), null);
    await p.locator('[data-act=more]').click();
    await p.locator('[data-act=source]').click();
    const saved = await p.locator('textarea').inputValue();
    const reopened = await c.newPage();
    await reopened.setContent(saved);
    assert.equal(await reopened.locator('[data-artboard=p2] [data-crop-frame] > img[data-crop-image]').count(), 1);
    await reopened.close();
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('ordinary pasted image file still uses the existing insert path', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.evaluate(() => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await p.waitForFunction(() => document.querySelectorAll('[data-artboard=p1] img[data-el]').length === 2);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});

test('cross-tab paste rebases relative links and rekeys SVG references', async () => {
  const c = await context(), source = await open(c), target = await open(c);
  try {
    await source.evaluate(() => {
      const base = document.createElement('base'); base.href = 'http://example.test/source/'; document.head.prepend(base);
      document.querySelector('[data-artboard=p1]').insertAdjacentHTML('beforeend', '<a data-el="link" href="chapter.html">Chapter</a><svg data-el="gradient" width="60" height="40" viewBox="0 0 60 40"><defs><linearGradient id="tone"><stop stop-color="red"/></linearGradient></defs><rect width="60" height="40" fill="url(#tone)"/><image xlink:href="asset.svg" width="10" height="10"/></svg>');
    });
    await source.locator('[data-el=link]').click();
    await source.locator('[data-el=gradient]').click({ modifiers: ['Shift'] });
    await source.keyboard.press('ControlOrMeta+C');
    await source.close();
    await target.locator('.thumb[data-page-id=p2] .thumb-main').click();
    assert.equal(await target.evaluate(() => document.querySelector('html-design-editor').shadowRoot.activeElement?.classList.contains('thumb-main')), true);
    await target.keyboard.press('ControlOrMeta+V');
    assert.equal(await target.locator('[data-artboard=p2] a').count(), 1, await target.locator('.toast').textContent());
    assert.equal(await target.locator('[data-artboard=p2] a').getAttribute('href'), 'http://example.test/source/chapter.html');
    const svg = target.locator('[data-artboard=p2] svg[data-el]');
    const id = await svg.locator('linearGradient').getAttribute('id');
    assert.notEqual(id, 'tone');
    assert.equal(await svg.locator('rect').getAttribute('fill'), `url(#${id})`);
    assert.equal(await svg.locator('image').getAttribute('xlink:href'), 'http://example.test/source/asset.svg');
    assert.deepEqual(target.errors, []);
  } finally { await c.close(); }
});

test('crop frames and masked images copy as editable images; a failed copy clears the previous packet', async () => {
  const c = await context(), p = await open(c);
  try {
    await p.locator('[data-artboard=p1]').evaluate((board, src) => {
      board.insertAdjacentHTML('beforeend', `<div style="position:absolute;left:130px;top:235px;width:180px;height:120px;overflow:hidden;border-radius:20px"><span data-el="inner-crop" data-crop-frame="1" style="position:absolute;left:45px;top:25px;display:block;width:80px;height:60px;overflow:clip"><img data-crop-image="" src="${src}" style="display:block;width:100%;height:100%;object-fit:cover"></span></div><div style="position:absolute;left:330px;top:235px;width:80px;height:60px;overflow:hidden;border-radius:12px"><img data-el="clipped" src="${src}" alt="clipped" style="display:block;width:80px;height:60px;object-fit:cover;translate:-2px"></div><picture style="position:absolute;left:430px;top:235px"><source srcset="${src}"><img data-el="picture-image" src="${src}" alt="picture" style="width:80px;height:60px"></picture>`);
    }, image);
    await p.locator('[data-el=inner-crop]').click();
    await p.keyboard.press('ControlOrMeta+C');
    await p.locator('.thumb[data-page-id=p2] .thumb-main').click();
    await p.keyboard.press('ControlOrMeta+V');
    assert.equal(await p.locator('[data-artboard=p2] [data-crop-frame] > img[data-crop-image]').count(), 1);
    await p.locator('.thumb[data-page-id=p1] .thumb-main').click();
    await p.locator('[data-el=clipped]').click();
    const sourceOffset = await p.locator('[data-el=clipped]').evaluate(node => {
      const a = node.getBoundingClientRect(), b = node.parentElement.getBoundingClientRect();
      return [a.left - b.left, a.top - b.top];
    });
    await p.keyboard.press('ControlOrMeta+C');
    await p.locator('.thumb[data-page-id=p2] .thumb-main').click();
    await p.keyboard.press('ControlOrMeta+V');
    const copiedFrame = p.locator('[data-artboard=p2] > [data-crop-frame][data-el]').last();
    assert.equal(await copiedFrame.locator('img[data-crop-image]').count(), 1);
    assert.equal(await copiedFrame.evaluate(node => getComputedStyle(node).borderRadius), '12px');
    const copiedOffset = await copiedFrame.evaluate(node => {
      const a = node.firstElementChild.getBoundingClientRect(), b = node.getBoundingClientRect();
      return [a.left - b.left, a.top - b.top];
    });
    assert.ok(copiedOffset.every((value, i) => Math.abs(value - sourceOffset[i]) < .5));
    await p.locator('.thumb[data-page-id=p1] .thumb-main').click();
    await p.locator('[data-el=clipped]').evaluate(node => { node.style.translate = 'none'; });
    await p.locator('[data-el=clipped]').click();
    await p.keyboard.press('ControlOrMeta+C');
    await p.locator('.thumb[data-page-id=p2] .thumb-main').click();
    await p.keyboard.press('ControlOrMeta+V');
    const copiedImage = p.locator('[data-artboard=p2] > img[data-el]');
    assert.equal(await copiedImage.count(), 1);
    assert.equal(await copiedImage.evaluate(node => getComputedStyle(node).borderRadius), '12px');
    await copiedImage.click();
    await p.locator('[data-act=image-crop]').click();
    assert.equal(await p.locator('.crop-panel').isVisible(), true);
    await p.locator('[data-act=crop-cancel]').click();
    await p.locator('.thumb[data-page-id=p1] .thumb-main').click();
    await p.locator('[data-el=picture-image]').click();
    await p.keyboard.press('ControlOrMeta+C');
    assert.match(await p.locator('.toast').textContent(), /picture/);
    await p.locator('.thumb[data-page-id=p2] .thumb-main').click();
    await p.keyboard.press('ControlOrMeta+V');
    assert.match(await p.locator('.toast').textContent(), /上次复制未成功/);
    assert.equal(await p.locator('[data-artboard=p2] [data-crop-frame]').count(), 2);
    assert.equal(await p.locator('[data-artboard=p2] > img[data-el]').count(), 1);
    assert.deepEqual(p.errors, []);
  } finally { await c.close(); }
});
