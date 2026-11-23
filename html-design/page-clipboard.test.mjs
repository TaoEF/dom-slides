import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { browserOptions } from './export.mjs';
import { createPreviewServer } from './server.mjs';
import { shapeMarkup } from './src/shapes.js';
import { PAGE_CLIPBOARD_TYPE } from './src/page-clipboard.js';

let browser, root, server, origin, editor;
const slide = (id, title, content) => `<section class="slide" data-artboard="${id}" data-mode="flow" data-title="${title}">${content}</section>`;
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#084"/></svg>';
const shape = shapeMarkup({id:'arrow',kind:'triangle',width:70,height:50,strokeWidth:4,stroke:'#164056'});
const fixture = (css, pages) => `<!doctype html><html><head><meta charset="utf-8"><title>Page clipboard</title>
<style>body{margin:0}[data-stage]{display:flex;flex-direction:column}.slide{box-sizing:border-box;width:800px;height:450px;padding:30px;position:relative}${css}</style>
</head><body><main data-stage>${pages}</main><script data-editor>${editor}</script></body></html>`;
const title = '<h1 id="heading" data-el="title">Reusable title</h1>';
const sourceCSS = '.slide{--ink:#164056;background:#edf7fa}#p1-heading,#heading{color:var(--ink);font:40px/1.2 Arial;margin:0}figure{width:160px;margin:0}img{display:block;width:100%;height:75px;object-fit:cover}';
const sourcePage = slide('p1','Source',title + '<figure><img data-el="photo" src="./art.svg" alt="Photo"></figure>' + shape +
  '<svg width="25" height="25"><defs><clipPath id="clip"><circle cx="10" cy="10" r="8"/></clipPath></defs><rect width="25" height="25" clip-path="url(#clip)"/></svg>' +
  '<a href="#heading" aria-labelledby="heading">Jump</a>');
const receiverPage = slide('p1','Target','<h1 id="heading" data-el="title">Existing title</h1>');
before(async () => {
  editor = await readFile('html-design/editor.js','utf8');
  root = await mkdtemp(join(tmpdir(),'page-clipboard-'));
  await mkdir(join(root,'source'));
  await mkdir(join(root,'receiver'));
  await writeFile(join(root,'source/art.svg'),image);
  await writeFile(join(root,'source/deck.html'),fixture(sourceCSS, sourcePage + slide('p2','Other','<h1 data-el="other">Other page</h1>')));
  await writeFile(join(root,'receiver/deck.html'),fixture('.slide{background:#dadada}h1{color:#a21;font:20px Georgia}',receiverPage));
  server = await createPreviewServer({root,port:0});
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(browserOptions());
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (root) await rm(root,{recursive:true,force:true});
});
async function open(c, file) {
  const page = await c.newPage();
  await page.goto(origin + file);
  await page.locator('.thumb-main').first().waitFor();
  return page;
}
const thumb = (page, id) => page.locator(`.thumb[data-page-id=${id}] .thumb-main`);
const getToast = page => page.locator('.toast').textContent();
const copy = async (page, id) => { await thumb(page,id).click(); await page.keyboard.press('ControlOrMeta+C'); };
const paste = async (page, id) => { await thumb(page,id).click(); await page.keyboard.press('ControlOrMeta+V'); };

test('thumbnail clipboard inserts after a selected page, with fresh IDs and single-step undo/redo', async () => {
  const c = await browser.newContext();
  try {
    const page = await open(c,'/source/deck.html');
    await copy(page,'p1');
    assert.match(await getToast(page), /已复制页面/);
    await paste(page,'p1');
    await thumb(page,'p3').waitFor({timeout:5000}).catch(async e => { throw new Error(await getToast(page), {cause:e}); });
    assert.deepEqual(await page.locator('[data-artboard]').evaluateAll(nodes => nodes.map(n=>n.dataset.artboard)),['p1','p3','p2']);
    await page.locator('[data-act=edit]').click();
    await page.locator('[data-act=undo]').click();
    assert.equal(await thumb(page,'p3').count(),0);
    await page.locator('[data-act=redo]').click();
    assert.equal(await thumb(page,'p3').count(),1);
  } finally { await c.close(); }
});

test('real cross-file clipboard preserves layout, local image paths, editable DOM and internal references', async () => {
  const c = await browser.newContext();
  try {
    const source = await open(c,'/source/deck.html');
    const target = await open(c,'/receiver/deck.html');
    await source.bringToFront();
    await copy(source,'p1');
    assert.match(await getToast(source), /已复制页面/);
    await target.bringToFront();
    await paste(target,'p1');
    await thumb(target,'p2').waitFor({timeout:5000}).catch(async e => { throw new Error(await getToast(target), {cause:e}); });
    const pasted = target.locator('[data-artboard=p2]');
    assert.deepEqual(await pasted.evaluate(b => {
      const h=b.querySelector('h1'), a=b.querySelector('a'), rect=b.querySelector('rect[clip-path]');
      return [b.dataset.mode,b.offsetWidth,b.offsetHeight,getComputedStyle(b).backgroundColor,getComputedStyle(h).color,getComputedStyle(h).fontSize,h.id,a.getAttribute('href'),a.getAttribute('aria-labelledby'),rect.getAttribute('clip-path')];
    }),['flow',800,450,'rgb(237, 247, 250)','rgb(22, 64, 86)','40px','p2-heading','#p2-heading','p2-heading','url("#p2-clip")']);
    const photo = pasted.locator('img');
    assert.equal(await photo.getAttribute('src'),origin+'/source/art.svg');
    await photo.evaluate(img => img.decode());
    assert.equal(await pasted.locator('svg[data-shape=triangle]').count(),1);
    assert.match(await readFile(join(root,'receiver/deck.html'),'utf8'),/p2-heading/);
    await target.reload();
    await thumb(target,'p2').click();
    await target.locator('[data-act=edit]').click();
    await pasted.locator('h1').dblclick();
    assert.equal(await pasted.locator('h1').getAttribute('contenteditable'),'true');
    await target.keyboard.press('ControlOrMeta+A');
    await target.keyboard.type('Still editable');
    await target.keyboard.press('Escape');
    assert.equal(await pasted.locator('h1').textContent(),'Still editable');
  } finally { await c.close(); }
});

test('invalid page clipboard does not insert or execute content', async () => {
  const c = await browser.newContext();
  try {
    const page = await open(c,'/source/deck.html');
    const before = await page.locator('[data-artboard]').count();
    await thumb(page,'p1').click();
    await page.evaluate(type => {
      const data = new DataTransfer();
      data.setData(type, JSON.stringify({version:1,html:
        '<section data-artboard="fake"><img src="https://invalid.example/" onerror="window.pageClipboardRan=true"></section>',
        layout:[]}));
      document.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    },PAGE_CLIPBOARD_TYPE);
    assert.equal(await page.locator('[data-artboard]').count(),before);
    assert.equal(await page.evaluate(()=>window.pageClipboardRan),undefined);
    assert.match(await getToast(page),/暂不支持整页复制/);
  } finally { await c.close(); }
});
