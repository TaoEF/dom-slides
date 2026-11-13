const NS = 'http://www.w3.org/2000/svg';
export const SHAPE_NAMES = {
  rect: '矩形', ellipse: '椭圆', triangle: '三角形', diamond: '菱形',
  star: '星形', line: '直线', arrow: '线箭头', blockArrow: '块箭头',
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const color = (value, fallback) => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
const starPoints = inner => Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? inner : 50;
  return `${100 + Math.cos(a) * r},${60 + Math.sin(a) * r}`;
}).join(' ');

// Geometry is materialized in the saved SVG. There is no script-time reconstruction.
export function renderShape(el) {
  const kind = el.dataset.shape;
  const fill = color(el.dataset.shapeFill, '#1d1d1f');
  const stroke = color(el.dataset.shapeStroke, '#1d1d1f');
  const sw = clamp(el.dataset.shapeWidth ?? 3, 0, 16);
  const adjust = clamp(el.dataset.shapeAdjust ?? 20, 0, 50);
  const outline = `stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`;
  const filled = `fill="${fill}" ${outline}`;
  const lineStyle = `fill="none" stroke="${stroke}" stroke-width="${Math.max(1, sw)}" stroke-linecap="round" stroke-linejoin="round"`;
  const geometry = {
    rect: `<rect x="10" y="10" width="180" height="100" rx="${adjust}" ${filled}/>` ,
    ellipse: `<ellipse cx="100" cy="60" rx="89" ry="49" ${filled}/>` ,
    triangle: `<polygon points="100,9 190,110 10,110" ${filled}/>` ,
    diamond: `<polygon points="100,9 190,60 100,111 10,60" ${filled}/>` ,
    star: `<polygon points="${starPoints(12 + adjust * .52)}" ${filled}/>` ,
    line: `<path d="M10 20H190" ${lineStyle}/>` ,
    arrow: `<path d="M10 20H190 M${190 - 12 - adjust} ${20 - 5 - adjust * .2}L190 20L${190 - 12 - adjust} ${20 + 5 + adjust * .2}" ${lineStyle}/>` ,
    blockArrow: `<polygon points="10,${42 - adjust * .25} ${125 - adjust * .5},${42 - adjust * .25} ${125 - adjust * .5},10 190,60 ${125 - adjust * .5},110 ${125 - adjust * .5},${78 + adjust * .25} 10,${78 + adjust * .25}" ${filled}/>` ,
  };
  el.innerHTML = geometry[kind] || '';
}

export function makeShape(kind, id) {
  if (!SHAPE_NAMES[kind]) return null;
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('data-el', id);
  el.setAttribute('data-shape', kind);
  el.setAttribute('viewBox', kind === 'line' || kind === 'arrow' ? '0 0 200 40' : '0 0 200 120');
  el.setAttribute('aria-label', SHAPE_NAMES[kind]);
  el.dataset.shapeFill = '#1d1d1f';
  el.dataset.shapeStroke = '#1d1d1f';
  el.dataset.shapeWidth = kind === 'line' || kind === 'arrow' ? '4' : '0';
  el.dataset.shapeAdjust = kind === 'rect' ? '12' : '20';
  el.style.width = '220px';
  el.style.height = kind === 'line' || kind === 'arrow' ? '44px' : '132px';
  el.style.display = 'block';
  el.style.overflow = 'visible';
  renderShape(el);
  return el;
}

export const shapeHasFill = kind => kind !== 'line' && kind !== 'arrow';
export const shapeHasAdjust = kind => ['rect', 'star', 'arrow', 'blockArrow'].includes(kind);
