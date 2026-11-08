import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  inspectFile,
  applySession,
  revisionOf,
  validatePatch,
} from "./runtime.mjs";
import { createPreviewServer } from "./server.mjs";
let root, server, origin;
const html = `<!doctype html><html><head><style data-design>:root { --brand: #123456; }</style><style>body{margin:0}[data-artboard]{position:relative;box-sizing:border-box;width:800px;height:450px;background:#fff}p{font:24px/32px Arial;color:var(--brand)}[data-artboard=p2]{width:500px;height:700px}</style></head><body><!-- keep comment and whitespace --><main data-stage><section data-artboard="p1"><p data-el="title">Original &amp; plain</p><p data-el="rich"><b>Bold</b> keep</p><p data-el="other" style="color: red; width: 300px;">Other</p></section><section data-artboard="p2"><p data-el="second">Second</p></section></main><script>document.querySelector('p').textContent='executed'</script></body></html>`;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dom-runtime-"));
  server = await createPreviewServer({ root, port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => {
    server.close(r);
    server.closeAllConnections();
  });
  await rm(root, { recursive: true, force: true });
});
async function request(action, body) {
  const res = await fetch(`${origin}/__html-design/document/ai/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const r = await res.json();
  if (!res.ok) throw new Error(r.error);
  return r;
}
async function session(name, source = html) {
  const file = path.join(root, `${name}.html`);
  await writeFile(file, source);
  const { token } = await request("begin", { path: `/${name}.html` });
  const info = await request("status", { path: `/${name}.html`, token });
  const dir = path.join(root, ".html-design", "work", token);
  await mkdir(dir, { recursive: true });
  const s = {
    origin,
    path: `/${name}.html`,
    token,
    workFile: path.join(dir, "document.html"),
    revision: info.revision,
  };
  const sessionFile = path.join(dir, "session.json");
  await writeFile(s.workFile, info.html);
  await writeFile(sessionFile, JSON.stringify(s));
  return { file, sessionFile, s };
}
const patch = (revision, operations) => ({ revision, operations });
test("inspect saved DOM returns stable scope, real dimensions, declared vs computed evidence and no content scripts", async () => {
  const file = path.join(root, "inspect.html");
  await writeFile(file, html);
  const r = await inspectFile(file, { details: true });
  assert.equal(r.source.revision, revisionOf(html));
  assert.deepEqual(
    r.pages.map((p) => [p.width, p.height]),
    [
      [800, 450],
      [500, 700],
    ],
  );
  assert.equal(
    r.objects.find((n) => n.elementId === "title").text,
    "Original & plain",
  );
  assert.equal(
    r.objects.find((n) => n.elementId === "rich").capabilities.replaceText,
    false,
  );
  const title = r.objects.find((n) => n.elementId === "title");
  assert.equal(title.styles.color.inline, null);
  assert.equal(title.styles.color.computed, "rgb(18, 52, 86)");
  assert.ok(title.styles.color.matchedDeclarations.length);
  assert.equal(r.environment.scripts, "disabled");
  assert.equal(r.design.tokens[0].name, "--brand");
  assert.equal(r.design.tokens[0].declared, "#123456");
  assert.equal(await readFile(file, "utf8"), html);
  const one = await inspectFile(file, { pageId: "p2", elementId: "second" });
  assert.equal(one.objects.length, 1);
  await assert.rejects(
    inspectFile(file, { pageId: "missing" }),
    /does not exist/,
  );
});
test("atomic sparse text staging preserves every unrelated byte and canonical commit enters existing review", async () => {
  const { file, sessionFile, s } = await session("plain");
  const r = await applySession(
    sessionFile,
    patch(s.revision, [
      {
        op: "replaceText",
        pageId: "p1",
        elementId: "title",
        text: 'New < & "',
      },
    ]),
  );
  assert.equal(r.committed, false);
  assert.equal(r.status, "applied");
  const actual = await readFile(s.workFile, "utf8");
  assert.equal(
    actual,
    html.replace("Original &amp; plain", "New &lt; &amp; &quot;"),
  );
  assert.equal(await readFile(file, "utf8"), html);
  assert.ok(r.affected.some((n) => n.elementId === "title"));
  const done = await request("commit", { ...s, html: actual });
  assert.equal(done.revision, r.source.revision);
  assert.ok(done.review.items.some((i) => i.id === "p1"));
});
test("sparse styles preserve omitted declarations, explicit null removes, and no-op retains exact bytes", async () => {
  const { sessionFile, s } = await session("style");
  const r = await applySession(
    sessionFile,
    patch(s.revision, [
      {
        op: "setStyle",
        pageId: "p1",
        elementId: "other",
        style: { color: "red" },
      },
    ]),
  );
  assert.equal(r.status, "no-op");
  assert.equal(await readFile(s.workFile, "utf8"), html);
  const next = await applySession(
    sessionFile,
    patch(s.revision, [
      {
        op: "setStyle",
        pageId: "p1",
        elementId: "other",
        style: { color: null },
      },
    ]),
  );
  const changed = await readFile(s.workFile, "utf8");
  assert.ok(changed.includes("width: 300px;"));
  assert.ok(!changed.includes("color: red;"));
  assert.equal(next.changes[0].status, "applied");
  await request("cancel", s);
});
test("rich text, invalid batch targets, stale revisions and expired leases refuse without any work-copy change", async () => {
  const { sessionFile, s } = await session("reject");
  const first = {
    op: "replaceText",
    pageId: "p1",
    elementId: "title",
    text: "valid",
  };
  await assert.rejects(
    applySession(
      sessionFile,
      patch(s.revision, [
        first,
        { op: "replaceText", pageId: "p1", elementId: "rich", text: "destroy" },
      ]),
    ),
    /plain-text/,
  );
  assert.equal(await readFile(s.workFile, "utf8"), html);
  await assert.rejects(
    applySession(sessionFile, patch("0".repeat(64), [first])),
    /revision conflict/,
  );
  await request("cancel", s);
  await assert.rejects(
    applySession(sessionFile, patch(s.revision, [first])),
    /lease/,
  );
  assert.equal(await readFile(s.workFile, "utf8"), html);
});
test("design tokens and page size stage explicit changes with derived affected objects", async () => {
  const { sessionFile, s } = await session("token");
  const r = await applySession(
    sessionFile,
    patch(s.revision, [
      { op: "setToken", name: "--brand", value: "#abcdef" },
      { op: "setPageSize", pageId: "p2", width: 700, height: 900 },
    ]),
  );
  assert.ok(r.affected.some((n) => n.elementId === "title"));
  assert.ok(r.affected.some((n) => n.elementId === "second"));
  const source = await readFile(s.workFile, "utf8");
  assert.ok(source.includes("width: 700px; height: 900px;"));
  assert.ok(!source.includes("visibility: visible"));
  const state = await inspectFile(s.workFile, {
    baseUrl: `${origin}/token.html`,
    pageId: "p2",
  });
  assert.equal(state.pages[0].height, 900);
  await request("cancel", s);
});
test("invalid IDs and bounded inspection are explicit; unsupported payloads never reach rendering", async () => {
  const file = path.join(root, "invalid.html");
  await writeFile(file, html.replace('data-el="other"', 'data-el="title"'));
  const r = await inspectFile(file);
  assert.equal(r.status, "issues");
  assert.equal(
    r.objects.find((n) => n.text === "Original & plain").elementId,
    null,
  );
  assert.throws(
    () =>
      validatePatch(
        patch(revisionOf(html), [
          {
            op: "setStyle",
            pageId: "p1",
            elementId: "other",
            style: { position: "fixed" },
          },
        ]),
      ),
    /supported properties/,
  );
  assert.throws(
    () =>
      validatePatch(
        patch(revisionOf(html), [
          { op: "setPageSize", pageId: "p1", width: 0, height: 100 },
        ]),
      ),
    /dimensions/,
  );
  const many = path.join(root, "many.html");
  await writeFile(
    many,
    html.replace(
      '<p data-el="title">',
      Array.from(
        { length: 105 },
        (_, i) => `<span data-el="n${i}">word</span>`,
      ).join("") + '<p data-el="title">',
    ),
  );
  const bounded = await inspectFile(many);
  assert.equal(bounded.coverage.truncated, true);
  assert.equal(bounded.objects.length, 100);
});

test("sparse changes preserve authored important priority and failed resource rendering never stages", async () => {
  const source = html
    .replace("color: red;", "color: red !important;")
    .replace("--brand: #123456;", "--brand: #123456 !important;");
  const { sessionFile, s } = await session("priority", source);
  const r = await applySession(
    sessionFile,
    patch(s.revision, [
      {
        op: "setStyle",
        pageId: "p1",
        elementId: "other",
        style: { color: "blue" },
      },
      { op: "setToken", name: "--brand", value: "#abcdef" },
    ]),
  );
  const text = await readFile(s.workFile, "utf8");
  assert.match(text, /color: blue !important/);
  assert.match(text, /--brand: #abcdef !important/);
  assert.equal(r.committed, false);
  await request("cancel", s);
  const broken = html.replace(
    "</head>",
    '<link rel="stylesheet" href="missing.css"></head>',
  );
  const bad = await session("resource", broken);
  await assert.rejects(
    applySession(
      bad.sessionFile,
      patch(bad.s.revision, [
        { op: "replaceText", pageId: "p1", elementId: "title", text: "change" },
      ]),
    ),
    /Resource loading/,
  );
  assert.equal(await readFile(bad.s.workFile, "utf8"), broken);
  await request("cancel", bad.s);
});

test("removing the last inline property preserves authored style-attribute selectors", async () => {
  const source = html.replace(
    'style="color: red; width: 300px;"',
    'style="color: red;"',
  );
  const { sessionFile, s } = await session("empty-style", source);
  await applySession(
    sessionFile,
    patch(s.revision, [
      {
        op: "setStyle",
        pageId: "p1",
        elementId: "other",
        style: { color: null },
      },
    ]),
  );
  const changed = await readFile(s.workFile, "utf8");
  assert.ok(changed.includes('data-el="other" style=""'));
  await request("cancel", s);
});
test("review: source patches preserve self-closing SVG siblings and unquoted trailing slash values", async () => {
  const source = html.replace(
    "</section>",
    '<svg width="200" height="100"><rect data-el="rect" width="20" height="20"/><rect data-el="next" x="30" width="20" height="20"/></svg><div data-el=slash/>trailing slash</div></section>',
  );
  const { sessionFile, s } = await session("svg-source", source);
  await applySession(
    sessionFile,
    patch(s.revision, [
      {
        op: "setStyle",
        pageId: "p1",
        elementId: "rect",
        style: { color: "blue" },
      },
      {
        op: "setStyle",
        pageId: "p1",
        elementId: "slash/",
        style: { color: "blue" },
      },
    ]),
  );
  const next = await readFile(s.workFile, "utf8");
  assert.ok(next.includes('height="20" style="color: blue;"/>'));
  assert.ok(next.includes("data-el=slash/ style="));
  const { parse } = await import("parse5");
  const tree = parse(next);
  const find = (n, id) =>
    n.attrs?.some((a) => a.name === "data-el" && a.value === id)
      ? n
      : (n.childNodes || []).map((c) => find(c, id)).find(Boolean);
  assert.equal(find(tree, "rect").parentNode, find(tree, "next").parentNode);
  assert.equal(
    find(tree, "slash/").attrs.find((a) => a.name === "data-el").value,
    "slash/",
  );
  await request("cancel", s);
});
test("review: malformed tokens reject atomically and no-op tokens preserve all source bytes", async () => {
  const { sessionFile, s } = await session("token-validation");
  await assert.rejects(
    applySession(
      sessionFile,
      patch(s.revision, [{ op: "setToken", name: "--brand", value: "var(" }]),
    ),
    /Invalid design-token/,
  );
  assert.equal(await readFile(s.workFile, "utf8"), html);
  const r = await applySession(
    sessionFile,
    patch(s.revision, [{ op: "setToken", name: "--brand", value: "#123456" }]),
  );
  assert.equal(r.status, "no-op");
  assert.equal(await readFile(s.workFile, "utf8"), html);
  await request("cancel", s);
});
test("review: embedded font and image decoding errors remain explicit and refuse every staged mutation", async () => {
  for (const kind of ["font", "image"]) {
    const source =
      kind === "font"
        ? html.replace(
            "</style></head>",
            "@font-face{font-family:Corrupt;src:url(data:font/woff2;base64,AAECAwQ=)}p{font-family:Corrupt,Arial}</style></head>",
          )
        : html.replace(
            "</section>",
            '<img data-el="bad" src="data:image/png;base64,AAAA"></section>',
          );
    const { sessionFile, s } = await session(`decode-${kind}`, source);
    const state = await inspectFile(s.workFile, {
      baseUrl: `${origin}/decode-${kind}.html`,
    });
    assert.equal(state.status, "issues");
    assert.ok(
      kind === "font"
        ? state.resources.fontsFailed > 0
        : state.resources.imagesFailed > 0,
    );
    await assert.rejects(
      applySession(
        sessionFile,
        patch(s.revision, [
          {
            op: "replaceText",
            pageId: "p1",
            elementId: "title",
            text: "Must not apply",
          },
        ]),
      ),
      /decoding failed/,
    );
    assert.equal(await readFile(s.workFile, "utf8"), source);
    await request("cancel", s);
  }
});

test("review: a mutation activating a corrupt font face also rejects without staging", async () => {
  const source = html
    .replace("<b>Bold</b> keep", "Plain keep")
    .replace(
      "</style></head>",
      '@font-face{font-family:Variant;src:local("Arial"),local("Liberation Sans");font-weight:400}@font-face{font-family:Variant;src:url(data:font/woff2;base64,AAECAwQ=);font-weight:700}p{font-family:Variant;font-weight:400}</style></head>',
    );
  const { sessionFile, s } = await session("decode-after-style", source);
  const state = await inspectFile(s.workFile, {
    baseUrl: `${origin}/decode-after-style.html`,
  });
  assert.equal(state.resources.fontsFailed, 0);
  await assert.rejects(
    applySession(
      sessionFile,
      patch(s.revision, [
        {
          op: "setStyle",
          pageId: "p1",
          elementId: "title",
          style: { "font-weight": "700" },
        },
      ]),
    ),
    /font decoding failed/,
  );
  assert.equal(await readFile(s.workFile, "utf8"), source);
  await request("cancel", s);
});

test("source integrity: unrepresentable HTML text is rejected before staging", () => {
  for (const text of ["NUL\0", "CR\rLF", "\ud800"])
    assert.throws(
      () =>
        validatePatch(
          patch(revisionOf(html), [
            { op: "replaceText", pageId: "p1", elementId: "title", text },
          ]),
        ),
      /well-formed Unicode/,
    );
});
