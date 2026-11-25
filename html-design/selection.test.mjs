import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { browserOptions } from "./export.mjs";
let browser, editor;
before(async () => {
  editor = await readFile("html-design/editor.js", "utf8");
  browser = await chromium.launch(browserOptions());
});
after(async () => browser?.close());
async function open(mode = "artboard", dark = false, narrow = false) {
  const p = await browser.newPage({
    viewport: narrow
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  });
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.setContent(
    `<!doctype html><html><head><title>多选</title><style>body{margin:0}[data-artboard]{position:relative;width:800px;height:450px;background:${dark ? "#181818" : "#fff"};font:20px Arial;color:${dark ? "#fff" : "#222"}}[data-el]{box-sizing:border-box}[data-artboard=p1]>[data-el]{position:absolute;width:100px;height:60px;padding:15px;background:${dark ? "#363636" : "#eee"}}[data-el=c]{background:#10b981!important}</style></head><body><main data-stage><section data-artboard="p1" data-title="多选测试" data-mode="${mode}"><div id="original-a" data-el="a" style="position:absolute;left:100px;top:80px">文字 A</div><div id="original-b" data-el="b" aria-labelledby="original-a" style="position:absolute;left:300px;top:80px">文字 B</div><div data-el="c" style="position:absolute;left:300px;top:250px">图片 C</div></section><section data-artboard="p2" data-title="另一页" data-mode="flow"><div data-el="other">Other</div></section></main></body></html>`,
  );
  await p.addScriptTag({ content: editor });
  await p.locator("[data-act=edit]").click();
  return p;
}
async function zoom(p, z) {
  await p.keyboard.press("Control+0");
  for (let i = 0; i < (z === 0.5 ? 4 : z === 2 ? 5 : 0); i++)
    await p.keyboard.press(z === 0.5 ? "Control+-" : "Control+=");
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.06, `${a} != ${b}`);
async function pos(p, id) {
  return p.locator(`[data-el=${id}]`).evaluate((n) => {
    const b = n.closest("[data-artboard]"),
      r = n.getBoundingClientRect(),
      br = b.getBoundingClientRect(),
      s = br.width / b.offsetWidth;
    return { x: (r.x - br.x) / s, y: (r.y - br.y) / s };
  });
}
async function choose(p, ids) {
  await p.locator(`[data-el=${ids[0]}]`).click();
  for (const id of ids.slice(1))
    await p.locator(`[data-el=${id}]`).click({ modifiers: ["Shift"] });
}
async function marquee(p, a, b, modifier) {
  const frame = await p.locator("[data-artboard=p1]").boundingBox(),
    s = frame.width / 800;
  if (modifier) await p.keyboard.down(modifier);
  await p.mouse.move(frame.x + a[0] * s, frame.y + a[1] * s);
  await p.mouse.down();
  await p.mouse.move(frame.x + b[0] * s, frame.y + b[1] * s, { steps: 6 });
  await p.mouse.up();
  if (modifier) await p.keyboard.up(modifier);
}

