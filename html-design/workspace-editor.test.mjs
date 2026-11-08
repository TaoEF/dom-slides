import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPreviewServer } from "./server.mjs";
import { chromium } from "playwright";
import { browserOptions, exportDocument } from "./export.mjs";
import JSZip from "jszip";
let browser, editor;
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="green"/></svg>',
  );
const fixture = `<!doctype html><html><head><title>Workspace editing</title><style>body{margin:0}[data-stage]{display:flex;gap:40px;padding:64px}[data-artboard]{position:relative;box-sizing:border-box;flex-shrink:0;width:200px;height:140px;overflow:hidden;background:white}[data-artboard=p2]{height:180px;background:#e3eee8}[data-artboard=p2] p{color:blue;font-size:30px}p{margin:0}</style></head><body><main data-stage data-workspace-prototype><section data-artboard="p1" data-title="First" data-mode="flow"><p data-el="a" style="position:absolute;left:20px;top:25px;width:100px;height:28px;font:16px/20px Arial;color:red">Move <b>me</b></p><img data-el="b" src="${image}" style="position:absolute;left:20px;top:80px;width:30px;height:30px"></section><section data-artboard="p2" data-title="Second" data-mode="flow"><p data-el="target" style="position:absolute;left:80px;top:130px;width:100px;font:14px Arial">Destination</p></section></main></body></html>`;
before(async () => {
  browser = await chromium.launch(browserOptions());
  editor = await readFile("html-design/editor.js", "utf8");
});
after(async () => browser?.close());
async function open(edit = true) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.setContent(fixture);
  await p.addScriptTag({ content: editor });
  if (edit) await p.locator("[data-act=edit]").click();
  return p;
}
async function zoom(p, value) {
  await p.locator("[data-act=zoom-reset]").click();
  const dir = value > 1 ? "in" : "out";
  for (let i = 0; i < (value === 2 ? 5 : value === 0.5 ? 4 : 0); i++)
    await p.locator(`[data-act=zoom-${dir}]`).click();
}
async function drag(p, id, { copy = false } = {}) {
  const source = await p.locator(`[data-el="${id}"]`).boundingBox(),
    target = await p.locator("[data-artboard=p2]").boundingBox();
  if (copy) await p.keyboard.down("Alt");
  await p.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await p.mouse.down();
  await p.mouse.move(
    target.x + target.width * 0.4,
    target.y + target.height * 0.4,
    { steps: 10 },
  );
  await p.mouse.up();
  if (copy) await p.keyboard.up("Alt");
}
const parent = (p, id) =>
  p
    .locator(`[data-el="${id}"]`)
    .evaluate((n) => n.closest("[data-artboard]").dataset.artboard);
