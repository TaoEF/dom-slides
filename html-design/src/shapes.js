const NS = 'http://www.w3.org/2000/svg';
export const SHAPE_NAMES = {
  rect: '矩形', ellipse: '椭圆', triangle: '三角形', diamond: '菱形',
  star: '星形', line: '直线', arrow: '线箭头', blockArrow: '块箭头',
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const color = (value, fallback) => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
const escapeAttr = value => String(value).replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
const starPoints = (inner, inset, width, height) => {
  const points = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? inner : 50;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return points.map(([x, y]) => `${inset + (x - minX) * (width - 2 * inset) / (maxX - minX)},${inset + (y - minY) * (height - 2 * inset) / (maxY - minY)}`).join(' ');
};

const defaultStrokeWidth = kind => kind === 'line' || kind === 'arrow' ? 4 : 2;
const dimensions = kind => ({ width: kind === 'star' ? 132 : 220, height: kind === 'line' ? 8 : kind === 'arrow' ? 44 : 132 });
const dimension = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 8 ? Math.round(Number(value) * 1000) / 1000 : fallback;
const viewBox = (width, height) => `0 0 ${width} ${height}`;

function shapeGeometry(kind, fill, stroke, sw, adjust, width, height) {
  const edge = Math.min(sw / 2, (width - 1) / 2, (height - 1) / 2);
  const midX = width / 2, midY = height / 2;
  const tipX = width - edge, bottom = height - edge;
  const shaftTop = height * (30 - adjust * .2) / 120;
  const shaftBottom = height * (90 + adjust * .2) / 120;
  const headX = width * (125 - adjust * .5) / 200;
  const outline = `stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`;
  const filled = `fill="${fill}" ${outline}`;
  const lineStyle = `fill="none" stroke="${stroke}" stroke-width="${Math.max(1, sw)}" stroke-linecap="round" stroke-linejoin="round"`;
  const geometry = {
    rect: `<rect x="${edge}" y="${edge}" width="${width - 2 * edge}" height="${height - 2 * edge}" rx="${adjust}" ${filled}/>` ,
    ellipse: `<ellipse cx="${midX}" cy="${midY}" rx="${midX - edge}" ry="${midY - edge}" ${filled}/>` ,
    triangle: `<polygon points="${midX},${edge} ${tipX},${bottom} ${edge},${bottom}" ${filled}/>` ,
    diamond: `<polygon points="${midX},${edge} ${tipX},${midY} ${midX},${bottom} ${edge},${midY}" ${filled}/>` ,
    star: `<polygon points="${starPoints(12 + adjust * .52, edge, width, height)}" ${filled}/>` ,
    line: `<path d="M${edge} ${midY}H${tipX}" ${lineStyle}/>` ,
    arrow: `<path d="M${edge} ${midY}H${tipX} M${width * (190 - adjust) / 200} ${edge}L${tipX} ${midY}L${width * (190 - adjust) / 200} ${bottom}" ${lineStyle}/>` ,
    blockArrow: `<polygon points="${edge},${shaftTop} ${headX},${shaftTop} ${headX},${edge} ${tipX},${midY} ${headX},${bottom} ${headX},${shaftBottom} ${edge},${shaftBottom}" ${filled}/>` ,
  };
  return geometry[kind] || '';
}

// AI can materialize a complete, editable shape from explicit parameters.
// The SVG child stays in the saved HTML, so it also renders without the editor.
export function shapeMarkup({ id, kind, fill = '#86868b', stroke = '#86868b', strokeWidth = defaultStrokeWidth(kind), adjust = kind === 'rect' ? 12 : 20, width, height }) {
  if (!id || !SHAPE_NAMES[kind]) throw new Error('shapeMarkup requires a unique id and supported kind');
  const params = { fill: color(fill, '#86868b'), stroke: color(stroke, '#86868b'), strokeWidth: clamp(strokeWidth, 0, 16), adjust: clamp(adjust, 0, 50) };
  const defaults = dimensions(kind);
  const size = { width: dimension(width, defaults.width), height: dimension(height, defaults.height) };
  return `<svg data-el="${escapeAttr(id)}" data-shape="${kind}" aria-label="${SHAPE_NAMES[kind]}" data-shape-fill="${params.fill}" data-shape-stroke="${params.stroke}" data-shape-width="${params.strokeWidth}" data-shape-adjust="${params.adjust}" viewBox="${viewBox(size.width, size.height)}" preserveAspectRatio="none" style="width:${size.width}px;height:${size.height}px;display:block;overflow:visible">${shapeGeometry(kind, params.fill, params.stroke, params.strokeWidth, params.adjust, size.width, size.height)}</svg>`;
}

// Geometry is materialized in the saved SVG. There is no script-time reconstruction.
export function renderShape(el, size) {
  const kind = el.dataset.shape;
  const defaults = dimensions(kind);
  const style = el.isConnected ? getComputedStyle(el) : el.style;
  const width = dimension(size?.width ?? parseFloat(style.width), defaults.width);
  const height = dimension(size?.height ?? parseFloat(style.height), defaults.height);
  el.setAttribute('viewBox', viewBox(width, height));
  el.setAttribute('preserveAspectRatio', 'none');
  const fill = color(el.dataset.shapeFill, '#86868b');
  const stroke = color(el.dataset.shapeStroke, '#86868b');
  const sw = clamp(el.dataset.shapeWidth ?? defaultStrokeWidth(kind), 0, 16);
  const adjust = clamp(el.dataset.shapeAdjust ?? 20, 0, 50);
  el.innerHTML = shapeGeometry(kind, fill, stroke, sw, adjust, width, height);
}

export function makeShape(kind, id) {
  if (!SHAPE_NAMES[kind]) return null;
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('data-el', id);
  el.setAttribute('data-shape', kind);
  el.setAttribute('aria-label', SHAPE_NAMES[kind]);
  el.dataset.shapeFill = '#86868b';
  el.dataset.shapeStroke = '#86868b';
  el.dataset.shapeWidth = String(defaultStrokeWidth(kind));
  el.dataset.shapeAdjust = kind === 'rect' ? '12' : '20';
  const size = dimensions(kind);
  el.style.width = `${size.width}px`;
  el.style.height = `${size.height}px`;
  el.style.display = 'block';
  el.style.overflow = 'visible';
  renderShape(el);
  return el;
}

export const shapeHasFill = kind => kind !== 'line' && kind !== 'arrow';
export const shapeHasAdjust = kind => ['rect', 'star', 'arrow', 'blockArrow'].includes(kind);
