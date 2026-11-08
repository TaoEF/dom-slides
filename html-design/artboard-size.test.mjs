import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { exportDocument, browserOptions } from "./export.mjs";
let browser, editor;
const html = `<!doctype html><html><head><title>Sizes</title><style>body{margin:0}[data-stage]{display:flex;flex-direction:column;gap:30px}[data-artboard]{position:relative;box-sizing:border-box;width:800px;height:450px;background:white;padding:30px;flex-shrink:0}[data-artboard=p2]{width:600px;height:600px}[data-artboard=p3]{width:450px;height:800px}p{font:24px Arial}</style></head><body><main data-stage><section data-artboard="p1" data-title="横版"><p data-el="t1">First</p></section><section data-artboard="p2" data-title="方形"><p data-el="t2">Second</p></section><section data-artboard="p3" data-title="竖版"><p data-el="t3">Third</p></section></main></body></html>`;
before(async () => {
  browser = await chromium.launch(browserOptions());
  editor = await readFile("html-design/editor.js", "utf8");
});
after(async () => browser?.close());
async function open() {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.setContent(html);
  await p.addScriptTag({ content: editor });
  return p;
}
async function dialog(p, index = 0) {
  await p.locator(".thumb-more").nth(index).click();
  await p.locator("[data-act=page-size]").click();
  await p.locator(".page-size-dialog").waitFor({ state: "visible" });
}
async function size(p, id) {
  return p
    .locator(`[data-artboard=${id}]`)
    .evaluate((n) => [n.offsetWidth, n.offsetHeight, n.getAttribute("style")]);
}
test("independent sizes: preview entry, fit, sizing undo/redo, inherited copy/new dimensions and saved reopen", async () => {
  const p = await open();
  try {
    for (const [i, dims] of [
      [0, [800, 450]],
      [1, [600, 600]],
      [2, [450, 800]],
    ]) {
      await p.locator(".thumb-main").nth(i).click();
      assert.deepEqual((await size(p, `p${i + 1}`)).slice(0, 2), dims);
      const r = await p.locator(`[data-artboard=p${i + 1}]`).boundingBox();
      assert.ok(r.x >= 170 && r.y >= 52 && r.y + r.height < 970);
    }
    await dialog(p, 1);
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    await p.getByLabel("画布宽度", { exact: true }).fill("700");
    await p.getByLabel("画布高度", { exact: true }).fill("500");
    await p.getByRole("button", { name: "应用尺寸", exact: true }).click();
    await p.locator(".page-size-dialog").waitFor({ state: "hidden" });
    assert.deepEqual((await size(p, "p2")).slice(0, 2), [700, 500]);
    await p.locator("[data-act=edit]").click();
    await p.locator("[data-act=undo]").click();
    assert.deepEqual(await size(p, "p2"), [600, 600, null]);
    await p.locator("[data-act=redo]").click();
    assert.deepEqual((await size(p, "p2")).slice(0, 2), [700, 500]);
    await p.locator(".thumb-more").nth(1).click();
    await p.locator("[data-act=page-copy]").click();
    assert.deepEqual((await size(p, "p4")).slice(0, 2), [700, 500]);
    await p.locator(".thumb-more").nth(2).click();
    await p.locator("[data-act=page-add]").first().click();
    assert.deepEqual((await size(p, "p5")).slice(0, 2), [700, 500]);
    await p.locator("[data-act=more]").click();
    await p.locator("[data-act=source]").click();
    const saved = await p.locator("textarea").inputValue();
    const q = await browser.newPage();
    try {
      await q.setContent(saved);
      await q.addScriptTag({ content: editor });
      await q.locator(".thumb-main").nth(1).click();
      assert.deepEqual((await size(q, "p2")).slice(0, 2), [700, 500]);
    } finally {
      await q.close();
    }
  } finally {
    await p.close();
  }
});
test("size cancel, keyboard focus, and CSS conflict leave original declarations intact", async () => {
  const p = await open();
  try {
    await dialog(p);
    await p.getByLabel("画布宽度", { exact: true }).fill("900");
    await p.keyboard.press("Escape");
    assert.deepEqual(await size(p, "p1"), [800, 450, null]);
    await p.addStyleTag({
      content: "[data-artboard=p1]{max-width:850px!important}",
    });
    await dialog(p);
    await p.getByLabel("画布宽度", { exact: true }).fill("1000");
    const beforeConflict = await size(p, "p1");
    await p.getByRole("button", { name: "应用尺寸", exact: true }).click();
    await p.locator(".size-error").waitFor({ state: "visible" });
    assert.deepEqual(await size(p, "p1"), beforeConflict);
    await p.getByRole("button", { name: "取消", exact: true }).click();
    assert.ok(
      await p
        .locator(".thumb-more")
        .first()
        .evaluate((n) => n === n.getRootNode().activeElement),
    );
  } finally {
    await p.close();
  }
});
test("mixed-size PDF preserves each page; PPTX rejects mixed ratios and accepts same-ratio pixel differences", async () => {
  const result = await exportDocument({
    html,
    baseUrl: "http://127.0.0.1/",
    format: "pdf",
  });
  const pdf = await PDFDocument.load(result.bytes);
  assert.deepEqual(
    pdf
      .getPages()
      .map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]),
    [
      [600, 338],
      [450, 450],
      [338, 600],
    ],
  );
  await assert.rejects(
    exportDocument({ html, baseUrl: "http://127.0.0.1/", format: "pptx" }),
    /相同比例/,
  );
  const uniform = html
    .replace("width:600px;height:600px", "width:1600px;height:900px")
    .replace("width:450px;height:800px", "width:400px;height:225px");
  assert.equal(
    (
      await exportDocument({
        html: uniform,
        baseUrl: "http://127.0.0.1/",
        format: "pptx",
      })
    ).pages,
    3,
  );
});
test("size panel stays usable at desktop/narrow sizes and managed resize persists without entering editing", async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createPreviewServer } = await import("./server.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "dom-size-managed-"));
  const file = path.join(root, "design.html");
  await writeFile(
    file,
    html.replace(
      "</body>",
      () => `<script data-editor>${editor}</script></body>`,
    ),
  );
  const server = await createPreviewServer({ root, port: 0 });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await p.goto(`http://127.0.0.1:${server.address().port}/design.html`);
    await p
      .locator(".state-text")
      .filter({ hasText: /^已保存$/ })
      .waitFor();
    await dialog(p, 1);
    await p.getByLabel("画布宽度", { exact: true }).fill("700");
    await p.getByLabel("画布高度", { exact: true }).fill("500");
    await p.getByRole("button", { name: "应用尺寸", exact: true }).click();
    await p.locator(".page-size-dialog").waitFor({ state: "hidden" });
    assert.equal(await p.locator("html").getAttribute("data-editing"), null);
    assert.match(await readFile(file, "utf8"), /width: 700px; height: 500px;/);
    await mkdir(".export-test", { recursive: true });
    for (const width of [1440, 760, 390]) {
      await p.setViewportSize({ width, height: 900 });
      if (width === 390) await p.locator("[data-act=nav]").click();
      await dialog(p, 1);
      const r = await p.locator(".size-box").boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= width && r.y + r.height <= 900);
      await p.screenshot({ path: `.export-test/artboard-size-${width}.png` });
      await p.getByRole("button", { name: "取消", exact: true }).click();
    }
  } finally {
    await p.close();
    await new Promise((r) => {
      server.close(r);
      server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
});
test("review: copied page retains important inline width and height against stylesheet constraints", async () => {
  const p = await open();
  try {
    await p.addStyleTag({
      content: "[data-artboard]{width:600px!important;height:400px!important}",
    });
    await p.locator("[data-artboard=p1]").evaluate((n) => {
      n.style.setProperty("width", "800px", "important");
      n.style.setProperty("height", "450px", "important");
    });
    await p.locator(".thumb-more").first().click();
    await p.locator("[data-act=page-copy]").click();
    assert.deepEqual((await size(p, "p4")).slice(0, 2), [800, 450]);
    assert.deepEqual(
      await p
        .locator("[data-artboard=p4]")
        .evaluate((n) =>
          ["width", "height"].map((k) => n.style.getPropertyPriority(k)),
        ),
      ["important", "important"],
    );
  } finally {
    await p.close();
  }
});
