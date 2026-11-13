const NS = 'http://www.w3.org/2000/svg';
export const SHAPE_NAMES = {
  rect: '矩形', ellipse: '椭圆', triangle: '三角形', diamond: '菱形',
  star: '星形', line: '直线', arrow: '线箭头', blockArrow: '块箭头',
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const color = (value, fallback) => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
const starPoints = (inner, inset) => {
  const points = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? inner : 50;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return points.map(([x, y]) => `${inset + (x - minX) * (200 - 2 * inset) / (maxX - minX)},${inset + (y - minY) * (120 - 2 * inset) / (maxY - minY)}`).join(' ');
};

// Geometry is materialized in the saved SVG. There is no script-time reconstruction.
export function renderShape(el) {
  const kind = el.dataset.shape;
  el.setAttribute('viewBox', kind === 'line' ? '0 0 200 8' : kind === 'arrow' ? '0 0 200 40' : '0 0 200 120');
  el.setAttribute('preserveAspectRatio', 'none');
  const fill = color(el.dataset.shapeFill, '#86868b');
  const stroke = color(el.dataset.shapeStroke, '#86868b');
  const sw = clamp(el.dataset.shapeWidth ?? 3, 0, 16);
  const adjust = clamp(el.dataset.shapeAdjust ?? 20, 0, 50);
  const edge = sw / 2;
  const outline = `stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`;
  const filled = `fill="${fill}" ${outline}`;
  const lineStyle = `fill="none" stroke="${stroke}" stroke-width="${Math.max(1, sw)}" stroke-linecap="round" stroke-linejoin="round"`;
  const geometry = {
    rect: `<rect x="${edge}" y="${edge}" width="${200 - sw}" height="${120 - sw}" rx="${adjust}" ${filled}/>` ,
    ellipse: `<ellipse cx="100" cy="60" rx="${100 - edge}" ry="${60 - edge}" ${filled}/>` ,
    triangle: `<polygon points="100,${edge} ${200 - edge},${120 - edge} ${edge},${120 - edge}" ${filled}/>` ,
    diamond: `<polygon points="100,${edge} ${200 - edge},60 100,${120 - edge} ${edge},60" ${filled}/>` ,
    star: `<polygon points="${starPoints(12 + adjust * .52, edge)}" ${filled}/>` ,
    line: `<path d="M0 4H200" ${lineStyle}/>` ,
    arrow: `<path d="M0 20H200 M${190 - adjust} 0L200 20L${190 - adjust} 40" ${lineStyle}/>` ,
    blockArrow: `<polygon points="${edge},${30 - adjust * .2} ${125 - adjust * .5},${30 - adjust * .2} ${125 - adjust * .5},${edge} ${200 - edge},60 ${125 - adjust * .5},${120 - edge} ${125 - adjust * .5},${90 + adjust * .2} ${edge},${90 + adjust * .2}" ${filled}/>` ,
  };
  el.innerHTML = geometry[kind] || '';
}

export function makeShape(kind, id) {
  if (!SHAPE_NAMES[kind]) return null;
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('data-el', id);
  el.setAttribute('data-shape', kind);
  el.setAttribute('aria-label', SHAPE_NAMES[kind]);
  el.dataset.shapeFill = '#86868b';
  el.dataset.shapeStroke = '#86868b';
  el.dataset.shapeWidth = kind === 'line' || kind === 'arrow' ? '4' : '2';
  el.dataset.shapeAdjust = kind === 'rect' ? '12' : '20';
  el.style.width = kind === 'star' ? '132px' : '220px';
  el.style.height = kind === 'line' ? '8px' : kind === 'arrow' ? '44px' : '132px';
  el.style.display = 'block';
  el.style.overflow = 'visible';
  renderShape(el);
  return el;
}

export const shapeHasFill = kind => kind !== 'line' && kind !== 'arrow';
export const shapeHasAdjust = kind => ['rect', 'star', 'arrow', 'blockArrow'].includes(kind);