test("workspace uses original thumbnails and explicit Edit; same DOM edits text and retains single-page interactions", async () => {
  const p = await open(false);
  try {
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    assert.ok(await p.locator("[data-act=edit]").isVisible());
    assert.equal(await p.locator(".thumb-list .thumb").count(), 2);
    assert.equal(await p.locator(".thumb iframe").count(), 2);
    assert.equal(await p.locator(".nav").evaluate((n) => n.offsetWidth), 170);
    await p.locator("[data-act=edit]").click();
    await p.locator("[data-el=a]").dblclick();
    await p.locator("[contenteditable=true]").fill("Edited in workspace");
    await p.keyboard.press("Escape");
    assert.equal(
      await p.locator("[data-el=a]").textContent(),
      "Edited in workspace",
    );
    await p.locator("[data-act=view-single]").click();
    assert.equal(await p.locator("html").getAttribute("data-editing"), "");
    assert.equal(await p.locator("[data-artboard=p2]").isVisible(), false);
    await p.locator("[data-act=view-workspace]").click();
    assert.ok(await p.locator("[data-artboard=p2]").isVisible());
    await p.locator("[data-act=done]").click();
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});
test("cross-artboard pointer moves retain text styles/identity and undo/redo restores both parents at 50/100/200%", async () => {
  for (const value of [0.5, 1, 2]) {
    const p = await open();
    try {
      await zoom(p, value);
      const old = await p.locator("[data-el=a]").getAttribute("style");
      await drag(p, "a");
      assert.equal(await parent(p, "a"), "p2");
      assert.equal(
        await p
          .locator("[data-el=a]")
          .evaluate((n) => getComputedStyle(n).color),
        "rgb(255, 0, 0)",
      );
      assert.ok(await p.locator("[data-el=a] b").count());
      await p.locator("[data-act=undo]").click();
      assert.equal(await parent(p, "a"), "p1");
      assert.equal(await p.locator("[data-el=a]").getAttribute("style"), old);
      await p.locator("[data-act=redo]").click();
      assert.equal(await parent(p, "a"), "p2");
      assert.deepEqual(p.errors, []);
    } finally {
      await p.close();
    }
  }
});
test("Alt cross-drag copies fresh IDs and images; Escape cancels without transfer or extra history", async () => {
  const p = await open();
  try {
    await zoom(p, 1);
    await drag(p, "b", { copy: true });
    assert.equal(await parent(p, "b"), "p1");
    assert.equal(await p.locator("[data-artboard=p2] img").count(), 1);
    const id = await p
      .locator("[data-artboard=p2] img")
      .getAttribute("data-el");
    assert.notEqual(id, "b");
    await p.locator("[data-act=undo]").click();
    assert.equal(await p.locator("[data-artboard=p2] img").count(), 0);
    await p.locator("[data-act=redo]").click();
    assert.equal(
      await p.locator("[data-artboard=p2] img").getAttribute("data-el"),
      id,
    );
    await p.locator(".thumb-main").first().click();
    const old = await p.locator("[data-el=a]").getAttribute("style"),
      r = await p.locator("[data-el=a]").boundingBox();
    await p.mouse.move(r.x + 10, r.y + 10);
    await p.mouse.down();
    await p.mouse.move(r.x + 250, r.y + 10);
    await p.keyboard.press("Escape");
    await p.mouse.up();
    assert.equal(await parent(p, "a"), "p1");
    assert.equal(await p.locator("[data-el=a]").getAttribute("style"), old);
    assert.equal(await p.locator(".workspace-ghost").count(), 0);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});
test("clipboard copy and target-frame paste reuse objects; native text clipboard remains text", async () => {
  const p = await open();
  try {
    await p.locator("[data-el=a]").click();
    await p.keyboard.press(
      (process.platform === "darwin" ? "Meta" : "Control") + "+c",
    );
    await p.locator("[data-artboard=p2]").click({ position: { x: 10, y: 10 } });
    await p.keyboard.press(
      (process.platform === "darwin" ? "Meta" : "Control") + "+v",
    );
    assert.equal(await p.locator("[data-artboard=p2] [data-el]").count(), 2);
    assert.equal(await parent(p, "a"), "p1");
    await p.locator("[data-act=undo]").click();
    assert.equal(await p.locator("[data-artboard=p2] [data-el]").count(), 1);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});
test("workspace save removes projection/ghost state and editable PPTX still uses local page coordinates", async () => {
  const p = await open();
  try {
    await zoom(p, 1);
    await drag(p, "a");
    await p.locator("[data-act=more]").click();
    await p.locator("[data-act=source]").click();
    const html = await p.locator(".modal textarea").inputValue();
    assert.doesNotMatch(
      html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""),
      /data-editor-workspace|data-editor-drop-target|workspace-labels|workspace-ghost/,
    );
    assert.equal((html.match(/data-el="a"/g) || []).length, 1);
    const doc = await exportDocument({
      html,
      baseUrl: "http://127.0.0.1/",
      format: "pdf",
    });
    assert.equal(doc.pages, 2);
    await assert.rejects(
      exportDocument({ html, baseUrl: "http://127.0.0.1/", format: "pptx" }),
      /相同比例/,
    );
    const uniform = html.replace(
      "[data-artboard=p2]{height:180px;",
      "[data-artboard=p2]{height:140px;",
    );
    const pptx = await exportDocument({
      html: uniform,
      baseUrl: "http://127.0.0.1/",
      format: "pptx",
    });
    const zip = await JSZip.loadAsync(pptx.bytes);
    assert.ok(
      (await zip.file("ppt/slides/slide2.xml").async("string")).includes(
        "Move",
      ),
    );
  } finally {
    await p.close();
  }
});
test("logical groups and multiselection transfer once and restore structure on Undo", async () => {
  for (const group of [false, true]) {
    const p = await open();
    try {
      await zoom(p, 1);
      await p.locator("[data-el=a]").click();
      await p.locator("[data-el=b]").click({ modifiers: ["Shift"] });
      if (group) await p.keyboard.press("Control+g");
      await drag(p, "a");
      assert.equal(await parent(p, "a"), "p2");
      assert.equal(await parent(p, "b"), "p2");
      if (group)
        assert.equal(
          await p.locator('[data-artboard=p2] [data-group="1"]').count(),
          1,
        );
      await p.locator("[data-act=undo]").click();
      assert.equal(await parent(p, "a"), "p1");
      assert.equal(await parent(p, "b"), "p1");
      if (group)
        assert.equal(
          await p.locator('[data-artboard=p1] [data-group="1"]').count(),
          1,
        );
      assert.deepEqual(p.errors, []);
    } finally {
      await p.close();
    }
  }
});
test("a conflicting target CSS refuses transfer without orphaned copies or source changes", async () => {
  const p = await open();
  try {
    await zoom(p, 1);
    await p.addStyleTag({
      content: "[data-artboard=p2] p{font-size:40px!important}",
    });
    const before = await p.locator("[data-el=a]").getAttribute("style");
    await drag(p, "a", { copy: true });
    assert.equal(await parent(p, "a"), "p1");
    assert.equal(await p.locator("[data-artboard=p2] [data-el]").count(), 1);
    assert.equal(await p.locator("[data-el=a]").getAttribute("style"), before);
    await drag(p, "a");
    assert.equal(await parent(p, "a"), "p1");
    assert.equal(await p.locator("[data-el=a]").getAttribute("style"), before);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});
test("rotated objects retain their page direction through transfer and a gap drop restores the source", async () => {
  const p = await open();
  try {
    await zoom(p, 1);
    await p.locator("[data-el=a]").evaluate((n) => (n.style.rotate = "30deg"));
    await drag(p, "a");
    assert.equal(await parent(p, "a"), "p2");
    const angle = await p.locator("[data-el=a]").evaluate((n) => {
      const m = new DOMMatrix(getComputedStyle(n).transform);
      return (Math.atan2(m.b, m.a) * 180) / Math.PI;
    });
    assert.ok(Math.abs(angle - 30) < 0.01);
    await p.locator("[data-act=undo]").click();
    const old = await p.locator("[data-el=a]").getAttribute("style");
    const a = await p.locator("[data-el=a]").boundingBox(),
      board = await p.locator("[data-artboard=p1]").boundingBox();
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await p.mouse.down();
    await p.mouse.move(board.x + board.width + 50, board.y + 40, { steps: 8 });
    await p.mouse.up();
    assert.equal(await parent(p, "a"), "p1");
    assert.equal(await p.locator("[data-el=a]").getAttribute("style"), old);
    assert.equal(await p.locator(".workspace-ghost").count(), 0);
  } finally {
    await p.close();
  }
});
test("native text copy after object copy does not replay the internal object clipboard", async () => {
  const p = await open();
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  try {
    await p.locator("[data-el=a]").click();
    await p.keyboard.press(mod + "+c");
    await p.locator("[data-el=a]").dblclick();
    await p.evaluate(() => {
      const s = getSelection(),
        r = document.createRange();
      r.selectNodeContents(document.querySelector("[data-el=a]"));
      s.removeAllRanges();
      s.addRange(r);
    });
    await p.keyboard.press(mod + "+c");
    await p.keyboard.press("Escape");
    await p.locator("[data-el=target]").dblclick();
    await p.locator("[contenteditable=true]").fill("");
    await p.keyboard.press(mod + "+v");
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("[data-el=target]").textContent(), "Move me");
    assert.equal(await p.locator("[data-artboard=p2] [data-el]").count(), 1);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});


test("managed workspace autosaves cross-frame moves, reopens canonical geometry and keeps viewer read-only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-managed-"));
  const file = path.join(root, "test.html");
  await writeFile(file, fixture.replace("</body>", () => `<script data-editor>${editor}</script></body>`));
  const server = await createPreviewServer({ root, port: 0 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  try {
    const url = `http://127.0.0.1:${server.address().port}/test.html`;
    await p.goto(url);
    await p.locator(".state-text").filter({ hasText: /^已保存$/ }).waitFor();
    const viewer = await context.newPage();
    await viewer.goto(url);
    await viewer.locator(".state-text").filter({ hasText: /已同步 · 预览中/ }).waitFor();
    assert.equal(await viewer.locator("[data-act=add-text]").isEnabled(), false);
    await p.locator("[data-act=edit]").click();
    await zoom(p, 1);
    await drag(p, "a");
    const landed = await p.locator("[data-el=a]").getAttribute("style");
    for (let i = 0; i < 80; i++) {
      const saved = await readFile(file, "utf8");
      if (saved.indexOf('data-artboard="p2"') < saved.indexOf('data-el="a"')) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const saved = await readFile(file, "utf8");
    assert.ok(saved.indexOf('data-artboard="p2"') < saved.indexOf('data-el="a"'));
    const body = saved.replace(/<script[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(body, /data-editor-workspace|data-editor-drop-target|workspace-ghost|transform:translateX/);
    await p.reload();
    await p.locator(".state-text").filter({ hasText: /^已保存$/ }).waitFor();
    assert.equal(await parent(p, "a"), "p2");
    assert.equal(await p.locator("[data-el=a]").getAttribute("style"), landed);
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    await p.locator(".thumb-main").nth(1).click();
    await p.locator("[data-act=view-single]").click();
    assert.equal(await p.locator("[data-artboard=p2]").evaluate(n => n.offsetWidth), 200);
    assert.equal(await p.locator("[data-artboard=p2]").evaluate(n => n.offsetHeight), 180);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await new Promise(r => server.close(r));
    await rm(root, { recursive: true, force: true });
  }
});

test("editable workspace desktop/narrow keeps original navigation and reachable footer controls", async () => {
  await mkdir(".html-design/evidence", { recursive: true });
  for (const width of [1440, 640]) {
    const p = await open(false);
    try {
      await p.setViewportSize({ width, height: 900 });
      await p.locator("[data-act=zoom-fit]").click();
      assert.equal(await p.locator(".nav").evaluate(n => n.offsetWidth), 170);
      for (const action of ["edit", "view-single", "view-workspace", "zoom-fit"]) {
        const r = await p.locator(`[data-act=${action}]`).boundingBox();
        assert.ok(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= width + 1 && r.y + r.height <= 901, `${action} reachable at ${width}`);
      }
      const thumb = await p.locator(".thumb-main").first().boundingBox();
      const nav = await p.locator(".nav").boundingBox();
      assert.ok(thumb.y >= nav.y, "first thumbnail is not top-clipped");
      await p.locator("[data-act=edit]").click();
      await p.screenshot({ path: `.html-design/evidence/workspace-before-${width}.png` });
      const target = await p.locator("[data-el=a]").boundingBox();
      await p.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
      assert.ok(await p.locator(".sel").isVisible());
      await p.screenshot({ path: `.html-design/evidence/workspace-fixture-${width}.png` });
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  }
});


test("review: target forced rotation and hidden rich-text descendants reject moves and copies atomically", async () => {
  for (const css of ["p{rotate:90deg!important}", "b{display:none!important}"])
    for (const copy of [false, true]) {
      const p = await open();
      try {
        await zoom(p, 1);
        await p.addStyleTag({content: css.replace(/^([pb])/, "[data-artboard=p2] $1")});
        const before = await p.locator("[data-el=a]").evaluate(n => n.outerHTML);
        await drag(p, "a", {copy});
        assert.equal(await parent(p, "a"), "p1");
        assert.equal(await p.locator("[data-el=a]").evaluate(n => n.outerHTML), before);
        assert.equal(await p.locator("[data-artboard=p2] [data-el]").count(), 1);
        assert.equal(await p.locator("[data-el=a] b").isVisible(), true);
        assert.equal(await p.locator(".workspace-ghost").count(), 0);
        assert.equal(await p.locator("[data-editor-drop-target]").count(), 0);
        assert.equal(await p.locator("[data-act=undo]").isEnabled(), false);
        assert.deepEqual(p.errors, []);
      } finally { await p.close(); }
    }
});
