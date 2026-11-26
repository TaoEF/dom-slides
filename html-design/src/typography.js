// Snapshot computed values once. Explicit spans must scale from their original sizes,
// rather than inheriting a repeatedly compounded scale from their parent.
export function textMetrics(el) {
  return [el, ...el.querySelectorAll("*")]
    .filter((n) => !n.matches("br"))
    .map((node) => {
      const cs = getComputedStyle(node);
      return {
        node,
        font: parseFloat(cs.fontSize),
        line: cs.lineHeight,
        letter: cs.letterSpacing,
        word: cs.wordSpacing,
      };
    });
}
export function scaleText(metrics, k) {
  for (const m of metrics) {
    m.node.style.fontSize = `${Math.round(m.font * k * 1000) / 1000}px`;
    for (const [prop, value] of [
      ["lineHeight", m.line],
      ["letterSpacing", m.letter],
      ["wordSpacing", m.word],
    ]) {
      m.node.style[prop] =
        value === "normal"
          ? "normal"
          : `${Math.round(parseFloat(value) * k * 1000) / 1000}px`;
    }
  }
}

export function setTextLineHeight(el, value) {
  const style = el.style;
  style.setProperty('line-height', value, style.getPropertyPriority('line-height'));
  const savedTrim = el.dataset.lineHeightTrim;
  const priority = style.getPropertyPriority('text-box-trim');
  if (value === '') {
    if (savedTrim !== undefined) {
      if (style.textBoxTrim === 'trim-both') style.setProperty('text-box-trim', savedTrim, priority);
      delete el.dataset.lineHeightTrim;
    }
    return;
  }

  const cs = getComputedStyle(el);
  if (cs.writingMode !== 'horizontal-tb' ||
      !['block', 'inline-block', 'flow-root', 'list-item'].includes(cs.display) ||
      !['none', 'trim-end'].includes(cs.textBoxTrim)) return;
  // Remove the external half-leading. CSS still lays out the content and
  // keeps the chosen line height between baselines.
  const original = style.textBoxTrim;
  style.setProperty('text-box-trim', 'trim-both', priority);
  if (getComputedStyle(el).textBoxTrim === 'trim-both') el.dataset.lineHeightTrim = original;
  else style.setProperty('text-box-trim', original, priority);
}
