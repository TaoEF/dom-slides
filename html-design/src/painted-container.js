// A painted box is a useful editable object; layout-only wrappers are not.
const colorVisible = value => {
  if (!value || value === 'transparent') return false;
  if (/^rgba\(/i.test(value) && /,\s*0(?:\.0+)?\s*\)$/.test(value)) return false;
  if (/\/\s*0(?:\.0+)?%?\s*\)$/.test(value)) return false;
  return true;
};

export function paintedDiv(el) {
  if (el?.tagName !== 'DIV' || !el.getClientRects().length) return false;
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  if (s.display === 'none' || s.display === 'contents' || s.visibility !== 'visible' || s.opacity === '0' || r.width <= 0 || r.height <= 0) return false;
  if (colorVisible(s.backgroundColor) || s.backgroundImage !== 'none' || s.boxShadow !== 'none') return true;
  if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && colorVisible(s.outlineColor)) return true;
  return ['Top', 'Right', 'Bottom', 'Left'].some(side =>
    !['none', 'hidden'].includes(s[`border${side}Style`]) &&
    parseFloat(s[`border${side}Width`]) > 0 && colorVisible(s[`border${side}Color`]));
}
