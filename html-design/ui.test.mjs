import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import JSZip from "jszip";
import { exportDocument, browserOptions } from "./export.mjs";

let browser, editor;
const fixture = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>Editor UI</title><style>
body{margin:0}[data-stage]{display:flex;flex-direction:column;padding:70px;gap:40px}[data-artboard]{position:relative;box-sizing:border-box;width:800px;height:450px;background:#fff;padding:50px;flex-shrink:0}h1{font:64px/1.2 Arial;margin:0;width:300px;min-height:160px}h1 span{font-size:32px;line-height:1.4;letter-spacing:2px}img{position:absolute;right:40px;bottom:40px;width:180px;height:80px;object-fit:cover}p{font:30px Arial}</style></head><body><main data-stage><section data-artboard="p1" data-title="First" data-mode="flow"><h1 data-el="p1-title">Scale<br><span>small text</span></h1><img data-el="p1-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='red'/%3E%3C/svg%3E" alt="test image"></section><section data-artboard="p2" data-title="Second" data-mode="flow"><p data-el="p2-title">Second page</p></section><section data-artboard="p3" data-title="Third" data-mode="flow"><p data-el="p3-title">Third page</p></section></main></body></html>`;
before(async () => {
  editor = await readFile("html-design/editor.js", "utf8");
  browser = await chromium.launch(browserOptions());
});
after(async () => {
  await browser?.close();
});
async function open(viewport = { width: 1440, height: 900 }, editing = true) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.errors = errors;
  await page.setContent(fixture);
  await page.addScriptTag({ content: editor });
  if (editing) await page.locator("[data-act=edit]").click();
  return page;
}
const order = (p) =>
  p
    .locator("[data-artboard]")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.artboard));
const near = (a, b, t = 0.05) =>
  assert.ok(Math.abs(a - b) < t, `${a} differs from ${b}`);

test('thumbnail measures each page alone when the stage uses a horizontal Flex row', async () => {
  for (const [width, flex] of [[1440, false], [700, false], [700, true]]) {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      let html = fixture.replace('flex-direction:column', 'flex-direction:row');
      if (flex) html = html.replace('[data-artboard]{', '[data-artboard]{flex:1 1 0;');
      await p.setContent(html);
      await p.addScriptTag({ content: editor });
      for (let i = 0; i < 3; i++) {
        const frame = p.locator('.thumb iframe').nth(i).contentFrame();
        await frame.locator('[data-thumb-target]').waitFor();
        assert.equal(await frame.locator('[data-thumb-target]').evaluate(n => n.offsetWidth), 800);
      }
      assert.equal(await p.locator('[data-artboard=p1]').evaluate(n => n.offsetWidth), 800);
      assert.equal(await p.locator('[data-thumb-measure-target]').count(), 0);
      assert.equal(await p.locator('html').getAttribute('data-thumb-measuring'), null);
    } finally { await p.close(); }
  }
});

test('Download HTML embeds the editor, images and linked CSS for offline reopening', async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  const folder = await mkdtemp(path.join(os.tmpdir(), 'dom-slides-portable-'));
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="red"/></svg>';
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/deck.css"></head><body><main data-stage><section data-artboard="p1" data-title="Portable" data-mode="flow"><h1 data-el="title">Offline slide</h1><img data-el="photo" src="/photo.svg" alt="photo"></section></main><script data-editor src="/editor.js"></script></body></html>`;
    await page.route('http://portable.test/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/deck.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (pathname === '/deck.css') return route.fulfill({ contentType: 'text/css', body: '[data-artboard]{position:relative;width:800px;height:450px;background-image:url("/texture.svg")}h1{font:40px Arial}' });
      if (pathname === '/editor.js') return route.fulfill({ contentType: 'application/javascript', body: editor });
      if (['/photo.svg','/texture.svg'].includes(pathname)) return route.fulfill({ contentType: 'image/svg+xml', body: svg });
      return route.abort();
    });
    await page.goto('http://portable.test/deck.html');
    await page.locator('[data-act=export]').click();
    const pending = page.waitForEvent('download');
    await page.locator('[data-act=download]').click();
    const downloaded = await readFile(await (await pending).path(), 'utf8');
    assert.doesNotMatch(downloaded, /<script[^>]+src=|<link[^>]+stylesheet|src="\/photo\.svg"|url\("\/texture\.svg"\)/);
    const file = path.join(folder, 'portable.html');
    await writeFile(file, downloaded);
    const offline = await browser.newPage();
    try {
      const remote = [];
      offline.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
      await offline.goto('file://' + file);
      await offline.locator('[data-act=edit]').waitFor();
      assert.equal(await offline.locator('[data-artboard]').evaluate(node => node.offsetWidth), 800);
      assert.equal(await offline.locator('img[data-el=photo]').evaluate(node => node.complete && node.naturalWidth > 0 && node.src.startsWith('data:')), true);
      assert.equal(await offline.locator('[data-act=edit]').isEnabled(), true);
      assert.deepEqual(remote, []);
    } finally { await offline.close(); }
  } finally { await page.close(); await rm(folder, { recursive: true, force: true }); }
});
async function current(p) {
  return p.locator("[data-editor-current]").getAttribute("data-artboard");
}
async function dragHandle(p, handle, dx, dy) {
  const r = await p.locator(`[data-h=${handle}]`).boundingBox();
  assert.ok(r);
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await p.mouse.down();
  await p.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, {
    steps: 8,
  });
  await p.mouse.up();
}

