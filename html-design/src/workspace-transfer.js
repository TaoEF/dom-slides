import { elementGeometry } from "./geometry.js";
import { isGroup, groupRoots, stableGroupMarkup } from "./groups.js";
import { selectionRoots, unionRect } from "./selection.js";
import { selectionFrame, writeGroupAngle } from "./oriented-selection.js";
import { rekeyDOMIds } from "./identifiers.js";

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
  let clipboard = null,
    ghost = null;
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
      const template = source.cloneNode(true),
        originals = [source, ...source.querySelectorAll("*")],
        copies = [template, ...template.querySelectorAll("*")],
        pairs = new Map(originals.map((n, i) => [n, copies[i]]));
      const ids = new Set(originals.map((n) => n.id).filter(Boolean));
      for (const node of originals) {
        if (node.matches("script,iframe,object,embed,video,canvas"))
          throw new Error("这种内容暂不支持跨画布复用");
        for (const pseudo of ["::before", "::after"])
          if (
            !["none", "normal", '""'].includes(
              getComputedStyle(node, pseudo).content,
            )
          )
            throw new Error("含生成内容的对象暂不支持跨画布复用");
        const target = pairs.get(node),
          cs = getComputedStyle(node);
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
      return { source, template, pairs, leaves };
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
            if (
              wanted &&
              getComputedStyle(nodes[j]).getPropertyValue(key) !== wanted
            )
              throw new Error("目标画布的 CSS 改变了对象样式，本次已保留原样");
          }
      }
      for (const item of expected) {
        const g = elementGeometry(item.node),
          k = S.zoom / packet.zoom;
        if (
          !g.supported ||
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
    if (!enabled || !canEdit() || !S.selection.length || S.text) return false;
    try {
      const packet = capture(S.selection),
        token = crypto.getRandomValues(new Uint32Array(4)).join("-");
      clipboard = { packet, token };
      event.clipboardData.setData("application/x-dom-slides-objects", token);
      event.clipboardData.setData(
        "text/plain",
        S.selection.map((n) => n.textContent).join("\n"),
      );
      event.preventDefault();
      event.stopImmediatePropagation();
      toast("已复制元素 · 可粘贴到其他画布");
      return true;
    } catch (error) {
      toast(error.message, 4500);
      return false;
    }
  }
  function pasteEvent(event) {
    if (
      !enabled ||
      !canEdit() ||
      S.text ||
      !clipboard ||
      event.clipboardData?.getData("application/x-dom-slides-objects") !==
        clipboard.token
    )
      return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const board = S.current;
    if (!board) return true;
    let inserted = [];
    try {
      const r = board.getBoundingClientRect();
      inserted = install(clipboard.packet, board, {
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
