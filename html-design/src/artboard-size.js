// CSS declarations remain the size truth; measurements and UI state are derived.
export function artboardSize(board) {
  const cs = getComputedStyle(board);
  return {
    width: board.offsetWidth,
    height: board.offsetHeight,
    box: "border-box",
    declared: {
      width: board.style.getPropertyValue("width") || null,
      height: board.style.getPropertyValue("height") || null,
    },
    computed: { width: cs.width, height: cs.height, boxSizing: cs.boxSizing },
  };
}
export function setArtboardSize(board, width, height) {
  if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 4096))
    throw new Error("画布宽高须为 1–4096 的整数像素");
  const before = board.getAttribute("style");
  const restore = () => {
    // Materialize an empty declaration before removal; CSSOM can retain a dirty style attribute.
    board.setAttribute("style", before || "");
    if (before === null) board.removeAttribute("style");
  };
  // Keep authored box-sizing; convert desired border-box to its CSS content box.
  const cs = getComputedStyle(board),
    px = (n) => parseFloat(n) || 0;
  const edges = (axis) =>
    cs.boxSizing === "border-box"
      ? 0
      : axis.reduce(
          (s, side) =>
            s + px(cs[`padding${side}`]) + px(cs[`border${side}Width`]),
          0,
        );
  const w = width - edges(["Left", "Right"]),
    h = height - edges(["Top", "Bottom"]);
  if (w <= 0 || h <= 0)
    throw new Error("画布尺寸小于当前内边距与边框，请先调整它们");
  board.style.setProperty(
    "width",
    `${w}px`,
    board.style.getPropertyPriority("width"),
  );
  board.style.setProperty(
    "height",
    `${h}px`,
    board.style.getPropertyPriority("height"),
  );
  if (
    Math.abs(board.offsetWidth - width) > 0.5 ||
    Math.abs(board.offsetHeight - height) > 0.5
  ) {
    restore();
    throw new Error("CSS 的最小/最大尺寸或优先级限制了画布大小，本次未修改");
  }
  return { before, after: board.getAttribute("style") };
}
