const NS = 'http://www.w3.org/2000/svg';
const number = value => Math.round(value * 1000) / 1000;
const param = (value, fallback, min, max) => {
  const n = value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.min(max, Math.max(min,n));
};
const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#86868b';
export const minArrowLength = 20;

export const connectorKinds = ['line', 'arrow', 'arrowDouble', 'arrowElbow'];
export const arrowShapeKinds = ['triangleHead', 'chevron', 'thinArrow', 'notched', 'doubleChevron', 'blockArrow'];
const presets = {
  line: { label: '直线', heads: 'none', head: 'none' },
  arrow: { label: '单向箭头直线' },
  arrowDouble: { label: '双向箭头直线', heads: 'both' },
  arrowElbow: { label: '单向箭头折线', route: 'elbow', radius: 12 },
  triangleHead: { label: '实心三角箭头', head: 'triangle', shaft: false, strokeWidth: 0, headLength: 86, headWidth: 96, radius: 4 },
  chevron: { label: '圆角折角', shaft: false, strokeWidth: 14, headLength: 34, headWidth: 64, radius: 4 },
  thinArrow: { label: '带杆线箭头', headLength: 40, headWidth: 66, strokeWidth: 8, width: 200 },
  notched: { label: '凹尾实心箭头', head: 'notched', shaft: false, strokeWidth: 0, headLength: 86, headWidth: 104, radius: 3 },
  doubleChevron: { label: '双折角', head: 'ribbon', shaft: false, strokeWidth: 0, headLength: 56, headWidth: 96, shaftWidth: 25, repeat: 2, gap: 7, radius: 5 },
  blockArrow: { label: '块箭头', head: 'triangle', headLength: 72, headWidth: 110, shaftWidth: 42, strokeWidth: 2, radius: 0, width: 220 },
};
export const arrowLabel = kind => presets[kind]?.label;
const defaults = { route: 'straight', heads: 'end', head: 'open', shaft: true, strokeWidth: 4,
  shaftWidth: 22, headLength: 16, headWidth: 18, radius: 0, repeat: 1, gap: 6, scale: 1 };
const fields = {
  route: 'shapeRoute', heads: 'shapeHeads', head: 'shapeHead', shaft: 'shapeShaft',
  strokeWidth: 'shapeWidth', shaftWidth: 'shapeShaftWidth', headLength: 'shapeHeadLength',
  headWidth: 'shapeHeadWidth', radius: 'shapeRadius', repeat: 'shapeRepeat', gap: 'shapeGap',
  scale: 'shapeArrowScale', fill: 'shapeFill', stroke: 'shapeStroke',
};
const valid = (v, values, fallback) => values.includes(v) ? v : fallback;
function model(kind, options = {}) {
  const p = { ...defaults, ...presets[kind] };
  return {
    route: valid(options.route, ['straight', 'elbow'], p.route),
    heads: valid(options.heads, ['none', 'end', 'both'], p.heads),
    head: valid(options.head, ['none', 'open', 'triangle', 'notched', 'ribbon'], p.head),
    shaft: options.shaft == null ? p.shaft : options.shaft === true || options.shaft === 'true',
    strokeWidth: param(options.strokeWidth, p.strokeWidth, 0, 16),
    shaftWidth: param(options.shaftWidth, p.shaftWidth, 1, 400),
    headLength: param(options.headLength, p.headLength, 4, 400),
    headWidth: param(options.headWidth, p.headWidth, 4, 400),
    radius: param(options.radius, p.radius, 0, 50),
    repeat: Math.round(param(options.repeat, p.repeat, 1, 2)),
    gap: param(options.gap, p.gap, 0, 5000),
    scale: param(options.scale, p.scale, .01, 40),
    fill: color(options.fill), stroke: color(options.stroke),
  };
}

const readModel = el => model(el.dataset.shape, Object.fromEntries(
  Object.entries(fields).map(([key, name]) => [key, el.dataset[name]])));
export const isArrowShape = el => el?.matches('svg[data-shape-arrow="1"]:not([data-shape-endpoints])');
export const arrowHasFill = el => !['open', 'none'].includes(readModel(el).head);
export function arrowResizeMode(el) {
  if (!isArrowShape(el)) return null;
  const p = readModel(el);
  return p.shaft || p.repeat > 1 ? 'length' : 'uniform';
}
export const arrowScale = el => readModel(el).scale;

export function readLineArrow(el) {
  if (!el?.matches('svg[data-shape-endpoints]') || !connectorKinds.includes(el.dataset.shape)) return null;
  const values = el.dataset.shapeEndpoints.trim().split(/\s+/).map(Number);
  if (values.length !== 4 || values.some(n => !Number.isFinite(n) || Math.abs(n) > 1e6)) return null;
  const [x, y, endX, endY] = values;
  return [{x, y}, {x: endX, y: endY}];
}

