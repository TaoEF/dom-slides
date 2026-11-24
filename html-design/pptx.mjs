// Browser geometry is the source of truth; text and images remain native PPTX objects.
export function collectEditableSlide(board) {
  const origin = board.getBoundingClientRect();
  const items = [], warnings = [], sources = [];
  const emit = (node, item) => { items.push(item); sources.push(node); };
  const cssColor = value => {
    const numbers = String(value).match(/[\d.]+/g)?.map(Number);
    if (!numbers || numbers.length < 3) return { color: '000000', transparency: 100 };
    return {
      color: numbers.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase(),
      transparency: Math.round((1 - (numbers[3] ?? 1)) * 100),
    };
  };
  const rect = el => {
    const r = el.getBoundingClientRect(), g = globalThis.__htmlDesignGeometry(el);
    if (g.supported && (!el.matches('svg,canvas') || el.matches('svg[data-shape]'))) {
      const w = g.w * g.scale, h = g.h * g.scale;
      return { x: g.cx - origin.left - w / 2, y: g.cy - origin.top - h / 2, w, h, rotation: (g.angle + 360) % 360, scale: g.scale, supported: true };
    }
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height, rotation: 0, scale: 1, supported: false };
  };
  // Parameterized arrows emit a restricted SVG command set. Custom geometry
  // keeps the same outline native, including rounded corners and repeated heads.
  const arrowPath = (d, view, box) => {
    const commands = d?.match(/[MLQZ][^MLQZ]*/g);
    if (!commands || !view.width || !view.height) return null;
    const point = (a, b) => ({ x: (a-view.x)*box.w/view.width, y:(b-view.y)*box.h/view.height });
    const items = commands.map(command => {
      const kind = command[0], body = command.slice(1).trim(), values = body ? body.split(/\s+/).map(Number) : [];
      if (values.length !== ({M:2,L:2,Q:4,Z:0})[kind] || !values.every(Number.isFinite)) return null;
      if (kind === 'Z') return {close:true};
      if (kind === 'Q') return {...point(values[2],values[3]), control:point(values[0],values[1])};
      return {...point(...values), moveTo:kind === 'M'};
    });
    return items.every(Boolean) ? items : null;
  };
  const font = (cs, text) => {
    const names = cs.fontFamily.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    const cjk = /[\u3400-\u9fff]/.test(text) && names.find(s => /PingFang|YaHei|Noto Sans CJK|Heiti|SimSun/i.test(s));
    return cjk || names[0] || 'Arial';
  };
  const styles = (cs, text, scale = 1) => ({
    fontFace: font(cs, text), fontSize: parseFloat(cs.fontSize) * scale,
    bold: Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold', italic: cs.fontStyle === 'italic',
    underline: cs.textDecorationLine.includes('underline'), strike: cs.textDecorationLine.includes('line-through'),
    color: cssColor(cs.color).color, charSpacing: (parseFloat(cs.letterSpacing) || 0) * scale,
  });
  const textVertical = (el, cs, name, textItems) => {
    const approximate = () => { warnings.push(`${name}: 文字子项或轨道对齐使用顶部近似`); return 'top'; };
    const anchor = (value, reversed = false) => {
      value = value.replace(/^(?:safe|unsafe) /, '');
      if (value === 'center') return 'middle';
      if (value === 'flex-start') return reversed ? 'bottom' : 'top';
      if (value === 'flex-end') return reversed ? 'top' : 'bottom';
      return ['end', 'self-end'].includes(value) ? 'bottom' : 'top';
    };
    const itemStyles = [...textItems].map(item => item === el ? null : getComputedStyle(item));
    const cross = itemStyles.map(style => !style || style.alignSelf === 'auto' ? cs.alignItems : style.alignSelf);
    const unsupportedItems = itemStyles.some(style => style && (['absolute','fixed'].includes(style.position) ||
      ['contents','flex','inline-flex','grid','inline-grid'].includes(style.display) || style.writingMode !== cs.writingMode));
    const ambiguous = reversed => new Set(cross.map(value => anchor(value, reversed))).size > 1;
    let alignment = 'start', reversed = false;
    if (['flex', 'inline-flex'].includes(cs.display)) {
      const column = cs.flexDirection.startsWith('column');
      reversed = column ? cs.flexDirection === 'column-reverse' : cs.flexWrap === 'wrap-reverse';
      if (unsupportedItems || (!column && ambiguous(reversed))) return approximate();
      alignment = column ? cs.justifyContent : cross[0] || cs.alignItems;
    } else if (['grid', 'inline-grid'].includes(cs.display)) {
      if (unsupportedItems || ambiguous(false)) return approximate();
      const itemAlignment = cross[0] || cs.alignItems;
      const rows = cs.gridTemplateRows.match(/[\d.]+px/g)?.map(parseFloat) || [];
      const padding = ['Top','Bottom'].reduce((sum,side)=>sum+(parseFloat(cs[`padding${side}`])||0)+(parseFloat(cs[`border${side}Width`])||0),0);
      const height = parseFloat(cs.height)-(cs.boxSizing==='border-box'?padding:0);
      const used = rows.reduce((sum,v)=>sum+v,0)+(parseFloat(cs.rowGap)||0)*Math.max(0,rows.length-1);
      const positionedTracks = rows.length && Math.abs(height-used)>.1 && !['normal', 'stretch'].includes(cs.alignContent);
      if (positionedTracks && rows.length === 1) {
        const itemHeight = Math.max(...itemStyles.map(style => parseFloat(style?.height) || parseFloat(cs.lineHeight) || parseFloat(cs.fontSize)*1.2));
        // A centered fixed track plus an end-aligned short item is neither the
        // full card's center nor its end. Do not silently claim either anchor.
        if (rows[0]-itemHeight>.1 && anchor(itemAlignment)!==anchor(cs.alignContent)) return approximate();
        if (['normal','stretch'].includes(itemAlignment) && rows[0]-(parseFloat(cs.lineHeight)||0)>.1)
          warnings.push(`${name}: 轨道内文字布局使用单文本框近似`);
      }
      alignment = positionedTracks ? cs.alignContent : itemAlignment;
      if (rows.length>1) warnings.push(`${name}: 多轨文字布局使用单文本框近似`);
    }
    if (cs.writingMode !== 'horizontal-tb' || /space-|safe /.test(alignment))
      warnings.push(`${name}: 复杂文字对齐使用简化映射`);
    return cs.writingMode !== 'horizontal-tb' ? 'top' : anchor(alignment, reversed);
  };
  const graphics = [...board.querySelectorAll('svg,canvas')];
  const outsideClippingAncestor = el => {
    const box = el.getBoundingClientRect();
    for (let ancestor = el.parentElement; ancestor && ancestor !== board; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const clipsX = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX);
      const clipsY = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const clip = ancestor.getBoundingClientRect();
      if ((clipsX && (box.right <= clip.left || box.left >= clip.right)) ||
          (clipsY && (box.bottom <= clip.top || box.top >= clip.bottom))) return true;
    }
    return false;
  };
  for (const el of board.querySelectorAll('*')) {
    if ((el.matches('img[data-crop-image]') && el.parentElement?.matches('[data-crop-frame="1"]')) || (el.closest('svg') && !el.matches('svg'))) continue;
    const cs = getComputedStyle(el), box = rect(el);
    if (!el.getClientRects().length || cs.visibility === 'hidden' || cs.opacity === '0' || !box.w || !box.h || outsideClippingAncestor(el)) continue;
    const name = el.dataset.el || el.className?.baseVal || String(el.className || el.tagName);
    const fill = cssColor(cs.backgroundColor);
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({
      side, width: (parseFloat(cs[`border${side}Width`]) || 0) * box.scale,
      style: cs[`border${side}Style`], color: cssColor(cs[`border${side}Color`]),
    }));
    const visibleBorder = side => side.width > 0 && !['none', 'hidden'].includes(side.style) && side.color.transparency < 100;
    // Uniform positive 2D scale/rotation retain native local geometry. Skew,
    // reflections and 3D keep the existing approximation with explicit notes.
    const corners = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => {
      const parts = cs[`border${corner}Radius`].split(/\s+/);
      const length = (value, size) => value.endsWith('%') ? parseFloat(value) * size / 100 : parseFloat(value) * box.scale;
      return [length(parts[0], box.w), length(parts[1] || parts[0], box.h)];
    });
    // CSS reduces all radii by a common factor when adjacent corners overlap.
    const factor = Math.min(1, ...[
      box.w / (corners[0][0] + corners[1][0]), box.w / (corners[3][0] + corners[2][0]),
      box.h / (corners[0][1] + corners[3][1]), box.h / (corners[1][1] + corners[2][1]),
    ]);
    const [rx, ry] = corners[0].map(value => value * factor);
    const near = (a, b) => Math.abs(a - b) < .01;
    const uniformCorners = corners.every(([x, y]) => near(x * factor, rx) && near(y * factor, ry));
    const geometry = box.supported && uniformCorners && (near(rx, ry) || (near(rx, box.w / 2) && near(ry, box.h / 2)))
      ? { type: near(rx, ry) ? (rx > 0 ? 'roundRect' : 'rect') : 'ellipse', radius: rx } : null;
    const first = sides[0];
    const uniformStroke = geometry && sides.every(side => visibleBorder(side) && side.style === 'solid' &&
      side.width === first.width && side.color.color === first.color.color && side.color.transparency === first.color.transparency) &&
      first.width < Math.min(box.w, box.h) && (geometry.type !== 'roundRect' || geometry.radius > first.width / 2) ? first : null;
    const container = !el.matches('img,svg,canvas');
    if (container && (fill.transparency < 100 || uniformStroke)) {
      // CSS borders lie inside the border box; DrawingML strokes straddle their path.
      const inset = uniformStroke ? uniformStroke.width / 2 : 0;
      emit(el, { kind: 'shape', x: box.x + inset, y: box.y + inset, w: box.w - inset * 2, h: box.h - inset * 2,
        name, fill, geometry: geometry?.type || 'rect', radius: Math.max(0, (geometry?.radius || 0) - inset),
        stroke: uniformStroke, opacity: Number(cs.opacity), rotation: box.rotation });
    }
    if (!container || !uniformStroke) for (const border of sides.filter(visibleBorder)) {
      const { side, width, color } = border;
      const points = side === 'Top' ? [box.x, box.y, box.w, 0]
        : side === 'Bottom' ? [box.x, box.y + box.h, box.w, 0]
          : side === 'Left' ? [box.x, box.y, 0, box.h] : [box.x + box.w, box.y, 0, box.h];
      const rad = box.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const point = (x, y) => {
        const dx = x - box.x - box.w / 2, dy = y - box.y - box.h / 2;
        return [box.x + box.w / 2 + cos * dx - sin * dy, box.y + box.h / 2 + sin * dx + cos * dy];
      };
      const a = point(points[0], points[1]), b = point(points[0] + points[2], points[1] + points[3]);
      emit(el, { kind: 'line', points: [a[0], a[1], b[0] - a[0], b[1] - a[1]], width, color, name });
    }
    if ((fill.transparency < 100 || sides.some(visibleBorder)) && (!geometry || (sides.some(visibleBorder) && !uniformStroke))) {
      warnings.push(`${name}: 边框或圆角使用简化映射`);
    }
    if (cs.backgroundImage !== 'none' || cs.filter !== 'none') warnings.push(`${name}: 复杂背景或滤镜`);
    if (!box.supported && !el.matches('svg,canvas')) warnings.push(`${name}: 不支持的变换使用外框近似`);
    if (el.matches('[data-crop-frame="1"]')) {
      const img = el.querySelector(':scope > img[data-crop-image]');
      const actual = globalThis.__htmlDesignCropGeometry(el, globalThis.__htmlDesignGeometry);
      if (!actual.supported) throw new Error(`裁切 CSS 无法可靠导出：${actual.reason}`);
      const imageStyle = getComputedStyle(img), g = globalThis.__htmlDesignGeometry(el);
      const inset = ['Left','Top','Right','Bottom'].map(side => (parseFloat(cs[`border${side}Width`]) || 0) + (parseFloat(cs[`padding${side}`]) || 0));
      const w = g.w-inset[0]-inset[2], h = g.h-inset[1]-inset[3];
      const dx = (inset[0]-inset[2])/2, dy = (inset[1]-inset[3])/2;
      const cx = g.cx-origin.left+g.matrix.a*dx+g.matrix.c*dy, cy = g.cy-origin.top+g.matrix.b*dx+g.matrix.d*dy;
      const z = parseFloat(imageStyle.scale) || 1, position = imageStyle.objectPosition.split(/\s+/).map(value => parseFloat(value)/100);
      if (![w,h,z,...position].every(Number.isFinite) || Math.min(w,h,z,img.naturalWidth,img.naturalHeight)<=0) throw new Error('裁切图片坐标无效');
      const fit = imageStyle.objectFit, k = (fit === 'contain' ? Math.min(w/img.naturalWidth,h/img.naturalHeight) : Math.max(w/img.naturalWidth,h/img.naturalHeight))*z;
      const pw=img.naturalWidth*k, ph=img.naturalHeight*k;
      const crop = fit === 'contain' ? null : { l:position[0]*(pw-w)/pw, t:position[1]*(ph-h)/ph, r:(1-position[0])*(pw-w)/pw, b:(1-position[1])*(ph-h)/ph };
      const radius = Math.max(0, rx/box.scale-Math.max(...inset));
      if (!geometry && corners.some(([x,y])=>x>0||y>0)) warnings.push(`${name}: 不统一的图片圆角使用矩形近似`);
      emit(img, { kind:'image', x:cx-w*box.scale/2, y:cy-h*box.scale/2, w:w*box.scale, h:h*box.scale, rotation:box.rotation, name, source:img.currentSrc||img.src, naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight, fit:crop?'crop':fit, crop, mask:geometry && radius>0 ? Math.min(.5,radius/Math.min(w,h)) : 0, maskGeometry:geometry?.type === 'ellipse' ? 'ellipse' : 'roundRect', opacity:Number(cs.opacity), href:img.closest('a')?.href });
    } else if (el.matches('img')) {
      emit(el, { kind: 'image', ...box, name, source: el.currentSrc || el.src, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, fit: cs.objectFit, opacity: Number(cs.opacity), href: el.closest('a')?.href });
    } else if (el.matches('svg[data-shape]')) {
      const kind = el.dataset.shape;
      const endpoints = el.dataset.shapeEndpoints?.trim().split(/\s+/).map(Number);
      const connector = ['line','arrow','arrowDouble','arrowElbow'].includes(kind) &&
        endpoints?.length === 4 && endpoints.every(Number.isFinite);
      const heads = el.dataset.shapeHeads || (kind === 'line' ? 'none' : 'end');
      const head = el.dataset.shapeHead || 'open';
      const hasHead = heads !== 'none' && head !== 'none';
      if (connector && el.dataset.shapeRoute !== 'elbow' && el.dataset.shapeShaft !== 'false') {
        const ink = el.querySelector('[data-shape-ink]') || el.lastElementChild || el;
        const stroke = getComputedStyle(ink), strokeWidth = parseFloat(stroke.strokeWidth);
        // Office sizes its line ends relative to the stroke and in preset
        // steps. Only use that approximation for the default arrow outline.
        const defaultHead = head === 'open' && Number(el.dataset.shapeRepeat ?? 1) === 1 &&
          Number(el.dataset.shapeHeadLength ?? 16) === 16 &&
          Number(el.dataset.shapeHeadWidth ?? 18) === 18 &&
          Number(el.dataset.shapeArrowScale ?? 1) === 1 && strokeWidth === 4;
        const matrix = !hasHead || defaultHead ? el.getScreenCTM() : null;
        if (matrix) {
          const [x1, y1, x2, y2] = endpoints;
          const a = new DOMPoint(x1, y1).matrixTransform(matrix);
          const b = new DOMPoint(x2, y2).matrixTransform(matrix);
          const width = strokeWidth * Math.hypot(matrix.a, matrix.b);
          emit(el, {kind: 'line', points: [a.x - origin.left, a.y - origin.top, b.x - a.x, b.y - a.y],
            width, color: cssColor(stroke.stroke),
            beginArrowType: hasHead && heads === 'both' ? 'arrow' : undefined,
            endArrowType: hasHead ? 'arrow' : undefined, nativeConnector: true, name});
          continue;
        }
      }
      // Endpoint arrows saved before the shared DSL have the same ink path,
      // but do not carry the data-shape-arrow marker.
      if ((el.dataset.shapeArrow === '1' || connector) && box.supported) {
        const paths = [...el.querySelectorAll('[data-shape-ink],[data-shape-head-ink]')].map(path => {
          const styles = getComputedStyle(path), points = arrowPath(path.getAttribute('d'),el.viewBox.baseVal,box);
          return points && {points, fill:cssColor(styles.fill), stroke:cssColor(styles.stroke),
            width:parseFloat(styles.strokeWidth)*box.w/el.viewBox.baseVal.width};
        });
        if (paths.length && paths.every(Boolean)) {
          paths.forEach(path => emit(el,{...box,...path,kind:'arrowPath',name}));
          continue;
        }
      }
      const native = { rect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond', star: 'star5', line: 'line', arrow: 'line', blockArrow: 'rightArrow' }[kind];
      const view = el.viewBox.baseVal;
      const radiusScale = view.width && view.height ? Math.min(box.w / view.width, box.h / view.height) : 1;
      const shapeRadius = Number(el.dataset.shapeRadius ?? (kind === 'rect' ? el.dataset.shapeAdjust : 0)) || 0;
      const hex = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value.slice(1).toUpperCase() : '1D1D1F';
      if (native) emit(el, { kind: 'nativeShape', ...box, name, native, shapeKind: kind,
        fill: hex(el.dataset.shapeFill), stroke: hex(el.dataset.shapeStroke),
        width: Number(el.dataset.shapeWidth) || 0, adjust: Number(el.dataset.shapeAdjust) || 0, radius: shapeRadius, radiusScale });
      else emit(el, { kind: 'graphic', ...box, name, index: graphics.indexOf(el) });
      if (['star', 'arrow', 'blockArrow'].includes(kind)) warnings.push(`${name}: PPTX 原生形状的细部参数可能与 HTML 不同`);
      if (shapeRadius > 0 && kind !== 'rect') warnings.push(`${name}: PPTX 原生形状不保留此圆角参数`);
    } else if (el.matches('svg,canvas')) {
      emit(el, { kind: 'graphic', ...box, name, index: graphics.indexOf(el) });
    } else if (el.hasAttribute('data-el') && !el.querySelector('[data-el]') && el.textContent.trim()) {
      // Keep authored breaks, not the browser's width-dependent soft wraps.
      const runs = [], textItems = new Set();
      let lastKey = null, pendingSpace = null, pendingBlockBreak = false;
      const baseStyle = styles(cs, el.textContent, box.scale);
      const append = (text, options) => {
        if (!text) return;
        const key = JSON.stringify(options);
        if (key === lastKey) runs[runs.length - 1].text += text;
        else { runs.push({ text, options }); lastKey = key; }
      };
      const endsLine = () => !runs.length || runs[runs.length - 1].text.endsWith('\n');
      const lineBreak = (options, explicit = false) => {
        pendingSpace = null;
        if (explicit || !endsLine()) append('\n', options);
        pendingBlockBreak = false;
      };
      const appendContent = (text, options) => {
        if (pendingBlockBreak) lineBreak(options);
        if (pendingSpace && !endsLine()) append(' ', pendingSpace);
        pendingSpace = null;
        append(text, options);
      };
      const visit = node => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.textContent.trim()) {
            let item = node.parentElement;
            while (item !== el && item.parentElement !== el) item = item.parentElement;
            textItems.add(item); // actual direct item, or el for anonymous text
          }
          const parentStyle = getComputedStyle(node.parentElement);
          const options = styles(parentStyle, el.textContent, box.scale);
          let text = node.textContent;
          if (parentStyle.textTransform === 'uppercase') text = text.toUpperCase();
          if (parentStyle.textTransform === 'lowercase') text = text.toLowerCase();
          const preserveSpaces = ['pre', 'pre-wrap', 'break-spaces'].includes(parentStyle.whiteSpace);
          const preserveLines = preserveSpaces || parentStyle.whiteSpace === 'pre-line';
          if (!preserveLines) text = text.replace(/\n/g, ' ');
          for (const token of text.match(/\n|[\t\r\f ]+|[^\t\r\f \n]+/g) || []) {
            if (token === '\n') {
              if (pendingBlockBreak) lineBreak(options);
              lineBreak(options, true);
            } else if (!preserveSpaces && /^[\t\r\f ]+$/.test(token)) pendingSpace ||= options;
            else appendContent(token, options);
          }
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const nodeStyle = getComputedStyle(node);
        if (nodeStyle.display === 'none' || nodeStyle.visibility === 'hidden' || nodeStyle.opacity === '0') return;
        const options = styles(nodeStyle, el.textContent, box.scale);
        if (node.tagName === 'BR') {
          if (pendingBlockBreak) lineBreak(options);
          lineBreak(options, true);
          return;
        }
        const parentStyle = node.parentElement && getComputedStyle(node.parentElement);
        const layoutItem = node !== el && ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(parentStyle?.display);
        // Flex/Grid blockify inline children; that does not make each child a paragraph.
        const columnItem = layoutItem && parentStyle.display.includes('flex') && parentStyle.flexDirection.startsWith('column');
        const block = node !== el && (layoutItem ? columnItem : ['block', 'flow-root', 'flex', 'grid', 'list-item', 'table-row'].includes(nodeStyle.display));
        if (block) lineBreak(options);
        else if (layoutItem && parseFloat(parentStyle.columnGap) > 0) pendingSpace ||= options;
        for (const child of node.childNodes) visit(child);
        if (block) { pendingSpace = null; pendingBlockBreak = true; }
      };
      visit(el);
      const textRange = document.createRange();
      textRange.selectNodeContents(el);
      const lineRects = [...textRange.getClientRects()].filter(rect => rect.width && rect.height);
      // Office can rewrap a single-line heading measured with browser font metrics.
      const keepOneLine = (cs.display === 'inline-block' || el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) &&
        el.childNodes.length === 1 &&
        el.firstChild.nodeType === Node.TEXT_NODE && !runs.some(run => run.text.includes('\n')) &&
        lineRects.length === 1;
      if (runs.length) emit(el, {
        kind: 'text', ...box, name, runs, ...baseStyle,
        nowrap: keepOneLine,
        align: ['left', 'center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : 'left',
        valign: textVertical(el, cs, name, textItems),
        lineHeight: (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) * box.scale,
        padding: ['Top', 'Right', 'Bottom', 'Left'].map(side => ((parseFloat(cs[`padding${side}`]) || 0) + (parseFloat(cs[`border${side}Width`]) || 0)) * box.scale),
        href: el.closest('a')?.href,
      });
    }
  }
  // Nodes, not public names/classes, own export groups. No metadata enters the DOM.
  const ownLeaves = new Map();
  sources.forEach(node => ownLeaves.set(node, (ownLeaves.get(node) || 0) + 1));
  const candidates = [...board.querySelectorAll('[data-el]')].filter(node =>
    !node.matches('[data-stage],[data-artboard]') && ((ownLeaves.get(node) || 0) > 1 || sources.some(source => source !== node && node.contains(source))));
  const groups = candidates.map((node, i) => ({ id: `g${i}`, name: node.dataset.el }));
  const groupByNode = new Map(candidates.map((node, i) => [node, groups[i].id]));
  items.forEach((item, i) => {
    const path = [];
    for (let node = sources[i]; node && node !== board; node = node.parentElement) {
      if (groupByNode.has(node)) path.unshift(groupByNode.get(node));
    }
    item.groupPath = path;
  });
  return { background: cssColor(getComputedStyle(board).backgroundColor), items, groups, warnings };
}

