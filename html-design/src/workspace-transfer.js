import { elementGeometry } from "./geometry.js";
import { isGroup, groupRoots, stableGroupMarkup } from "./groups.js";
import { selectionRoots, unionRect } from "./selection.js";
import { selectionFrame, writeGroupAngle } from "./oriented-selection.js";
import { rekeyDOMIds } from "./identifiers.js";

const CLIPBOARD_TYPE = "application/x-dom-slides-objects+json";
const CLIPBOARD_LIMIT = 4 * 1024 * 1024;

// Transient clipboard/gesture snapshots, never a second document model.
export function createWorkspaceTransfer({
  S,
  stage,
  ui,
  viewport,
  snap,
  apply,
  push,
  select,
  activate,
  elementId,
  canEdit,
  toast,
}) {
  const enabled = stage.hasAttribute("data-workspace-prototype");
  let ghost = null;
  const all = (roots) => [
    ...new Set(roots.flatMap((n) => [n, ...n.querySelectorAll("*")])),
  ];
  const ignored =
    /^(cursor|user-select|-webkit-user-select|caret-color|pointer-events|animation.*|transition.*)$/;
  function capture(roots) {
    roots = selectionRoots(roots);
    if (!roots.length) throw new Error("请先选择元素");
    if (all(roots).length > 500)
      throw new Error("原型暂支持一次复用最多 500 个节点");
    const bounds = unionRect(roots),
      zoom = S.zoom;
    const objects = roots.map((source) => {
      for (let ancestor = source.parentElement; ancestor && !ancestor.matches('[data-artboard]'); ancestor = ancestor.parentElement) {
        if (ancestor.matches('picture'))
          throw new Error('图片依赖 picture 来源，暂不能单独跨页复制');
        const style = getComputedStyle(ancestor);
        if (['overflowX', 'overflowY'].some(key => ['hidden', 'clip', 'scroll', 'auto'].includes(style[key])) ||
          style.clipPath !== 'none' || style.maskImage !== 'none')
          throw new Error('对象受外层蒙版裁切，暂不能单独跨页复制');
      }
      const template = source.cloneNode(true),
        originals = [source, ...source.querySelectorAll("*")],
        copies = [template, ...template.querySelectorAll("*")],
        pairs = new Map(originals.map((n, i) => [n, copies[i]]));
      const ids = new Set(originals.map((n) => n.id).filter(Boolean));
      for (const node of originals) {
        if (node.matches("script,style,link,iframe,object,embed,video,canvas,form"))
          throw new Error("这种内容暂不支持跨画布复用");
        for (const pseudo of ["::before", "::after"])
          if (!["none", "normal"].includes(getComputedStyle(node, pseudo).content))
            throw new Error("含生成内容的对象暂不支持跨画布复用");
        const target = pairs.get(node),
          cs = getComputedStyle(node);
        if (node.hasAttribute('srcset')) throw new Error('含 srcset 的对象暂不支持跨页复制');
        for (const attr of ['src', 'href', 'poster', 'xlink:href']) {
          const value = node.getAttribute(attr);
          if (!value || value.startsWith('#')) continue;
          const url = new URL(value, node.baseURI);
          if (url.protocol === 'blob:' || url.protocol === 'javascript:')
            throw new Error('这种资源暂不支持跨页复制');
          if (attr === 'xlink:href' && node.hasAttributeNS('http://www.w3.org/1999/xlink', 'href'))
            target.setAttributeNS('http://www.w3.org/1999/xlink', attr, url.href);
          else target.setAttribute(attr, url.href);
        }
        target.removeAttribute("contenteditable");
        target.removeAttribute("data-bbox");
        target.removeAttribute("data-flow-style");
        for (const key of cs) {
          if (ignored.test(key)) continue;
          let value = cs.getPropertyValue(key);
          value = value.replace(
            /url\(["']?[^#"')]*#([^"')]+)["']?\)/g,
            (match, id) => (ids.has(id) ? `url("#${id}")` : match),
          );
          target.style.setProperty(
            key,
            value,
            node.style.getPropertyPriority(key),
          );
        }
      }
      const leaves = groupRoots([source]).map((node) => {
        const g = elementGeometry(node);
        if (!g.supported) throw new Error("这种变换暂不支持跨画布复用");
        return { source: node, copy: pairs.get(node), g };
      });
      for (const node of originals.filter(isGroup))
        if (
          !leaves.some(
            (leaf) => leaf.source !== node && leaf.source.contains(node),
          )
        ) {
          const frame = selectionFrame([node]);
          if (frame) writeGroupAngle(pairs.get(node), frame.angle);
        }
      const frames = originals.map((node) => {
        const r = node.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
      });
      return { source, template, pairs, leaves, frames };
    });
    return {
      objects,
      zoom,
      cx: bounds.left + bounds.width / 2,
      cy: bounds.top + bounds.height / 2,
    };
  }
  function placements(roots) {
    return roots.map((node) => ({
      node,
      parent: node.parentNode,
      next: node.nextSibling,
    }));
  }
  function restore(places) {
    for (const { node, parent, next } of [...places].reverse())
      parent.insertBefore(node, next?.parentNode === parent ? next : null);
  }
  function clear() {
    viewport.highlight(null);
    ghost?.remove();
    ghost = null;
  }
  function begin(roots) {
    roots = selectionRoots(roots);
    return {
      roots,
      before: snap(all(roots)),
      places: placements(roots),
      source: roots[0]?.closest("[data-artboard]"),
    };
  }
  function position(node, g, board, cx, cy, zoom) {
    const r = board.getBoundingClientRect(),
      cs = getComputedStyle(board),
      scale = g.scale / zoom;
    const set = (key, value) =>
      node.style.setProperty(key, value, node.style.getPropertyPriority(key));
    for (const [key, value] of Object.entries({
      position: "absolute",
      inset: "auto",
      margin: "0px",
      "box-sizing": "border-box",
      width: `${g.w}px`,
      height: `${g.h}px`,
      "min-width": "0px",
      "min-height": "0px",
      "max-width": "none",
      "max-height": "none",
      translate: "none",
      rotate: "none",
      scale: "none",
      zoom: "1",
      "transform-origin": "50% 50%",
      transform: `rotate(${g.angle}deg) scale(${scale})`,
      left: `${(cx - r.left) / S.zoom - (parseFloat(cs.borderLeftWidth) || 0) - g.w / 2}px`,
      top: `${(cy - r.top) / S.zoom - (parseFloat(cs.borderTopWidth) || 0) - g.h / 2}px`,
    }))
      set(key, value);
  }
  function install(packet, board, { copy, center = null } = {}) {
    const result = [],
      expected = [];
    try {
      for (const object of packet.objects) {
        const node = copy ? object.template.cloneNode(true) : object.source;
        const templates = [
            object.template,
            ...object.template.querySelectorAll("*"),
          ],
          nodes = [node, ...node.querySelectorAll("*")];
        if (!copy)
          for (let i = 0; i < nodes.length; i++) {
            const value = templates[i].getAttribute("style");
            nodes[i].setAttribute("style", value || "");
            nodes[i].removeAttribute("data-flow-style");
            nodes[i].removeAttribute("data-bbox");
            if (templates[i].hasAttribute("data-group-angle-v1"))
              nodes[i].setAttribute(
                "data-group-angle-v1",
                templates[i].getAttribute("data-group-angle-v1"),
              );
          }
        if (copy) {
          for (const child of nodes.filter((n) => n.hasAttribute("data-el")))
            child.dataset.el = elementId(board, "copy");
          rekeyDOMIds(node, node.dataset.el);
        }
        board.append(node);
        result.push(node);
        for (const leaf of object.leaves) {
          const index = templates.indexOf(leaf.copy),
            target = nodes[index];
          const cx = center
              ? center.x + ((leaf.g.cx - packet.cx) / packet.zoom) * S.zoom
              : leaf.g.cx,
            cy = center
              ? center.y + ((leaf.g.cy - packet.cy) / packet.zoom) * S.zoom
              : leaf.g.cy;
          position(target, leaf.g, board, cx, cy, packet.zoom);
          expected.push({ node: target, cx, cy, g: leaf.g });
        }
      }
      if (!stableGroupMarkup(board))
        throw new Error("目标容器无法保留这个对象的 HTML 结构，本次已保留原样");
      const visual = [
        "display",
        "visibility",
        "content-visibility",
        "color",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "line-height",
        "letter-spacing",
        "word-spacing",
        "text-align",
        "text-transform",
        "white-space",
        "background-color",
        "opacity",
        "object-fit",
        "object-position",
        "box-shadow",
      ];
      for (let i = 0; i < result.length; i++) {
        const templates = [
            packet.objects[i].template,
            ...packet.objects[i].template.querySelectorAll("*"),
          ],
          nodes = [result[i], ...result[i].querySelectorAll("*")];
        for (let j = 0; j < nodes.length; j++)
          for (const key of visual) {
            const wanted = templates[j].style.getPropertyValue(key);
            const actual = getComputedStyle(nodes[j]).getPropertyValue(key);
            // Absolute placement blockifies inline roots; their internal layout
            // still has to pass the rendered-geometry checks below.
            const blockified = key === "display" && actual === "block" &&
              ["inline", "inline-block"].includes(wanted) && packet.objects[i].leaves.some(l => l.copy === templates[j]);
            if (wanted && actual !== wanted && !blockified)
              throw new Error("目标画布的 CSS 改变了对象样式，本次已保留原样");
          }
      }
      // A fixed root box can conceal hidden/reflowed descendants. Check the
      // rendered subtree too, in the same viewport coordinate system as capture.
      for (let i = 0; i < result.length; i++) {
        const nodes = [result[i], ...result[i].querySelectorAll("*")];
        const k = S.zoom / packet.zoom;
        for (let j = 0; j < nodes.length; j++) {
          const before = packet.objects[i].frames[j];
          if (!before.w && !before.h) continue; // e.g. display:contents wrappers
          const r = nodes[j].getBoundingClientRect();
          const cx = center ? center.x + (before.cx - packet.cx) * k : before.cx;
          const cy = center ? center.y + (before.cy - packet.cy) * k : before.cy;
          if (Math.abs(r.left + r.width / 2 - cx) > 1 ||
              Math.abs(r.top + r.height / 2 - cy) > 1 ||
              Math.abs(r.width - before.w * k) > 1 ||
              Math.abs(r.height - before.h * k) > 1)
            throw new Error("目标画布改变了对象内部布局，本次已保留原样");
        }
      }
      for (const item of expected) {
        const g = elementGeometry(item.node),
          k = S.zoom / packet.zoom;
        if (
          !g.supported ||
          Math.abs(((g.angle - item.g.angle + 180) % 360 + 360) % 360 - 180) > 0.01 ||
          Math.abs(g.cx - item.cx) > 1 ||
          Math.abs(g.cy - item.cy) > 1 ||
          Math.abs(g.w * g.scale - item.g.w * item.g.scale * k) > 1 ||
          Math.abs(g.h * g.scale - item.g.h * item.g.scale * k) > 1
        )
          throw new Error("目标画布的 CSS 限制了位置或尺寸，本次已保留原样");
      }
      return result;
    } catch (error) {
      if (copy) result.forEach((n) => n.remove());
      throw error;
    }
  }
  function drop(context, event) {
    clear();
    if (!enabled || !viewport.workspaceActive() || !event) return false;
    if (!canEdit()) {
      apply(context.before);
      activate(context.source);
      select(context.roots, true);
      return true;
    }
    const board = viewport.boardAt(event.clientX, event.clientY);
    if (!board) {
      apply(context.before);
      activate(context.source);
      select(context.roots, true);
      toast("请拖到画布内，本次已恢复原位置");
      return true;
    }
    if (board === context.source) return false;
    let inserted = [];
    const copy = !!event.altKey;
    try {
      const packet = capture(context.roots);
      if (copy) apply(context.before);
      inserted = install(packet, board, { copy });
      const after = snap(all(inserted));
      push({
        board,
        undo() {
          if (copy) inserted.forEach((n) => n.remove());
          else {
            restore(context.places);
            apply(context.before);
          }
          activate(context.source, true);
          select(copy ? context.roots : inserted, true);
        },
        redo() {
          inserted.forEach((n) => board.append(n));
          apply(after);
          activate(board, true);
          select(inserted, true);
        },
      });
      activate(board);
      select(inserted, true);
      toast(copy ? "已复制到此画布 · 可撤销" : "已移动到此画布 · 可撤销");
      return true;
    } catch (error) {
      if (copy) for (const n of inserted) n.remove();
      else restore(context.places);
      apply(context.before);
      activate(context.source);
      select(context.roots, true);
      toast(error.message, 4500);
      return true;
    }
  }
  function move(context, event) {
    if (!enabled || !viewport.workspaceActive()) return;
    const board = viewport.boardAt(event.clientX, event.clientY);
    viewport.highlight(board && board !== context.source ? board : null);
    const r = context.source?.getBoundingClientRect(),
      outside =
        r &&
        (event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom);
    if (!outside) {
      ghost?.remove();
      ghost = null;
      return;
    }
    if (!ghost) {
      try {
        const packet = capture(context.roots);
        ghost = document.createElement("div");
        ghost.className = "workspace-ghost";
        for (const object of packet.objects)
          for (const leaf of object.leaves) {
            const clone = leaf.copy.cloneNode(true);
            for (const n of [clone, ...clone.querySelectorAll("*")]) {
              for (const a of [...n.attributes])
                if (/^on/i.test(a.name)) n.removeAttribute(a.name);
              n.style.setProperty("pointer-events", "none", "important");
            }
            ghost.append(clone);
          }
        ui.append(ghost);
        ghost._sources = packet.objects.flatMap((o) =>
          o.leaves.map((l) => l.source),
        );
      } catch {
        return;
      }
    }
    [...ghost.children].forEach((node, i) => {
      const g = elementGeometry(ghost._sources[i]);
      Object.assign(node.style, {
        position: "fixed",
        margin: "0",
        boxSizing: "border-box",
        width: `${g.w}px`,
        height: `${g.h}px`,
        left: `${g.cx - g.w / 2}px`,
        top: `${g.cy - g.h / 2}px`,
        inset: "auto",
        translate: "none",
        rotate: "none",
        scale: "none",
        zoom: "1",
        transformOrigin: "50% 50%",
        transform: `rotate(${g.angle}deg) scale(${g.scale})`,
      });
      node.style.left = `${g.cx - g.w / 2}px`;
      node.style.top = `${g.cy - g.h / 2}px`;
    });
  }
  function copyEvent(event) {
    if (!canEdit() || !S.selection.length || S.text || editableTarget(event)) return false;
    try {
      const packet = capture(S.selection);
      const data = JSON.stringify({
        app: 'dom-slides', version: 1, origin: location.origin,
        zoom: packet.zoom, cx: packet.cx, cy: packet.cy,
        objects: packet.objects.map(object => {
          const nodes = [object.template, ...object.template.querySelectorAll('*')];
          return {
            html: object.template.outerHTML,
            frames: object.frames,
            leaves: object.leaves.map(leaf => ({ index: nodes.indexOf(leaf.copy), g: leaf.g })),
          };
        }),
      });
      if (data.length > CLIPBOARD_LIMIT) throw new Error('复制内容过大，请减少选中元素');
      event.clipboardData.setData(CLIPBOARD_TYPE, data);
      event.clipboardData.setData(
        "text/plain",
        S.selection.map((n) => n.textContent).join("\n"),
      );
      event.preventDefault();
      event.stopImmediatePropagation();
      toast("已复制元素 · 可粘贴到其他页面或标签页");
      return true;
    } catch (error) {
      toast(error.message, 4500);
      return false;
    }
  }
  const editableTarget = event => event.composedPath().some(node =>
    node instanceof Element && node.matches('input,textarea,select,[contenteditable]:not([contenteditable=false])'));
  function readPacket(data) {
    if (!data || data.length > CLIPBOARD_LIMIT) throw new Error('剪贴板内容无效或过大');
    const wire = JSON.parse(data);
    if (wire.app !== 'dom-slides' || wire.version !== 1 || wire.origin !== location.origin ||
      !Number.isFinite(wire.zoom) || wire.zoom <= 0 || !Number.isFinite(wire.cx) || !Number.isFinite(wire.cy) ||
      !Array.isArray(wire.objects) || !wire.objects.length || wire.objects.length > 100)
      throw new Error('剪贴板对象格式不受支持');
    let count = 0;
    const objects = wire.objects.map(object => {
      if (typeof object.html !== 'string' || object.html.length > CLIPBOARD_LIMIT ||
        !Array.isArray(object.frames) || !Array.isArray(object.leaves))
        throw new Error('剪贴板对象格式不受支持');
      const template = document.createElement('template');
      template.innerHTML = object.html;
      if (template.content.children.length !== 1 || template.content.childNodes.length !== 1)
        throw new Error('剪贴板对象结构无效');
      const root = template.content.firstElementChild;
      if (!root.hasAttribute('data-el') || root.hasAttribute('data-artboard'))
        throw new Error('剪贴板对象结构无效');
      const nodes = [root, ...root.querySelectorAll('*')];
      count += nodes.length;
      if (count > 500 || object.frames.length !== nodes.length ||
        nodes.some(node => {
          if (node.matches('script,style,link,iframe,object,embed,video,canvas,form')) return true;
          return [...node.attributes].some(attr => /^on/i.test(attr.name) || attr.name === 'srcdoc' ||
            /^(href|src|poster)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value));
        })) throw new Error('剪贴板对象含不支持的内容');
      const frames = object.frames.map(frame => {
        if (!frame || !['cx','cy','w','h'].every(key => Number.isFinite(frame[key]) && Math.abs(frame[key]) < 1e7))
          throw new Error('剪贴板对象位置无效');
        return frame;
      });
      const leaves = object.leaves.map(leaf => {
        if (!Number.isInteger(leaf.index) || leaf.index < 0 || leaf.index >= nodes.length ||
          !leaf.g || !['w','h','cx','cy','scale','angle'].every(key => Number.isFinite(leaf.g[key]) && Math.abs(leaf.g[key]) < 1e7) ||
          leaf.g.w <= 0 || leaf.g.h <= 0 || leaf.g.scale <= 0)
          throw new Error('剪贴板对象几何无效');
        return { copy: nodes[leaf.index], g: leaf.g };
      });
      if (!leaves.length) throw new Error('剪贴板对象没有可放置的元素');
      return { template: root, frames, leaves };
    });
    return { objects, zoom: wire.zoom, cx: wire.cx, cy: wire.cy };
  }
  function pasteEvent(event) {
    if (!canEdit() || S.text || editableTarget(event)) return false;
    const data = event.clipboardData?.getData(CLIPBOARD_TYPE);
    if (!data) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const board = S.current;
    if (!board) return true;
    let inserted = [];
    try {
      const packet = readPacket(data);
      const r = board.getBoundingClientRect();
      inserted = install(packet, board, {
        copy: true,
        center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      });
      const after = snap(all(inserted));
      push({
        board,
        undo() {
          inserted.forEach((n) => n.remove());
          select(null);
        },
        redo() {
          inserted.forEach((n) => board.append(n));
          apply(after);
          activate(board, true);
          select(inserted, true);
        },
      });
      select(inserted);
      toast("已粘贴到当前画布 · 可撤销");
    } catch (error) {
      inserted.forEach((n) => n.remove());
      toast(error.message, 4500);
    }
    return true;
  }
  return { enabled, begin, move, drop, clear, copyEvent, pasteEvent };
}
