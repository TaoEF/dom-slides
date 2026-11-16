// A painted box is a useful editable object; layout-only wrappers are not.
const colorVisible = value => {
  if (!value || value === 'transparent') return false;
  if (/^rgba\(/i.test(value) && /,\s*0(?:\.0+)?\s*\)$/.test(value)) return false;
  if (/\/\s*0(?:\.0+)?%?\s*\)$/.test(value)) return false;
  return true;
};
const shadowVisible = value => {
  if (value === 'none') return false;
  const layers = []; let start = 0, depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && !depth) { layers.push(value.slice(start, i)); start = i + 1; }
  }
  layers.push(value.slice(start));
  return layers.some(layer => {
    const colors = layer.match(/(?:rgba?|hsla?|color)\([^)]*\)|transparent/gi);
    if (colors && !colors.some(colorVisible)) return false;
    const lengths = [...layer.replace(/(?:rgba?|hsla?|color)\([^)]*\)/gi, '').matchAll(/(-?(?:\d+\.?\d*|\.\d+))px/g)]
      .map(match => Number(match[1]));
    return lengths.length < 2 || lengths.some(length => Math.abs(length) > .001);
  });
};

export function paintedDiv(el) {
  if (el?.tagName !== 'DIV' || !el.getClientRects().length) return false;
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  if (s.display === 'none' || s.display === 'contents' || s.visibility !== 'visible' || s.opacity === '0' || r.width <= 0 || r.height <= 0) return false;
  if (colorVisible(s.backgroundColor) || s.backgroundImage !== 'none' || shadowVisible(s.boxShadow)) return true;
  if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && colorVisible(s.outlineColor)) return true;
  return ['Top', 'Right', 'Bottom', 'Left'].some(side =>
    !['none', 'hidden'].includes(s[`border${side}Style`]) &&
    parseFloat(s[`border${side}Width`]) > 0 && colorVisible(s[`border${side}Color`]));
}
