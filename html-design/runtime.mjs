import {
  readFile,
  writeFile,
  rename,
  unlink,
  realpath,
  open,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { parse } from "parse5";
import { browserOptions } from "./export.mjs";
import {
  createResourceServer,
  readSavedSnapshot,
  localResourceUrl,
} from "./saved-file.mjs";
export const revisionOf = (value) =>
  createHash("sha256").update(value).digest("hex");
const encode = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const inside = (root, file) =>
  !path.relative(root, file).startsWith("..") &&
  !path.isAbsolute(path.relative(root, file));
const allowed = new Set([
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "width",
  "height",
  "max-width",
  "min-width",
  "max-height",
  "min-height",
  "padding",
  "gap",
  "object-fit",
  "object-position",
  "border-radius",
  "opacity",
]);
const keys = (obj, names) =>
  obj &&
  typeof obj === "object" &&
  !Array.isArray(obj) &&
  Object.keys(obj).every((k) => names.includes(k));
export function validatePatch(request) {
  if (
    !keys(request, ["revision", "operations"]) ||
    !/^[a-f0-9]{64}$/.test(request.revision) ||
    !Array.isArray(request.operations) ||
    request.operations.length < 1 ||
    request.operations.length > 32
  )
    throw new Error("Expected revision and 1–32 operations.");
  const used = new Set();
  for (const op of request.operations) {
    const variants = {
      replaceText: ["op", "pageId", "elementId", "text"],
      setStyle: ["op", "pageId", "elementId", "style"],
      setPageSize: ["op", "pageId", "width", "height"],
      setToken: ["op", "name", "value"],
    };
    if (
      !keys(op, variants[op.op] || []) ||
      !variants[op.op] ||
      variants[op.op].some((k) => !Object.hasOwn(op, k))
    )
      throw new Error("Unknown operation or fields.");
    const id = (v) => typeof v === "string" && v.length > 0 && v.length <= 256;
    if (
      op.op !== "setToken" &&
      (!id(op.pageId) || (op.op !== "setPageSize" && !id(op.elementId)))
    )
      throw new Error("Stable page and element IDs are required.");
    const key =
      op.op === "setToken"
        ? "design"
        : `${op.pageId}/${op.elementId || "@page"}`;
    if (used.has(key)) throw new Error("One operation per target per batch.");
    used.add(key);
    if (
      op.op === "replaceText" &&
      (typeof op.text !== "string" ||
        op.text.length > 20000 ||
        !op.text.isWellFormed() ||
        /[\u0000\r]/.test(op.text))
    )
      throw new Error(
        "Text must be well-formed Unicode, use LF newlines, contain no NUL, and be at most 20000 UTF-16 units.",
      );
    if (
      op.op === "setPageSize" &&
      ![op.width, op.height].every(
        (n) => Number.isInteger(n) && n >= 1 && n <= 4096,
      )
    )
      throw new Error(
        "Page dimensions must be integers from 1 to 4096 CSS px.",
      );
    if (
      op.op === "setStyle" &&
      (!op.style ||
        typeof op.style !== "object" ||
        Array.isArray(op.style) ||
        !Object.keys(op.style).length ||
        Object.keys(op.style).length > 12 ||
        Object.entries(op.style).some(
          ([p, v]) =>
            !allowed.has(p) ||
            (v !== null &&
              (typeof v !== "string" ||
                !v ||
                v.length > 240 ||
                /url\s*\(|[;{}<>]|!important/i.test(v))),
        ))
    )
      throw new Error(
        "Style patches require supported properties and bounded CSS values; null removes an inline declaration.",
      );
    if (
      op.op === "setToken" &&
      (!/^--[a-zA-Z][\w-]{0,63}$/.test(op.name) ||
        typeof op.value !== "string" ||
        !op.value ||
        op.value.length > 240 ||
        /url\s*\(|[;{}<>]|!important/i.test(op.value))
    )
      throw new Error("Invalid design-token name or value.");
  }
}
async function render(snapshot, baseUrl, method, arg) {
  const browser = await chromium.launch(browserOptions());
  let blocked = false;
  const resourceErrors = [];
  let timer;
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
    });
    page.setDefaultTimeout(10000);
    page.on("requestfailed", (r) => {
      if (
        ["stylesheet", "font", "image"].includes(r.resourceType()) &&
        resourceErrors.length < 50
      )
        resourceErrors.push({
          type: r.resourceType(),
          url: r.url().slice(0, 200),
        });
    });
    page.on("response", (r) => {
      if (
        r.status() >= 400 &&
        ["stylesheet", "font", "image"].includes(r.request().resourceType()) &&
        resourceErrors.length < 50
      )
        resourceErrors.push({
          type: r.request().resourceType(),
          status: r.status(),
          url: r.url().slice(0, 200),
        });
    });
    const url = new URL(`/__runtime/${randomUUID()}`, baseUrl).href;
    await page.route("**/*", (r) => {
      if (r.request().isNavigationRequest()) {
        blocked = true;
        return r.abort();
      }
      return r.continue();
    });
    const tag = `<base href="${encode(baseUrl)}">`,
      html = snapshot.toString("utf8");
    await page.route(url, (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: /<head\b[^>]*>/i.test(html)
          ? html.replace(/<head\b[^>]*>/i, (m) => m + tag)
          : tag + html,
        headers: {
          "Content-Security-Policy":
            "script-src 'none'; object-src 'none'; frame-src 'none'",
        },
      }),
    );
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    if (blocked || page.url() !== url)
      throw new Error("Document navigation is unsupported.");
    await page.evaluate(
      await readFile(new URL("./runtime-browser.js", import.meta.url), "utf8"),
    );
    const result = await Promise.race([
      page.evaluate(
        async ({ method, arg }) =>
          await globalThis.__domSlidesRuntime[method](arg),
        { method, arg },
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Runtime scan exceeded 30 seconds.")),
          30000,
        );
      }),
    ]);
    if (blocked || page.url() !== url)
      throw new Error("Document navigation is unsupported.");
    if (method === "patch" && resourceErrors.length)
      throw new Error("Resource loading failed; work copy is unchanged.");
    return {
      ...result,
      resourceErrors,
      ...(resourceErrors.length && method === "inspect"
        ? { status: "issues" }
        : {}),
    };
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
export async function inspectFile(
  file,
  { baseUrl, pageId, elementId, details = false } = {},
) {
  if (baseUrl) baseUrl = localResourceUrl(baseUrl);
  const s = await readSavedSnapshot(file, { baseUrl });
  if (!Buffer.from(s.snapshot.toString("utf8")).equals(s.snapshot))
    throw new Error("Runtime requires UTF-8 HTML.");
  let server;
  try {
    if (!baseUrl) {
      server = await createResourceServer(s.resourceRoot);
      baseUrl = `${server.origin}/${encodeURIComponent(path.basename(s.inputPath))}`;
    }
    return {
      ...(await render(s.snapshot, baseUrl, "inspect", {
        pageId,
        elementId,
        details,
      })),
      source: { kind: "saved-file", path: s.inputPath, revision: s.revision },
    };
  } finally {
    await server?.close();
  }
}
function sourceChanges(html, operations, results) {
  const tree = parse(html, { sourceCodeLocationInfo: true }),
    all = [];
  function walk(n) {
    all.push(n);
    for (const c of n.childNodes || []) walk(c);
  }
  walk(tree);
  const attr = (n, key) => n.attrs?.find((a) => a.name === key)?.value;
  const edits = [];
  function addStyle(n, text) {
    const l = n.sourceCodeLocation;
    if (!l?.startTag)
      throw new Error("Target has no reliable source location.");
    const a = l.attrs?.style;
    if (a)
      edits.push({
        start: a.startOffset,
        end: a.endOffset,
        text: text === null ? "" : `style="${encode(text)}"`,
      });
    else if (text) {
      // Insert after the last actual attribute: keep SVG '/>' and unquoted
      // attribute values ending with '/' intact without guessing tokenizer state.
      const position = Math.max(
        l.startTag.startOffset + 1 + n.tagName.length,
        ...Object.values(l.attrs || {}).map((a) => a.endOffset),
      );
      edits.push({
        start: position,
        end: position,
        text: ` style="${encode(text)}"`,
      });
    }
  }
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i],
      result = results[i];
    if (result.status === "no-op") continue;
    const matches =
      op.op === "setToken"
        ? all.filter(
            (n) =>
              n.tagName === "style" &&
              n.attrs?.some((a) => a.name === "data-design"),
          )
        : all.filter(
            (n) =>
              attr(n, op.op === "setPageSize" ? "data-artboard" : "data-el") ===
              (op.op === "setPageSize" ? op.pageId : op.elementId),
          );
    if (matches.length !== 1) throw new Error("Source target is not unique.");
    const n = matches[0],
      l = n.sourceCodeLocation;
    if (op.op === "replaceText" || op.op === "setToken") {
      if (!l?.startTag || !l.endTag)
        throw new Error("Text target needs explicit closing tags.");
      if (
        op.op === "replaceText" &&
        n.childNodes.some((c) => c.nodeName !== "#text")
      )
        throw new Error("Rich text is unsupported.");
      edits.push({
        start: l.startTag.endOffset,
        end: l.endTag.startOffset,
        text: op.op === "setToken" ? result.designText : encode(op.text),
      });
    } else addStyle(n, result.style);
  }
  edits.sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++)
    if (edits[i].start < edits[i - 1].end)
      throw new Error("Overlapping source patches are unsupported.");
  for (const edit of edits.reverse())
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  const structure = (node) => [
    node.nodeName,
    node.namespaceURI || null,
    (node.attrs || [])
      .filter((a) => a.name !== "style")
      .map((a) => [a.name, a.value]),
    (node.childNodes || []).filter((n) => n.tagName).map(structure),
  ];
  if (
    JSON.stringify(structure(tree)) !== JSON.stringify(structure(parse(html)))
  )
    throw new Error("Source patch changed the document structure.");
  return html;
}
export async function applySession(sessionFile, request) {
  validatePatch(request);
  const sessionPath = await realpath(sessionFile),
    session = JSON.parse(await readFile(sessionPath, "utf8"));
  const directory = path.dirname(sessionPath),
    work = await realpath(session.workFile);
  if (
    path.basename(sessionPath) !== "session.json" ||
    path.basename(directory) !== session.token ||
    work !== path.join(directory, "document.html") ||
    !inside(path.resolve(directory, "../../"), work)
  )
    throw new Error("Expected a collaboration work session.");
  const origin = new URL(localResourceUrl(session.origin)).origin;
  const status = async () => {
    const response = await fetch(`${origin}/__html-design/document/ai/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: session.path, token: session.token }),
      signal: AbortSignal.timeout(15000),
    });
    const r = await response.json();
    if (!response.ok || !r.ready || r.revision !== session.revision)
      throw new Error("AI lease is unavailable or its baseline changed.");
  };
  const lockPath = path.join(directory, ".runtime-lock");
  const lock = await open(lockPath, "wx");
  let tmp;
  try {
    await status();
    const s = await readSavedSnapshot(work, {
      baseUrl: new URL(session.path, origin).href,
    });
    if (!Buffer.from(s.snapshot.toString("utf8")).equals(s.snapshot))
      throw new Error("Runtime requires UTF-8 HTML.");
    if (s.revision !== request.revision)
      throw new Error("Work-copy revision conflict.");
    const result = await render(
      s.snapshot,
      new URL(session.path, origin).href,
      "patch",
      request.operations,
    );
    const next = sourceChanges(
        s.snapshot.toString("utf8"),
        request.operations,
        result.changes,
      ),
      revision = revisionOf(next);
    await status();
    if (revisionOf(await readFile(work)) !== s.revision)
      throw new Error("Work copy changed during measurement.");
    if (revision !== s.revision) {
      tmp = path.join(directory, `.runtime-${randomUUID()}.html`);
      await writeFile(tmp, next, { flag: "wx", mode: 0o600 });
      await rename(tmp, work);
    }
    return {
      schemaVersion: 1,
      status: revision === s.revision ? "no-op" : "applied",
      committed: false,
      source: {
        kind: "ai-work-copy",
        path: work,
        revision,
        previousRevision: s.revision,
        documentRevision: session.revision,
      },
      changes: result.changes.map(({ text, style, designText, ...r }) => r),
      affected: result.affected,
      affectedTruncated: result.affectedTruncated,
      impactCoverage: result.impactCoverage,
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
    if (tmp) await unlink(tmp).catch(() => {});
  }
}