test("modifier clicks and directional shortcuts extend selection; canvas Select All and native text editing stay distinct", async () => {
  const p = await open();
  try {
    await zoom(p, 1);
    await choose(p, ["a", "b"]);
    assert.equal(await p.locator(".selection-member").count(), 2);
    await p.locator("[data-el=b]").click({ modifiers: ["Control"] });
    assert.equal(await p.locator(".selection-member").count(), 0);
    await p.locator("[data-el=b]").click({ modifiers: ["Meta"] });
    assert.equal(await p.locator(".selection-member").count(), 2);
    await p.keyboard.press("Control+a");
    await p.keyboard.press("Meta+a");
    assert.equal(await p.locator(".selection-member").count(), 3);
    await p.keyboard.press("Escape");
    await p.locator("[data-el=a]").click();
    await p.keyboard.press("Control+Shift+ArrowRight");
    assert.equal(await p.locator(".selection-member").count(), 2);
    await p.keyboard.press("Meta+Shift+ArrowDown");
    assert.equal(await p.locator(".selection-member").count(), 3);
    await p.keyboard.press("Shift+ArrowRight");
    near((await pos(p, "a")).x, 110);
    near((await pos(p, "b")).x, 310);
    await p.keyboard.press("Control+z");
    near((await pos(p, "a")).x, 100);
    await p.keyboard.press("Enter");
    assert.equal(await p.locator("[contenteditable]").count(), 0);
    await p.locator("[data-el=a]").dblclick();
    assert.equal(
      await p.locator("[data-el=a]").getAttribute("contenteditable"),
      "true",
    );
    await p.keyboard.press(
      process.platform === "darwin" ? "Meta+a" : "Control+a",
    );
    assert.equal(await p.evaluate(() => getSelection().toString()), "文字 A");
    await p.keyboard.press("Control+Shift+ArrowRight");
    assert.equal(await p.locator(".selection-member").count(), 0);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("marquee selects partially intersecting elements at 50% and 200% in either direction; Shift adds and Escape cancels", async () => {
  for (const z of [0.5, 2]) {
    const p = await open();
    try {
      await zoom(p, z);
      await marquee(p, [95, 70], [310, 90]);
      assert.equal(await p.locator(".selection-member").count(), 2);
      assert.equal(await p.locator(".marquee").isVisible(), false);
      assert.ok(
        await p.locator("[data-act=undo]").isDisabled(),
        "selection creates no undo command",
      );
      await marquee(p, [410, 150], [195, 130]);
      assert.equal(await p.locator(".selection-member").count(), 2);
      await marquee(p, [295, 240], [310, 260], "Shift");
      assert.equal(await p.locator(".selection-member").count(), 3);
      const b = await p.locator("[data-artboard=p1]").boundingBox();
      await p.mouse.move(b.x + 95 * z, b.y + 40 * z);
      await p.mouse.down();
      await p.mouse.move(b.x + 210 * z, b.y + 150 * z);
      await p.keyboard.press("Escape");
      await p.mouse.up();
      assert.equal(await p.locator(".selection-member").count(), 3);
      await p.locator(".footer [data-act=next]").click();
      assert.equal(await p.locator(".selection-member").count(), 0);
      assert.equal(await p.locator(".sel").isVisible(), false);
      assert.deepEqual(p.errors, []);
    } finally {
      await p.close();
    }
  }
});

test("group drag snaps the union frame without self-snapping and preserves relative positions in both layout modes", async () => {
  for (const mode of ["flow", "artboard"])
    for (const z of [0.5, 2]) {
      const p = await open(mode);
      try {
        await zoom(p, z);
        await choose(p, ["a", "b"]);
        const r = await p.locator("[data-el=a]").boundingBox(),
          x = r.x + r.width / 2,
          y = r.y + r.height / 2;
        await p.mouse.move(x, y);
        await p.mouse.down();
        await p.mouse.move(x + 148 * z, y + 60 * z, { steps: 8 });
        near((await pos(p, "a")).x, 250);
        near((await pos(p, "b")).x, 450);
        near((await pos(p, "a")).y, 140);
        assert.equal(await p.locator(".guide-line").count(), 1);
        await p.mouse.up();
        await p.keyboard.press("ArrowRight");
        near((await pos(p, "a")).x, 251);
        near((await pos(p, "b")).x, 451);
        await p.keyboard.press("Control+z");
        near((await pos(p, "a")).x, 250);
        await p.keyboard.press("Control+z");
        near((await pos(p, "a")).x, 100);
        near((await pos(p, "b")).x, 300);
        assert.equal(await p.locator(".guide-line").count(), 0);
        assert.deepEqual(p.errors, []);
      } finally {
        await p.close();
      }
    }
});

test("batch copy/delete each use one undo step, keep DOM order and fresh cross-object ID references", async () => {
  const p = await open();
  try {
    await zoom(p, 1);
    const original = await p
      .locator("[data-artboard=p1]")
      .evaluate((n) => n.innerHTML);
    await choose(p, ["b", "a"]);
    await p.keyboard.press("Delete");
    assert.equal(await p.locator("[data-artboard=p1]>[data-el]").count(), 1);
    await p.keyboard.press("Control+z");
    assert.equal(
      await p.locator("[data-artboard=p1]").evaluate((n) => n.innerHTML),
      original,
    );
    await choose(p, ["a", "b"]);
    await p.keyboard.press("Control+d");
    assert.equal(await p.locator("[data-artboard=p1]>[data-el]").count(), 5);
    const copyInfo = await p
      .locator("[data-artboard=p1]>[data-el]")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => !["a", "b", "c"].includes(n.dataset.el))
          .map((n) => ({
            id: n.id,
            ref: n.getAttribute("aria-labelledby"),
            x: parseFloat(n.style.left),
          })),
      );
    assert.equal(copyInfo.length, 2);
    assert.notEqual(copyInfo[0].id, "original-a");
    assert.equal(copyInfo[1].ref, copyInfo[0].id);
    near(copyInfo[0].x, 116);
    near(copyInfo[1].x, 316);
    await p.keyboard.press("Delete");
    assert.equal(await p.locator("[data-artboard=p1]>[data-el]").count(), 3);
    await p.keyboard.press("Control+z");
    assert.equal(await p.locator("[data-artboard=p1]>[data-el]").count(), 5);
    await p.keyboard.press("Control+z");
    assert.equal(await p.locator("[data-artboard=p1]>[data-el]").count(), 3);
    await p.keyboard.press("Control+Shift+z");
    assert.equal(await p.locator("[data-artboard=p1]>[data-el]").count(), 5);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("batch layer changes keep all selected objects together and undo as a unit", async () => {
  const p = await open();
  try {
    await zoom(p, 1);
    await choose(p, ["a", "b"]);
    await p.locator("[data-el=c]").evaluate((n) =>
      Object.assign(n.style, {
        left: "80px",
        top: "60px",
        width: "400px",
        height: "150px",
      }),
    );
    const hit = (x) =>
      p.evaluate((x) => {
        const b = document.querySelector("[data-artboard=p1]"),
          r = b.getBoundingClientRect(),
          s = r.width / b.offsetWidth;
        return document
          .elementsFromPoint(r.x + x * s, r.y + 110 * s)
          .find((n) => n.dataset.el)?.dataset.el;
      }, x);
    assert.equal(await hit(150), "c");
    assert.equal(await hit(350), "c");
    await p.locator("[data-act=element-more]").click();
    await p.locator("[data-act=element-front]").click();
    assert.equal(await hit(150), "a");
    assert.equal(await hit(350), "b");
    await p.locator("[data-act=element-more]").click();
    await p.locator("[data-act=element-back]").click();
    assert.equal(await hit(150), "c");
    assert.equal(await hit(350), "c");
    await p.keyboard.press("Control+z");
    assert.equal(await hit(150), "a");
    assert.equal(await hit(350), "b");
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("nested containers never move twice and modifier clicks can replace a parent selection with its child", async () => {
  const p = await open("flow");
  try {
    await zoom(p, 1);
    await p.evaluate(() => {
      const a = document.querySelector("[data-el=a]"),
        group = document.createElement("div");
      group.dataset.el = "group";
      group.style.cssText =
        "position:absolute;left:0;top:0;width:250px;height:200px";
      a.before(group);
      group.append(a);
    });
    await p.locator("[data-el=group]").click({ position: { x: 10, y: 10 } });
    await p.locator("[data-el=a]").click({ modifiers: ["Shift"] });
    await p.locator("[data-el=b]").click({ modifiers: ["Shift"] });
    assert.equal(await p.locator(".selection-member").count(), 2);
    await p.keyboard.press("ArrowRight");
    near((await pos(p, "a")).x, 101);
    near((await pos(p, "b")).x, 301);
    assert.equal(
      await p.locator("[data-el=group]").evaluate((n) => n.style.translate),
      "",
    );
    await p.keyboard.press("Control+z");
    await marquee(p, [-4, -4], [805, 455]);
    assert.equal(await p.locator(".selection-member").count(), 3);
    await p.keyboard.press("ArrowRight");
    near((await pos(p, "a")).x, 101);
    near((await pos(p, "b")).x, 301);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.close();
  }
});

test("selection overlays never enter saved HTML and preview preserves native modifier clicks", async () => {
  await mkdir(".export-test", { recursive: true });
  for (const [name, dark, narrow] of [
    ["light", false, false],
    ["dark", true, false],
    ["narrow", true, true],
  ]) {
    const p = await open("artboard", dark, narrow);
    try {
      if (!narrow) await zoom(p, 1);
      await choose(p, ["a", "b"]);
      await p.screenshot({ path: `.export-test/multiselect-${name}.png` });
      await p.locator("[data-act=more]").click();
      await p.locator("[data-act=source]").click();
      const source = (await p.locator("textarea").inputValue()).replace(
        /<script[\s\S]*?<\/script>/g,
        "",
      );
      assert.doesNotMatch(
        source,
        /selection-member|selection-count|class="marquee"|html-design-editor/,
      );
      await p.keyboard.press("Escape");
      await p.locator("[data-act=done]").click();
      assert.equal(await p.locator(".selection-member").count(), 0);
      await p.locator("[data-el=a]").click({ modifiers: ["Shift"] });
      assert.equal(await p.locator(".sel").isVisible(), false);
      assert.deepEqual(p.errors, []);
    } finally {
      await p.close();
    }
  }
});

test('clicking inside a marquee selection keeps the set and dragging the gap moves it as one action', async () => {
  const p = await open();
  try {
    await zoom(p, 1);
    await p.locator('[data-el=c]').evaluate(n => { n.style.cssText += ';left:225px;top:112px;width:50px;height:26px;padding:0'; });
    await marquee(p, [95, 70], [310, 90]);
    const board = await p.locator('[data-artboard=p1]').boundingBox();
    const point = (x, y) => [board.x + x, board.y + y];
    const count = () => p.locator('.selection-member').count();
    assert.equal(await count(), 2);
    await p.mouse.click(...point(250, 100));
    assert.equal(await count(), 2);
    await p.mouse.click(...point(250, 120));
    assert.equal(await count(), 2);
    assert.equal(await p.locator('[data-act=undo]').isDisabled(), true);
    await p.mouse.move(...point(250, 100));
    await p.mouse.down();
    await p.keyboard.down('Alt');
    await p.mouse.move(...point(270, 132), {steps: 4});
    await p.mouse.up();
    await p.keyboard.up('Alt');
    near((await pos(p, 'a')).x, 120);
    near((await pos(p, 'b')).y, 112);
    near((await pos(p, 'c')).x, 225);
    await p.locator('[data-act=undo]').click();
    near((await pos(p, 'a')).x, 100);
    near((await pos(p, 'b')).y, 80);
    await p.mouse.click(...point(700, 390));
    assert.equal(await count(), 0);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('text context menu changes line height and negative tracking on the box without splitting markup', async () => {
  const p = await open();
  try {
    const text = p.locator('[data-el=a]');
    await text.evaluate(n => {
      n.style.height = 'auto';
      n.style.lineHeight = '1.25';
      n.innerHTML = '<b>One</b><br>Two';
    });
    const before = (await text.boundingBox()).height;
    await text.click({button: 'right'});
    const line = p.getByRole('spinbutton', {name: '行高（倍）'});
    const spacing = p.getByRole('spinbutton', {name: '字距（px）'});
    assert.equal(await line.inputValue(), '1.25');
    await line.fill('2');
    await line.press('Enter');
    assert.ok((await text.boundingBox()).height > before);
    await spacing.fill('-1.5');
    await spacing.press('Enter');
    const styles = () => text.evaluate(n => [n.style.lineHeight, n.style.letterSpacing]);
    assert.deepEqual(await styles(), ['2', '-1.5px']);
    assert.equal(await text.innerHTML(), '<b>One</b><br>Two');
    await p.locator('[data-act=undo]').click();
    assert.deepEqual(await styles(), ['2', '']);
    await p.locator('[data-act=redo]').click();
    assert.deepEqual(await styles(), ['2', '-1.5px']);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
