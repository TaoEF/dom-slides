import { selectionFrame, frameCorner, resizeCursor, sameSelection, rotationGroups, groupLocalAngle, writeGroupAngle } from './oriented-selection.js';
import { isGroup, groupRoots, objectRect, logicalTarget, groupProblem, groupStructureProblem, stableGroupMarkup, layoutProbe } from "./groups.js";
import { createCrop, cropImage } from './crop.js';
import { toolbarHTML } from "./ui.js";
import { createExporter } from "./export.js";
import { createPersistence } from "./persistence.js";
import { createReview } from './review.js';
import { createViewport } from "./viewport.js";
import { createPages } from "./pages.js";
import { textMetrics, scaleText } from "./typography.js";
import { createTextLayout } from "./text-layout.js";
import { icon } from "./icons.js";
import { rekeyDOMIds } from "./identifiers.js";
import { createGuides } from "./guides.js";
import { layerChanges } from "./layers.js";
import { elementGeometry, inverseDelta, mappedDelta, normalizedAngle, snappedAngle } from './geometry.js';
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

  const MEDIA = 'img,video,canvas,svg,iframe,picture,[data-crop-frame]';
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
      group: null,
      composing: false,
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

    let selectionDirection = {nodes:[],angle:0};
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
    const helpDialog = $(".help-dialog");
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
    const crop = createCrop({ S, ui, select, draw: drawSel, sync: syncBar, push, toast, getPos, setPos, canEdit: () => S.editing && !S.playing && !!persistence?.canEdit() });

    /* ---------- 工具函数 ---------- */
    let focusedBeforeModal = null;
    const fromUI = (e) => e.composedPath().includes(host);
    const inStage = (n) =>
      n instanceof Element && !!n.closest("[data-artboard]");
    const visible = (n) => isGroup(n) ? objectRect(n).width > 0 && objectRect(n).height > 0 : n.getClientRects().length > 0;
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
    function restoreDirection(state) {
      if(state && sameSelection(state.nodes,S.selection)) selectionDirection={nodes:[...state.nodes],angle:state.angle};
    }
    function commit(before, board, directionBefore = null) {
      const after = snap(
        before.map((x) => x.el),
        before[0]?.h != null,
      );
      const directionAfter = directionBefore ? {nodes:[...directionBefore.nodes],angle:selectionDirection.angle} : null;
      if (key(before) !== key(after))
        push({ undo: () => { apply(before); restoreDirection(directionBefore); }, redo: () => { apply(after); restoreDirection(directionAfter); }, board });
    }
    function record(els, fn, board) {
      const b = snap(els);
      fn();
      commit(b, board);
    }
    function history(dir) {
      if (crop.active) return crop.history(dir);
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
      crop.finish();
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
      const ancestors = [...new Set(nodes.flatMap(node => { const list=[]; for(let n=node.parentElement; isGroup(n); n=n.parentElement) list.push(n); return list; }))];
      nodes.forEach((node) => node.remove());
      for (const group of ancestors.sort((a,b) => a.contains(b)?1:b.contains(a)?-1:0)) if (!group.children.length) {
        places.push({node:group,parent:group.parentNode,next:group.nextSibling}); group.remove();
      }
      drawSel();
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
        redo: () => { [...places].forEach(({node}) => node.remove()); drawSel(); },
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
        S.group = null;
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
      $("[data-act=undo]").disabled = !writable || !(crop.active ? crop.canUndo : S.undo.length);
      $("[data-act=redo]").disabled = !writable || !(crop.active ? crop.canRedo : S.redo.length);
      [
        "flow",
        "artboard",
        "add-text",
        "add-image",
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
      ["page-copy", "page-delete", "page-rename", "page-size"].forEach(act => ui.querySelectorAll(`[data-act=${act}]`).forEach(n => { n.disabled = !manageable || !b; }));
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
          x: parseFloat(getComputedStyle(el).left) || 0,
          y: parseFloat(getComputedStyle(el).top) || 0,
        };
      const t = getComputedStyle(el).translate.split(/\s+/), g = elementGeometry(el);
      const value = (v, size) => (parseFloat(v) || 0) * (v?.endsWith('%') ? size / 100 : 1);
      return { abs, x: value(t[0], g.w), y: value(t[1], g.h) };
    }
    function setPos(el, p, x, y) {
      x = Math.round(x * 1000) / 1000;
      y = Math.round(y * 1000) / 1000;
      if (p.abs) {
        el.style.left = x + "px";
        el.style.top = y + "px";
      } else el.style.translate = x || y ? `${x}px ${y}px` : "";
    }

    function transformable(nodes) {
      const roots=groupRoots(nodes);
      return roots.length>0 && nodes.every(n => !isGroup(n) || !groupStructureProblem(n)) && roots.every(n => n.getClientRects().length && elementGeometry(n).supported);
    }
    function enterGroup(group, target = null) {
      if (!isGroup(group) || !S.editing || !persistence?.canEdit()) return;
      crop.finish(); endText();
      const issue = groupStructureProblem(group);
      if (issue) return toast(issue);
      S.group = group;
      select(logicalTarget(target, group) || [...group.children][0] || null);
    }
    function exitGroup() {
      if (!S.group) return;
      crop.finish(); endText();
      const group = S.group;
      S.group = group.parentElement?.closest('[data-group="1"][data-el]') || null;
      select(group.isConnected ? group : null);
    }
    function groupSelection() {
      crop.finish(); endText();
      const nodes = selectionRoots(S.selection), issue = groupProblem(nodes);
      if (issue) return toast(issue);
      const parent = nodes[0].parentElement, board = activeBoard();
      const ordered = [...parent.childNodes], first = ordered.findIndex(n => nodes.includes(n)), last = ordered.findLastIndex(n => nodes.includes(n));
      const children = ordered.slice(first,last+1), next = ordered[last+1] || null;
      const unchanged = layoutProbe(board);
      const sequence = stage.getAttribute('data-element-seq');
      const group = document.createElement('div');
      group.dataset.group = '1'; group.dataset.el = elementId(board,'group'); group.style.display = 'contents'; group.setAttribute('role','group');
      const wrap = () => { parent.insertBefore(group, children[0].parentNode===parent ? children[0] : next?.parentNode===parent ? next : null); children.forEach(n => group.append(n)); };
      const unwrap = () => { children.forEach(n => parent.insertBefore(n,group)); group.remove(); };
      wrap();
      if (groupStructureProblem(group) || !stableGroupMarkup(board) || !unchanged()) { unwrap(); sequence===null ? stage.removeAttribute('data-element-seq') : stage.setAttribute('data-element-seq',sequence); return toast('这种布局的组合会改变样式、位置或绘制顺序，已保留原样',4000); }
      const context = S.group;
      push({board, undo:() => { unwrap(); S.group=context; select(nodes); }, redo:() => { wrap(); S.group=context; select(group); }});
      select(group);
    }
    function ungroupSelection() {
      const group = S.selection.length===1 && isGroup(S.sel) ? S.sel : null;
      if (!group) return;
      crop.finish(); endText();
      const issue = groupStructureProblem(group);
      if (issue) return toast(issue);
      const parent=group.parentNode, children=[...group.childNodes], next=group.nextSibling, board=activeBoard(), context=S.group;
      const unwrap=() => { children.forEach(n => parent.insertBefore(n,group)); group.remove(); };
      const wrap=() => { parent.insertBefore(group,children[0]?.parentNode===parent ? children[0] : next?.parentNode===parent ? next : null); children.forEach(n => group.append(n)); };
      const unchanged=layoutProbe(board,[group]);
      unwrap();
      if (!stableGroupMarkup(board) || !unchanged()) { wrap(); return toast('取消组合会改变当前布局，已保留原样',4000); }
      const members=children.filter(n => n.nodeType===1);
      push({board,undo:() => { wrap(); S.group=context; select(group); },redo:() => { unwrap(); S.group=context; select(members); }});
      select(members);
    }
    function startGroupResize(e, dir) {
      if (dir.length!==2 || groupStructureProblem(S.sel)) return;
      endText();
      const nodes=groupRoots([S.sel]), items=nodes.map(node => ({node,g:elementGeometry(node),p:getPos(node),scale:getComputedStyle(node).scale}));
      if (!items.length || items.some(i => !i.g.supported)) return toast('这种变换暂不支持组合缩放');
      const frame=selectionFrame([S.sel]), board=activeBoard(), boardScale=scaleOf(board), before=snap(nodes);
      if(!frame)return;
      const sx=dir.includes('w')?-1:1,sy=dir.includes('n')?-1:1;
      const anchor=frameCorner(frame,-sx,-sy), corner=frameCorner(frame,sx,sy);
      const dx=corner.x-anchor.x,dy=corner.y-anchor.y;
      const minimum=Math.max(...items.map(i => 8*boardScale/Math.min(i.g.w*i.g.scale,i.g.h*i.g.scale)), ...items.flatMap(i => textMetrics(i.node).filter(m=>m.node.textContent.trim()).map(m=>6*boardScale/(m.font*elementGeometry(m.node).scale))));
      let moved=false, factor=1;
      S.drag={move(ev) {
        if (!moved && Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)<3) return;
        if (!moved) { items.forEach(i => { prepareTransform(i.node,i.g,i.p); i.position=getPos(i.node); }); moved=true; }
        const k=Math.max(minimum,1+((ev.clientX-e.clientX)*dx+(ev.clientY-e.clientY)*dy)/(dx*dx+dy*dy));
        factor=k;
        for (const i of items) {
          setPos(i.node,i.position,i.position.x,i.position.y);
          const scale=i.scale==='none'?1:parseFloat(i.scale);
          i.node.style.scale=String(scale*k);
          keepCenter(i.node,i.position,{x:anchor.x+(i.g.cx-anchor.x)*k,y:anchor.y+(i.g.cy-anchor.y)*k});
        }
        drawSel();
      },up() { if(moved && Math.abs(factor-1)>1e-6)commit(before,board); else if(moved)apply(before); },cancel() { apply(before); drawSel(); }};
    }

    /* ---------- 选中 / 拖动 / 改大小 ---------- */
    function select(el, keepDrag = false) {
      if (crop.active && !crop.owns(el)) crop.finish();
      const nodes = selectionRoots(Array.isArray(el) ? el : el ? [el] : []);
      if (S.group && (!S.group.isConnected || nodes.some(n => !S.group.contains(n)))) S.group = null;
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
      if(!sameSelection(nodes,selectionDirection.nodes))selectionDirection={nodes:[...nodes],angle:0};
      S.selection = nodes;
      S.sel = nodes.at(-1) || null;
      drawSel();
      syncBar();
    }
    function drawSel() {
      if (S.group && (!S.group.isConnected || S.group.closest("[data-artboard]") !== S.current)) S.group = null;
      crop.refresh();
      guides.refresh();
      S.selection = selectionRoots(S.selection).filter((n) => visible(n));
      if(!sameSelection(S.selection,selectionDirection.nodes))selectionDirection={nodes:[...S.selection],angle:0};
      S.sel = S.selection.at(-1) || null;
      selectionOverlay.draw(S.selection);
      const el = S.sel;
      if (!el || !el.isConnected || !visible(el)) selBox.style.display = "none";
      else {
        const r = unionRect(S.selection), frame = selectionFrame(S.selection,selectionDirection.angle);
        const width = frame ? frame.width : r.width, height = frame ? frame.height : r.height;
        Object.assign(selBox.style, {
          display: "block",
          left: (frame ? frame.cx-width/2 : r.left) + "px",
          top: (frame ? frame.cy-height/2 : r.top) + "px",
          width: width + "px",
          height: height + "px",
          transform: frame ? `rotate(${frame.angle}deg)` : 'none',
        });
        selBox.querySelectorAll('[data-h]').forEach(n=>n.style.cursor=resizeCursor(n.dataset.h,frame?.angle||0));
        selBox.classList.toggle('unsupported', !transformable(S.selection));
        selBox.classList.toggle("typing", !!S.text);
        selBox.classList.toggle("multiple", S.selection.length > 1);
        selBox.classList.toggle("group", S.selection.length === 1 && isGroup(el));
      }
      positionRotation();
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
          const hits = selectable(board, S.group).filter((n) => {
            const r = objectRect(n);
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
        nodes = groupRoots(S.selection),
        positions = nodes.map((node) => ({ node, p: getPos(node), g: elementGeometry(node) })),
        before = snap(nodes);
      if (!transformable(S.selection) || positions.some(item => !item.g.supported)) return toast('这种变换暂不支持拖动、缩放或旋转');
      let alignment = guides.begin(nodes, b, S.group);
      const x0 = e.clientX,
        y0 = e.clientY;
      let moved = false;
      S.drag = {
        move(ev) {
          if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3)
            return;
          if (!moved) {
            positions.forEach(item => {
              prepareTransform(item.node, item.g, item.p);
              item.p = getPos(item.node); item.g = elementGeometry(item.node);
            });
            alignment = guides.begin(nodes, b, S.group);
          }
          moved = true;
          const delta = alignment.move(
            {
              x: (ev.clientX - x0) / s,
              y: (ev.clientY - y0) / s,
            },
            ev.altKey,
          );
          positions.forEach(({ node, p, g }) => {
            const d = inverseDelta(g.parent, delta.x * s, delta.y * s);
            setPos(node, p, p.x + d.x, p.y + d.y);
          });
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
    function resizeAnchor(g, dir) {
      const x = dir.includes('w') ? g.w / 2 : dir.includes('e') ? -g.w / 2 : 0;
      const y = dir.includes('n') ? g.h / 2 : dir.includes('s') ? -g.h / 2 : 0;
      const d = mappedDelta(g.matrix, x, y);
      return { x: g.cx + d.x, y: g.cy + d.y };
    }
    function keepCenter(el, p, target) {
      const g = elementGeometry(el), d = inverseDelta(g.parent, target.x - g.cx, target.y - g.cy);
      setPos(el, p, p.x + d.x, p.y + d.y);
    }
    function prepareTransform(el, initial, p) {
      if (!initial.inline) return;
      el.style.display = 'inline-block';
      const g = elementGeometry(el), change = normalizedAngle(initial.angle - g.angle);
      if (Math.abs(change) > .0001) el.style.rotate = `${g.individual + change}deg`;
      keepCenter(el, p, { x: initial.cx, y: initial.cy });
    }
    function startResize(e, dir) {
      if (S.selection.length !== 1) return;
      if (isGroup(S.sel)) return startGroupResize(e, dir);
      endText();
      const el = S.sel, b = el.closest('[data-artboard]'), initial = elementGeometry(el);
      if (!initial.supported) return toast('这种变换暂不支持拖动、缩放或旋转');
      const media = el.matches(MEDIA), text = !media && !el.querySelector('[data-el],img,svg,canvas,video,iframe') && !!el.textContent.trim();
      const metrics = text && dir.length === 2 ? textMetrics(el) : null;
      const before = snap(metrics ? metrics.map(m => m.node) : cropImage(el) && el !== cropImage(el) ? [el, cropImage(el)] : [el]);
      const hp = media || el.style.height ? 'height' : 'minHeight';
      const x0 = e.clientX, y0 = e.clientY;
      let g = initial, p = getPos(el), anchor, moved = false;
      S.drag = {
        move(ev) {
          if (!moved) {
            if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
            prepareTransform(el, initial, p);
            g = elementGeometry(el); p = getPos(el); anchor = resizeAnchor(g, dir); moved = true;
          }
          const { x: dx, y: dy } = inverseDelta(g.matrix, ev.clientX - x0, ev.clientY - y0);
          const w0 = g.w, h0 = g.h;
          let w = w0, h = h0;
          if (dir.includes('e')) w += dx;
          if (dir.includes('w')) w -= dx;
          if (dir.includes('s')) h += dy;
          if (dir.includes('n')) h -= dy;
          if (metrics) {
            const sx = dir.includes('w') ? -1 : 1, sy = dir.includes('n') ? -1 : 1;
            const k = Math.max(6 / Math.min(...metrics.map(m => m.font)), 8 / w0, 8 / h0,
              1 + (sx * dx * w0 + sy * dy * h0) / (w0 * w0 + h0 * h0));
            w = w0 * k; h = h0 * k; scaleText(metrics, k);
          } else if (dir.length === 2 && media !== ev.shiftKey) {
            const k = Math.abs(dx) > Math.abs(dy) ? w / w0 : h / h0;
            w = w0 * k; h = h0 * k;
          }
          el.style.boxSizing = 'border-box'; el.style.maxWidth = 'none';
          if (dir !== 'n' && dir !== 's') el.style.width = Math.round(Math.max(8, w) * 1000) / 1000 + 'px';
          if (dir !== 'e' && dir !== 'w') { el.style[hp] = Math.round(Math.max(8, h) * 1000) / 1000 + 'px'; if (el.matches('[data-crop-frame]')) cropImage(el).style.setProperty('height','100%','important'); }
          setPos(el, p, p.x, p.y);
          const now = elementGeometry(el), current = resizeAnchor(now, dir);
          const d = inverseDelta(now.parent, anchor.x - current.x, anchor.y - current.y);
          setPos(el, p, p.x + d.x, p.y + d.y);
          drawSel();
        },
        up() { if (moved) commit(before, b); },
        cancel() { apply(before); drawSel(); },
      };
    }

    function rotationItems() {
      return groupRoots(S.selection).map(node => ({ node, g: elementGeometry(node), p: getPos(node) }));
    }
    function applyRotation(items, center, delta) {
      const rad = delta * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      for (const item of items) {
        const { node, g, p } = item;
        if (!item.ready) {
          prepareTransform(node, g, p);
          item.base = elementGeometry(node); item.position = getPos(node); item.ready = true;
        }
        setPos(node, item.position, item.position.x, item.position.y);
        node.style.rotate = `${Math.round((item.base.individual + delta) * 10000) / 10000}deg`;
        const x = g.cx - center.x, y = g.cy - center.y;
        keepCenter(node, item.position, { x: center.x + cos * x - sin * y, y: center.y + sin * x + cos * y });
      }
    }
    function rotateTo(value) {
      if (!S.sel || isGroup(S.sel) || S.selection.length !== 1 || !S.editing || !persistence?.canEdit() || !Number.isFinite(value)) return;
      endText();
      const items = rotationItems(), g = items[0].g, delta = normalizedAngle(value - g.angle);
      if (!g.supported) return toast('这种变换暂不支持拖动、缩放或旋转');
      if (Math.abs(delta) < .0001) return;
      const before = snap([S.sel]);
      applyRotation(items, { x: g.cx, y: g.cy }, delta);
      commit(before, activeBoard()); drawSel();
    }
    function startRotation(e) {
      if (e.button !== 0 || !S.sel || !S.editing || !persistence?.canEdit()) return;
      endText(); closeMenus();
      const items = rotationItems();
      if (!transformable(S.selection) || items.some(item => !item.g.supported)) return toast('这种变换暂不支持拖动、缩放或旋转');
      const frame=selectionFrame(S.selection,selectionDirection.angle);
      if(!frame)return;
      const center={x:frame.cx,y:frame.cy}, groups=rotationGroups(S.selection).map(node=>({node,angle:groupLocalAngle(node)}));
      const before = snap([...items.map(item => item.node),...groups.map(g=>g.node)]), b = activeBoard();
      const directionBefore={nodes:[...S.selection],angle:selectionDirection.angle};
      let last = Math.atan2(e.clientY - center.y, e.clientX - center.x) * 180 / Math.PI, total = 0, changed = false;
      const operation = {
        rotation: true, delta: 0,
        move(ev) {
          const current = Math.atan2(ev.clientY - center.y, ev.clientX - center.x) * 180 / Math.PI;
          total += normalizedAngle(current - last); last = current;
          const base = frame.angle;
          const delta = snappedAngle(base + total, ev) - base;
          operation.delta = delta;
          if (Math.abs(delta) < .0001 && !changed) return;
          changed = true; applyRotation(items, center, delta);
          groups.forEach(g=>writeGroupAngle(g.node,g.angle+delta));
          if(S.selection.length>1)selectionDirection.angle=directionBefore.angle+delta;
          drawSel();
        },
        up() {
          const delta = operation.delta; operation.rotation = false;
          if (changed && Math.abs(normalizedAngle(delta)) > .01) commit(before, b, directionBefore);
          else if (changed) { apply(before); restoreDirection(directionBefore); }
          drawSel();
        },
        cancel() { operation.rotation = false; apply(before); restoreDirection(directionBefore); drawSel(); },
      };
      S.drag = operation;
    }
    function positionRotation() {
      if (crop.active) { $('.rotate-handle').hidden = true; $('.rotation-feedback').hidden = true; return; }
      const button = $('.rotate-handle'), feedback = $('.rotation-feedback');
      const show = S.editing && !S.playing && !S.text && S.sel && transformable(S.selection);
      button.hidden = !show; feedback.hidden = !show || !S.drag?.rotation;
      if (!show) return;
      const frame=selectionFrame(S.selection,selectionDirection.angle), g = S.selection.length === 1 && !isGroup(S.sel) ? elementGeometry(S.sel) : null;
      if(!frame){button.hidden=true;feedback.hidden=true;return;}
      const rad = frame.angle * Math.PI / 180;
      const x = frame.cx + Math.sin(rad) * (frame.height / 2 + 26);
      const y = frame.cy - Math.cos(rad) * (frame.height / 2 + 26);
      const v = viewport.bounds(), left = Math.max(v.x + 15, Math.min(v.x + v.w - 15, x)), top = Math.max(v.y + 15, Math.min(v.y + v.h - 15, y));
      Object.assign(button.style, { left: `${left}px`, top: `${top}px` });
      const degrees = Math.round((g ? g.angle : S.drag?.delta || 0) * 10) / 10;
      feedback.textContent = `${!g && degrees > 0 ? '+' : ''}${degrees}°`;
      Object.assign(feedback.style, { left: `${Math.min(v.x + v.w - 62, left + 20)}px`, top: `${Math.max(v.y + 5, top - 13)}px` });
      if (ui.activeElement !== $('.rotation-angle') && g) $('.rotation-angle').value = degrees;
    }
    function nudge(el, k, n) {
      crop.finish();
      const nodes = S.selection.includes(el)
        ? groupRoots(S.selection)
        : groupRoots([el]);
      const dx = k === "arrowleft" ? -n : k === "arrowright" ? n : 0,
        dy = k === "arrowup" ? -n : k === "arrowdown" ? n : 0;
      if (!transformable(S.selection.includes(el) ? S.selection : [el]) || nodes.some(node => !elementGeometry(node).supported)) return toast('这种变换暂不支持拖动、缩放或旋转');
      record(
        nodes,
        () =>
          nodes.forEach((node) => {
            const initial = elementGeometry(node); prepareTransform(node, initial, getPos(node));
            const p = getPos(node), g = elementGeometry(node), s = scaleOf(node.closest('[data-artboard]'));
            const d = inverseDelta(g.parent, dx * s, dy * s);
            setPos(node, p, p.x + d.x, p.y + d.y);
          }),
        el.closest("[data-artboard]"),
      );
      drawSel();
    }
    function duplicate(el) {
      if (isGroup(el) && !transformable([el])) return toast('这种组合暂不支持复制位移，已保留原样');
      crop.finish();
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
        if (isGroup(copy)) groupRoots([copy]).forEach(member => { const p = getPos(member), g = elementGeometry(member), d = inverseDelta(g.parent, 16 * scaleOf(b), 16 * scaleOf(b)); setPos(member, p, p.x+d.x, p.y+d.y); });
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
      crop.finish();
      S.replace = cropImage(img);
      fileIn.click();
    }
    fileIn.addEventListener("change", () => {
      const files = [...fileIn.files].filter((f) =>
          f.type.startsWith("image/"),
        ),
        target = S.replace;
      fileIn.value = "";
      S.replace = null;
      if (target) files[0] && readFile(files[0], src => {
        const probe = new Image();
        probe.onload = () => {
          if (!persistence?.canEdit() || !S.editing || !target.isConnected) return;
          record([target], () => { target.src = src; target.removeAttribute('srcset');
            if (target.hasAttribute('data-crop-image')) { target.style.setProperty('--crop-zoom','1'); target.style.setProperty('--crop-x','50%'); target.style.setProperty('--crop-y','50%'); target.style.setProperty('object-fit','cover','important'); }
          }, target.closest('[data-artboard]')); drawSel();
        };
        probe.onerror = () => toast('图片无法读取，已保留原图'); probe.src = src;
      });
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
        show = S.editing && !S.playing && !crop.active && el?.isConnected && visible(el);
      tbar.hidden = !show;
      if (!show) {
        $("[data-menu=text-layout]").hidden = true;
        $('[data-menu=rotation]').hidden = true;
        $('[data-act=rotation]').setAttribute('aria-expanded', 'false');
        ++layoutRequest;
        return;
      }
      const multi = S.selection.length > 1 || isGroup(el);
      ui.querySelectorAll("[data-act=group]").forEach(n => { n.hidden = S.selection.length < 2; n.disabled = !!groupProblem(S.selection); n.title = groupProblem(S.selection) || n.getAttribute("aria-label"); });
      ui.querySelectorAll("[data-act=ungroup],[data-act=group-enter]").forEach(n => { n.hidden = !isGroup(el) || S.selection.length !== 1; });
      ui.querySelectorAll("[data-act=group-exit]").forEach(n => { n.hidden = !S.group; });
      const supported = transformable(S.selection);
      $('[data-act=rotation]').disabled = !supported;
      $('.rotation-single').hidden = multi;
      $('.rotation-multiple').hidden = !multi;
      if (!supported) $('[data-menu=rotation]').hidden = true;
      $(".selection-count").hidden = !multi;
      $(".selection-count").textContent = multi
        ? isGroup(el) && S.selection.length === 1 ? `组合 · ${groupRoots([el]).length} 个对象` : `已选 ${S.selection.length} 个元素`
        : "";
      const image = !multi && !!cropImage(el),
        text =
          !multi &&
          !el.matches(MEDIA) &&
          !el.querySelector("[data-el]") &&
          !!el.textContent.trim();
      $(".text-tools").hidden = !text;
      $(".more-text-section").hidden = !text;
      $(".image-tools").hidden = !image;
      if (image) {
        const fit = getComputedStyle(cropImage(el)).objectFit;
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
    $('.rotation-angle').addEventListener('change', e => rotateTo(e.target.valueAsNumber));
    $('.rotation-angle').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.value = Math.round(elementGeometry(S.sel).angle * 10) / 10; e.target.blur(); positionRotation(); closeMenus(); $('[data-act=rotation]').focus(); }
    });
    $('.rotate-handle').addEventListener('pointerdown', e => { e.preventDefault(); startRotation(e); });
    $('.rotate-handle').addEventListener('keydown', e => {
      if (['ArrowLeft', 'ArrowRight'].includes(e.key) && S.selection.length === 1 && !isGroup(S.sel)) {
        e.preventDefault(); rotateTo(elementGeometry(S.sel).angle + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 15 : 1));
      } else if (['Enter', ' '].includes(e.key)) { e.preventDefault(); ACTS.rotation($('[data-act=rotation]')); }
    });

    function openHelp() {
      endText(); closeMenus();
      if (S.drag?.cancel) { S.drag.cancel(); S.drag=null; }
      helpDialog.hidden=false;
      $('[data-act=help-close]').focus();
    }
    function closeHelp() {
      helpDialog.hidden=true;
      $('[data-act=more]').focus();
    }
    addEventListener('compositionstart', () => { S.composing=true; }, true);
    addEventListener('compositionend', () => { S.composing=false; }, true);

    /* ---------- 事件 1：快捷键（最先注册） ---------- */
    addEventListener(
      "keydown",
      (e) => {
        if (e.isComposing || e.keyCode===229 || S.composing) { if(S.editing || fromUI(e))e.stopImmediatePropagation(); return; }
        if (pages.sizeKey(e)) return;
        if (!helpDialog.hidden) {
          if(e.key==='Escape') { e.preventDefault(); closeHelp(); }
          else if(e.key==='Tab') {
            const controls=[$('[data-act=help-close]'),$('.help-content')], first=controls[0], last=controls.at(-1);
            if(e.shiftKey && (ui.activeElement===first || !helpDialog.contains(ui.activeElement))) { e.preventDefault(); last.focus(); }
            else if(!e.shiftKey && (ui.activeElement===last || !helpDialog.contains(ui.activeElement))) { e.preventDefault(); first.focus(); }
          }
          e.stopImmediatePropagation(); return;
        }
        if (reviewUI?.key(e)) return;
        if (fromUI(e) && ui.activeElement?.matches('.rotate-handle') && ['ArrowLeft','ArrowRight','Enter',' '].includes(e.key)) return;
        if (S.playing) return;
        if (crop.active && (e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopImmediatePropagation(); if(canMutate())ui.activeElement?.blur(); runAction(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo'); return; }
        if (crop.active && e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if(canMutate())ui.activeElement?.blur(); runAction('crop-done'); return; }
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
        if (crop.active && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); runAction('crop-cancel'); return; }
        if (e.key === "Escape" && S.drag?.cancel) {
          S.drag.cancel();
          S.drag = null;
          e.preventDefault();
          return;
        }
        const controlKey = e.ctrlKey || e.metaKey,
          localShortcut = controlKey && ['g','a'].includes(e.key.toLowerCase()),
          zoomKey =
            controlKey && ["=", "+", "-", "_", "0", "1"].includes(e.key);
        if (
          e
            .composedPath()
            .some(
              (n) =>
                n instanceof Element &&
                n.matches("input,textarea,select,[contenteditable]:not([contenteditable=false])"),
            ) &&
          !zoomKey &&
          !(e.key==="Escape" && S.text && e.composedPath().includes(S.text.el)) &&
          !(controlKey && e.key.toLowerCase() === "s")
        )
          return;
        if (!modal.hidden && !zoomKey && !(controlKey && e.key.toLowerCase()==='s') && e.key!=='Escape') return;
        if (localShortcut && (crop.active || !modal.hidden || ui.querySelector('[data-menu]:not([hidden])') || ui.activeElement?.closest('.thumb'))) return;
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
        const writable = canMutate();
        const can = writable && !typing && el;
        if (k === "escape") {
          if (ui.querySelector("[data-menu]:not([hidden])")) closeMenus();
          else if (!modal.hidden) {
            modal.hidden = true;
            focusedBeforeModal?.focus();
          } else if (typing) endText();
          else if (S.group) exitGroup();
          else if (el) select(null);
          else if (S.editing) {
            setEditing(false);
            persistence?.flush().catch(() => {});
          } else closeMenus();
        } else if (mod && !e.altKey && k==='g' && writable && !typing) runAction(e.shiftKey?'ungroup':'group');
        else if (mod && !e.altKey && k==='a' && writable && !typing) runAction('select-all');
        else if (mod && k === "z" && writable && !typing) runAction(e.shiftKey ? 'redo' : 'undo');
        else if (mod && k === "y" && writable && !typing) runAction('redo');
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
          const next = directionTarget(S.selection, S.current, e.key, S.group);
          if (next) select([...S.selection, next]);
        } else if (mod && k === "d" && can) runAction("element-duplicate");
        else if ((k === "delete" || k === "backspace") && can) runAction("element-delete");
        else if (k === "enter" && can && S.selection.length === 1)
          isGroup(el) ? enterGroup(el) : cropImage(el) ? crop.start(el) : startText(el);
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
      S.composing=false;
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
        const raw = e.target.closest("[data-el]");
        if (S.group && raw && !S.group.contains(raw)) S.group = null;
        const el = logicalTarget(raw, S.group);
        if (!el) {
          startMarquee(e);
          return;
        }
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          toggleSelection(el);
          return;
        }
        if (!S.selection.includes(el)) select(el);
        if (e.button === 0) { if (crop.active && crop.owns(el)) crop.gesture(e); else startDrag(e, el); }
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
            const el = logicalTarget(e.target, S.group);
            if (el) {
              if (!S.selection.includes(el)) select(el);
              openMenu("element", null, { x: e.clientX, y: e.clientY });
            }
          }
          if (type === "dblclick" && !editable) {
            if (e.shiftKey || e.ctrlKey || e.metaKey) return;
            const el = logicalTarget(e.target, S.group);
            if (isGroup(el)) { enterGroup(el, e.target); return; }
            if (el) select(el);
            cropImage(el)
              ? crop.start(el)
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
        if (crop.active) crop.gesture(e, h.dataset.h); else startResize(e, h.dataset.h);
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
    function imageFit(value) { crop.finish(); crop.reset(S.sel, value); }
    function layer(front) {
      const el = S.sel;
      if (!el) return;
      const board = el.closest("[data-artboard]");
      const plans = groupRoots(S.selection).map((n) =>
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
      undo: () => history(-1),
      redo: () => history(1),
      "page-add": () => pages.add(),
      "page-copy": () => pages.copy(),
      "page-delete": () => pages.remove(),
      "page-rename": () => pages.rename(),
      "page-size": () => pages.openSize(),
      "page-up": () => pages.moveStep(-1),
      "page-down": () => pages.moveStep(1),
      "image-replace": () => pickReplace(S.sel),
      "image-crop": () => { endText(); crop.start(S.sel); },
      "crop-done": () => crop.finish(),
      "crop-cancel": () => crop.finish(true),
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
      "select-all": () => select(S.current ? selectable(S.current,S.group) : []),
      group: groupSelection,
      ungroup: ungroupSelection,
      "group-enter": () => enterGroup(S.sel),
      "group-exit": exitGroup,
      "element-duplicate": () => S.sel && duplicate(S.sel),
      "element-delete": () => S.sel && removeEl(S.sel),
      "element-front": () => layer(true),
      "element-back": () => layer(false),
      source: openSource,
      export: (btn) => openMenu("export", btn),
      more: (btn) => openMenu("more", btn),
      status: (btn) => openMenu("status", btn),
      "element-more": (btn) => openMenu("element", btn),
      rotation: btn => {
        openMenu('rotation', btn);
        if (!$('[data-menu=rotation]').hidden && S.selection.length === 1 && !isGroup(S.sel)) { $('.rotation-angle').focus(); $('.rotation-angle').select(); }
      },
      'rotation-reset': () => rotateTo(0),
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
      help: openHelp,
      "help-close": closeHelp,
    };
    const mutations = new Set([
      "flow",
      "artboard",
      "add-text",
      "add-image",
      "undo",
      "redo",
      "src-apply",
      "image-replace",
      "image-fit",
      "image-cover",
      "image-crop", "crop-done", "crop-cancel",
      "text-height",
      "text-fit",
      "text-align",
      "group", "ungroup", "group-enter", "group-exit", "select-all",
      "element-duplicate",
      "element-delete",
      "element-front",
      "element-back",
      'rotation-reset',
    ]);
    function canMutate() { return S.editing && !S.playing && !!persistence?.canEdit(); }
    function runAction(act, btn) {
      if (mutations.has(act) && !canMutate()) return false;
      if (act==='group' && groupProblem(selectionRoots(S.selection))) return false;
      if (act==='ungroup' && (S.selection.length!==1 || !isGroup(S.sel))) return false;
      if (crop.active && !["crop-done", "crop-cancel", "undo", "redo", "image-crop", "zoom-in", "zoom-out", "zoom-reset", "zoom-fit"].includes(act)) crop.finish();
      ACTS[act]?.(btn);
      return true;
    }
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
        !["preview", "export", "more", "status", "element-more", "text-layout", "rotation"].includes(act)
      )
        closeMenus();
      runAction(act, btn);
    });
    ui.addEventListener("keydown", (e) => {
      if (e.target.matches('.rotation-angle')) return;
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
      S.group = null;
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
      if (S.current !== (b || null)) { S.reviewContext++; S.group = null; }
      S.current = b || null;
      boards().forEach((x) =>
        x.toggleAttribute("data-editor-current", x === b),
      );
    }
    function goTo(b) {
      const list = boards(),
        i = list.indexOf(b);
      crop.finish(); endText();
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
            const r = objectRect(el);
            const v = [r.left - o.x, r.top - o.y, r.width, r.height]
              .map((n) => Math.round(n / o.s))
              .join(",");
            if (el.dataset.bbox !== v) el.dataset.bbox = v;
          });
        }),
      );
    }
    function serialize(finish = true) {
      if (finish) { crop.finish(); endText(); }
      measure();
      const doc = root.cloneNode(true);
      if (!finish) crop.cleanClone(doc);
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
      crop.finish(); endText();
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
      if (S.changed || crop.active || sourcePending() || pages.hasPendingDraft()) {
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
      isBusy: () => !!S.drag || crop.active || sourcePending(),
      hasPendingSource: () => sourcePending() || pages.hasPendingDraft(),
      pause() {
        if (sourcePending() || pages.hasPendingDraft()) return false;
        if (S.drag) {
          const drag = S.drag; S.drag = null;
          if (drag.kind === "page") drag.cancel(); else drag.up();
        }
        setEditing(false);
        return true;
      },
      reload: reloadLatest,
      historyBoundary() { S.group = null; S.undo = []; S.redo = []; select(null); syncBar(); },
      prepareReview(kind) {
        if (sourcePending() || (pages.hasPendingDraft() && kind !== "rename")) return false;
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
