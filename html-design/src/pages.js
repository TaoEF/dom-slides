import { artboardSize, setArtboardSize } from "./artboard-size.js";
import { icon } from "./icons.js";
import { rekeyDOMIds } from "./identifiers.js";
export function createPages({
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
  writable,
  submit,
  openMenu,
  closeMenus,
}) {
  const listUI = ui.querySelector(".thumb-list"),
    thumbs = new Map(),
    sizes = new WeakMap();
  let renameDraft = null, sizeDraft = null;
  let menuBoard,
    suppressClick = false,
    lastSize = { w: 1280, h: 720 },
    nextPage = Math.max(
      Number(stage.dataset.pageSeq) || 0,
      ...boards().map(
        (b) => Number(b.dataset.artboard?.match(/^p(\d+)$/)?.[1]) || 0,
      ),
    );
  const thumbWidth = () => {
    const cs = getComputedStyle(listUI);
    return listUI.clientWidth ? Math.max(80, listUI.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) : 146;
  };
  function sizeOf(b) {
    return withAll(() => {
      if (visible(b)) {
        const v = {
          w: b.offsetWidth || 1280,
          h: b.offsetHeight || 720,
          display: getComputedStyle(b).display,
        };
        sizes.set(b, v);
        lastSize = v;
        return v;
      }
      return sizes.get(b) || { ...lastSize, display: "block" };
    });
  }
  const fixCSS = ({ w, h, display }) =>
    `html,body{margin:0!important;padding:0!important;overflow:hidden!important;width:${w}px!important;height:${h}px!important;min-height:0!important}[data-thumb-chain]{display:block!important;position:static!important;transform:none!important;translate:none!important;scale:none!important;margin:0!important;padding:0!important;border:0!important;width:${w}px!important;height:${h}px!important;min-height:0!important;overflow:hidden!important}[data-thumb-target]{display:${display}!important;position:relative!important;inset:auto!important;margin:0!important;transform:none!important;translate:none!important;scale:none!important;opacity:1!important;visibility:visible!important;flex:none!important;width:${w}px!important;height:${h}px!important;box-sizing:border-box!important}*,*::before,*::after{animation:none!important;transition:none!important}`;
  function snapshot(b) {
    const c = b.cloneNode(true);
    c.querySelectorAll("script").forEach((n) => n.remove());
    c.querySelectorAll("[contenteditable]").forEach((n) =>
      n.removeAttribute("contenteditable"),
    );
    c.querySelectorAll("video[autoplay],audio[autoplay]").forEach((n) =>
      n.removeAttribute("autoplay"),
    );
    c.removeAttribute("data-editor-current");
    c.setAttribute("data-thumb-target", "");
    return c;
  }
  const contentCSS = () =>
    [...document.querySelectorAll('style,link[rel~="stylesheet"]')]
      .filter(
        (n) =>
          !n.matches("[data-editor-style]") && !n.closest("[data-artboard]"),
      )
      .map((n) => n.outerHTML)
      .join("");
  function shellHTML(b) {
    let inner = snapshot(b).outerHTML;
    for (
      let p = b.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      const c = p.cloneNode(false);
      c.setAttribute("data-thumb-chain", "");
      c.innerHTML = inner;
      inner = c.outerHTML;
    }
    const body = document.body.cloneNode(false);
    body.innerHTML = inner;
    const attrs = [...root.attributes]
      .filter((a) => !/^data-edit/.test(a.name))
      .map((a) => `${a.name}="${esc(a.value)}"`)
      .join(" ");
    return `<!DOCTYPE html><html ${attrs}><head><meta charset="utf-8"><base href="${esc(location.href)}">${contentCSS()}<style id="thumb-fix">${fixCSS(sizeOf(b))}</style></head>${body.outerHTML}</html>`;
  }
  function layout(b) {
    const t = thumbs.get(b),
      sz = sizeOf(b),
      w = thumbWidth();
    if (!t) return;
    t.frame.style.width = `${w}px`;
    t.frame.style.height = `${Math.round((sz.h * w) / sz.w)}px`;
    Object.assign(t.ifr.style, {
      width: `${sz.w}px`,
      height: `${sz.h}px`,
      transform: `scale(${w / sz.w})`,
    });
    return sz;
  }
  function paint(b) {
    const t = thumbs.get(b);
    if (!t) return;
    if (!t.ready) {
      t.pending = true;
      return;
    }
    const sz = layout(b);
    let d;
    try {
      d = t.ifr.contentDocument;
    } catch {}
    const old = d?.querySelector("[data-thumb-target]");
    if (!old) {
      t.ready = false;
      t.ifr.srcdoc = shellHTML(b);
      return;
    }
    d.getElementById("thumb-fix").textContent = fixCSS(sz);
    old.replaceWith(d.importNode(snapshot(b), true));
    t.label.textContent = `${boards().indexOf(b) + 1}. ${b.dataset.title || b.dataset.artboard}`;
  }
  function build() {
    const all = boards();
    for (const [b, t] of thumbs)
      if (!all.includes(b)) {
        t.remove();
        thumbs.delete(b);
      }
    listUI.querySelector(".empty-list")?.remove();
    if (!all.length) {
      const e = document.createElement("p");
      e.className = "empty-list";
      e.textContent = "还没有页面，点击上方 ＋ 开始。";
      listUI.append(e);
    }
    all.forEach((b, i) => {
      let t = thumbs.get(b);
      if (!t) {
        t = document.createElement("div");
        t.className = "thumb";
        t.setAttribute("role", "listitem");
        t.dataset.pageId = b.dataset.artboard;
        t.innerHTML = `<div class="thumb-main" role="button" tabindex="0"><div class="frame"><iframe sandbox="allow-same-origin" tabindex="-1" aria-hidden="true" title="页面缩略图"></iframe></div><div class="label"></div></div><button class="thumb-more" title="页面操作" aria-label="页面操作" aria-haspopup="menu">${icon("Ellipsis")}</button>`;
        t.frame = t.querySelector(".frame");
        t.ifr = t.querySelector("iframe");
        t.label = t.querySelector(".label");
        t.ifr.onload = () => {
          t.ready = true;
          if (t.pending) {
            t.pending = false;
            paint(b);
          }
        };
        t.querySelector(".thumb-main").onclick = () => {
          if (suppressClick) {
            suppressClick = false;
            return;
          }
          closeMenus();
          select(null);
          goTo(b);
        };
        t.querySelector(".thumb-more").onclick = (e) => {
          e.stopPropagation();
          menuBoard = b;
          select(null);
          goTo(b);
          showPageMenu(e.currentTarget);
        };
        t.oncontextmenu = (e) => {
          e.preventDefault();
          menuBoard = b;
          select(null);
          goTo(b);
          showPageMenu(null, { x: e.clientX, y: e.clientY });
        };
        t.label.ondblclick = (e) => {
          e.stopPropagation();
          rename(b);
        };
        t.querySelector(".thumb-main").addEventListener("pointerdown", (e) =>
          startReorder(e, b),
        );
        thumbs.set(b, t);
        layout(b);
        t.ifr.srcdoc = shellHTML(b);
      }
      t.label.textContent = `${i + 1}. ${b.dataset.title || b.dataset.artboard}`;
      t.querySelector(".thumb-main").setAttribute(
        "aria-label",
        `第 ${i + 1} 页：${b.dataset.title || b.dataset.artboard}`,
      );
      if (listUI.children[i] !== t)
        listUI.insertBefore(t, listUI.children[i] || null);
      layout(b);
    });
    markActive();
  }
  function markActive() {
    thumbs.forEach((t, b) => {
      const on = b === S.current;
      t.classList.toggle("active", on);
      t.querySelector(".thumb-main").setAttribute(
        "aria-current",
        on ? "page" : "false",
      );
      if (
        on &&
        (t.offsetTop < listUI.scrollTop ||
          t.offsetTop + t.offsetHeight > listUI.scrollTop + listUI.clientHeight)
      )
        t.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
  }
  function showPageMenu(anchor, point) {
    const index = boards().indexOf(target());
    ui.querySelector("[data-act=page-up]").disabled = !writable() || index <= 0;
    ui.querySelector("[data-act=page-down]").disabled =
      !writable() || index >= boards().length - 1;
    openMenu("page", anchor, point);
  }
  function refresh(preferred) {
    build();
    goTo(preferred?.isConnected ? preferred : boards()[0]);
  }
  function transaction(redo, undo, preferred) {
    endText();
    select(null);
    const previous = S.current;
    redo();
    refresh(preferred);
    push({
      undo() {
        undo();
        refresh(previous);
      },
      redo() {
        redo();
        refresh(preferred);
      },
    });
  }
  function allocatePage() {
    nextPage = Math.max(nextPage, Number(stage.dataset.pageSeq) || 0) + 1;
    stage.dataset.pageSeq = nextPage;
    return `p${nextPage}`;
  }
  function target() {
    return menuBoard?.isConnected ? menuBoard : S.current;
  }
  function add(ref) {
    const
      sz = ref ? sizeOf(ref) : lastSize,
      b = document.createElement("section");
    b.dataset.artboard = allocatePage();
    b.dataset.title = "未命名页面";
    b.dataset.mode = "flow";
    b.className = "page";
    Object.assign(b.style, {
      width: `${sz.w}px`,
      height: `${sz.h}px`,
      boxSizing: "border-box",
      position: "relative",
      overflow: "hidden",
      padding: "64px",
      background: "var(--bg, #fff)",
      flexShrink: "0",
    });
    transaction(
      () => (ref?.isConnected ? ref.after(b) : stage.append(b)),
      () => b.remove(),
      b,
    );
    menuBoard = null;
  }
  function copy(b) {
    if (!b) return;
    const c = b.cloneNode(true),
      id = allocatePage(),
      old = b.dataset.artboard;
    c.dataset.artboard = id;
    // ID/nth-child-dependent CSS may change when copied; retain source size.
    const copiedSize = sizeOf(b);
    const sourceCS = getComputedStyle(b);
    c.style.setProperty('width', sourceCS.width, b.style.getPropertyPriority('width'));
    c.style.setProperty('height', sourceCS.height, b.style.getPropertyPriority('height'));
    c.dataset.title = `${b.dataset.title || old} 副本`;
    c.removeAttribute("data-editor-current");
    [c, ...c.querySelectorAll("[contenteditable]")].forEach((n) =>
      n.removeAttribute("contenteditable"),
    );
    const used = new Set();
    c.querySelectorAll("[data-el]").forEach((el, i) => {
      let name = `${id}-${el.dataset.el?.startsWith(old + "-") ? el.dataset.el.slice(old.length + 1) : `element-${i + 1}`}`;
      if (used.has(name)) name = `${id}-element-${i + 1}`;
      used.add(name);
      el.dataset.el = name;
      el.removeAttribute("data-bbox");
    });
    rekeyDOMIds(c, id);
    transaction(
      () => {
        b.after(c);
        try {
          withAll(() => { if (c.offsetWidth !== copiedSize.w || c.offsetHeight !== copiedSize.h) setArtboardSize(c, copiedSize.w, copiedSize.h); });
        } catch (error) { c.remove(); throw error; }
      },
      () => c.remove(),
      c,
    );
    menuBoard = null;
  }
  function remove(b) {
    if (!b) return;
    lastSize = sizeOf(b);
    const parent = b.parentNode,
      next = b.nextSibling,
      all = boards(),
      i = all.indexOf(b),
      preferred = all[i + 1] || all[i - 1];
    transaction(
      () => b.remove(),
      () => parent.insertBefore(b, next?.parentNode === parent ? next : null),
      preferred,
    );
    menuBoard = null;
  }
  function move(b, before) {
    if (!b || b === before || b.nextElementSibling === before)
      return;
    const parent = b.parentNode,
      next = b.nextSibling;
    transaction(
      () => stage.insertBefore(b, before || null),
      () => parent.insertBefore(b, next?.parentNode === parent ? next : null),
      b,
    );
    menuBoard = null;
  }
  function execute(nodes, apply, valid = () => true, rename = false) {
    if (!writable()) return Promise.reject(new Error('当前暂不可操作，请等待同步或 AI 修改结束'));
    const ids = nodes.map(n => n?.dataset.artboard || null), find = id => id ? boards().find(b => b.dataset.artboard === id) : null;
    return submit(() => apply(...ids.map(find)), () => valid() && ids.every(id => !id || !!find(id)), rename);
  }
  const action = (fn, b = target()) => execute([b], node => fn(node)).catch(() => {});
  function moveStep(dir) {
    const b = target(), a = boards(), i = a.indexOf(b), j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    execute([b, dir < 0 ? a[j] : a[j + 1] || null], move).catch(() => {});
  }
  function rename(b = target()) {
    if (!b || !writable() || renameDraft) return;
    closeMenus(); goTo(b);
    const t = thumbs.get(b); if (!t) return;
    const input = document.createElement('input'); input.className = 'rename-input'; input.value = b.dataset.title || ''; input.setAttribute('aria-label', '页面名称');
    const before = b.dataset.title || '', label = t.label;
    const draft = { input }; renameDraft = draft;
    label.hidden = true; t.append(input); input.focus(); input.select();
    let done = false, committing = false;
    function cleanup() { done = true; if (renameDraft === draft) renameDraft = null; input.remove(); label.hidden = false; t.querySelector('.thumb-main')?.focus(); }
    async function finish(apply) {
      if (done) return;
      if (!apply) { cleanup(); return; }
      if (committing) return;
      const after = input.value.trim() || '未命名页面';
      if (after === before) { cleanup(); return; }
      committing = true; input.readOnly = true;
      try {
        await execute([b], target => {
          transaction(() => { target.dataset.title = after; }, () => { target.dataset.title = before; }, target);
          cleanup();
        }, () => !done, true);
      } catch { if (!done) { committing = false; input.readOnly = false; input.focus(); } }
    }
    input.onblur = () => finish(true);
    input.onkeydown = e => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(e.key === 'Enter'); }
    };
  }
  const sizeDialog = ui.querySelector('.page-size-dialog'), sizeForm = sizeDialog.querySelector('form');
  const sizeField = name => sizeForm.elements.namedItem(name);
  function closeSize() {
    if (sizeDraft?.busy) return;
    sizeDraft = null; sizeDialog.hidden = true;
    const focus = thumbs.get(S.current)?.querySelector('.thumb-more') || ui.querySelector('[data-act=page-add]');
    focus?.focus();
  }
  function openSize() {
    const b = target(); if (!b || !writable() || renameDraft || sizeDraft) return;
    endText(); select(null); closeMenus(); goTo(b);
    const value = artboardSize(b);
    sizeDraft = { board: b, style: b.getAttribute('style'), busy: false };
    sizeField('width').value = value.width; sizeField('height').value = value.height;
    ui.querySelector('.size-preset').value = 'custom';
    ui.querySelector('.size-page').textContent = b.dataset.title || b.dataset.artboard;
    ui.querySelector('.size-error').hidden = true;
    sizeDialog.hidden = false; sizeField('width').focus(); sizeField('width').select();
  }
  sizeDialog.querySelector('.size-close').onclick = closeSize;
  sizeDialog.querySelector('.size-cancel').onclick = closeSize;
  ui.querySelector('.size-preset').onchange = e => {
    if (e.target.value === 'custom') return;
    const [w,h] = e.target.value.split(','); sizeField('width').value=w; sizeField('height').value=h;
  };
  sizeForm.oninput = e => { ui.querySelector('.size-error').hidden = true; if (e.target.matches('input')) ui.querySelector('.size-preset').value = 'custom'; };
  sizeForm.onsubmit = async e => {
    e.preventDefault(); const draft = sizeDraft; if (!draft || draft.busy) return;
    const w = sizeField('width').valueAsNumber, h = sizeField('height').valueAsNumber;
    draft.busy = true; sizeForm.querySelector('[type=submit]').disabled = true;
    try {
      await execute([draft.board], b => {
        const current = artboardSize(b);
        if (current.width === w && current.height === h) return;
        const change = setArtboardSize(b,w,h);
        const write = value => value === null ? b.removeAttribute('style') : b.setAttribute('style', value);
        transaction(() => write(change.after), () => write(change.before), b);
      }, () => sizeDraft === draft && draft.board.isConnected && draft.board.getAttribute('style') === draft.style, true);
      draft.busy = false; closeSize();
    } catch (error) {
      draft.busy = false;
      const message = ui.querySelector('.size-error'); message.textContent=error.message; message.hidden=false;
    } finally { sizeForm.querySelector('[type=submit]').disabled = false; }
  };
  function sizeKey(e) {
    if (sizeDialog.hidden) return false;
    if (e.key === 'Escape') { e.preventDefault(); closeSize(); }
    if (e.key === 'Tab') {
      const controls = [...sizeDialog.querySelectorAll('button,input,select')].filter(n=>!n.disabled);
      const first=controls[0],last=controls.at(-1);
      if (e.shiftKey && (ui.activeElement===first || !sizeDialog.contains(ui.activeElement))) {e.preventDefault();last.focus();}
      if (!e.shiftKey && (ui.activeElement===last || !sizeDialog.contains(ui.activeElement))) {e.preventDefault();first.focus();}
    }
    e.stopImmediatePropagation(); return true;
  }
  function startReorder(e, b) {
    if (e.button !== 0 || !writable() || e.detail > 1) return;
    menuBoard = null;
    const x = e.clientX,
      y = e.clientY;
    let moved = false,
      before = null,
      lastY = y,
      raf;
    const clear = () =>
      thumbs.forEach((t) => t.classList.remove("drop-before", "drop-after"));
    function indicator() {
      clear();
      const others = boards().filter((n) => n !== b);
      before =
        others.find((n) => {
          const r = thumbs.get(n).getBoundingClientRect();
          return lastY < r.top + r.height / 2;
        }) || null;
      if (before) thumbs.get(before).classList.add("drop-before");
      else if (others.length)
        thumbs.get(others.at(-1)).classList.add("drop-after");
    }
    function scroll() {
      if (!moved) return;
      const r = listUI.getBoundingClientRect(),
        delta = lastY < r.top + 32 ? -9 : lastY > r.bottom - 32 ? 9 : 0;
      if (delta) {
        listUI.scrollTop += delta;
        indicator();
      }
      raf = requestAnimationFrame(scroll);
    }
    S.drag = {
      kind: "page",
      move(ev) {
        lastY = ev.clientY;
        if (!moved && Math.hypot(ev.clientX - x, ev.clientY - y) < 6) return;
        if (!moved) {
          moved = true;
          thumbs.get(b).classList.add("dragging");
          scroll();
        }
        indicator();
      },
      up(ev) {
        cancelAnimationFrame(raf);
        clear();
        thumbs.get(b)?.classList.remove("dragging");
        if (moved) {
          suppressClick = true;
          setTimeout(() => {
            suppressClick = false;
          }, 0);
          if (ev?.type !== "pointercancel") {
            // Finish the gesture before admission can pause it; the DOM stays untouched until lease grant.
            S.drag = null;
            execute([b, before], move).catch(() => {});
          }
        }
      },
      cancel() {
        cancelAnimationFrame(raf);
        moved = false;
        clear();
        thumbs.get(b)?.classList.remove("dragging");
      },
    };
  }
  function key(e) {
    const active = ui.activeElement?.closest(".thumb");
    if (!active || ui.activeElement.matches("input")) return false;
    const b = boards().find(
        (b) => b.dataset.artboard === active.dataset.pageId,
      ),
      index = boards().indexOf(b),
      mod = e.ctrlKey || e.metaKey;
    menuBoard = b;
    if (e.key === "F2") rename(b);
    else if (mod && e.key.toLowerCase() === "d") action(copy);
    else if (["Delete", "Backspace"].includes(e.key)) action(remove);
    else if (e.altKey && e.key === "ArrowUp") moveStep(-1);
    else if (e.altKey && e.key === "ArrowDown") moveStep(1);
    else if (["ArrowUp", "ArrowDown"].includes(e.key)) {
      const next =
        boards()[
          Math.max(
            0,
            Math.min(
              boards().length - 1,
              index + (e.key === "ArrowUp" ? -1 : 1),
            ),
          )
        ];
      select(null);
      goTo(next);
      thumbs.get(next)?.querySelector(".thumb-main").focus();
    } else if (e.key === "Enter" || e.key === " ") {
      select(null);
      goTo(b);
    } else return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  return {
    sizeOf,
    paint,
    build,
    markActive,
    add: () => action(add),
    copy: () => action(copy),
    remove: () => action(remove),
    moveStep,
    rename,
    key,
    openSize, sizeKey,
    hasPendingDraft: () => !!renameDraft || !!sizeDraft,
    clearTarget() {
      menuBoard = null;
    },
  };
}
