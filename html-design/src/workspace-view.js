// Prototype-only view projection. Artboard CSS/DOM remain canonical.
export function createWorkspaceView({
  S,
  root,
  stage,
  ui,
  withAll,
  activate,
  single,
}) {
  const enabled = stage.hasAttribute("data-workspace-prototype");
  const labels = document.createElement("div");
  labels.className = "workspace-labels";
  labels.hidden = true;
  ui.append(labels);
  let entries = [],
    extent = { w: 1280, h: 720 };
  const active = () => enabled && !!S.workspace && !S.playing;
  function layout() {
    entries = withAll(() =>
      [...stage.querySelectorAll("[data-artboard]")].map((b) => ({
        b,
        w: b.offsetWidth || 1280,
        h: b.offsetHeight || 720,
      })),
    );
    let y = 72,
      maximum = 0;
    for (let row = 0; row < entries.length; row += 3) {
      let x = 48,
        height = 0;
      for (const item of entries.slice(row, row + 3)) {
        item.x = x;
        item.y = y;
        x += item.w + 140;
        height = Math.max(height, item.h);
      }
      maximum = Math.max(maximum, x - 92);
      y += height + 140;
    }
    extent = { w: Math.max(1, maximum), h: Math.max(1, y - 68) };
    return extent;
  }
  function css() {
    return (
      `html[data-editor-workspace] [data-artboard]{position:absolute!important;inset:auto!important;margin:0!important;flex:none!important}` +
      entries
        .map(
          ({ b, x, y }) =>
            `html[data-editor-workspace] [data-artboard=${CSS.escape(b.dataset.artboard)}]{left:${x}px!important;top:${y}px!important}`,
        )
        .join("")
    );
  }
  function draw(bounds) {
    labels.hidden = !active();
    if (!active()) return;
    labels.replaceChildren();
    for (const item of entries) {
      const r = item.b.getBoundingClientRect();
      if (
        r.right < bounds.x ||
        r.left > bounds.x + bounds.w ||
        r.bottom < bounds.y ||
        r.top > bounds.y + bounds.h
      )
        continue;
      const button = document.createElement("button");
      button.className = "workspace-label";
      button.textContent = item.b.dataset.title || item.b.dataset.artboard;
      button.title = `${button.textContent} · ${item.w} × ${item.h} · 双击进入单页`;
      Object.assign(button.style, {
        left: `${Math.max(bounds.x + 4, r.left)}px`,
        top: `${Math.max(bounds.y + 2, r.top - 28)}px`,
        maxWidth: `${Math.max(40, r.width)}px`,
      });
      button.onclick = () => activate(item.b);
      button.ondblclick = () => {
        activate(item.b);
        single();
      };
      labels.append(button);
    }
  }
  function boardAt(x, y) {
    return (
      entries
        .map((i) => i.b)
        .find((b) => {
          const r = b.getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        }) || null
    );
  }
  function highlight(board) {
    for (const item of entries)
      item.b.toggleAttribute("data-editor-drop-target", item.b === board);
  }
  return {
    enabled,
    active,
    layout,
    css,
    draw,
    boardAt,
    highlight,
    extent: () => extent,
  };
}
