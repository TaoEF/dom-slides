const NS = 'http://www.w3.org/2000/svg';
const number = value => Math.round(value * 1000) / 1000;
const param = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback;
export const minArrowLength = 20;

export function readLineArrow(el) {
  if (!el?.matches('svg[data-shape="arrow"][data-shape-endpoints]')) return null;
  const values = el.dataset.shapeEndpoints.trim().split(/\s+/).map(Number);
  if (values.length !== 4 || values.some(n => !Number.isFinite(n) || Math.abs(n) > 1e6)) return null;
  const [x, y, endX, endY] = values;
  return [{x, y}, {x: endX, y: endY}];
}

export function makeLineArrow() {
  const el = document.createElementNS(NS, 'svg');
  el.dataset.shape = 'arrow';
  el.dataset.shapeStroke = '#86868b';
  el.dataset.shapeWidth = '4';
  el.dataset.shapeHeadLength = '16';
  el.dataset.shapeHeadWidth = '18';
  el.setAttribute('aria-label', '线箭头');
  el.setAttribute('preserveAspectRatio', 'none');
  Object.assign(el.style, {
    position: 'absolute', display: 'block', overflow: 'visible',
    pointerEvents: 'none', margin: '0', boxSizing: 'border-box',
  });
  return el;
}

// Normalize the endpoints into a small SVG viewport. Each CSS pixel in the
// viewport is one SVG unit, independent of the line's length and direction.
export function setLineArrow(el, start, end) {
  const pad = 12;
  const x = Math.min(start.x, end.x) - pad, y = Math.min(start.y, end.y) - pad;
  const w = number(Math.abs(start.x - end.x) + pad * 2);
  const h = number(Math.abs(start.y - end.y) + pad * 2);
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.dataset.shapeEndpoints = [start.x - x, start.y - y, end.x - x, end.y - y].map(number).join(' ');
  renderLineArrow(el, readLineArrow(el));
  return {x, y};
}

export function renderLineArrow(el, [start, end]) {
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const dx = (end.x - start.x) / length, dy = (end.y - start.y) / length;
  const headLength = param(el.dataset.shapeHeadLength, 16, 2, 100);
  const halfHead = param(el.dataset.shapeHeadWidth, 18, 2, 100) / 2;
  const width = param(el.dataset.shapeWidth, 4, 1, 16);
  const color = /^#[0-9a-f]{6}$/i.test(el.dataset.shapeStroke) ? el.dataset.shapeStroke : '#86868b';
  const base = {x: end.x - dx * headLength, y: end.y - dy * headLength};
  const p = (x, y) => `${number(x)} ${number(y)}`;
  const shaft = `M${p(start.x, start.y)}L${p(end.x, end.y)}`;
  const head = `M${p(base.x - dy * halfHead, base.y + dx * halfHead)}L${p(end.x, end.y)}L${p(base.x + dy * halfHead, base.y - dx * halfHead)}`;
  el.innerHTML = `<path d="${shaft}" fill="none" stroke="transparent" stroke-width="${Math.max(14, width)}" pointer-events="stroke"/><path data-shape-ink="" d="${shaft} ${head}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"/>`;
}
