import { toolbarHTML } from "./ui.js";
import { createExporter } from "./export.js";
import { createPersistence } from "./persistence.js";
import { createReview } from './review.js';
import { createViewport } from "./viewport.js";
import { createPages } from "./pages.js";
import { textMetrics, scaleText } from "./typography.js";
import { createTextLayout } from "./text-layout.js";
import { icon } from "./icons.js";
import { makeShape, renderShape, shapeHasFill, shapeHasAdjust } from './shapes.js';
import { rekeyDOMIds } from "./identifiers.js";
import { createGuides } from "./guides.js";
import { layerChanges } from "./layers.js";
import {
  selectionRoots,
  unionRect,
  selectable,
  directionTarget,
  createSelectionOverlay,
} from "./selection.js";
(() => {
  if (window.__htmlDesignEditor) return;
  window.__htmlDesignEditor = true;

  const MEDIA = "img,video,canvas,svg,iframe,picture";
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const SKIP_ATTR = /^(contenteditable|data-editor-current)$/; // 编辑器临时属性：不进撤销、不触发缩略图刷新

  function main() {
    const root = document.documentElement;
    const stage = document.querySelector("[data-stage]") || document.body;
    const boards = () => [...stage.querySelectorAll("[data-artboard]")];
    const S = {
      editing: false,
      playing: false,
      current: null,
      reviewContext: 0,
      sel: null,
      selection: [],
      drag: null,
      text: null,
      range: null,
      undo: [],
      redo: [],
      changed: false,
      zoom: 1,
      fit: true,
      replace: null,
    };

    let persistence = null, reviewUI = null, reviewRestorePage = null;
    let canRequestEdit = false,
      editRequested = false,
      requestingEdit = false;

    /* ---------- 页面级样式（保存时删除） ---------- */
    const mkStyle = (v, css = "") => {
      const s = document.createElement("style");
      s.setAttribute("data-editor-style", v);
      s.textContent = css;
      return s;
    };
    const pageStyle = mkStyle(
      "",
      `
      @media screen{
        html[data-editor-on],html[data-editor-on] body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;overflow:hidden!important;background:#f2f2f2!important}
        html[data-editor-playing],html[data-editor-playing] body{background:#151515!important}
        html[data-editor-on] body > :not([data-stage]):not(script):not(style){display:none!important}
        html[data-editor-single] [data-artboard]:not([data-editor-current]){display:none!important}
        html[data-editor-panning] [data-stage],html[data-editor-panning] [data-stage] *{cursor:grab!important}
      }
      @media print{html[data-editor-on],html[data-editor-on] body{padding:0!important;overflow:visible!important}[data-artboard]{break-after:page;break-inside:avoid}}
      html[data-editing] [data-artboard],html[data-editing] [data-artboard] *{user-select:none;-webkit-user-select:none}
      html[data-editing] [data-artboard] *{animation-play-state:paused!important}
      html[data-editing] [data-artboard] [data-el]{cursor:move}
      html[data-editing] [data-artboard] [contenteditable],html[data-editing] [data-artboard] [contenteditable] *{cursor:text;user-select:text;-webkit-user-select:text}
      html[data-editing] [data-artboard] [contenteditable]{outline:none}`,
    );
    const zoomStyle = mkStyle("zoom"),
      printStyle = mkStyle("print");
    document.head.append(pageStyle, zoomStyle, printStyle);
    root.setAttribute("data-editor-on", "");
    root.setAttribute("data-editor-nav", "");

    /* ---------- 编辑器 UI：挂在 <html> 上 + Shadow DOM，内容 CSS 影响不到 ---------- */
    const host = document.createElement("html-design-editor");
    host.setAttribute("data-editor-ui", "");
    host.style.cssText = "all:initial!important;position:static!important";
    root.append(host);
    new MutationObserver(() => {
      if (!host.isConnected) root.append(host);
    }).observe(root, { childList: true });

    const ui = host.attachShadow({ mode: "open" });
    ui.innerHTML = toolbarHTML({ HANDLES });
    const $ = (s) => ui.querySelector(s);
    const side = $(".nav"),
      head = $(".head"),
      selBox = $(".sel"),
      tbar = $(".tbar");
    const modal = $(".modal"),
      ta = $("textarea"),
      fileIn = $(".file"),
      toastEl = $(".toast");
    const fileName = () =>
      decodeURIComponent(location.pathname.split("/").pop() || "") ||
      "design.html";
    $(".title").textContent = document.title || fileName();
    const guides = createGuides({ ui, origin });
    const selectionOverlay = createSelectionOverlay(ui);
    const textLayout = createTextLayout({ ui });
    let layoutRequest = 0, layoutTimer;

    /* ---------- 工具函数 ---------- */
    let focusedBeforeModal = null;
    const fromUI = (e) => e.composedPath().includes(host);
    const inStage = (n) =>
      n instanceof Element && !!n.closest("[data-artboard]");
    const visible = (n) => n.getClientRects().length > 0;
    const scaleOf = (b) => b.getBoundingClientRect().width / b.offsetWidth || 1; // 已包含缩放
    const isArtboard = (b) => b?.dataset.mode === "artboard";
    const activeBoard = () =>
      S.sel?.closest("[data-artboard]") || S.current || boards()[0];
    const esc = (s) =>
      String(s).replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
      );
    const px = (v) => (/px$/.test(v || "") ? parseFloat(v) : 0);
    function origin(b) {
      // 画板 padding-box 左上角（绝对定位参照点）
      const s = scaleOf(b),
        r = b.getBoundingClientRect(),
        cs = getComputedStyle(b);
      return {
        s,
        x: r.left + parseFloat(cs.borderLeftWidth) * s,
        y: r.top + parseFloat(cs.borderTopWidth) * s,
      };
    }
    // 临时显示全部页面（同步执行，不会闪）：测量隐藏页时用
    function withAll(fn) {
      const on = root.hasAttribute("data-editor-single");
      if (on) root.removeAttribute("data-editor-single");
      try {
        return fn();
      } finally {
        if (on) root.setAttribute("data-editor-single", "");
      }
    }
    let toastT = 0;
    function toast(msg, duration = 1800) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(toastT);
      toastT = setTimeout(() => toastEl.classList.remove("show"), duration);
    }
    const readFile = (f, cb) => {
      const r = new FileReader();
      r.onload = () => cb(r.result);
      r.readAsDataURL(f);
    };

    /* ---------- 撤销 / 重做 ---------- */
    const snap = (els, html) =>
      els.map((el) => ({
        el,
        a: [...el.attributes]
          .filter((x) => !SKIP_ATTR.test(x.name))
          .map((x) => [x.name, x.value]),
        h: html ? el.innerHTML : null,
      }));
    const key = (list) => JSON.stringify(list.map((x) => [x.a, x.h]));
    function apply(list) {
      list.forEach(({ el, a, h }) => {
        if (h != null) el.innerHTML = h;
        [...el.attributes].forEach(
          (x) => SKIP_ATTR.test(x.name) || el.removeAttribute(x.name),
        );
        a.forEach(([n, v]) => el.setAttribute(n, v));
      });
    }
    function push(cmd) {
      S.undo.push(cmd);
      if (S.undo.length > 200) S.undo.shift();
      S.redo = [];
      S.changed = true;
      persistence?.markDirty();
      syncBar();
    }
    function commit(before, board) {
      const after = snap(
        before.map((x) => x.el),
        before[0]?.h != null,
      );
      if (key(before) !== key(after))
        push({ undo: () => apply(before), redo: () => apply(after), board });
    }
    function record(els, fn, board) {
      const b = snap(els);
      fn();
      commit(b, board);
    }
    function history(dir) {
      endText();
      const from = dir < 0 ? S.undo : S.redo,
        to = dir < 0 ? S.redo : S.undo,
        c = from.pop();
      if (!c) return;
      if (c.board?.isConnected && c.board !== S.current) goTo(c.board); // 先跳到改动所在的页
      dir < 0 ? c.undo() : c.redo();
      to.push(c);
      S.changed = true;
      persistence?.markDirty();
      S.selection = selectionRoots(S.selection);
      S.sel = S.selection.at(-1) || null;
      drawSel();
      syncBar();
    }
    function insertEl(el, b, ref) {
      ref ? ref.after(el) : b.append(el);
      const p = el.parentNode,
        n = el.nextSibling;
      push({
        undo: () => el.remove(),
        redo: () => p.insertBefore(el, n?.parentNode === p ? n : null),
        board: b,
      });
    }
    function removeEl(el) {
      const nodes = S.selection.includes(el)
        ? selectionRoots(S.selection)
        : [el];
      const b = el.closest("[data-artboard]");
      const places = [...nodes]
        .sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1))
        .map((node) => ({
          node,
          parent: node.parentNode,
          next: node.nextSibling,
        }));
      select(null);
      nodes.forEach((node) => node.remove());
      push({
        undo: () =>
          [...places]
            .reverse()
            .forEach(({ node, parent, next }) =>
              parent.insertBefore(
                node,
                next?.parentNode === parent ? next : null,
              ),
            ),
        redo: () => nodes.forEach((node) => node.remove()),
        board: b,
      });
    }

    const viewport = createViewport({
      S,
      root,
      stage,
      host,
      ui,
      style: zoomStyle,
      draw: drawSel,
      pageStep,
      finishEditing(resume) {
        endText();
        select(null);
        if (resume !== "pan") setEditing(false);
      },
      currentPage(b) {
        setCurrent(b);
        markActive();
        syncBar();
      },
      flush: () => persistence?.flush() || Promise.resolve(),
      save: () => save(),
      toast,
    });
    const applyZoom = (z, at = null) => viewport.zoom(z, at);
    const zoomStep = (dir) => viewport.step(dir);
    const zoomFit = () => viewport.fit();

    /* ---------- 编辑开关 & 模式 ---------- */
    function finishEditRequest() {
      if (!editRequested || !persistence?.canEdit() || S.playing) return;
      editRequested = false;
      endText();
      select(null);
      ui.activeElement?.blur();
      setEditing(true);
    }
    async function requestEditPermission() {
      if (!editRequested || requestingEdit || !canRequestEdit) return;
      requestingEdit = true;
      syncBar();
      try {
        if ((await persistence.takeover()) === false) editRequested = false;
      } finally {
        requestingEdit = false;
        finishEditRequest();
        syncBar();
      }
    }
    function setEditing(on) {
      if (on && persistence && !persistence.canEdit()) return;
      S.editing = on;
      root.toggleAttribute("data-editing", on);
      host.toggleAttribute("data-editing", on);
      if (!on) {
        endText();
        select(null);
      }
      syncBar();
    }
    function syncBar() {
      const b = activeBoard(),
        permitted = !!persistence?.canEdit() && !S.playing,
        writable = permitted && S.editing,
        manageable = !!persistence?.canManagePages() && !S.playing;
      head.classList.toggle("on", S.editing);
      $(".tools").hidden = !S.editing;
      $("[data-act=edit]").hidden = S.editing;
      const editButton = $("[data-act=edit]");
      editButton.disabled =
        S.playing || editRequested || !(permitted || canRequestEdit);
      editButton.setAttribute("aria-busy", editRequested);
      editButton.querySelector("span").textContent = editRequested
        ? "正在进入…"
        : "编辑";
      $("[data-act=done]").hidden = !S.editing;
      ta.readOnly = !writable;
      $("[data-act=flow]").setAttribute("aria-pressed", !isArtboard(b));
      $("[data-act=artboard]").setAttribute("aria-pressed", isArtboard(b));
      $("[data-act=undo]").disabled = !writable || !S.undo.length;
      $("[data-act=redo]").disabled = !writable || !S.redo.length;
      [
        "flow",
        "artboard",
        "add-text",
        "add-image",
        "add-shape",
        "shape-insert",
        "src-apply",
        "image-replace",
        "image-fit",
        "image-cover",
      ].forEach((act) =>
        ui.querySelectorAll(`[data-act=${act}]`).forEach((n) => {
          n.disabled = !writable || !b;
        }),
      );
      ui.querySelectorAll("[data-act=page-add]").forEach((n) => {
        n.disabled = !manageable;
      });
      ["page-copy", "page-delete", "page-rename"].forEach(act => ui.querySelectorAll(`[data-act=${act}]`).forEach(n => { n.disabled = !manageable || !b; }));
      ["page-up", "page-down"].forEach((act, i) => {
        $(`[data-act=${act}]`).disabled =
          !manageable ||
          !b ||
          (i === 0
            ? boards().indexOf(b) <= 0
            : boards().indexOf(b) >= boards().length - 1);
      });
      ["preview", "scroll-play", "fullscreen", "pdf", "pptx", "print"].forEach(
        (act) =>
          ui.querySelectorAll(`[data-act=${act}]`).forEach((n) => {
            n.disabled = !boards().length;
          }),
      );
      $(".empty-canvas").hidden = !!boards().length;
    }
    function setMode(b, mode) {
      if (!b || (mode === "artboard") === isArtboard(b)) return;
      endText();
      mode === "artboard" ? absolutize(b) : restoreFlow(b);
      drawSel();
      syncBar();
    }
    // 画板模式：只把顶层 data-el 转成绝对定位；嵌套元素保持内部排版
    function absolutize(b) {
      if (!visible(b)) return alert("这一页当前不可见，请先切换到这一页。");
      const cs = getComputedStyle(b),
        bw = cs.width,
        bh = cs.height,
        pos = cs.position,
        o = origin(b);
      const tops = [...b.querySelectorAll("[data-el]")].filter(
        (el) =>
          el.parentElement.closest("[data-el],[data-artboard]") === b &&
          visible(el),
      );
      const m = tops.map((el) => {
        const style = getComputedStyle(el);
        const dimension = (axis, sides) =>
          (parseFloat(style[axis]) ||
            (axis === "width" ? el.offsetWidth : el.offsetHeight)) +
          (style.boxSizing === "border-box"
            ? 0
            : sides.reduce(
                (sum, side) =>
                  sum +
                  parseFloat(style[`padding${side}`]) +
                  parseFloat(style[`border${side}Width`]),
                0,
              ));
        return {
          el,
          r: el.getBoundingClientRect(),
          media: el.matches(MEDIA),
          w: dimension("width", ["Left", "Right"]),
          h: dimension("height", ["Top", "Bottom"]),
        };
      }); // 先量后写，保留元素自身的 transform
      const els = [b, ...tops];
      record(
        els,
        () => {
          els.forEach((el) => {
            el.dataset.flowStyle = el.getAttribute("style") || "";
          });
          if (pos === "static") b.style.position = "relative";
          b.style.width = bw;
          b.style.height = bh;
          const v = (n) => Math.round(n * 1000) / 1000 + "px";
          m.forEach(({ el, w, h, media }) => {
            Object.assign(el.style, {
              position: "absolute",
              margin: "0",
              translate: "none",
              boxSizing: "border-box",
              left: "0px",
              top: "0px",
              width: v(w),
            });
            el.style[media ? "height" : "minHeight"] = v(h);
          });
          // An unmarked positioned wrapper can remain the containing block.
          // Measure after all layout writes, then compensate in document pixels.
          m.forEach(({ el, r }) => {
            const zero = el.getBoundingClientRect();
            el.style.left = v((r.left - zero.left) / o.s);
            el.style.top = v((r.top - zero.top) / o.s);
          });
          b.dataset.mode = "artboard";
        },
        b,
      );
    }
    function restoreFlow(b) {
      if (b.dataset.flowStyle == null)
        return alert("这一页没有自动排版快照，无法切回自动排版。");
      if (
        !confirm(
          "切回自动排版会恢复原有布局，手动模式下的拖动会丢失（可以撤销）。继续吗？",
        )
      )
        return;
      const els = [b, ...b.querySelectorAll("[data-flow-style]")];
      record(
        els,
        () => {
          els.forEach((el) => {
            const v = el.dataset.flowStyle;
            v ? el.setAttribute("style", v) : el.removeAttribute("style");
            delete el.dataset.flowStyle;
          });
          b.dataset.mode = "flow";
        },
        b,
      );
    }

    /* ---------- 位置：画板模式用 left/top，排版模式用 translate ---------- */
    function getPos(el) {
      const abs =
        el.style.position === "absolute" &&
        isArtboard(el.closest("[data-artboard]"));
      if (abs)
        return {
          abs,
          x: parseFloat(el.style.left) || 0,
          y: parseFloat(el.style.top) || 0,
        };
      const t = (el.style.translate || "").split(/\s+/);
      return { abs, x: parseFloat(t[0]) || 0, y: parseFloat(t[1]) || 0 };
    }
    function setPos(el, p, x, y) {
      x = Math.round(x * 1000) / 1000;
      y = Math.round(y * 1000) / 1000;
      if (p.abs) {
        el.style.left = x + "px";
        el.style.top = y + "px";
      } else el.style.translate = x || y ? `${x}px ${y}px` : "";
    }

    /* ---------- 选中 / 拖动 / 改大小 ---------- */
    function select(el, keepDrag = false) {
      const nodes = selectionRoots(Array.isArray(el) ? el : el ? [el] : []);
      if (
        nodes.length !== S.selection.length ||
        nodes.some((n, i) => n !== S.selection[i])
      ) {
        if (!keepDrag && S.drag?.cancel) {
          S.drag.cancel();
          S.drag = null;
        }
        guides.clear();
      }
      S.selection = nodes;
      S.sel = nodes.at(-1) || null;
      drawSel();
      syncBar();
    }
    function drawSel() {
      guides.refresh();
      S.selection = selectionRoots(S.selection).filter((n) => visible(n));
      S.sel = S.selection.at(-1) || null;
      selectionOverlay.draw(S.selection);
      const el = S.sel;
      if (!el || !el.isConnected || !visible(el)) selBox.style.display = "none";
      else {
        const r = unionRect(S.selection);
        Object.assign(selBox.style, {
          display: "block",
          left: r.left + "px",
          top: r.top + "px",
          width: r.width + "px",
          height: r.height + "px",
        });
        selBox.classList.toggle("typing", !!S.text);
        selBox.classList.toggle("multiple", S.selection.length > 1);
      }
      placeTbar();
    }
    addEventListener("scroll", drawSel, true);

    function toggleSelection(el) {
      const next = S.selection.includes(el)
        ? S.selection.filter((n) => n !== el)
        : [
            ...S.selection.filter((n) => !n.contains(el) && !el.contains(n)),
            el,
          ];
      select(next);
    }
    function startMarquee(e) {
      const board = S.current;
      if (!board || e.button !== 0) return;
      const before = [...S.selection],
        additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const x = e.clientX,
        y = e.clientY;
      let moved = false;
      if (!additive) select(null);
      S.drag = {
        move(ev) {
          const v = viewport.bounds(),
            cx = Math.max(v.x, Math.min(v.x + v.w, ev.clientX)),
            cy = Math.max(v.y, Math.min(v.y + v.h, ev.clientY));
          if (!moved && Math.hypot(cx - x, cy - y) < 3) return;
          moved = true;
          const rect = {
            left: Math.min(x, cx),
            top: Math.min(y, cy),
            right: Math.max(x, cx),
            bottom: Math.max(y, cy),
            width: Math.abs(cx - x),
            height: Math.abs(cy - y),
          };
          const hits = selectable(board).filter((n) => {
            const r = n.getBoundingClientRect();
            return (
              r.left < rect.right &&
              r.right > rect.left &&
              r.top < rect.bottom &&
              r.bottom > rect.top
            );
          });
          select(additive ? [...before, ...hits] : hits, true);
          selectionOverlay.marquee(rect);
        },
        up() {
          selectionOverlay.marquee(null);
        },
        cancel() {
          selectionOverlay.marquee(null);
          select(before, true);
        },
      };
    }

    function startDrag(e, el) {
      const b = el.closest("[data-artboard]"),
        s = scaleOf(b),
        nodes = selectionRoots(S.selection),
        positions = nodes.map((node) => ({ node, p: getPos(node) })),
        before = snap(nodes);
      const alignment = guides.begin(nodes, b);
      const x0 = e.clientX,
        y0 = e.clientY;
      let moved = false;
      S.drag = {
        move(ev) {
          if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3)
            return;
          moved = true;
          const delta = alignment.move(
            {
              x: (ev.clientX - x0) / s,
              y: (ev.clientY - y0) / s,
            },
            ev.altKey,
          );
          positions.forEach(({ node, p }) =>
            setPos(node, p, p.x + delta.x, p.y + delta.y),
          );
          drawSel();
          alignment.draw(delta.matches);
        },
        up() {
          guides.clear();
          if (moved) commit(before, b);
        },
        cancel() {
          guides.clear();
          apply(before);
          drawSel();
        },
      };
    }
    function startResize(e, dir) {
      if (S.selection.length !== 1) return;
      endText();
      const el = S.sel,
        b = el.closest("[data-artboard]"),
        s = scaleOf(b),
        r = el.getBoundingClientRect();
      const w0 = r.width / s,
        h0 = r.height / s,
        p = getPos(el),
        media = el.matches(MEDIA);
      const text =
        !media &&
        !el.querySelector("[data-el],img,svg,canvas,video,iframe") &&
        !!el.textContent.trim();
      const metrics = text && dir.length === 2 ? textMetrics(el) : null;
      const before = snap(metrics ? metrics.map((m) => m.node) : [el]);
      const hp = media || el.style.height ? "height" : "minHeight";
      if (getComputedStyle(el).display === "inline")
        el.style.display = "inline-block";
      const x0 = e.clientX,
        y0 = e.clientY;
      S.drag = {
        move(ev) {
          const dx = (ev.clientX - x0) / s,
            dy = (ev.clientY - y0) / s;
          let w = w0,
            h = h0;
          if (dir.includes("e")) w = w0 + dx;
          if (dir.includes("w")) w = w0 - dx;
          if (dir.includes("s")) h = h0 + dy;
          if (dir.includes("n")) h = h0 - dy;
          if (metrics) {
            const sx = dir.includes("w") ? -1 : 1,
              sy = dir.includes("n") ? -1 : 1;
            const k = Math.max(
              6 / Math.min(...metrics.map((m) => m.font)),
              8 / w0,
              8 / h0,
              1 + (sx * dx * w0 + sy * dy * h0) / (w0 * w0 + h0 * h0),
            );
            w = w0 * k;
            h = h0 * k;
            scaleText(metrics, k);
          } else if (dir.length === 2 && media !== ev.shiftKey) {
            const k = Math.abs(dx) > Math.abs(dy) ? w / w0 : h / h0;
            w = w0 * k;
            h = h0 * k;
          }
          w = Math.max(8, w);
          h = Math.max(8, h);
          el.style.boxSizing = "border-box";
          el.style.maxWidth = "none";
          if (dir !== "n" && dir !== "s")
            el.style.width = Math.round(w * 1000) / 1000 + "px";
          if (dir !== "e" && dir !== "w")
            el.style[hp] = Math.round(h * 1000) / 1000 + "px";
          setPos(
            el,
            p,
            p.x + (dir.includes("w") ? w0 - w : 0),
            p.y + (dir.includes("n") ? h0 - h : 0),
          );
          drawSel();
        },
        up() {
          commit(before, b);
        },
      };
    }
    function nudge(el, k, n) {
      const nodes = S.selection.includes(el)
        ? selectionRoots(S.selection)
        : [el];
      const dx = k === "arrowleft" ? -n : k === "arrowright" ? n : 0,
        dy = k === "arrowup" ? -n : k === "arrowdown" ? n : 0;
      record(
        nodes,
        () =>
          nodes.forEach((node) => {
            const p = getPos(node);
            setPos(node, p, p.x + dx, p.y + dy);
          }),
        el.closest("[data-artboard]"),
      );
      drawSel();
    }
    function duplicate(el) {
      const b = el.closest("[data-artboard]");
      const nodes = S.selection.includes(el)
        ? selectionRoots(S.selection)
        : [el];
      const tree = document.createElement("div");
      const copies = nodes.map((node) => ({
        node,
        copy: node.cloneNode(true),
        p: getPos(node),
      }));
      copies.forEach(({ copy }) => tree.append(copy));
      [...tree.querySelectorAll("[data-el]")].forEach((n) => {
        if (n.hasAttribute("data-el")) n.dataset.el = elementId(b, "element");
      });
      rekeyDOMIds(tree, elementId(b, "copy"));
      [...tree.querySelectorAll("[data-bbox]")].forEach((n) =>
        n.removeAttribute("data-bbox"),
      );
      copies.forEach(({ node, copy, p }) => {
        if (p.abs) setPos(copy, p, p.x + 16, p.y + 16);
        node.after(copy);
      });
      const places = copies.map(({ copy }) => ({
        node: copy,
        parent: copy.parentNode,
        next: copy.nextSibling,
      }));
      push({
        undo: () => copies.forEach(({ copy }) => copy.remove()),
        redo: () =>
          [...places]
            .reverse()
            .forEach(({ node, parent, next }) =>
              parent.insertBefore(
                node,
                next?.parentNode === parent ? next : null,
              ),
            ),
        board: b,
      });
      select(copies.map((c) => c.copy));
    }

    /* ---------- 添加文字 / 图片 ---------- */
    function placeNew(el, b, w, h) {
      const ref = S.sel && S.sel !== b && b.contains(S.sel) ? S.sel : null;
      if (isArtboard(b)) {
        let x = (b.clientWidth - w) / 2,
          y = (b.clientHeight - h) / 2;
        if (ref) {
          const p = getPos(ref);
          if (p.abs) {
            x = p.x + 24;
            y = p.y + 24;
          }
        }
        Object.assign(el.style, {
          position: "absolute",
          margin: "0",
          boxSizing: "border-box",
          left: Math.round(x) + "px",
          top: Math.round(y) + "px",
          width: w + "px",
        });
        if (el.matches(MEDIA)) el.style.height = h + "px";
        el.dataset.flowStyle = ""; // 切回排版模式时变成普通文档流元素
        insertEl(el, b, null);
      } else {
        if (el.matches(MEDIA)) el.style.maxWidth = "100%";
        insertEl(el, b, ref);
      }
    }
    function elementId(b, kind) {
      let n = Number(stage.dataset.elementSeq) || 0,
        id;
      do {
        id = `${b.dataset.artboard}-${kind}-${++n}`;
      } while (stage.querySelector(`[data-el="${id}"]`));
      stage.dataset.elementSeq = n;
      return id;
    }
    function addText() {
      const b = activeBoard();
      if (!b || !visible(b) || !persistence?.canEdit()) return;
      endText();
      const el = document.createElement("div");
      el.setAttribute("data-el", elementId(b, "text"));
      el.textContent = "双击编辑文字";
      placeNew(el, b, 320, 60);
      startText(el);
      const r = document.createRange(),
        s = getSelection();
      r.selectNodeContents(el);
      s.removeAllRanges();
      s.addRange(r);
    }
    function addShape(kind) {
      const b = activeBoard();
      if (!b || !visible(b) || !persistence?.canEdit()) return;
      endText();
      const el = makeShape(kind, elementId(b, 'shape'));
      if (!el) return;
      placeNew(el, b, 220, kind === 'line' || kind === 'arrow' ? 44 : 132);
      select(el);
    }
    function addImage(src) {
      const b = activeBoard();
      if (!b || !visible(b) || !persistence?.canEdit()) return;
      const probe = new Image();
      probe.onload = () => {
        if (!persistence?.canEdit()) return;
        const nw = probe.naturalWidth || 400,
          nh = probe.naturalHeight || 300;
        const w = Math.max(
            16,
            Math.min(nw, Math.round(b.clientWidth * 0.5) || 400),
          ),
          h = Math.round((w * nh) / nw);
        const el = document.createElement("img");
        el.setAttribute("data-el", elementId(b, "image"));
        el.alt = "";
        el.src = src;
        el.style.width = w + "px";
        el.style.height = h + "px";
        el.style.objectFit = "contain";
        placeNew(el, b, w, h);
        select(el);
      };
      probe.onerror = () => toast("图片无法读取");
      probe.src = src;
    }
    function pickReplace(img) {
      S.replace = img;
      fileIn.click();
    }
    fileIn.addEventListener("change", () => {
      const files = [...fileIn.files].filter((f) =>
          f.type.startsWith("image/"),
        ),
        target = S.replace;
      fileIn.value = "";
      S.replace = null;
      if (target)
        files[0] &&
          readFile(
            files[0],
            (src) =>
              persistence?.canEdit() &&
              record(
                [target],
                () => {
                  target.src = src;
                  target.removeAttribute("srcset");
                },
                target.closest("[data-artboard]"),
              ),
          );
      else files.forEach((f) => readFile(f, addImage));
    });

    /* ---------- 改字 + 文本工具条 ---------- */
    function startText(el, x, y) {
      if (
        !el ||
        S.text?.el === el ||
        el.matches(MEDIA) ||
        el.querySelector("[data-el]")
      )
        return;
      endText();
      S.text = {
        el,
        before: snap([el], true),
        board: el.closest("[data-artboard]"),
      };
      el.contentEditable = "true";
      try {
        document.execCommand("styleWithCSS", false, true);
      } catch {}
      el.focus({ preventScroll: true });
      const s = getSelection();
      let r = x != null && document.caretRangeFromPoint?.(x, y);
      if (!r && x != null && document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        if (p) {
          r = document.createRange();
          r.setStart(p.offsetNode, p.offset);
        }
      }
      if (!r || !el.contains(r.startContainer)) {
        r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
      }
      s.removeAllRanges();
      s.addRange(r);
      select(el);
      syncTbar();
    }
    function endText() {
      const t = S.text;
      if (!t) return;
      S.text = null;
      S.range = null;
      t.el.removeAttribute("contenteditable");
      if (document.activeElement === t.el) t.el.blur();
      getSelection().removeAllRanges();
      commit(t.before, t.board);
      drawSel();
    }
    document.addEventListener("selectionchange", () => {
      if (!S.text) return;
      const s = getSelection();
      if (s.rangeCount && S.text.el.contains(s.anchorNode)) {
        S.range = s.getRangeAt(0).cloneRange();
        syncTbar();
      }
    });
    function fmt(cmd, v) {
      if (!S.text && S.sel && !S.sel.matches(MEDIA)) startText(S.sel);
      const t = S.text;
      if (!t) return;
      const el = t.el,
        s = getSelection();
      el.focus({ preventScroll: true });
      if (S.range) {
        s.removeAllRanges();
        s.addRange(S.range);
      }
      if (cmd === "align") el.style.textAlign = v;
      else if (cmd === "size") fontSize(el, Math.max(6, Number(v)), true);
      else if (cmd === "size+" || cmd === "size-")
        fontSize(el, cmd === "size+" ? 2 : -2);
      else {
        if (!s.rangeCount || s.getRangeAt(0).collapsed) {
          // 没选文字 → 作用于整段
          const r = document.createRange();
          r.selectNodeContents(el);
          s.removeAllRanges();
          s.addRange(r);
        }
        document.execCommand(
          cmd === "color" ? "foreColor" : cmd,
          false,
          v ?? null,
        );
      }
      if (s.rangeCount && el.contains(s.anchorNode))
        S.range = s.getRangeAt(0).cloneRange();
      persistence?.markDirty();
      syncTbar();
      drawSel();
    }
    function fontSize(el, d, absolute = false) {
      const s = getSelection(),
        r = s.rangeCount ? s.getRangeAt(0) : null;
      const size = (n) =>
        Math.max(
          6,
          absolute
            ? d
            : Math.round(parseFloat(getComputedStyle(n).fontSize)) + d,
        ) + "px";
      if (!r || r.collapsed || r.toString() === el.textContent) {
        const value = size(el);
        el.style.fontSize = value;
        if (absolute)
          el.querySelectorAll("[style]").forEach((n) => {
            if (n.style.fontSize) n.style.fontSize = value;
          });
        return;
      }
      let n = r.commonAncestorContainer;
      if (n.nodeType !== 1) n = n.parentElement;
      if (n !== el && n.tagName === "SPAN" && r.toString() === n.textContent) {
        n.style.fontSize = size(n);
        return;
      }
      const span = document.createElement("span");
      span.style.fontSize = size(n);
      span.append(r.extractContents());
      span.querySelectorAll("[style]").forEach((x) => {
        x.style.fontSize = "";
        if (!x.getAttribute("style")) x.removeAttribute("style");
      });
      r.insertNode(span);
      r.selectNodeContents(span);
      s.removeAllRanges();
      s.addRange(r);
    }
    function syncTbar() {
      const el = S.text?.el || S.sel;
      if (!el) return;
      ["bold", "italic", "underline", "strikeThrough"].forEach((c) => {
        let on = false;
        try {
          on = S.text
            ? document.queryCommandState(c)
            : c === "bold"
              ? Number(getComputedStyle(el).fontWeight) >= 600
              : false;
        } catch {}
        $(`[data-fmt=${c}]`).setAttribute("aria-pressed", on);
      });
      const n = getSelection().anchorNode,
        at = n ? (n.nodeType === 1 ? n : n.parentElement) : el;
      if (ui.activeElement !== $(".fs"))
        $(".fs").value = Math.round(
          parseFloat(getComputedStyle(el.contains(at) ? at : el).fontSize),
        );
      const cs = getComputedStyle(el), raw = cs.textAlign;
      const value = raw === "start" ? (cs.direction === "rtl" ? "right" : "left") : raw === "end" ? (cs.direction === "rtl" ? "left" : "right") : raw;
      const index = Math.max(0, ["left", "center", "right", "justify"].indexOf(value));
      const labels = ["左对齐", "居中", "右对齐", "两端对齐"], alignButton = $("[data-act=text-align]");
      alignButton.dataset.align = ["left", "center", "right", "justify"][index];
      alignButton.innerHTML = icon(["AlignLeft", "AlignCenter", "AlignRight", "AlignJustify"][index]);
      alignButton.title = `${labels[index]}；点击切换为${labels[(index + 1) % 4]}`;
      alignButton.setAttribute("aria-label", `文字对齐：${alignButton.title}`);
      const color = getComputedStyle(el.contains(at) ? at : el).color;
      $(".color-swatch").style.background = color;
      const rgb = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
      if (rgb && ui.activeElement !== $(".cpick")) $(".cpick").value = "#" + rgb.slice(1).map(n => Number(n).toString(16).padStart(2,"0")).join("");
    }
    function placeTbar() {
      const el = S.sel,
        show = S.editing && !S.playing && el?.isConnected && visible(el);
      tbar.hidden = !show;
      if (!show) {
        $("[data-menu=text-layout]").hidden = true;
        ++layoutRequest;
        return;
      }
      const multi = S.selection.length > 1;
      $(".selection-count").hidden = !multi;
      $(".selection-count").textContent = multi
        ? `已选 ${S.selection.length} 个元素`
        : "";
      const image = !multi && el.matches("img"),
        text =
          !multi &&
          !el.matches(MEDIA) &&
          !el.querySelector("[data-el]") &&
          !!el.textContent.trim();
      $(".text-tools").hidden = !text;
      $(".more-text-section").hidden = !text;
      $(".image-tools").hidden = !image;
      const shape = !multi && el.matches('svg[data-shape]');
      $(".shape-tools").hidden = !shape;
      if (shape) {
        for (const [prop, value] of Object.entries({ fill: el.dataset.shapeFill, stroke: el.dataset.shapeStroke, width: el.dataset.shapeWidth, adjust: el.dataset.shapeAdjust })) {
          const input = $(`[data-shape-prop=${prop}]`);
          if (ui.activeElement !== input) input.value = value;
        }
        $('.shape-color').hidden = !shapeHasFill(el.dataset.shape);
        $('.shape-adjust').hidden = !shapeHasAdjust(el.dataset.shape);
        $('.shape-adjust').firstChild.textContent = ({ rect: '圆角', star: '尖角', arrow: '箭头', blockArrow: '箭头' })[el.dataset.shape] || '调整';
      }
      if (image) {
        const fit = getComputedStyle(el).objectFit;
        $("[data-act=image-fit]").setAttribute(
          "aria-pressed",
          fit === "contain" || fit === "scale-down",
        );
        $("[data-act=image-cover]").setAttribute(
          "aria-pressed",
          fit === "cover",
        );
      }
      if (text) syncTbar();
      if (!text || !show) {
        $("[data-menu=text-layout]").hidden = true;
        ++layoutRequest;
      } else if (!$("[data-menu=text-layout]").hidden) {
        clearTimeout(layoutTimer);
        layoutTimer = setTimeout(refreshTextLayout, 100);
      }
    }
    $(".cpick").addEventListener("input", e => fmt("color", e.target.value));
    $(".fs").addEventListener("change", (e) => {
      if (Number.isFinite(e.target.valueAsNumber))
        fmt("size", e.target.valueAsNumber);
    });
    $(".fs").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.target.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        syncTbar();
        e.target.blur();
      }
    });

    /* ---------- 事件 1：快捷键（最先注册） ---------- */
    addEventListener(
      "keydown",
      (e) => {
        if (reviewUI?.key(e)) return;
        if (S.playing) return;
        if (fromUI(e) && pages.key(e)) return;
        if (
          fromUI(e) &&
          ["Enter", " "].includes(e.key) &&
          !e.ctrlKey &&
          !e.metaKey
        )
          return;
        if (
          fromUI(e) &&
          ["ArrowDown", "ArrowUp", "Escape"].includes(e.key) &&
          (ui.activeElement?.closest("[data-menu]") ||
            ui.activeElement?.matches("[aria-expanded=true]"))
        )
          return;
        if (e.key === "Escape" && S.drag?.cancel) {
          S.drag.cancel();
          S.drag = null;
          e.preventDefault();
          return;
        }
        const controlKey = e.ctrlKey || e.metaKey,
          zoomKey =
            controlKey && ["=", "+", "-", "_", "0", "1"].includes(e.key);
        if (
          fromUI(e) &&
          e
            .composedPath()
            .some(
              (n) =>
                n instanceof Element &&
                n.matches("input,textarea,[contenteditable=true]"),
            ) &&
          !zoomKey &&
          !(controlKey && e.key.toLowerCase() === "s")
        )
          return;
        const typing = !!S.text,
          mod = e.metaKey || e.ctrlKey,
          k = (e.key || "").toLowerCase(),
          c = e.code,
          el = S.sel;
        // Canvas preview belongs to the document: let its own keyboard handlers run.
        if (
          !S.editing &&
          !fromUI(e) &&
          !(mod && (zoomKey || k === "s")) &&
          !(
            k === "escape" &&
            (!modal.hidden || ui.querySelector("[data-menu]:not([hidden])"))
          )
        )
          return;
        const can = S.editing && !typing && el;
        if (k === "escape") {
          if (ui.querySelector("[data-menu]:not([hidden])")) closeMenus();
          else if (!modal.hidden) {
            modal.hidden = true;
            focusedBeforeModal?.focus();
          } else if (typing) endText();
          else if (el) select(null);
          else if (S.editing) {
            setEditing(false);
            persistence?.flush().catch(() => {});
          } else closeMenus();
        } else if (mod && k === "z" && S.editing && !typing)
          history(e.shiftKey ? 1 : -1);
        else if (mod && k === "y" && S.editing && !typing) history(1);
        else if (mod && k === "s") {
          if (sourcePending()) applySource();
          save();
        } else if (
          mod &&
          (k === "=" || k === "+" || c === "Equal" || c === "NumpadAdd")
        )
          zoomStep(1);
        else if (
          mod &&
          (k === "-" || k === "_" || c === "Minus" || c === "NumpadSubtract")
        )
          zoomStep(-1);
        else if (mod && (k === "0" || c === "Digit0" || c === "Numpad0")) {
          S.fit = false;
          applyZoom(1);
        } else if (mod && (k === "1" || c === "Digit1" || c === "Numpad1"))
          zoomFit();
        else if (mod && e.shiftKey && k.startsWith("arrow") && can) {
          const next = directionTarget(S.selection, S.current, e.key);
          if (next) select([...S.selection, next]);
        } else if (mod && k === "d" && can) duplicate(el);
        else if ((k === "delete" || k === "backspace") && can) removeEl(el);
        else if (k === "enter" && can && S.selection.length === 1)
          el.matches("img") ? pickReplace(el) : startText(el);
        else if (k.startsWith("arrow") && can && !mod)
          nudge(el, k, e.shiftKey ? 10 : 1);
        else if (
          !typing &&
          !mod &&
          (k === "pagedown" || (!el && k === "arrowright"))
        )
          pageStep(1);
        else if (
          !typing &&
          !mod &&
          (k === "pageup" || (!el && k === "arrowleft"))
        )
          pageStep(-1);
        else return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );

    /* ---------- 事件 2：拖动 / 改大小 ---------- */
    const guard = (e) => S.editing && !fromUI(e) && inStage(e.target);
    addEventListener(
      "pointermove",
      (e) => {
        if (S.drag) {
          S.drag.move(e);
          e.stopImmediatePropagation();
        } else if (guard(e)) e.stopImmediatePropagation();
      },
      true,
    );
    ["pointerup", "pointercancel"].forEach((type) =>
      addEventListener(
        type,
        (e) => {
          if (S.drag) {
            if (type === "pointercancel" && S.drag.cancel) S.drag.cancel();
            else S.drag.up(e);
            S.drag = null;
            e.stopImmediatePropagation();
          } else if (guard(e)) e.stopImmediatePropagation();
        },
        true,
      ),
    );

    addEventListener("blur", () => {
      if (S.drag) {
        if (S.drag.cancel) S.drag.cancel();
        else S.drag.up();
        S.drag = null;
      }
      guides.clear();
    });

    /* ---------- 事件 3：编辑模式下拦截内容交互 ---------- */
    addEventListener(
      "pointerdown",
      (e) => {
        if (fromUI(e)) return;
        closeMenus();
        host.removeAttribute("data-mobile-nav");
        if (!S.editing) return;
        if (!inStage(e.target)) {
          endText();
          const v = viewport.bounds();
          if (
            e.clientX >= v.x &&
            e.clientX <= v.x + v.w &&
            e.clientY >= v.y &&
            e.clientY <= v.y + v.h
          ) {
            e.preventDefault();
            ui.activeElement?.blur();
            startMarquee(e);
          } else select(null);
          return;
        }
        e.stopImmediatePropagation();
        if (e.target.isContentEditable) return; // 正在改字：允许放光标
        e.preventDefault();
        ui.activeElement?.blur();
        endText();
        const el = e.target.closest("[data-el]");
        if (!el) {
          startMarquee(e);
          return;
        }
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          toggleSelection(el);
          return;
        }
        if (!S.selection.includes(el)) select(el);
        if (e.button === 0) startDrag(e, el);
      },
      true,
    );

    [
      "click",
      "dblclick",
      "auxclick",
      "contextmenu",
      "mousedown",
      "mouseup",
      "submit",
      "keydown",
      "keyup",
      "keypress",
      "input",
      "change",
    ].forEach((type) =>
      addEventListener(
        type,
        (e) => {
          const key = type.startsWith("key");
          if (!(key ? S.editing && !fromUI(e) : guard(e))) return;
          e.stopImmediatePropagation();
          const editable = e.target.isContentEditable;
          if (!editable && !key) e.preventDefault();
          if (type === "input") {
            persistence?.markDirty();
            drawSel();
          }
          if (type === "contextmenu" && !editable) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            const el = e.target.closest("[data-el]");
            if (el) {
              if (!S.selection.includes(el)) select(el);
              openMenu("element", null, { x: e.clientX, y: e.clientY });
            }
          }
          if (type === "dblclick" && !editable) {
            if (e.shiftKey || e.ctrlKey || e.metaKey) return;
            const el = e.target.closest("[data-el]");
            if (el) select(el);
            el?.matches("img")
              ? pickReplace(el)
              : startText(el, e.clientX, e.clientY);
          }
        },
        true,
      ),
    );

    addEventListener(
      "paste",
      (e) => {
        if (!S.editing || fromUI(e)) return;
        const dt = e.clipboardData;
        if (!dt) return;
        if (S.text) {
          // 只粘贴纯文本
          e.preventDefault();
          e.stopImmediatePropagation();
          document.execCommand("insertText", false, dt.getData("text/plain"));
          return;
        }
        const f = [...dt.files].find((f) => f.type.startsWith("image/"));
        if (f) {
          e.preventDefault();
          e.stopImmediatePropagation();
          readFile(f, addImage);
        }
      },
      true,
    );
    addEventListener(
      "dragover",
      (e) => {
        if (S.editing && [...(e.dataTransfer?.types || [])].includes("Files"))
          e.preventDefault();
      },
      true,
    );
    addEventListener(
      "drop",
      (e) => {
        if (!S.editing) return;
        const fs = [...(e.dataTransfer?.files || [])].filter((f) =>
          f.type.startsWith("image/"),
        );
        if (!fs.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        fs.forEach((f) => readFile(f, addImage));
      },
      true,
    );

    /* ---------- UI 按钮 ---------- */
    ui.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) e.preventDefault();
    }); // 点按钮不抢走文字焦点
    ui.addEventListener("pointerdown", (e) => {
      const h = e.target.closest?.("[data-h]");
      if (h && S.sel && S.editing) {
        e.preventDefault();
        startResize(e, h.dataset.h);
      }
    });
    function closeMenus() {
      ui.querySelectorAll("[data-menu]").forEach((n) => {
        n.hidden = true;
      });
      ui.querySelectorAll("[aria-expanded]").forEach((n) =>
        n.setAttribute("aria-expanded", "false"),
      );
    }
    function openMenu(name, anchor, point) {
      const panel = $(`[data-menu=${name}]`),
        wasOpen = !panel.hidden;
      closeMenus();
      if (wasOpen && anchor) return;
      panel.hidden = false;
      anchor?.setAttribute("aria-expanded", "true");
      const r = anchor?.getBoundingClientRect(),
        x = point?.x ?? r?.right ?? innerWidth - 12,
        y = point?.y ?? r?.bottom + 7 ?? 60;
      panel.style.left =
        Math.max(
          8,
          Math.min(
            innerWidth - panel.offsetWidth - 8,
            point ? x : x - panel.offsetWidth,
          ),
        ) + "px";
      panel.style.top =
        Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, y)) + "px";
    }
    function imageFit(value) {
      const el = S.sel;
      if (!el?.matches("img")) return;
      record(
        [el],
        () => {
          const cs = getComputedStyle(el);
          el.style.width = cs.width;
          el.style.height = cs.height;
          el.style.objectFit = value;
        },
        el.closest("[data-artboard]"),
      );
      drawSel();
    }
    function layer(front) {
      const el = S.sel;
      if (!el) return;
      const board = el.closest("[data-artboard]");
      const plans = S.selection.map((n) =>
        layerChanges(n, board, front, S.selection),
      );
      record(
        [...new Set(plans.flatMap((p) => p.nodes))],
        () => plans.forEach((p) => p.apply()),
        board,
      );
      drawSel();
    }
    async function refreshTextLayout() {
      const id = ++layoutRequest, el = S.sel;
      const status = $(".text-layout-status");
      const height = $("[data-act=text-height]"), fit = $("[data-act=text-fit]");
      height.disabled = fit.disabled = true;
      status.textContent = "正在检测文字…";
      delete status.dataset.engine;
      try {
        if (!el || S.selection.length !== 1) return;
        const result = await textLayout.inspect(el);
        if (id !== layoutRequest || S.sel !== el || !S.editing) return;
        status.dataset.engine = result.engine;
        status.dataset.overflow = String(result.overflow);
        status.textContent = `${result.overflow ? "文字溢出" : "文字可完整显示"}${result.lineCount ? ` · ${result.lineCount} 行` : ""}，需要 ${Math.ceil(result.requiredHeight)}px / 当前 ${Math.round(result.availableHeight)}px。${result.engine === "pretext" ? "" : "使用浏览器实测。"}${result.adaptable ? "" : "这种布局暂不支持自动适配。"}`;
        status.title = result.reason;
        height.disabled = !result.adaptable;
        fit.disabled = !result.adaptable || !result.overflow;
      } catch (error) {
        if (id === layoutRequest) status.textContent = error.message;
      }
    }
    async function adaptText(mode) {
      endText();
      const el = S.sel;
      if (!el || S.selection.length !== 1) return;
      const before = el.outerHTML;
      try {
        const changes = await textLayout.plan(el, mode);
        if (!el.isConnected || S.sel !== el || !S.editing || S.playing || !persistence?.canEdit() || el.outerHTML !== before) {
          toast("文字或编辑状态已变化，请重新适配");
          return;
        }
        if (!changes.length) return toast("文字已可完整显示");
        const stylesBefore = changes.map(({ node }) => node.getAttribute("style"));
        record(changes.map(c => c.node), () => {
          changes.forEach(({ node, styles }) => Object.assign(node.style, styles));
          if (textLayout.check(el).overflow) {
            changes.forEach(({ node }, i) => stylesBefore[i] === null
              ? node.removeAttribute("style") : node.setAttribute("style", stylesBefore[i]));
            throw new Error("页面布局限制了适配，已保留原样；请调整文本框或父级布局");
          }
        }, el.closest("[data-artboard]"));
        drawSel();
        toast(mode === "height" ? "已按内容调整高度，可撤销" : "已缩小字号适配，可撤销");
      } catch (error) { toast(error.message, 4000); }
    }
    const ACTS = {
      nav(btn) {
        if (innerWidth <= 540) {
          const on = !host.hasAttribute("data-mobile-nav");
          host.toggleAttribute("data-mobile-nav", on);
          btn.setAttribute("aria-pressed", on);
          return;
        }
        const on = !root.hasAttribute("data-editor-nav");
        root.toggleAttribute("data-editor-nav", on);
        host.toggleAttribute("data-nav-hidden", !on);
        btn.setAttribute("aria-pressed", on);
        viewport.refresh(true);
      },
      prev: () => pageStep(-1),
      next: () => pageStep(1),
      edit: () => {
        editRequested = true;
        finishEditRequest();
        requestEditPermission();
      },
      done: () => {
        editRequested = false;
        setEditing(false);
        persistence?.flush().catch(() => {});
        ui.activeElement?.blur();
      },
      preview: (btn) => openMenu("play", btn),
      "scroll-play": () => {
        editRequested = false;
        viewport.preview(false);
      },
      fullscreen: () => {
        editRequested = false;
        viewport.preview(true);
      },
      stop: () => viewport.stop(),
      flow: () => setMode(activeBoard(), "flow"),
      artboard: () => setMode(activeBoard(), "artboard"),
      "add-text": addText,
      "add-image": () => {
        S.replace = null;
        fileIn.click();
      },
      "add-shape": (btn) => openMenu('shape', btn),
      "shape-insert": (btn) => addShape(btn.dataset.shapeKind),
      undo: () => history(-1),
      redo: () => history(1),
      "page-add": () => pages.add(),
      "page-copy": () => pages.copy(),
      "page-delete": () => pages.remove(),
      "page-rename": () => pages.rename(),
      "page-up": () => pages.moveStep(-1),
      "page-down": () => pages.moveStep(1),
      "image-replace": () => pickReplace(S.sel),
      "image-fit": () => imageFit("contain"),
      "image-cover": () => imageFit("cover"),
      "text-align": () => {
        const values = ["left", "center", "right", "justify"];
        fmt("align", values[(values.indexOf($("[data-act=text-align]").dataset.align) + 1) % 4]);
      },
      "text-layout": async (btn) => {
        const keyboard = ui.activeElement === btn, trigger = $("[data-act=element-more]"), panel = $("[data-menu=text-layout]");
        openMenu("text-layout", trigger);
        if (keyboard) trigger.focus();
        if (!panel.hidden) {
          await refreshTextLayout();
          if (keyboard && !panel.hidden) panel.querySelector("button:not(:disabled)")?.focus();
        }
      },
      "text-height": () => adaptText("height"),
      "text-fit": () => adaptText("fit"),
      "element-duplicate": () => S.sel && duplicate(S.sel),
      "element-delete": () => S.sel && removeEl(S.sel),
      "element-front": () => layer(true),
      "element-back": () => layer(false),
      source: openSource,
      export: (btn) => openMenu("export", btn),
      more: (btn) => openMenu("more", btn),
      status: (btn) => openMenu("status", btn),
      "element-more": (btn) => openMenu("element", btn),
      save: () => save(),
      download: () => download(serialize()),
      copy: () => copyText(serialize()),
      print: doPrint,
      conflict: () => persistence.conflict(),
      retry: () => persistence.retry(),
      recover: () => persistence.restore(),
      pdf: () => exportFile("pdf"),
      pptx: () => exportFile("pptx"),
      "zoom-in": () => zoomStep(1),
      "zoom-out": () => zoomStep(-1),
      "zoom-reset": () => {
        S.fit = false;
        applyZoom(1);
      },
      "zoom-fit": zoomFit,
      "src-copy": () => copyText(ta.value),
      "src-download": () => download(ta.value),
      "src-apply": applySource,
      "src-close": () => {
        modal.hidden = true;
        focusedBeforeModal?.focus();
      },
      help: () =>
        toast(
          "空白处拖动框选；Shift 或 Ctrl/⌘＋点击增减选择，Shift＋框选追加，Ctrl/⌘＋Shift＋方向键按方向扩选。多选后可一起拖动、微调、复制和删除；Ctrl/⌘ A 保留原行为。Alt/Option 暂停吸附，Esc 逐级取消。文字角点缩放字号，边点调整文本框；空格＋拖动平移，Ctrl/⌘ ＋ − 0 1 缩放；Ctrl/⌘ Z 撤销，Ctrl/⌘ Shift Z 重做，Ctrl/⌘ D 复制。",
          10000,
        ),
    };
    const mutations = new Set([
      "flow",
      "artboard",
      "add-text",
      "add-image",
      "shape-insert",
      "undo",
      "redo",
      "src-apply",
      "image-replace",
      "image-fit",
      "image-cover",
      "text-height",
      "text-fit",
      "text-align",
      "element-duplicate",
      "element-delete",
      "element-front",
      "element-back",
    ]);
    ui.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || btn.disabled) return;
      if (btn.dataset.fmt) {
        if (persistence?.canEdit() && S.editing)
          fmt(btn.dataset.fmt, btn.dataset.v);
        return;
      }
      const act = btn.dataset.act;
      if (!act) return;
      if (
        !["preview", "export", "more", "status", "element-more", "text-layout", "add-shape"].includes(act)
      )
        closeMenus();
      if (
        mutations.has(act) &&
        (!persistence?.canEdit() || !S.editing || S.playing)
      )
        return;
      ACTS[act]?.(btn);
    });
    ui.addEventListener('change', (e) => {
      const prop = e.target.dataset?.shapeProp;
      const el = S.sel;
      if (!prop || !el?.matches('svg[data-shape]') || !S.editing || !persistence?.canEdit()) return;
      const field = { fill: 'shapeFill', stroke: 'shapeStroke', width: 'shapeWidth', adjust: 'shapeAdjust' }[prop];
      if (!field) return;
      const before = snap([el], true);
      el.dataset[field] = e.target.value;
      renderShape(el);
      commit(before, el.closest('[data-artboard]'));
      drawSel();
    });
    ui.addEventListener("keydown", (e) => {
      if (!modal.hidden && e.key === "Tab") {
        const controls = [
            ...modal.querySelectorAll("button:not(:disabled),textarea"),
          ],
          first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && ui.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && ui.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (
        e.target.matches("[aria-expanded=true]") &&
        ["ArrowDown", "ArrowUp"].includes(e.key)
      ) {
        const menu = ui.querySelector("[data-menu]:not([hidden])"),
          items = [
            ...(menu?.querySelectorAll("button:not(:disabled):not([hidden])") ||
              []),
          ].filter(n => n.getClientRects().length);
        e.preventDefault();
        (e.key === "ArrowDown" ? items[0] : items.at(-1))?.focus();
        return;
      }
      if (e.key === "Escape" && e.target.closest("[data-menu]")) {
        e.preventDefault();
        e.stopPropagation();
        const expanded = $("[aria-expanded=true]");
        closeMenus();
        expanded?.focus();
      }
      if (
        e.target.closest("[data-menu]") &&
        ["ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        const items = [
            ...e.target
              .closest("[data-menu]")
              .querySelectorAll("button:not(:disabled):not([hidden])"),
          ].filter(n => n.getClientRects().length),
          i = items.indexOf(ui.activeElement);
        e.preventDefault();
        items[
          (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
        ]?.focus();
      }
    });

    /* ---------- 源码 / 导出 ---------- */
    const headCSS = () =>
      [
        ...document.head.querySelectorAll('style, link[rel~="stylesheet"]'),
      ].filter((n) => !n.matches("[data-editor-style]"));
    const grab = () => ({
      html: stage.innerHTML,
      css: headCSS().map((n) => n.outerHTML),
      idx: boards().indexOf(S.current),
    });
    function setContent(c) {
      endText();
      select(null);
      headCSS().forEach((n) => n.remove());
      const t = document.createElement("template");
      t.innerHTML = c.css.join("");
      document.head.insertBefore(t.content, pageStyle);
      stage.innerHTML = c.html;
      const list = boards();
      setCurrent(list[Math.min(Math.max(c.idx, 0), list.length - 1)] || null);
      buildNav();
      goTo(S.current);
    }
    let sourceOriginal = "";
    const sourcePending = () => !modal.hidden && ta.value !== sourceOriginal;
    function openSource() {
      focusedBeforeModal = $("[data-act=more]");
      endText();
      select(null);
      ta.value = serialize();
      sourceOriginal = ta.value;
      modal.hidden = false;
      ta.focus();
      ta.setSelectionRange(0, 0);
      ta.scrollTop = 0;
    }
    function applySource() {
      if (!persistence?.canEdit()) return;
      const d = new DOMParser().parseFromString(ta.value, "text/html");
      const ns = d.querySelector("[data-stage]") || d.body;
      ns.querySelectorAll("[data-editor-current],[contenteditable]").forEach(
        (n) => {
          n.removeAttribute("data-editor-current");
          n.removeAttribute("contenteditable");
        },
      );
      const before = grab();
      setContent({
        html: ns.innerHTML,
        css: [...d.head.querySelectorAll('style, link[rel~="stylesheet"]')].map(
          (n) => n.outerHTML,
        ),
        idx: before.idx,
      });
      const after = grab();
      push({ undo: () => setContent(before), redo: () => setContent(after) });
      modal.hidden = true;
      toast("已应用");
    }
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        modal.hidden = true;
        focusedBeforeModal?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        applySource();
      }
    });
    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        toast("已复制 HTML");
      } catch {
        toast("复制失败，请打开“源码”手动复制");
      }
    }
    function doPrint() {
      endText();
      select(null);
      print();
    }
    addEventListener("beforeprint", () => {
      endText();
      const b = S.current || boards()[0],
        sz = b && sizeOf(b);
      printStyle.textContent = sz
        ? `@page{size:${sz.w}px ${sz.h}px;margin:0}`
        : "";
    });

    /* ---------- 单页 / 翻页 ---------- */
    function setCurrent(b) {
      if (S.current !== (b || null)) S.reviewContext++;
      S.current = b || null;
      boards().forEach((x) =>
        x.toggleAttribute("data-editor-current", x === b),
      );
    }
    function goTo(b) {
      const list = boards(),
        i = list.indexOf(b);
      endText();
      if (S.sel && (!b || !b.contains(S.sel))) select(null);
      setCurrent(i >= 0 ? b : list[0] || null);
      if (S.current)
        document.dispatchEvent(
          new CustomEvent("editor:goto", {
            detail: {
              index: list.indexOf(S.current),
              id: S.current.dataset.artboard,
            },
          }),
        );
      pages.clearTarget();
      host.removeAttribute("data-mobile-nav");
      viewport.refresh(true);
      markActive();
      syncBar();
    }
    function pageStep(d) {
      const list = boards(),
        i = Math.min(list.length - 1, Math.max(0, list.indexOf(S.current) + d));
      if (list[i] !== S.current) goTo(list[i]);
    }
    function markActive() {
      const list = boards(),
        i = list.indexOf(S.current);
      ui.querySelectorAll(".pageno").forEach(
        (n) =>
          (n.textContent = list.length ? `${i + 1} / ${list.length}` : "0 / 0"),
      );
      ui.querySelectorAll("[data-act=prev]").forEach(
        (n) => (n.disabled = i <= 0),
      );
      ui.querySelectorAll("[data-act=next]").forEach(
        (n) => (n.disabled = i < 0 || i >= list.length - 1),
      );
      $(".page-title").textContent = S.current?.dataset.title || "";
      $(".page-title").title =
        (S.current?.dataset.title || "") + " · 点击重命名";
      $(".play-title").textContent = S.current?.dataset.title || "";
      pages.markActive();
    }
    const pages = createPages({
      S,
      root,
      stage,
      ui,
      boards,
      withAll,
      visible,
      esc,
      push,
      goTo,
      select,
      endText,
      writable: () => !!persistence?.canManagePages() && !S.playing,
      async submit(apply, valid, rename) {
        const wasEditing = S.editing;
        try { return await persistence.pageAction(apply, valid, rename); }
        catch (error) { toast(error.message, 6000); throw error; }
        finally { if (wasEditing && persistence.canEdit() && !S.playing) setEditing(true); }
      },
      openMenu,
      closeMenus,
    });
    const sizeOf = (b) => pages.sizeOf(b),
      paint = (b) => pages.paint(b),
      buildNav = () => pages.build();
    const dirty = new Set();
    let timer = 0,
      rebuild = false;
    function schedule() {
      timer ||= setTimeout(() => {
        timer = 0;
        if (rebuild) {
          rebuild = false;
          dirty.clear();
          buildNav();
        } else {
          dirty.forEach(paint);
          dirty.clear();
        }
        if (S.zoom !== 1) applyZoom(S.zoom, null); // 内容高度变了，重算缩放留白
        drawSel();
      }, 250);
    }
    const mo = new MutationObserver((ms) => {
      let hit = false;
      for (const m of ms) {
        if (m.type === "attributes" && SKIP_ATTR.test(m.attributeName))
          continue;
        const n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!n || n.closest("[data-editor-style]")) continue;
        if (
          m.type === "childList" &&
          [...m.addedNodes, ...m.removedNodes].every(
            (x) => x.nodeType === 1 && x.matches("[data-editor-style]"),
          )
        )
          continue;
        hit = true;
        if (document.head.contains(n) || n.closest("style")) {
          rebuild = true;
          continue;
        }
        if (
          m.type === "childList" &&
          [...m.addedNodes, ...m.removedNodes].some(
            (x) =>
              x.nodeType === 1 &&
              (x.matches("[data-artboard]") ||
                x.querySelector("[data-artboard]")),
          )
        )
          rebuild = true;
        const b = n.closest("[data-artboard]");
        if (b) dirty.add(b);
      }
      if (hit) schedule();
    });
    mo.observe(stage, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    mo.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    addEventListener("resize", () => {
      rebuild = true;
      schedule();
      viewport.refresh();
      drawSel();
    });

    /* ---------- 测量 & 保存 ---------- */
    function measure() {
      // 所有页都量（单页模式下临时全部显示）
      withAll(() =>
        boards().forEach((b) => {
          if (!visible(b)) return;
          const o = origin(b);
          b.querySelectorAll("[data-el]").forEach((el) => {
            if (!visible(el)) return el.removeAttribute("data-bbox");
            const r = el.getBoundingClientRect();
            const v = [r.left - o.x, r.top - o.y, r.width, r.height]
              .map((n) => Math.round(n / o.s))
              .join(",");
            if (el.dataset.bbox !== v) el.dataset.bbox = v;
          });
        }),
      );
    }
    function serialize(finish = true) {
      if (finish) endText();
      measure();
      const doc = root.cloneNode(true);
      doc
        .querySelectorAll(
          "[data-editor-ui], [data-editor-connection], style[data-editor-style], #codex-browser-sidebar-comments-root",
        )
        .forEach((n) => n.remove());
      [...doc.attributes]
        .filter((a) => /^data-edit/.test(a.name))
        .forEach((a) => doc.removeAttribute(a.name));
      doc
        .querySelectorAll("[contenteditable],[data-editor-current]")
        .forEach((n) => {
          n.removeAttribute("contenteditable");
          n.removeAttribute("data-editor-current");
        });
      return "<!DOCTYPE html>\n" + doc.outerHTML;
    }
    function download(text, name = fileName()) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        text instanceof Blob
          ? text
          : new Blob([text], { type: "text/html;charset=utf-8" }),
      );
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    function save() {
      endText();
      persistence.save();
    }
    const exportFile = createExporter({
      ui,
      serialize,
      toast,
      download,
      fileName,
    });
    addEventListener("beforeunload", (e) => {
      if (S.changed || sourcePending() || pages.hasPendingRename()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    let config = null;
    try {
      config = JSON.parse(
        document.querySelector("[data-editor-connection]")?.textContent ||
          "null",
      );
    } catch {}
    const viewKey = "html-design-view:" + location.pathname;
    function reloadLatest(notice) {
      try {
        sessionStorage.setItem(
          viewKey,
          JSON.stringify({
            page: reviewRestorePage || S.current?.dataset.artboard,
            zoom: S.zoom,
            fit: S.fit,
            editRequested,
            notice: typeof notice === "string" ? notice : undefined,
          }),
        );
      } catch {}
      location.reload();
    }
    persistence = createPersistence({
      config,
      serialize,
      download,
      changed: (value) => {
        S.changed = value;
      },
      isBusy: () => !!S.drag || sourcePending(),
      hasPendingSource: () => sourcePending() || pages.hasPendingRename(),
      pause() {
        if (sourcePending() || pages.hasPendingRename()) return false;
        if (S.drag) {
          const drag = S.drag; S.drag = null;
          if (drag.kind === "page") drag.cancel(); else drag.up();
        }
        setEditing(false);
        return true;
      },
      reload: reloadLatest,
      historyBoundary() { S.undo = []; S.redo = []; select(null); syncBar(); },
      prepareReview(kind) {
        if (sourcePending() || (pages.hasPendingRename() && kind !== "rename")) return false;
        editRequested = false;
        if (S.drag) { const drag = S.drag; S.drag = null; if (drag.kind === "page") drag.cancel(); else drag.up(); }
        setEditing(false);
        return true;
      },
      applyHTML(html) {
        const d = new DOMParser().parseFromString(html, "text/html");
        setContent({
          html: d.querySelector("[data-stage]").innerHTML,
          css: [
            ...d.head.querySelectorAll('style,link[rel~="stylesheet"]'),
          ].map((n) => n.outerHTML),
          idx: boards().indexOf(S.current),
        });
      },
      render(state) {
        reviewUI?.update(state);
        canRequestEdit = !!state.takeover;
        if (state.retry || state.conflict) editRequested = false;
        host.toggleAttribute("data-readonly", !state.canEdit);
        const message =
          state.message === "已自动保存" ? "已保存" : state.message;
        $(".state-text").textContent = message;
        $(".save-state").title = state.message;
        $(".status-detail").textContent = state.message;
        $(".state-icon").innerHTML = icon(
          state.retry || state.conflict
            ? "CircleAlert"
            : state.message.includes("只读")
              ? "Lock"
              : state.message.includes("保存…")
                ? "RefreshCw"
                : "Check",
        );
        ["retry", "recover", "conflict"].forEach(
          (act) => ($(`[data-act=${act}]`).hidden = !state[act]),
        );
        $("[data-act=save]").disabled =
          state.managed && !state.canEdit && !state.dirty;
        if (!state.canEdit && S.editing) setEditing(false);
        finishEditRequest();
        if (editRequested && !state.canEdit) requestEditPermission();
        syncBar();
        if (state.retry || state.recover || state.conflict) {
          $(".save-state").setAttribute(
            "aria-label",
            state.message + "，点击处理",
          );
        } else $(".save-state").setAttribute("aria-label", state.message);
      },
    });
    reviewUI = createReview({
      ui, persistence: () => persistence, toast,
      navigate(id) { const b = boards().find(b => b.dataset.artboard === id); if (b) goTo(b); },
      restoreTarget(id) { reviewRestorePage = id; },
      view() { const b = S.current; return { board: b, rect: b?.getBoundingClientRect(), bounds: viewport.bounds(), zoom: S.zoom, playing: S.playing, intentEpoch: S.reviewContext, layoutWidth: b?.offsetWidth || 1280, layoutHeight: b?.offsetHeight || 720 }; },
    });

    /* ---------- 初始化 ---------- */
    setCurrent(boards()[0]);
    root.setAttribute("data-editor-single", "");
    buildNav();
    markActive();
    setEditing(false);
    zoomFit();
    document.readyState === "complete"
      ? viewport.refresh()
      : addEventListener("load", () => {
          buildNav();
          viewport.refresh();
        });
    try {
      const view = JSON.parse(sessionStorage.getItem(viewKey) || "null");
      sessionStorage.removeItem(viewKey);
      if (view) {
        editRequested = !!view.editRequested;
        setCurrent(
          boards().find((b) => b.dataset.artboard === view.page) || boards()[0],
        );
        S.fit = view.fit;
        view.fit ? zoomFit() : applyZoom(view.zoom);
        markActive();
        if (view.notice) toast(view.notice, 6000);
      }
    } catch {}
    ui.querySelectorAll("[data-menu] button").forEach((n) =>
      n.setAttribute("role", "menuitem"),
    );
    persistence.start();
  }

  document.readyState === "loading"
    ? addEventListener("DOMContentLoaded", main)
    : main();
})();