test("canvas preview preserves document interactions; Edit exposes page-local layout toggles and Done/Escape return to preview", async () => {
  const p = await open(undefined, false);
  try {
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    assert.ok(await p.locator("[data-act=edit]").isVisible());
    assert.equal(await p.locator(".tools").isVisible(), false);
    await p.evaluate(() => {
      const b = document.querySelector("[data-artboard=p1]");
      b.insertAdjacentHTML(
        "beforeend",
        `<button data-el="native" style="position:absolute;left:50px;top:270px">互动按钮</button><input id="native-input" style="position:absolute;left:50px;top:325px;width:200px;height:30px"><div id="native-scroll" style="position:absolute;left:380px;top:80px;width:120px;height:100px;overflow:auto"><div style="height:500px">滚动内容</div></div>`,
      );
      window.nativeClicks = 0;
      window.nativeKeys = 0;
      b.querySelector("[data-el=native]").addEventListener(
        "click",
        () => window.nativeClicks++,
      );
      window.addEventListener("keydown", (e) => {
        if (["ArrowRight", " "].includes(e.key)) window.nativeKeys++;
      });
    });
    await p.locator("[data-el=native]").click();
    assert.equal(await p.evaluate(() => window.nativeClicks), 1);
    await p.locator("#native-input").fill("HTML input");
    await p.locator("#native-input").press("ArrowRight");
    await p.locator("body").press("Space");
    assert.equal(await p.evaluate(() => window.nativeKeys), 2);
    assert.equal(await current(p), "p1");
    const scroll = await p.locator("#native-scroll").boundingBox();
    await p.mouse.move(
      scroll.x + scroll.width / 2,
      scroll.y + scroll.height / 2,
    );
    await p.mouse.wheel(0, 180);
    await p.waitForFunction(
      () => document.querySelector("#native-scroll").scrollTop > 0,
    );
    await p.locator("[data-el=p1-title]").dblclick();
    assert.equal(
      await p.locator("[data-el=p1-title]").getAttribute("contenteditable"),
      null,
    );
    const untouched = await p
      .locator("[data-artboard=p2]")
      .evaluate((n) => n.outerHTML);
    await p.locator("[data-act=edit]").click();
    assert.equal(await p.locator("html").getAttribute("data-editing"), "");
    assert.ok(await p.locator(".layout-toggle").isVisible());
    await p.locator("[data-act=artboard]").click();
    assert.equal(
      await p.locator("[data-artboard=p1]").getAttribute("data-mode"),
      "artboard",
    );
    assert.equal(
      await p.locator("[data-artboard=p2]").evaluate((n) => n.outerHTML),
      untouched,
    );
    p.once("dialog", (dialog) => dialog.accept());
    await p.locator("[data-act=flow]").click();
    assert.equal(
      await p.locator("[data-artboard=p1]").getAttribute("data-mode"),
      "flow",
    );
    assert.equal(
      await p.locator("[data-artboard=p2]").evaluate((n) => n.outerHTML),
      untouched,
    );
    await p.locator("[data-el=native]").click();
    assert.equal(
      await p.evaluate(() => window.nativeClicks),
      1,
      "editing intercepts document clicks",
    );
    await p.locator("[data-el=p1-title]").dblclick();
    await p.locator("[data-el=p1-title]").fill("Updated title");
    await p.locator("[data-act=done]").click();
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    assert.equal(
      await p.locator("[data-el=p1-title]").getAttribute("contenteditable"),
      null,
    );
    assert.equal(await p.locator(".sel").isVisible(), false);
    await p.locator("[data-el=native]").click();
    assert.equal(await p.evaluate(() => window.nativeClicks), 2);
    await p.locator("[data-act=edit]").click();
    await p.locator("[data-el=p1-title]").dblclick();
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("html").getAttribute("data-editing"), "");
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("html").getAttribute("data-editing"), "");
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("layer actions change actual paint order across containers, survive save/reopen, and undo without moving elements", async () => {
  const p = await open();
  try {
    await p.evaluate(() => {
      document
        .querySelector("[data-artboard=p1]")
        .insertAdjacentHTML(
          "beforeend",
          `<div id="stack-a" style="position:absolute;left:100px;top:220px;width:220px;height:140px;transform:translateZ(0)"><div data-el="layer-a" style="position:absolute;inset:0;background:#ff5555">A</div></div><div id="stack-b" style="position:absolute;left:180px;top:250px;width:220px;height:140px;z-index:20"><div data-el="layer-b" style="position:absolute;inset:0;background:#55bb88">B</div></div>`,
        );
    });
    const hit = (page) =>
      page.evaluate(() => {
        const b = document.querySelector("[data-artboard=p1]"),
          r = b.getBoundingClientRect(),
          s = r.width / b.offsetWidth;
        return document
          .elementsFromPoint(r.left + 230 * s, r.top + 290 * s)
          .find((n) => n.dataset.el)?.dataset.el;
      });
    const a = p.locator("[data-el=layer-a]");
    const initial = await a.boundingBox();
    assert.equal(await hit(p), "layer-b");
    await a.click({ position: { x: 15, y: 15 } });
    await p.locator("[data-act=element-more]").click();
    await p.locator("[data-act=element-front]").click();
    assert.equal(await hit(p), "layer-a");
    await p.locator("[data-act=undo]").click();
    assert.equal(await hit(p), "layer-b");
    await p.locator("[data-act=redo]").click();
    assert.equal(await hit(p), "layer-a");
    await p.locator("[data-act=element-more]").click();
    await p.locator("[data-act=element-back]").click();
    assert.equal(await hit(p), "layer-b");
    const after = await a.boundingBox();
    for (const key of ["x", "y", "width", "height"])
      near(after[key], initial[key]);
    await p.locator("[data-act=more]").click();
    await p.locator("[data-act=source]").click();
    const source = await p.locator("textarea").inputValue();
    const reopened = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    try {
      await reopened.setContent(
        source.replace(/<script[\s\S]*?<\/script>/g, ""),
      );
      assert.equal(await hit(reopened), "layer-b");
    } finally {
      await reopened.close();
    }
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("artboard conversion only touches the current page and preserves positioned wrappers and element transforms", async () => {
  const p = await open();
  try {
    await p.evaluate(() => {
      const title = document.querySelector("[data-el=p1-title]"),
        wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;margin-left:60px;padding:20px";
      title.before(wrap);
      wrap.append(title);
      title.style.transform = "scale(.8)";
    });
    const title = p.locator("[data-el=p1-title]"),
      before = await title.boundingBox();
    const original = await p
      .locator("[data-artboard=p2]")
      .evaluate((n) => n.outerHTML);
    await p.locator("[data-act=artboard]").click();
    const after = await title.boundingBox();
    for (const key of ["x", "y", "width", "height"])
      near(after[key], before[key]);
    assert.equal(
      await p.locator("[data-artboard=p2]").evaluate((n) => n.outerHTML),
      original,
    );
    assert.equal(
      await p.locator("[data-artboard=p3]").getAttribute("data-mode"),
      "flow",
    );
    await p.locator("[data-act=undo]").click();
    const restored = await title.boundingBox();
    for (const key of ["x", "y", "width", "height"])
      near(restored[key], before[key]);
  } finally {
    await p.close();
  }
});

test("manual mode detaches nested editable SVGs and text from a Flex container", async () => {
  const p = await open();
  try {
    await p.locator('[data-artboard=p1]').evaluate((board) => {
      board.insertAdjacentHTML('beforeend', `<div data-el="workspace" style="display:flex;align-items:center;gap:24px;width:440px;height:140px;margin-top:12px">
        <svg data-el="rect" viewBox="0 0 80 80" style="display:block;width:80px;height:80px"><rect width="80" height="80" fill="red"/></svg>
        <svg data-el="arrow" viewBox="0 0 60 60" style="display:block;width:60px;height:60px"><path d="M0 20h35V0l25 30-25 30V40H0z" fill="blue"/></svg>
        <span data-el="hint">Observe the stroke</span>
      </div>`);
    });
    const ids = ['workspace', 'rect', 'arrow', 'hint'];
    const box = async (id) => p.locator(`[data-el=${id}]`).boundingBox();
    const before = await Promise.all(ids.map(box));
    await p.locator('[data-act=artboard]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'artboard');
    for (let i = 0; i < ids.length; i++) {
      const after = await box(ids[i]);
      for (const axis of ['x', 'y', 'width', 'height']) near(after[axis], before[i][axis], 1.5);
      assert.equal(await p.locator(`[data-el=${ids[i]}]`).evaluate((n) => n.style.position), 'absolute');
    }
    await p.locator('[data-act=undo]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'flow');
    await p.locator('[data-act=redo]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'artboard');
    await p.locator('[data-el=rect]').click();
    await dragHandle(p, 'e', 70, 0);
    assert.ok((await box('rect')).width > before[1].width + 30);
    for (let i = 2; i < ids.length; i++) {
      const after = await box(ids[i]);
      for (const axis of ['x', 'y']) near(after[axis], before[i][axis], 1.5);
    }
    assert.match(await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML), /data-flow-style=/);
    p.once('dialog', (dialog) => dialog.accept());
    await p.locator('[data-act=flow]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'flow');
    assert.equal(await p.locator('[data-el=arrow]').evaluate((n) => n.style.position), '');
    assert.equal(await p.locator('[data-el=rect]').evaluate((n) => n.style.width), '80px');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("manual mode rejects CSS that prevents independent positioning without partial changes", async () => {
  const p = await open();
  try {
    await p.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '[data-el="p1-title"]{position:static!important}';
      document.head.append(style);
    });
    const beforeHTML = await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML);
    const before = await p.locator('[data-el=p1-title]').boundingBox();
    p.once('dialog', (dialog) => dialog.dismiss());
    await p.locator('[data-act=artboard]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'flow');
    const after = await p.locator('[data-el=p1-title]').boundingBox();
    for (const axis of ['x', 'y', 'width', 'height']) near(after[axis], before[axis], 0.05);
    assert.equal(await p.locator('[data-artboard=p1]').evaluate((n) => n.querySelectorAll('[data-flow-style]').length), 0);
    assert.equal(await p.locator('[data-artboard=p1]').evaluate((n) => [n, ...n.querySelectorAll('[data-el]')].every((el) => el.style.length === 0)), true);
    assert.equal(await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML), beforeHTML);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("manual mode detaches Grid objects inside an unmarked wrapper", async () => {
  const p = await open();
  try {
    await p.locator('[data-artboard=p1]').evaluate((board) => {
      board.insertAdjacentHTML('beforeend', `<div id="plain-grid" style="display:grid;grid-template-columns:100px 100px;gap:16px;width:216px;height:90px">
        <div data-el="grid-a" style="background:red;height:80px">A</div>
        <div data-el="grid-b" style="background:blue;height:80px">B</div>
      </div>`);
    });
    const a = p.locator('[data-el=grid-a]'), b = p.locator('[data-el=grid-b]');
    const beforeA = await a.boundingBox(), beforeB = await b.boundingBox();
    const alerts = [];
    p.on('dialog', (dialog) => { alerts.push(dialog.message()); dialog.dismiss(); });
    await p.locator('[data-act=artboard]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'artboard', alerts.join('; '));
    for (const [node, before] of [[a, beforeA], [b, beforeB]]) {
      const after = await node.boundingBox();
      for (const axis of ['x', 'y', 'width', 'height']) near(after[axis], before[axis], 1.5);
      assert.equal(await node.evaluate((n) => getComputedStyle(n).position), 'absolute');
    }
    await a.evaluate((n) => { n.style.width = '180px'; });
    const afterB = await b.boundingBox();
    for (const axis of ['x', 'y']) near(afterB[axis], beforeB[axis], 1.5);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("manual mode preserves an unmarked absolute decoration beside an editable object", async () => {
  const p = await open();
  try {
    await p.locator('[data-artboard=p1]').evaluate((board) => {
      board.insertAdjacentHTML('beforeend', `<div id="plain-wrap" style="margin-left:100px;width:220px;height:100px">
        <div data-el="editable-blue" style="width:90px;height:70px;background:blue">Blue</div>
        <div id="absolute-red" style="position:absolute;left:40px;top:35px;width:30px;height:30px;background:red"></div>
      </div>`);
    });
    const before = await p.locator('#absolute-red').boundingBox();
    const beforeHTML = await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML);
    const alerts = [];
    p.on('dialog', (dialog) => { alerts.push(dialog.message()); dialog.dismiss(); });
    await p.locator('[data-act=artboard]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'flow', alerts.join('; '));
    const after = await p.locator('#absolute-red').boundingBox();
    for (const axis of ['x', 'y', 'width', 'height']) near(after[axis], before[axis], 1.5);
    assert.equal(await p.locator('#plain-wrap').evaluate((n) => getComputedStyle(n).position), 'static');
    assert.equal(await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML), beforeHTML);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("manual mode preserves positioned pseudo decorations on a static wrapper", async () => {
  const p = await open();
  try {
    await p.locator('[data-artboard=p1]').evaluate((board) => {
      const style = document.createElement('style');
      style.textContent = '#pseudo-wrap::before{content:"";position:absolute;left:20px;top:20px;width:30px;height:30px;background:red}';
      document.head.append(style);
      board.insertAdjacentHTML('beforeend', '<div id="pseudo-wrap"><span data-el="pseudo-child">Decorated</span></div>');
    });
    const beforeHTML = await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML);
    const alerts = [];
    p.on('dialog', (dialog) => { alerts.push(dialog.message()); dialog.dismiss(); });
    await p.locator('[data-act=artboard]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'flow');
    assert.match(alerts.join('; '), /装饰元素/);
    assert.equal(await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML), beforeHTML);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("manual mode rejects normal-flow pseudo decorations when a child leaves flow", async () => {
  const p = await open();
  try {
    await p.locator('[data-artboard=p1]').evaluate((board) => {
      const style = document.createElement('style');
      style.textContent = '#flow-pseudo-wrap::after{content:"Decoration";display:block;background:red;height:24px}';
      document.head.append(style);
      board.insertAdjacentHTML('beforeend', '<div id="flow-pseudo-wrap" style="width:200px;height:100px"><span data-el="flow-pseudo-child" style="display:block;height:30px">Text</span></div>');
    });
    const beforeHTML = await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML);
    const alerts = [];
    p.on('dialog', (dialog) => { alerts.push(dialog.message()); dialog.dismiss(); });
    await p.locator('[data-act=artboard]').click();
    assert.equal(await p.locator('[data-artboard=p1]').getAttribute('data-mode'), 'flow');
    assert.match(alerts.join(' '), /装饰元素/);
    assert.equal(await p.locator('[data-artboard=p1]').evaluate((n) => n.outerHTML), beforeHTML);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

// This test is geometry/interaction verification; visual review is done separately in one batch.
test("single page is centered in the available work area, footer owns navigation, and zoom never enters a saved file", async () => {
  const p = await open();
  try {
    const geometry = await p.locator("[data-editor-current]").evaluate((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    near(geometry.x + geometry.w / 2, 170 + (1440 - 170) / 2);
    near(geometry.y + geometry.h / 2, 52 + (900 - 52 - 40) / 2);
    assert.equal(await p.locator("[data-artboard]:visible").count(), 1);
    assert.equal(await p.locator("[data-act=single]").count(), 0);
    assert.equal(await p.locator(".head [data-act=save]").count(), 0);
    assert.equal(await p.locator(".footer .pageno").textContent(), "1 / 3");
    await p.locator(".footer [data-act=next]").click();
    assert.equal(await current(p), "p2");
    assert.equal(await p.locator(".page-title").textContent(), "Second");
    await p.keyboard.press("Control+0");
    near(
      await p
        .locator("[data-editor-current]")
        .evaluate((b) => b.getBoundingClientRect().width),
      800,
    );
    await p.locator("[data-act=more]").click();
    await p.locator("[data-act=source]").click();
    const source = await p.locator("textarea").inputValue(),
      content = source.replace(/<script[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(
      content,
      /data-editor-current|data-editor-playing|data-editor-on|<html-design-editor|position:fixed|transform:scale/,
    );
    assert.match(content, /data-el="p1-title"/);
    assert.match(content, /data-artboard="p3"/);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("page add/copy/rename/reorder/delete are undoable and IDs are never reused", async () => {
  const p = await open();
  try {
    await p.locator(".nav-head [data-act=page-add]").click();
    assert.deepEqual(await order(p), ["p1", "p4", "p2", "p3"]);
    await p.locator(".thumb.active .thumb-more").click();
    await p.locator("[data-act=page-copy]").click();
    assert.deepEqual(await order(p), ["p1", "p4", "p5", "p2", "p3"]);
    await p.locator(".thumb.active .thumb-more").click();
    await p.locator("[data-menu=page] [data-act=page-rename]").click();
    await p.locator(".rename-input").fill("Renamed page");
    await p.locator(".rename-input").press("Enter");
    assert.equal(
      await p.locator("[data-artboard=p5]").getAttribute("data-title"),
      "Renamed page",
    );
    await p.locator(".thumb.active .thumb-more").click();
    await p.locator("[data-act=page-up]").click();
    assert.deepEqual(await order(p), ["p1", "p5", "p4", "p2", "p3"]);
    await p.locator("[data-act=undo]").click();
    assert.deepEqual(await order(p), ["p1", "p4", "p5", "p2", "p3"]);
    await p.locator(".thumb.active .thumb-more").click();
    await p.locator("[data-act=page-delete]").click();
    assert.deepEqual(await order(p), ["p1", "p4", "p2", "p3"]);
    await p.locator("[data-act=undo]").click();
    assert.equal(
      await p.locator("[data-artboard=p5]").getAttribute("data-title"),
      "Renamed page",
    );
    await p.locator("[data-act=redo]").click();
    await p.locator(".nav-head [data-act=page-add]").click();
    assert.ok((await order(p)).includes("p6"));
    const first = p.locator(".thumb[data-page-id=p1] .thumb-main"),
      last = p.locator(".thumb[data-page-id=p3] .thumb-main");
    const a = await first.boundingBox(),
      b = await last.boundingBox();
    await p.mouse.move(a.x + a.width / 2, a.y + 20);
    await p.mouse.down();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height - 1, { steps: 14 });
    await p.mouse.up();
    assert.equal((await order(p)).at(-1), "p1");
    await p.locator("[data-act=undo]").click();
    assert.equal((await order(p))[0], "p1");
    await p.locator(".thumb[data-page-id=p1] .thumb-more").click();
    await p.locator("[data-act=page-copy]").click();
    const ids = await p
      .locator("[data-el]")
      .evaluateAll((ns) => ns.map((n) => n.dataset.el));
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("deleting all pages leaves an actionable empty state and undo restores content", async () => {
  const p = await open();
  try {
    for (let i = 0; i < 3; i++) {
      await p.locator(".thumb.active .thumb-more").click();
      await p.locator("[data-act=page-delete]").click();
    }
    assert.equal(await p.locator("[data-artboard]").count(), 0);
    assert.ok(await p.locator(".empty-canvas").isVisible());
    assert.equal(await p.locator(".footer .pageno").textContent(), "0 / 0");
    assert.equal(await p.locator("[data-act=pdf]").isEnabled(), false);
    await p.locator("[data-act=undo]").click();
    assert.equal(await p.locator("[data-artboard]").count(), 1);
    assert.ok(await p.locator("[data-editor-current]").isVisible());
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("text corners scale nested typography at 50% and 200%; side handles only resize the frame", async () => {
  for (const zoom of [0.5, 2]) {
    const p = await open();
    try {
      const title = p.locator("[data-el=p1-title]");
      await title.click();
      await p.keyboard.press("Control+0");
      for (let i = 0; i < (zoom === 0.5 ? 4 : 5); i++)
        await p.keyboard.press(zoom === 0.5 ? "Control+-" : "Control+=");
      const before = await title.evaluate((el) => ({
        w: el.offsetWidth,
        h: el.offsetHeight,
        font: parseFloat(getComputedStyle(el).fontSize),
        small: parseFloat(getComputedStyle(el.querySelector("span")).fontSize),
        line: parseFloat(getComputedStyle(el.querySelector("span")).lineHeight),
      }));
      await dragHandle(p, "se", before.w * 0.5 * zoom, before.h * 0.5 * zoom);
      const after = await title.evaluate((el) => ({
        w: el.offsetWidth,
        h: el.offsetHeight,
        font: parseFloat(getComputedStyle(el).fontSize),
        small: parseFloat(getComputedStyle(el.querySelector("span")).fontSize),
        line: parseFloat(getComputedStyle(el.querySelector("span")).lineHeight),
      }));
      near(after.w, before.w * 1.5, 1);
      near(after.h, before.h * 1.5, 1);
      near(after.font, 96);
      near(after.small, 48);
      near(after.line, before.line * 1.5);
      await p.locator("[data-act=undo]").click();
      near(
        await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
        64,
      );
      await title.click();
      await dragHandle(p, "e", 40 * zoom, 0);
      near(
        await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
        64,
      );
      assert.equal(await title.evaluate((el) => el.offsetWidth), 340);
      assert.deepEqual(p.errors, []);
    } finally {
      await p.close();
    }
  }
});

test("image fit modes keep the frame and source, and undo restores the mode", async () => {
  const p = await open();
  try {
    const image = p.locator("[data-el=p1-image]"),
      src = await image.getAttribute("src");
    await image.click();
    assert.equal(await p.locator('[data-act=image-replace]').evaluate(n => getComputedStyle(n).fontSize), '12px');
    assert.equal(await p.locator('[data-act=image-fit]').textContent(), '适应');
    assert.equal(await p.locator('[data-act=image-cover]').textContent(), '填充');
    const before = await image.boundingBox();
    await p.locator("[data-act=image-fit]").click();
    assert.equal(await p.locator('[data-act=image-fit]').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(85, 85, 85)');
    assert.equal(await p.locator('[data-act=image-fit]').evaluate(n => getComputedStyle(n).color), 'rgb(255, 255, 255)');
    assert.equal(
      await image.evaluate((n) => getComputedStyle(n).objectFit),
      "contain",
    );
    const fit = await image.boundingBox();
    for (const k of ["x", "y", "width", "height"]) near(before[k], fit[k]);
    await p.locator("[data-act=image-cover]").click();
    assert.equal(
      await image.evaluate((n) => getComputedStyle(n).objectFit),
      "cover",
    );
    await p.locator("[data-act=undo]").click();
    assert.equal(
      await image.evaluate((n) => getComputedStyle(n).objectFit),
      "contain",
    );
    assert.equal(await image.getAttribute("src"), src);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("compact navigation keeps the first thumbnail intact and text layout controls visible across window sizes", async () => {
  const p = await open();
  try {
    await mkdir('.export-test', { recursive: true });
    for (const width of [1440, 760, 390]) {
      await p.setViewportSize({ width, height: 900 });
      if (!(await p.locator('.nav').isVisible())) await p.locator('[data-act=nav]').click();
      const layout = await p.evaluate(() => {
        const u = document.querySelector('html-design-editor').shadowRoot;
        const nav = u.querySelector('.nav').getBoundingClientRect();
        const list = u.querySelector('.thumb-list').getBoundingClientRect();
        const frame = u.querySelector('.frame').getBoundingClientRect();
        return { nav: nav.width, top: frame.top - list.top, right: frame.right <= list.right,
          headerWidth: u.querySelector('.head').scrollWidth,
          modeIcons: u.querySelectorAll('.layout-toggle svg').length };
      });
      assert.equal(layout.nav, 170); assert.ok(layout.top >= 4); assert.ok(layout.right);
      assert.ok(layout.headerWidth <= width); assert.equal(layout.modeIcons, 0);
      assert.equal(await p.locator('[data-act=flow]').textContent(), '自动排版');
      assert.equal(await p.locator('[data-act=artboard]').textContent(), '手动');
      assert.ok(await p.locator('[data-act=flow]').isVisible());
      assert.ok(await p.locator('[data-act=status]').isVisible(), 'save diagnostics stay accessible on narrow screens');
      await p.locator('[data-act=status]').click();
      assert.ok(await p.locator('[data-menu=status]').isVisible());
      await p.keyboard.press('Escape');
      await p.locator('[data-act=more]').click();
      near((await p.locator('[data-menu=more]').boundingBox()).width, 190);
      await p.keyboard.press('Escape');
      if (width <= 540) await p.locator('[data-act=nav]').click();
      await p.locator('[data-el=p1-title]').click();
      await p.screenshot({ path: `.export-test/ui-refinement-${width}.png` });
    }
    assert.equal(await p.locator('[data-act=add-text] svg').count(), 2);
    assert.equal(await p.locator('[data-act=text-styles]').count(), 0);
    assert.equal(await p.locator('[data-act=add-image] svg').count(), 1);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('text selection has width handles and one scale corner; insert menu reuses page styles or three defaults', async () => {
  const p = await open();
  try {
    await p.locator('[data-el=p1-title]').click();
    const handles = await p.locator('.sel [data-h]').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').map(n => n.dataset.h));
    assert.deepEqual(handles, ['e', 'se', 'w']);
    await p.locator('[data-el=p1-image]').click();
    assert.equal(await p.locator('.sel [data-h]').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').length), 8);
    const originalCount = await p.locator('[data-artboard=p1] [data-el]').count();
    await p.locator('[data-act=add-text]').click();
    assert.equal(await p.locator('[data-artboard=p1] [data-el]').count(), originalCount, 'opening the menu does not insert text');
    assert.equal(await p.locator('[data-act=add-text]').getAttribute('aria-expanded'), 'true');
    await p.locator('[data-act=add-text]').click();
    assert.equal(await p.locator('[data-act=add-text]').getAttribute('aria-expanded'), 'false');
    await p.locator('[data-act=add-text]').click();
    assert.match((await p.locator('[data-menu=text-styles] button').first().textContent()), /64px/);
    assert.doesNotMatch((await p.locator('[data-menu=text-styles]').textContent()), /Scalesmall text/);
    await p.locator('[data-menu=text-styles] button').click();
    const inserted = p.locator('[data-artboard=p1] [data-el^=p1-text-]');
    assert.equal(await inserted.evaluate(node => getComputedStyle(node).fontSize), '64px');
    await p.keyboard.type('New title');
    assert.match(await inserted.textContent(), /New title/);
    await p.keyboard.press('Escape');
    await p.locator('[data-artboard=p2]').evaluate(board => board.querySelector('[data-el]').remove());
    await p.locator('.thumb[data-page-id=p2] .thumb-main').click();
    await p.locator('[data-act=add-text]').click();
    const defaults = await p.locator('[data-menu=text-styles] button').allTextContents();
    assert.deepEqual(defaults.map(item => item.split(' · ')[0]), ['大标题','小标题','正文']);
    assert.ok(defaults.every(item => /\d+px/.test(item)));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('text style menu keeps four largest distinct styles on the current page', async () => {
  const p = await open();
  try {
    await p.locator('[data-artboard=p1]').evaluate(board => {
      for (const [index, size] of [44,72,52,18,44].entries()) {
        const node = document.createElement('p');
        node.dataset.el = `extra-${index}`;
        node.textContent = `Sample ${index}`;
        node.style.cssText = `position:absolute;left:450px;top:${30 + index * 45}px;font-size:${size}px`;
        board.append(node);
      }
    });
    await p.locator('[data-act=add-text]').click();
    const items = p.locator('[data-menu=text-styles] button');
    assert.equal(await items.count(), 4);
    const descriptions = await items.allTextContents();
    assert.deepEqual(descriptions.map(item => item.match(/\d+(?:\.\d+)?px/)?.[0]), ['72px','64px','52px','44px']);
    assert.ok(descriptions.every(item => !/Sample|Scalesmall/.test(item)));
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('an emptied text box keeps its three handles and font scaling', async () => {
  const p = await open();
  try {
    await p.locator('[data-act=add-text]').click();
    await p.locator('[data-menu=text-styles] button').first().click();
    const text = p.locator('[data-artboard=p1] [data-text-box]');
    await p.keyboard.press('ControlOrMeta+A');
    await p.keyboard.press('Backspace');
    assert.equal(await text.textContent(), '');
    await p.keyboard.press('Escape');
    assert.equal(await text.getAttribute('data-text-box'), '');
    assert.ok((await text.boundingBox()).height >= 8);
    assert.deepEqual(await p.locator('.sel [data-h]').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').map(n => n.dataset.h)), ['e','se','w']);
    const before = await text.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const handle = await p.locator('.sel [data-h=se]').boundingBox();
    await p.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await p.mouse.down();
    await p.mouse.move(handle.x + handle.width / 2 + 30, handle.y + handle.height / 2 + 20, { steps: 4 });
    await p.mouse.up();
    assert.ok(await text.evaluate((node, value) => parseFloat(getComputedStyle(node).fontSize) > value, before));
    const existing = p.locator('[data-el=p1-title]');
    await existing.dblclick();
    await p.keyboard.press('ControlOrMeta+A');
    await p.keyboard.press('Backspace');
    await p.keyboard.press('Escape');
    assert.equal(await existing.getAttribute('data-text-box'), '');
    assert.deepEqual(await p.locator('.sel [data-h]').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').map(n => n.dataset.h)), ['e','se','w']);
    await p.locator('[data-act=more]').click();
    await p.locator('[data-act=source]').click();
    const saved = await p.locator('.modal textarea').inputValue();
    const reopened = await browser.newPage();
    try {
      await reopened.setContent(saved);
      await reopened.addScriptTag({ content: editor });
      await reopened.locator('[data-act=edit]').click();
      await reopened.locator('[data-el=p1-title]').click();
      assert.equal(await reopened.locator('[data-el=p1-title]').getAttribute('data-text-box'), '');
      assert.deepEqual(await reopened.locator('.sel [data-h]').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').map(n => n.dataset.h)), ['e','se','w']);
    } finally { await reopened.close(); }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("text alignment cycles with one click and adaptation stays in the element menu", async () => {
  const p = await open();
  try {
    await p.locator('[data-el=p1-title]').click();
    assert.equal(await p.locator('.tbar').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(32, 32, 32)');
    assert.equal(await p.locator('.head').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
    assert.equal(await p.locator('.text-tools select').count(), 0);
    assert.equal(await p.locator('.text-tools [data-act=text-layout]').count(), 0);
    for (const align of ['center', 'right', 'justify', 'left']) {
      await p.locator('[data-act=text-align]').click();
      assert.equal(await p.locator('[data-el=p1-title]').evaluate(n => n.style.textAlign), align);
      assert.equal(await p.locator('[data-act=text-align]').getAttribute('data-align'), align);
    }
    assert.equal(await p.locator('.color-control svg').count(), 0);
    assert.equal(await p.locator('.cpick').getAttribute('type'), 'color');
    assert.equal(await p.locator('.color-swatch').evaluate(n => getComputedStyle(n).borderRadius), '50%');
    await p.locator('[data-act=element-more]').click();
    assert.ok(await p.locator('[data-act=text-layout]').isVisible());
    near((await p.locator('[data-menu=element]').boundingBox()).width, 190);
    await p.locator('[data-act=text-layout]').click();
    assert.ok(await p.locator('[data-menu=text-layout]').isVisible());
    assert.ok((await p.locator('[data-menu=text-layout]').boundingBox()).y > 52, 'diagnostics anchor to the visible toolbar, not the hidden menu item');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("keyboard adaptation opens with useful focus and image menus skip hidden text actions", async () => {
  const p = await open();
  const focused = () => p.evaluate(() => document.querySelector('html-design-editor').shadowRoot.activeElement?.dataset.act);
  try {
    await p.locator('[data-el=p1-title]').click();
    await p.locator('[data-act=element-more]').focus();
    await p.keyboard.press('Enter');
    for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'text-layout');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => ['text-height', 'text-fit'].includes(document.querySelector('html-design-editor').shadowRoot.activeElement?.dataset.act));
    await p.keyboard.press('ArrowDown');
    assert.ok(['text-height', 'text-fit'].includes(await focused()));
    await p.keyboard.press('Escape');
    assert.equal(await focused(), 'element-more');
    await p.locator('[data-el=p1-image]').click();
    await p.locator('[data-act=element-more]').focus();
    await p.keyboard.press('Enter');
    const imageActions = await p.locator('[data-menu=element] button').evaluateAll(nodes =>
      nodes.filter(n => !n.disabled && n.getClientRects().length).map(n => n.dataset.act));
    assert.deepEqual(imageActions, ['select-all', 'element-duplicate', 'element-front', 'element-back', 'element-delete']);
    await p.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'select-all', 'the new visible action precedes duplicate; hidden text/group actions are skipped');
    await p.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'element-duplicate');
    await p.keyboard.press('ArrowUp');
    assert.equal(await focused(), 'select-all');
    await p.keyboard.press('Escape');
    assert.equal(await focused(), 'element-more');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("thumbnail More exposes direct page management while ordinary content still requires Edit", async () => {
  const p = await open(undefined, false);
  try {
    const more = p.locator('.thumb.active .thumb-more');
    assert.ok(await more.isVisible()); assert.equal(await more.locator('svg').count(), 1);
    await more.click();
    assert.ok(await p.locator('[data-menu=page]').isVisible());
    assert.equal(await p.locator('.page-preview-hint').count(), 0);
    assert.ok(await p.locator('[data-act=page-copy]').isEnabled());
    assert.ok(await p.locator('[data-act=add-text]').isDisabled());
    assert.equal(await p.locator('html').getAttribute('data-editing'), null);
    await p.locator('[data-act=edit]').click(); await more.click();
    assert.equal(await p.locator('.page-preview-hint').isVisible(), false);
    assert.ok(await p.locator('[data-act=page-copy]').isEnabled());
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test("play menu offers scrolling and fullscreen; exiting either returns to canvas preview on the current page", async () => {
  const p = await open();
  try {
    assert.equal(await p.locator(".head [data-act=fullscreen]").count(), 0);
    await p.locator("[data-act=preview]").click();
    assert.equal(await p.locator("[data-menu=play]").isVisible(), true);
    await p.locator("[data-act=scroll-play]").click();
    assert.equal(await p.locator(".head").isVisible(), false);
    assert.equal(await p.locator(".nav").isVisible(), false);
    assert.equal(await p.locator("[data-artboard]:visible").count(), 3);
    assert.equal(
      await p.locator("html").getAttribute("data-editor-scrolling"),
      "",
    );
    await p.keyboard.press("Space");
    assert.equal(await current(p), "p2");
    await p.mouse.move(800, 450);
    await p.mouse.wheel(0, 600);
    await p.waitForFunction(
      () =>
        document.querySelector("[data-editor-current]")?.dataset.artboard ===
        "p3",
    );
    await p.mouse.wheel(0, -600);
    await p.waitForFunction(
      () =>
        document.querySelector("[data-editor-current]")?.dataset.artboard ===
        "p2",
    );
    await p.keyboard.press("Escape");
    assert.equal(await current(p), "p2");
    assert.ok(await p.locator(".head").isVisible());
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    assert.equal(await p.locator("[data-artboard]:visible").count(), 1);
    assert.ok(await p.locator("[data-act=edit]").isVisible());
    await p.locator("[data-act=preview]").click();
    await p.locator("[data-act=fullscreen]").click();
    assert.equal(
      await p.locator("html").getAttribute("data-editor-playing"),
      "",
    );
    await p.waitForFunction(() => document.fullscreenElement !== null);
    await p.keyboard.press("ArrowRight");
    assert.equal(await current(p), "p3");
    await p.locator(".play-controls [data-act=stop]").click();
    assert.equal(await current(p), "p3");
    await p.waitForFunction(() => document.fullscreenElement === null);
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("menus are keyboard accessible, source keeps focus, numeric font size and space-pan work", async () => {
  const p = await open();
  try {
    await p.locator("[data-el=p1-title]").click();
    await p.locator(".fs").fill("80");
    await p.locator(".fs").press("Enter");
    assert.equal(
      await p
        .locator("[data-el=p1-title]")
        .evaluate((n) => getComputedStyle(n).fontSize),
      "80px",
    );
    assert.equal(await p.locator('.text-tools .number-stepper').count(), 1);
    await p.locator('[data-act=font-size-up]').click();
    assert.equal(await p.locator('[data-el=p1-title]').evaluate(n => getComputedStyle(n).fontSize), '81px');
    await p.locator('[data-act=font-size-down]').click();
    assert.equal(await p.locator('[data-el=p1-title]').evaluate(n => getComputedStyle(n).fontSize), '80px');
    await p.keyboard.press("Escape");
    await p.locator("[data-act=more]").focus();
    await p.keyboard.press("Enter");
    await p.keyboard.press("ArrowDown");
    assert.equal(
      await p.evaluate(
        () =>
          document.querySelector("html-design-editor").shadowRoot.activeElement
            .dataset.act,
      ),
      "source",
    );
    await p.keyboard.press("Enter");
    assert.ok(await p.locator(".modal").isVisible());
    await p.locator("textarea").focus();
    await p.keyboard.press("Tab");
    assert.equal(
      await p.evaluate(
        () =>
          document.querySelector("html-design-editor").shadowRoot.activeElement
            .dataset.act,
      ),
      "src-copy",
    );
    await p.keyboard.press("Escape");
    assert.equal(await p.locator(".modal").isVisible(), false);
    const before = await p.locator("[data-editor-current]").boundingBox();
    await p.keyboard.press("Escape");
    await p.locator("[data-act=edit]").click();
    await p.mouse.move(
      before.x + before.width - 15,
      before.y + before.height - 15,
    );
    await p.keyboard.down("Space");
    await p.mouse.down();
    await p.mouse.move(
      before.x + before.width + 35,
      before.y + before.height + 15,
      { steps: 5 },
    );
    await p.mouse.up();
    await p.keyboard.up("Space");
    const after = await p.locator("[data-editor-current]").boundingBox();
    near(after.x - before.x, 50);
    near(after.y - before.y, 30);
    assert.equal(await p.locator("html").getAttribute("data-editing"), "");
    await p.locator("[data-act=zoom-fit]").click();
    const reset = await p.locator("[data-editor-current]").boundingBox();
    near(reset.x, before.x);
    near(reset.y, before.y);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("scaled text and image Fit export as editable PPTX objects in the current page order", async () => {
  const p = await open();
  try {
    await p.locator("[data-el=p1-title]").click();
    await p.keyboard.press("Control+0");
    await dragHandle(p, "se", 150, 80);
    await p.locator("[data-el=p1-image]").click();
    await p.locator("[data-act=image-fit]").click();
    await p.locator(".thumb.active .thumb-more").click();
    await p.locator("[data-act=page-down]").click();
    await p.locator("[data-act=more]").click();
    await p.locator("[data-act=source]").click();
    const html = await p.locator("textarea").inputValue();
    const result = await exportDocument({
      html,
      baseUrl: "http://127.0.0.1:8876/demos/toy-history.html",
      title: "Current editable state",
      format: "pptx",
    });
    const zip = await JSZip.loadAsync(result.bytes),
      first = await zip.file("ppt/slides/slide1.xml").async("string"),
      second = await zip.file("ppt/slides/slide2.xml").async("string");
    assert.match(first, /Second page/);
    assert.match(second, /Scale/);
    assert.match(second, /sz="7200"/);
    assert.match(second, /sz="3600"/);
    assert.equal((second.match(/<p:pic>/g) || []).length, 1);
    assert.doesNotMatch(second, /<a:srcRect l="[1-9]/);
    assert.equal(result.pages, 3);
  } finally {
    await p.close();
  }
});