const xy = ([x, y]) => `${number(x)} ${number(y)}`;
const towards = (a, b, r) => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t = length ? Math.min(.5, r / length) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};
function path(points, radius = 0, closed = false) {
  if (!radius) return `M${points.map(xy).join('L')}${closed ? 'Z' : ''}`;
  const n = points.length;
  let d = `M${xy(closed ? towards(points[0], points[1], radius) : points[0])}`;
  for (let i = 1; i < n + Number(closed); i++) {
    const p = points[i % n];
    if (!closed && i === n - 1) d += `L${xy(p)}`;
    else d += `L${xy(towards(p, points[i - 1], radius))}Q${xy(p)} ${xy(towards(p, points[(i + 1) % n], radius))}`;
  }
  return d + (closed ? 'Z' : '');
}

function routedPoints(start, end, route) {
  const {x, y} = start, {x: ex, y: ey} = end;
  const points = [[x, y]];
  if (route === 'elbow' && Math.abs(ex - x) >= 1 && Math.abs(ey - y) >= 1) {
    if (Math.abs(ex - x) >= Math.abs(ey - y)) {
      const mid = (x + ex) / 2;
      points.push([mid, y], [mid, ey]);
    } else {
      const mid = (y + ey) / 2;
      points.push([x, mid], [ex, mid]);
    }
  }
  return [...points, [ex, ey]];
}
function headPath(type, map, half, length, thickness, radius) {
  const points = {
    open: [[-length, -half], [0, 0], [-length, half]],
    triangle: [[-length, -half], [0, 0], [-length, half]],
    notched: [[-length, -half], [0, 0], [-length, half], [-length * .7, 0]],
    ribbon: [[-length, -half], [-length + thickness, -half], [0, 0], [-length + thickness, half], [-length, half], [-thickness, 0]],
  }[type];
  return points ? path(points.map(map), radius, type !== 'open') : '';
}

function pathMarkup(d, p, filled, primary = false) {
  if (!d) return '';
  return `<path${primary ? ' data-shape-ink=""' : ' data-shape-head-ink=""'} d="${d}" fill="${filled ? p.fill : 'none'}" stroke="${p.stroke}" stroke-width="${number(p.strokeWidth)}" stroke-linecap="${p.round || p.radius > 0 ? 'round' : 'butt'}" stroke-linejoin="${p.round || p.radius > 0 ? 'round' : 'miter'}" pointer-events="${filled ? 'painted' : 'stroke'}"/>`;
}
function geometry(p, start, end, connector) {
  if (connector) p = {...p, round:true, strokeWidth:Math.max(1,p.strokeWidth)};
  const points = routedPoints(start, end, connector ? p.route : 'straight');
  const shaft = p.shaft ? path(points, connector ? p.radius : 0) : '';
  const reach = p.headLength * p.scale, half = p.headWidth * p.scale / 2;
  const filled = p.head !== 'open' && p.head !== 'none';
  let heads = '';
  // A block arrow is one closed silhouette, with no seam between head and shaft.
  if (!connector && p.shaft && p.head === 'triangle' && p.heads === 'end' && p.repeat === 1) {
    const cross = Math.min(half, p.shaftWidth * p.scale / 2), base = end.x - reach, y = end.y;
    const outline = [[start.x,y-cross],[base,y-cross],[base,y-half],[end.x,y],
      [base,y+half],[base,y+cross],[start.x,y+cross]];
    return pathMarkup(path(outline, p.radius * p.scale, true), p, true, true);
  }
  if (p.head !== 'none' && p.heads !== 'none') {
    const ends = p.heads === 'both' ? [false, true] : [true];
    for (const last of ends) {
      const tip = last ? points.at(-1) : points[0];
      const prev = last ? points.at(-2) : points[1];
      const d = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
      const [dx,dy] = connector ? [(tip[0]-prev[0])/d,(tip[1]-prev[1])/d] : [last ? 1 : -1,0];
      for (let i = 0; i < p.repeat; i++) {
        const offset = i * (reach + p.gap);
        const map = ( [x,y] ) => [tip[0] + (x-offset)*dx - y*dy, tip[1] + (x-offset)*dy + y*dx];
        heads += headPath(p.head, map, half, reach, Math.min(reach * .48, p.shaftWidth * p.scale), connector ? 0 : p.radius * p.scale);
      }
    }
  }
  const hit = connector ? [shaft, heads].filter(Boolean).join(' ') : '';
  const hitPath = hit ? `<path d="${hit}" fill="none" stroke="transparent" stroke-width="${Math.max(14,p.strokeWidth)}" pointer-events="stroke"/>` : '';
  if (!filled) return hitPath + pathMarkup([shaft, heads].filter(Boolean).join(' '), p, false, true);
  return hitPath + pathMarkup(shaft, p, false, true) + pathMarkup(heads, p, true, !shaft);
}

const datasetAttrs = p => Object.entries(fields).map(([key,name]) =>
  `data-${name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}="${p[key]}"`).join(' ');