export async function addEditableSlide({ pptx, slide, data, page, board, context, scale = 1 }) {
  const px = v => v * scale / 96;
  const pt = v => v * scale * .75;
  const textOptions = options => ({
    fontFace: options.fontFace, fontSize: pt(options.fontSize), charSpacing: pt(options.charSpacing || 0),
    bold: options.bold, italic: options.italic, underline: options.underline, strike: options.strike,
    color: options.color, align: options.align,
  });
  slide.background = { color: data.background.transparency === 100 ? 'FFFFFF' : data.background.color };
  for (const item of data.items) {
    const position = { x: px(item.x), y: px(item.y), w: px(item.w), h: px(item.h), rotate: item.rotation || 0, objectName: item.name };
    if (item.kind === 'nativeShape') {
      const isLine = item.native === 'line';
      slide.addShape(pptx.ShapeType[item.native], {
        ...position,
        y: isLine ? px(item.y + item.h / 2) : position.y,
        h: isLine ? 0 : position.h,
        fill: isLine ? { color: 'FFFFFF', transparency: 100 } : { color: item.fill },
        line: { color: item.stroke, width: pt(Math.max(isLine ? 1 : 0, item.width)),
          transparency: item.width ? 0 : 100,
          endArrowType: item.shapeKind === 'arrow' ? 'triangle' : undefined },
        rectRadius: item.shapeKind === 'rect' ? px(item.radius * item.radiusScale) : undefined,
      });
    } else if (item.kind === 'shape') {
      slide.addShape(pptx.ShapeType[item.geometry], {
        ...position, fill: { color: item.fill.color, transparency: 100 - (100 - item.fill.transparency) * item.opacity },
        line: item.stroke ? { color: item.stroke.color.color,
          transparency: 100 - (100 - item.stroke.color.transparency) * item.opacity, width: pt(item.stroke.width) }
          : { transparency: 100 },
        rectRadius: item.geometry === 'roundRect' ? px(item.radius) : undefined,
      });
    } else if (item.kind === 'arrowPath') {
      const points = item.points.map(point => point.close ? {close:true} : {
        x:px(point.x), y:px(point.y), moveTo:point.moveTo,
        ...(point.control ? {curve:{type:'quadratic',x1:px(point.control.x),y1:px(point.control.y)}} : {}),
      });
      slide.addShape(pptx.ShapeType.custGeom, {
        ...position, points, fill:item.fill,
        line:{color:item.stroke.color,transparency:item.width ? item.stroke.transparency : 100,width:pt(item.width)},
      });
    } else if (item.kind === 'line') {
      const [x, y, w, h] = item.points;
      // DrawingML extents cannot be negative. Preserve both directed endpoints
      // by translating to the minimum corner and flipping the normalized path.
      slide.addShape(pptx.ShapeType.line, {
        x: px(Math.min(x, x + w)), y: px(Math.min(y, y + h)), w: px(Math.abs(w)), h: px(Math.abs(h)),
        flipH: w < 0, flipV: h < 0, objectName: item.nativeConnector ? item.name : `${item.name}-border`,
        line: { color: item.color.color, transparency: item.color.transparency, width: pt(item.width), beginArrowType: item.beginArrowType, endArrowType: item.endArrowType },
      });
    } else if (item.kind === 'text') {
      // Explicit segments avoid PptxGenJS treating a trailing newline in a rich run
      // differently from a newline followed by more text in the same run.
      const runs = item.runs.flatMap(run => run.text.split('\n').map((text, i, parts) => ({
        text, options: { ...textOptions(run.options), breakLine: i < parts.length - 1,
          hyperlink: item.href ? { url: item.href } : undefined },
      })));
      slide.addText(runs, {
        ...position, ...textOptions(item),
        x: position.x, y: position.y, w: position.w, h: position.h,
        // PptxGenJS 4 serializes text margins as left/right/bottom/top.
        margin: [item.padding[3], item.padding[1], item.padding[2], item.padding[0]].map(pt), valign: item.valign,
        fit: item.nowrap ? 'shrink' : 'none', wrap: !item.nowrap,
        lineSpacing: pt(item.lineHeight), paraSpaceBefore: 0, paraSpaceAfter: 0,
        lang: 'zh-CN',
      });
    } else {
      let source;
      if (item.kind === 'graphic') {
        const png = await board.locator('svg,canvas').nth(item.index).screenshot({ type: 'png', scale: 'device' });
        source = `image/png;base64,${png.toString('base64')}`;
      } else if (item.source.startsWith('data:')) {
        if (/;base64,/i.test(item.source)) source = item.source;
        else {
          const response = await fetch(item.source);
          const mime = (response.headers.get('content-type') || 'image/png').split(';')[0];
          source = `data:${mime};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
        }
      }
      else {
        const response = await context.request.get(item.source);
        if (!response.ok()) throw new Error('图片读取失败，请替换后重试');
        source = `data:${response.headers()['content-type'] || 'image/png'};base64,${(await response.body()).toString('base64')}`;
      }
      // SVG previews are not generated by PptxGenJS in Node. Rasterize unsupported
      // sources at their intrinsic aspect, keeping Fit/Cover and a separate image object.
      if (/^(?:data:)?image\/(?:svg\+xml|webp|avif)[;,]/i.test(source)) {
        source = await page.evaluate(async data => {
          const image = new Image(); image.src = data; await image.decode();
          const k = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * k));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * k));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/png');
        }, source);
      }
      const sizing = ['cover', 'contain'].includes(item.fit) ? { type: item.fit, w: position.w, h: position.h } : undefined;
      // PptxGenJS calculates crop from the supplied intrinsic aspect, then uses sizing as the viewport.
      const intrinsic = sizing && item.naturalWidth ? { w: position.w, h: position.w * item.naturalHeight / item.naturalWidth } : {};
      slide.addImage({ ...position, ...intrinsic, sizing, data: source, transparency: (1 - (item.opacity ?? 1)) * 100, altText: item.name, hyperlink: item.href ? { url: item.href } : undefined });
    }
  }
  slide.addNotes(data.warnings.length ? `文字和图片均为可编辑元素。以下效果可能简化：\n${data.warnings.join('\n')}` : '文字和图片均为可编辑元素。');
}

// Runs in the existing export browser, on trusted PptxGenJS XML, never design scripts.
export function groupEditableSlideXml({ xml, owners, groups, pictures = [] }) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  if (doc.querySelector('parsererror')) throw new Error('PPTX XML 无法解析，组合导出已停止');
  const tree = doc.getElementsByTagNameNS(p, 'spTree')[0];
  if (!tree) throw new Error('PPTX 缺少对象树，组合导出已停止');
  const leaves = [...tree.children].filter(node => ['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(node.localName));
  if (leaves.length !== owners.length || [...tree.children].some(node => node.localName === 'grpSp')) {
    throw new Error('PPTX 对象对应关系不一致，组合导出已停止');
  }
  pictures.forEach((picture,i) => {
    if (!picture) return;
    const leaf = leaves[i]; if (leaf.localName !== 'pic') throw new Error('PPTX 裁切对象对应关系无效');
    const make = (name, attributes={}) => { const n=doc.createElementNS(a, `a:${name}`);for(const [key,value] of Object.entries(attributes))n.setAttribute(key,String(value));return n; };
    if (picture.crop) {
      const fill = leaf.getElementsByTagNameNS(p,'blipFill')[0];
      for(const node of [...fill.children])if(node.localName==='srcRect')node.remove();
      const values = Object.fromEntries(Object.entries(picture.crop).map(([k,v])=>[k,Math.round(Math.max(0,Math.min(1,v))*100000)]));
      fill.insertBefore(make('srcRect',values), [...fill.children].find(n=>n.localName==='stretch') || null);
    }
    if (picture.mask) {
      const properties=leaf.getElementsByTagNameNS(p,'spPr')[0];
      for(const node of [...properties.children])if(['prstGeom','custGeom'].includes(node.localName))node.remove();
      const geometry=make('prstGeom',{prst:picture.maskGeometry||'roundRect'}), list=make('avLst');
      if (picture.maskGeometry !== 'ellipse') list.append(make('gd',{name:'adj',fmla:`val ${Math.round(picture.mask*100000)}`}));geometry.append(list);
      properties.insertBefore(geometry, [...properties.children].find(n=>['noFill','solidFill','gradFill','blipFill','pattFill','grpFill','ln','effectLst','effectDag','scene3d','sp3d','extLst'].includes(n.localName))||null);
    }
  });
  const definitions = new Map(groups.map(group => [group.id, group]));
  if (definitions.size !== groups.length) throw new Error('PPTX 组合标识重复');
  const root = { children: [] }, registry = new Map();
  owners.forEach((path, i) => {
    let parent = root;
    for (const id of path) {
      if (!definitions.has(id)) throw new Error('PPTX 组合归属未知');
      let group = registry.get(id);
      if (!group) {
        group = { ...definitions.get(id), children: [], parent };
        registry.set(id, group); parent.children.push(group);
      }
      // The DOM walk must yield contiguous subtrees; otherwise grouping changes paint order.
      if (group.parent !== parent || parent.children.at(-1) !== group) throw new Error('PPTX 组合顺序不连续');
      parent = group;
    }
    parent.children.push({ node: leaves[i] });
  });
  let nextId = Math.max(0, ...[...doc.getElementsByTagNameNS(p, 'cNvPr')].map(node => Number(node.getAttribute('id')) || 0)) + 1;
  const element = (ns, name, attributes = {}) => {
    const node = doc.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  const bounds = node => {
    const properties = [...node.children].find(child => ['spPr', 'grpSpPr', 'xfrm'].includes(child.localName));
    const xfrm = properties?.localName === 'xfrm' ? properties : properties?.getElementsByTagNameNS(a, 'xfrm')[0];
    const off = xfrm && [...xfrm.children].find(child => child.localName === 'off');
    const ext = xfrm && [...xfrm.children].find(child => child.localName === 'ext');
    if (!off || !ext) throw new Error('PPTX 对象缺少可组合坐标');
    const values = [off.getAttribute('x'), off.getAttribute('y'), ext.getAttribute('cx'), ext.getAttribute('cy')].map(Number);
    if (!values.every(Number.isFinite) || values[2] < 0 || values[3] < 0) throw new Error('PPTX 组合坐标无效');
    const [x, y, w, h] = values, rad = Number(xfrm.getAttribute('rot') || 0) / 60000 * Math.PI / 180;
    const width = Math.abs(Math.cos(rad) * w) + Math.abs(Math.sin(rad) * h), height = Math.abs(Math.sin(rad) * w) + Math.abs(Math.cos(rad) * h);
    return [x + (w - width) / 2, y + (h - height) / 2, width, height];
  };
  const render = entry => {
    if (entry.node) return entry.node;
    const children = entry.children.map(render);
    if (children.length === 1) return children[0]; // Omit a wrapper that adds no useful grouping.
    const boxes = children.map(bounds);
    const x = Math.floor(Math.min(...boxes.map(box => box[0]))), y = Math.floor(Math.min(...boxes.map(box => box[1])));
    const w = Math.max(1, Math.ceil(Math.max(...boxes.map(box => box[0] + box[2]))) - x);
    const h = Math.max(1, Math.ceil(Math.max(...boxes.map(box => box[1] + box[3]))) - y);
    const group = element(p, 'p:grpSp'), nv = element(p, 'p:nvGrpSpPr');
    nv.append(element(p, 'p:cNvPr', { id: nextId++, name: entry.name }), element(p, 'p:cNvGrpSpPr'), element(p, 'p:nvPr'));
    const properties = element(p, 'p:grpSpPr'), xfrm = element(a, 'a:xfrm');
    xfrm.append(element(a, 'a:off', { x, y }), element(a, 'a:ext', { cx: w, cy: h }),
      element(a, 'a:chOff', { x, y }), element(a, 'a:chExt', { cx: w, cy: h }));
    properties.append(xfrm); group.append(nv, properties, ...children);
    return group;
  };
  // Build first, then replace only drawable children; retain spTree schema properties/extLst.
  const result = root.children.map(render);
  for (const node of leaves) if (node.parentNode === tree) node.remove();
  const extension = [...tree.children].find(node => node.localName === 'extLst') || null;
  for (const node of result) tree.insertBefore(node, extension);
  return new XMLSerializer().serializeToString(doc);
}
