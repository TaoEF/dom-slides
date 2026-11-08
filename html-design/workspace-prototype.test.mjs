import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { browserOptions } from "./export.mjs";
const html = await readFile("prototypes/workspace.html", "utf8");
test("workspace prototype: same DOM, mixed sizes, pan/zoom, focus and responsive controls", async () => {
  const b = await chromium.launch(browserOptions());
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.setContent(html);
    await p.evaluate(
      () =>
        (window.originalNodes = [
          ...document.querySelectorAll("[data-artboard]"),
        ]),
    );
    assert.equal(await p.locator("[data-artboard]").count(), 6);
    assert.equal(await p.locator(".frame:not([data-off])").count(), 6);
    const before = await p.locator(".world").getAttribute("style");
    await p.locator(".plus").click();
    assert.notEqual(await p.locator(".world").getAttribute("style"), before);
    await p
      .getByRole("button", { name: "第 2 页：纵向表达", exact: true })
      .click();
    assert.equal(await p.locator(".page-label").innerText(), "2 / 6");
    await p.locator("[data-view=single]").click();
    assert.equal(await p.locator(".frame:not([data-off])").count(), 1);
    assert.equal(
      await p
        .locator(".frame:not([data-off]) [data-artboard]")
        .getAttribute("data-artboard"),
      "p2",
    );
    await p.keyboard.press("ArrowRight");
    assert.equal(await p.locator(".page-label").innerText(), "3 / 6");
    await p.keyboard.press("Escape");
    assert.equal(await p.locator(".frame:not([data-off])").count(), 6);
    assert.ok(
      await p.evaluate(() =>
        window.originalNodes.every(
          (n, i) => n === document.querySelectorAll("[data-artboard]")[i],
        ),
      ),
    );
    const r = await p.locator(".surface").boundingBox();
    const start = await p.locator(".world").getAttribute("style");
    await p.keyboard.down("Space");
    await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await p.mouse.down();
    await p.mouse.move(r.x + r.width / 2 + 90, r.y + r.height / 2 + 40, {
      steps: 5,
    });
    await p.mouse.up();
    await p.keyboard.up("Space");
    assert.notEqual(await p.locator(".world").getAttribute("style"), start);
    await p.locator(".fit").click();
    await mkdir(".export-test", { recursive: true });
    await p.screenshot({ path: ".export-test/workspace-1440.png" });
    for (const width of [760, 390]) {
      await p.setViewportSize({ width, height: 900 });
      await p.locator(".fit").click();
      assert.ok(await p.locator("[data-view=workspace]").isVisible());
      const header = await p
        .locator("header")
        .evaluate((n) => ({ w: n.clientWidth, s: n.scrollWidth }));
      assert.ok(header.s <= header.w);
      await p.screenshot({ path: `.export-test/workspace-${width}.png` });
    }
    assert.deepEqual(errors, []);
  } finally {
    await p.close();
    await b.close();
  }
});