const attr = value => String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const view = (w,h) => `0 0 ${w} ${h}`;
const startView = (kind,id,p,w,h) =>
  `<svg data-el="${attr(id)}" data-shape="${kind}" data-shape-arrow="1" aria-label="${arrowLabel(kind)}" ${datasetAttrs(p)} viewBox="${view(w,h)}" preserveAspectRatio="none"`;

function sizing(p) {
  return { head: p.headLength * p.scale, pad: p.strokeWidth * p.scale / 2,
    natural: p.headLength * p.scale * p.repeat + p.gap * (p.repeat - 1) + p.strokeWidth * p.scale };
}
const repeatsWithoutShaft = p => !p.shaft && p.repeat === 2;
function minimumArrowWidth(p) {
  return sizing(p).natural - (repeatsWithoutShaft(p) ? p.gap : 0);
}
function shapeWithWidth(p, width) {
  if (repeatsWithoutShaft(p)) p.gap = number(Math.max(0, width - minimumArrowWidth(p)));
  return p;
}
function shapeGeometry(p,w,h) {
  const {pad,natural} = sizing(p);
  const y = h / 2, to = !p.shaft && p.repeat === 1 ? (w + natural)/2 - pad : w - pad;
  return geometry({...p,strokeWidth:p.strokeWidth*p.scale}, {x:pad,y}, {x:to,y}, false);
}
export function arrowShapeMarkup({id,kind,...options}) {
  if (!id || !arrowShapeKinds.includes(kind)) throw new Error('arrowShapeMarkup requires an id and arrow shape kind');
  const p = model(kind, options), {natural} = sizing(p);
  const w = param(options.width, presets[kind].width ?? natural, minimumArrowWidth(p), 5000);
  shapeWithWidth(p,w);
  const h = p.headWidth*p.scale + p.strokeWidth*p.scale;
  return `${startView(kind,id,p,w,h)} style="width:${w}px;height:${h}px;display:block;overflow:visible">${shapeGeometry(p,w,h)}</svg>`;
}
export function renderArrowShape(el,w,h) {
  const p = shapeWithWidth(readModel(el),w);
  el.setAttribute('viewBox',view(w,h));
  if (repeatsWithoutShaft(p)) el.dataset.shapeGap = String(p.gap);
  el.innerHTML=shapeGeometry(p,w,h);
}
export function resizeArrowShape(el,w,h,initial,mode,scale) {
  if (mode === 'length') return {w:Math.max(minimumArrowWidth(readModel(el)),w),h:initial.h};
  const k = Math.max(.1,w === initial.w ? h/initial.h : w/initial.w,8/initial.w,8/initial.h);
  el.dataset.shapeArrowScale = String(k*scale);
  return {w:initial.w*k,h:initial.h*k};
}

function connectorBox(start,end) {
  const pad = 12;
  const x = Math.min(start.x,end.x)-pad, y = Math.min(start.y,end.y)-pad;
  return {x,y,w:number(Math.abs(start.x-end.x)+2*pad),h:number(Math.abs(start.y-end.y)+2*pad),
    local:[{x:number(start.x-x),y:number(start.y-y)},{x:number(end.x-x),y:number(end.y-y)}]};
}
const vector = points => points.map(({x,y}) => `${x} ${y}`).join(' ');
const validPoint = p => p && [p.x,p.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6);
export function connectorMarkup({id,kind='arrow',start,end,...options}) {
  if (!id || !connectorKinds.includes(kind) || !validPoint(start) || !validPoint(end) ||
      Math.hypot(start.x-end.x,start.y-end.y)<minArrowLength) throw new Error('connectorMarkup requires an id, connector kind and distinct endpoints');
  const p=model(kind,options), {x,y,w,h,local}=connectorBox(start,end);
  return `${startView(kind,id,p,w,h)} data-shape-endpoints="${vector(local)}" style="position:absolute;left:${x}px;top:${y}px;margin:0;box-sizing:border-box;display:block;overflow:visible;pointer-events:none;width:${w}px;height:${h}px">${geometry(p,...local,true)}</svg>`;
}
export function makeLineArrow(kind = 'arrow') {
  const el = document.createElementNS(NS, 'svg'), p = model(kind);
  el.dataset.shape = kind;
  el.dataset.shapeArrow = '1';
  for (const [key,name] of Object.entries(fields)) el.dataset[name]=String(p[key]);
  el.setAttribute('aria-label', arrowLabel(kind));
  el.setAttribute('preserveAspectRatio','none');
  Object.assign(el.style,{position:'absolute',display:'block',overflow:'visible',
    pointerEvents:'none',margin:'0',boxSizing:'border-box'});
  return el;
}
export function setLineArrow(el,start,end) {
  const {x,y,w,h,local}=connectorBox(start,end);
  el.setAttribute('viewBox',view(w,h));
  el.style.width=`${w}px`; el.style.height=`${h}px`;
  el.dataset.shapeEndpoints=vector(local);
  renderLineArrow(el,local);
  return {x,y};
}
export function renderLineArrow(el,[start,end]) {
  el.innerHTML=geometry(readModel(el),start,end,true);
}
