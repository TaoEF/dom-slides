import { elementGeometry } from "./geometry.js";
import { artboardSize, setArtboardSize } from "./artboard-size.js";
const properties = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-family",
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
  "display",
  "position",
  "rotate",
  "object-fit",
  "object-position",
  "border-radius",
  "opacity",
];
const round = (x) => Math.round(x * 1000) / 1000;
const safe = (x) => typeof x === "string" && x.length > 0 && x.length <= 256;
const value = (x) => String(x).slice(0, 240);
function targets() {
  const boards = [...document.querySelectorAll("[data-artboard]")],
    nodes = [...document.querySelectorAll("[data-artboard] [data-el]")];
  if (
    nodes.length > 2000 ||
    document.querySelectorAll("[data-artboard] img").length > 500
  )
    throw new Error("Runtime scope exceeds 2000 objects or 500 images.");
  const unique = (a, key, id) =>
    safe(id) && a.filter((n) => n.getAttribute(key) === id).length === 1;
  return {
    boards,
    nodes,
    validPage: (b) => unique(boards, "data-artboard", b.dataset.artboard),
    validElement: (n) => unique(nodes, "data-el", n.dataset.el),
  };
}
async function prepare() {
  for (const a of [...document.documentElement.attributes])
    if (/^data-edit/.test(a.name))
      document.documentElement.removeAttribute(a.name);
  document
    .querySelectorAll(
      "html-design-editor,[data-editor-style],[data-editor-connection]",
    )
    .forEach((n) => n.remove());
  const style = document.createElement("style");
  style.setAttribute("data-runtime-probe", "");
  style.textContent =
    "[data-stage]{transform:none!important;translate:none!important;zoom:1!important;position:static!important;display:block!important;margin:0!important;padding:0!important;width:max-content!important;height:auto!important}[data-artboard]{visibility:visible!important;margin:0!important}*,*::before,*::after{animation:none!important;transition:none!important}";
  document.head.append(style);
  const t = targets();
  t.originalStyles = new Map(t.boards.map((b) => [b, b.getAttribute("style")]));
  if (!t.boards.length || t.boards.length > 100)
    throw new Error("Expected 1–100 artboards.");
  for (const b of t.boards)
    if (getComputedStyle(b).display === "none")
      b.style.setProperty("display", "block", "important");
  let timeout;
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Font loading timed out.")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  for (const img of document.querySelectorAll("[data-artboard] img")) {
    img.loading = "eager";
    let timer;
    try {
      await Promise.race([
        img.decode(),
        new Promise((_, r) => {
          timer = setTimeout(
            () => r(new Error("Image loading timed out.")),
            5000,
          );
        }),
      ]);
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  return t;
}
function ruleFacts(node, property) {
  const matches = [],
    unreadable = [];
  let source = "[inline stylesheet]";
  const walk = (rules) => {
    for (const rule of rules) {
      if (matches.length >= 8) break;
      if (rule.selectorText && rule.style?.getPropertyValue(property)) {
        try {
          if (node.matches(rule.selectorText))
            matches.push({
              source,
              selector: value(rule.selectorText),
              value: value(rule.style.getPropertyValue(property)),
              important:
                rule.style.getPropertyPriority(property) === "important",
            });
        } catch {}
      } else if (rule.cssRules) {
        if (
          rule.conditionText &&
          rule.constructor.name === "CSSMediaRule" &&
          !matchMedia(rule.conditionText).matches
        )
          continue;
        walk(rule.cssRules);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode?.matches("[data-runtime-probe]")) continue;
    try {
      source = value(
        sheet.href ||
          (sheet.ownerNode?.hasAttribute("data-design")
            ? "[data-design]"
            : "[inline stylesheet]"),
      );
      walk(sheet.cssRules);
    } catch {
      unreadable.push(value(sheet.href || "[stylesheet]"));
    }
  }
  return {
    matchedDeclarations: matches,
    unreadableStylesheets: unreadable.slice(0, 4),
    resolution: "evidence-only",
  };
}
function object(n, b, t, details) {
  const r = n.getBoundingClientRect(),
    br = b.getBoundingClientRect(),
    g = elementGeometry(n),
    cs = getComputedStyle(n);
  let visible = n.getClientRects().length > 0 && cs.visibility === "visible";
  for (let a = n; a; a = a.parentElement) {
    const style = getComputedStyle(a);
    if (
      style.opacity === "0" ||
      style.display === "none" ||
      style.contentVisibility === "hidden"
    )
      visible = false;
  }
  const styles = {};
  for (const p of properties) {
    styles[p] = {
      computed: value(cs.getPropertyValue(p)),
      inline: n.style.getPropertyValue(p) || null,
      important: n.style.getPropertyPriority(p) === "important",
      ...(details ? ruleFacts(n, p) : {}),
    };
  }
  const image = n.matches("img")
    ? n
    : n.matches("[data-crop-frame]")
      ? n.querySelector("img")
      : null;
  const id = t.validElement(n) ? n.dataset.el : null;
  return {
    elementId: id,
    pageId: t.validPage(b) ? b.dataset.artboard : null,
    tag: n.tagName.toLowerCase(),
    text: (n.textContent || "").slice(0, 1000),
    textTruncated: (n.textContent || "").length > 1000,
    visible,
    geometry: {
      box: "border-box",
      x: round(r.left - br.left),
      y: round(r.top - br.top),
      width: round(r.width),
      height: round(r.height),
      localWidth: round(g.w) || null,
      localHeight: round(g.h) || null,
      angle: g.supported ? round(g.angle) : null,
      supported: g.supported,
    },
    styles,
    identity: id ? "stable" : "invalid",
    capabilities: {
      replaceText:
        !!id &&
        n.childNodes.length ===
          [...n.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE)
            .length &&
        !n.matches("[data-group],[data-crop-frame],[data-crop-image]") &&
        /^(P|H[1-6]|SPAN|DIV|LABEL|BUTTON|SMALL|STRONG|EM|LI)$/.test(n.tagName),
      stylePatch:
        !!id && !n.matches("[data-group],[data-crop-frame],[data-crop-image]"),
    },
    ...(image
      ? {
          image: {
            source: /^(data|blob):/.test(image.currentSrc || image.src)
              ? "[embedded]"
              : value(image.currentSrc || image.src),
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            decoded: image.complete && image.naturalWidth > 0,
          },
        }
      : {}),
  };
}
function fingerprint(n) {
  const r = n.getBoundingClientRect(),
    cs = getComputedStyle(n);
  return JSON.stringify([
    n.textContent,
    r.x,
    r.y,
    r.width,
    r.height,
    ...properties.map((p) => cs.getPropertyValue(p)),
  ]);
}
async function inspect({ pageId, elementId, details = false } = {}) {
  const t = await prepare(),
    objects = [],
    pages = [];
  let seen = 0;
  for (const b of t.boards) {
    if (pageId && b.dataset.artboard !== pageId) continue;
    pages.push({
      pageId: t.validPage(b) ? b.dataset.artboard : null,
      title: value(b.dataset.title || ""),
      ...artboardSize(b),
    });
    for (const n of b.querySelectorAll("[data-el]")) {
      if (elementId && n.dataset.el !== elementId) continue;
      seen++;
      if (objects.length < 100) objects.push(object(n, b, t, details));
    }
  }
  if (pageId && !t.boards.some((b) => b.dataset.artboard === pageId))
    throw new Error("Page target does not exist.");
  if (elementId && !objects.length)
    throw new Error("Element target does not exist in this scope.");
  let truncated = seen > objects.length;
  while (JSON.stringify({ pages, objects }).length > 350000 && objects.length) {
    objects.pop();
    truncated = true;
  }
  const images = [...document.querySelectorAll("[data-artboard] img")];
  const designSheets = [...document.querySelectorAll("style[data-design]")];
  let design = {
    editable: false,
    tokens: [],
    reason: "Expected one inline style[data-design] with one :root rule.",
  };
  if (designSheets.length === 1) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(designSheets[0].textContent);
    const rule = sheet.cssRules[0];
    if (sheet.cssRules.length === 1 && rule.selectorText === ":root") {
      const names = [...rule.style].filter((n) => n.startsWith("--"));
      design = {
        editable: true,
        tokens: names.slice(0, 64).map((name) => ({
          name: value(name),
          declared: value(rule.style.getPropertyValue(name)),
          computed: value(
            getComputedStyle(document.documentElement).getPropertyValue(name),
          ),
          important: rule.style.getPropertyPriority(name) === "important",
        })),
        truncated: names.length > 64,
      };
    }
  }
  return {
    schemaVersion: 1,
    status:
      images.some((n) => !n.naturalWidth) ||
      truncated ||
      objects.some((n) => n.identity === "invalid") ||
      pages.some((n) => !n.pageId)
        ? "issues"
        : "ok",
    units: "css-px",
    coordinateSpace: "artboard",
    environment: {
      viewport: { width: innerWidth, height: innerHeight },
      scripts: "disabled",
      fonts: document.fonts.status,
    },
    design,
    pages,
    objects,
    coverage: { seen, returned: objects.length, truncated },
    resources: {
      imagesSeen: images.length,
      imagesFailed: images.filter((n) => !n.naturalWidth).length,
    },
  };
}
async function patch(operations) {
  const t = await prepare(),
    changes = [],
    before = new Map(t.nodes.slice(0, 500).map((n) => [n, fingerprint(n)]));
  for (const op of operations) {
    if (op.op === "setToken") {
      const sheets = [...document.querySelectorAll("style[data-design]")];
      if (sheets.length !== 1)
        throw new Error("Expected one inline style[data-design].");
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(sheets[0].textContent);
      if (
        sheet.cssRules.length !== 1 ||
        sheet.cssRules[0].selectorText !== ":root"
      )
        throw new Error("Token editing requires a single :root design rule.");
      const rule = sheet.cssRules[0],
        old = rule.style.getPropertyValue(op.name);
      if (old === op.value) {
        changes.push({ op: op.op, status: "no-op" });
        continue;
      }
      rule.style.setProperty(
        op.name,
        op.value,
        rule.style.getPropertyPriority(op.name),
      );
      const text = sheet.cssRules[0].cssText;
      sheets[0].textContent = text;
      changes.push({ op: op.op, status: "applied", designText: text });
      continue;
    }
    const b = t.boards.find((n) => n.dataset.artboard === op.pageId);
    if (!b || !t.validPage(b)) throw new Error("Page target must be unique.");
    const n =
      op.op === "setPageSize"
        ? b
        : t.nodes.find(
            (n) =>
              n.dataset.el === op.elementId &&
              n.closest("[data-artboard]") === b,
          );
    if (!n || (n !== b && !t.validElement(n)))
      throw new Error("Element target must be unique.");
    if (op.op === "replaceText") {
      if (!object(n, b, t, false).capabilities.replaceText)
        throw new Error(
          "Text replacement requires a plain-text element; rich/nested markup is preserved.",
        );
      const same = n.textContent === op.text;
      n.textContent = op.text;
      changes.push({
        op: op.op,
        status: same ? "no-op" : "applied",
        pageId: op.pageId,
        elementId: op.elementId,
        text: op.text,
      });
    } else if (op.op === "setStyle") {
      if (!object(n, b, t, false).capabilities.stylePatch)
        throw new Error("This object does not support inline style patches.");
      const original = n.getAttribute("style"),
        originalDeclarations = n.style.cssText;
      for (const [p, v] of Object.entries(op.style)) {
        if (v === null) n.style.removeProperty(p);
        else {
          if (!CSS.supports(p, v)) throw new Error("Unsupported CSS value.");
          n.style.setProperty(p, v, n.style.getPropertyPriority(p));
        }
      }
      changes.push({
        op: op.op,
        status: originalDeclarations === n.style.cssText ? "no-op" : "applied",
        pageId: op.pageId,
        elementId: op.elementId,
        style: n.getAttribute("style"),
      });
    } else if (op.op === "setPageSize") {
      if (b.offsetWidth === op.width && b.offsetHeight === op.height) {
        changes.push({ op: op.op, status: "no-op", pageId: op.pageId });
        continue;
      }
      let change;
      try {
        change = setArtboardSize(b, op.width, op.height);
      } catch {
        throw new Error(
          "Requested page size conflicts with CSS constraints; the work copy is unchanged.",
        );
      }
      const authored = document.createElement("div");
      authored.setAttribute("style", t.originalStyles.get(b) || "");
      for (const key of ["width", "height"])
        authored.style.setProperty(
          key,
          b.style.getPropertyValue(key),
          b.style.getPropertyPriority(key),
        );
      change.after = authored.getAttribute("style");
      changes.push({
        op: op.op,
        status: change.before === change.after ? "no-op" : "applied",
        pageId: op.pageId,
        style: change.after,
      });
    }
  }
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i],
      op = operations[i];
    if (op.op === "setToken")
      change.effective = {
        name: op.name,
        computed: value(
          getComputedStyle(document.documentElement).getPropertyValue(op.name),
        ),
      };
    else {
      const board = t.boards.find((b) => b.dataset.artboard === op.pageId);
      const node =
        op.op === "setPageSize"
          ? board
          : t.nodes.find(
              (n) =>
                n.dataset.el === op.elementId &&
                n.closest("[data-artboard]") === board,
            );
      if (op.op === "setStyle")
        change.effective = Object.fromEntries(
          Object.keys(op.style).map((key) => [
            key,
            value(getComputedStyle(node).getPropertyValue(key)),
          ]),
        );
      if (op.op === "setPageSize")
        change.effective = {
          width: node.offsetWidth,
          height: node.offsetHeight,
          box: "border-box",
        };
      if (op.op === "replaceText")
        change.effective = { textLength: node.textContent.length };
    }
  }
  const affected = [];
  for (const [n, key] of before)
    if (key !== fingerprint(n))
      affected.push({
        pageId: t.validPage(n.closest("[data-artboard]"))
          ? n.closest("[data-artboard]").dataset.artboard
          : null,
        elementId: t.validElement(n) ? n.dataset.el : null,
      });
  for (const change of changes)
    if (
      change.status === "applied" &&
      change.pageId &&
      !affected.some(
        (n) =>
          n.pageId === change.pageId &&
          n.elementId === (change.elementId || null),
      )
    )
      affected.push({
        pageId: change.pageId,
        elementId: change.elementId || null,
      });
  return {
    changes,
    affected,
    affectedTruncated: t.nodes.length > 500,
    impactCoverage: "bounded-observation",
  };
}
globalThis.__domSlidesRuntime = { inspect, patch };
