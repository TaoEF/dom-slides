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
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };
  const font = (cs, text) => {
    const names = cs.fontFamily.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    const cjk = /[\u3400-\u9fff]/.test(text) && names.find(s => /PingFang|YaHei|Noto Sans CJK|Heiti|SimSun/i.test(s));
    return cjk || names[0] || 'Arial';
  };
  const styles = (cs, text) => ({
    fontFace: font(cs, text), fontSize: parseFloat(cs.fontSize),
    bold: Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold', italic: cs.fontStyle === 'italic',
    underline: cs.textDecorationLine.includes('underline'), strike: cs.textDecorationLine.includes('line-through'),
    color: cssColor(cs.color).color, charSpacing: parseFloat(cs.letterSpacing) || 0,
  });
  const graphics = [...board.querySelectorAll('svg,canvas')];
  for (const el of board.querySelectorAll('*')) {
    if (el.closest('svg') && !el.matches('svg')) continue;
    const cs = getComputedStyle(el), box = rect(el);
    if (!el.getClientRects().length || cs.visibility === 'hidden' || cs.opacity === '0' || !box.w || !box.h) continue;
    const name = el.dataset.el || el.className?.baseVal || String(el.className || el.tagName);
    const fill = cssColor(cs.backgroundColor);
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({
      side, width: parseFloat(cs[`border${side}Width`]) || 0,
      style: cs[`border${side}Style`], color: cssColor(cs[`border${side}Color`]),
    }));
    const visibleBorder = side => side.width > 0 && !['none', 'hidden'].includes(side.style) && side.color.transparency < 100;
    // Only merge geometry we can express faithfully. Translations are harmless;
    // scaled/rotated/skewed boxes need the existing side-specific approximation.
    let axisAligned = true;
    for (let node = el; node && node !== board.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node), matrix = new DOMMatrix(style.transform);
      if (!matrix.is2D || matrix.a !== 1 || matrix.d !== 1 || matrix.b || matrix.c ||
          !['none', '0deg'].includes(style.rotate) || !['none', '1'].includes(style.scale) || Number(style.zoom) !== 1) axisAligned = false;
    }
    const corners = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => {
      const parts = cs[`border${corner}Radius`].split(/\s+/);
      const length = (value, size) => value.endsWith('%') ? parseFloat(value) * size / 100 : parseFloat(value);
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
    const geometry = axisAligned && uniformCorners && (near(rx, ry) || (near(rx, box.w / 2) && near(ry, box.h / 2)))
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
        stroke: uniformStroke, opacity: Number(cs.opacity) });
    }
    if (!container || !uniformStroke) for (const border of sides.filter(visibleBorder)) {
      const { side, width, color } = border;
      const points = side === 'Top' ? [box.x, box.y, box.w, 0]
        : side === 'Bottom' ? [box.x, box.y + box.h, box.w, 0]
          : side === 'Left' ? [box.x, box.y, 0, box.h] : [box.x + box.w, box.y, 0, box.h];
      emit(el, { kind: 'line', points, width, color, name });
    }
    if ((fill.transparency < 100 || sides.some(visibleBorder)) && (!geometry || (sides.some(visibleBorder) && !uniformStroke))) {
      warnings.push(`${name}: 边框或圆角使用简化映射`);
    }
    if (cs.backgroundImage !== 'none' || cs.filter !== 'none') warnings.push(`${name}: 复杂背景或滤镜`);
    if (el.matches('img')) {
      emit(el, { kind: 'image', ...box, name, source: el.currentSrc || el.src, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, fit: cs.objectFit, opacity: Number(cs.opacity) });
    } else if (el.matches('svg[data-shape]')) {
      const kind = el.dataset.shape;
      const native = { rect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond', star: 'star5', line: 'line', arrow: 'line', blockArrow: 'rightArrow' }[kind];
      const view = el.viewBox.baseVal;
      const radiusScale = view.width && view.height ? Math.min(box.w / view.width, box.h / view.height) : 1;
      const hex = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value.slice(1).toUpperCase() : '1D1D1F';
      const drawing = el.firstElementChild;
      const bounds = drawing?.getBBox?.(), matrix = drawing?.getScreenCTM?.();
      const corners = bounds && matrix ? [
        [bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
        [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix)) : [];
      const painted = corners.length ? {
        x: Math.min(...corners.map(p => p.x)) - origin.left,
        y: Math.min(...corners.map(p => p.y)) - origin.top,
        w: Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)),
        h: Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)),
      } : box;
      if (native) emit(el, { kind: 'nativeShape', ...painted, name, native, shapeKind: kind,
        fill: hex(el.dataset.shapeFill), stroke: hex(el.dataset.shapeStroke),
        width: Number(el.dataset.shapeWidth) || 0, adjust: Number(el.dataset.shapeAdjust) || 0, radiusScale });
      else emit(el, { kind: 'graphic', ...box, name, index: graphics.indexOf(el) });
      if (['star', 'arrow', 'blockArrow'].includes(kind)) warnings.push(`${name}: PPTX 原生形状的细部参数可能与 HTML 不同`);
    } else if (el.matches('svg,canvas')) {
      emit(el, { kind: 'graphic', ...box, name, index: graphics.indexOf(el) });
    } else if (el.hasAttribute('data-el') && !el.querySelector('[data-el]') && el.textContent.trim()) {
      // Keep authored breaks, not the browser's width-dependent soft wraps.
      const runs = [];
      let lastKey = null, pendingSpace = null, pendingBlockBreak = false;
      const baseStyle = styles(cs, el.textContent);
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
          const parentStyle = getComputedStyle(node.parentElement);
          const options = styles(parentStyle, el.textContent);
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
        const options = styles(nodeStyle, el.textContent);
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
      if (runs.length) emit(el, {
        kind: 'text', ...box, name, runs, ...baseStyle,
        align: ['left', 'center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : 'left',
        lineHeight: parseFloat(cs.lineHeight) || baseStyle.fontSize * 1.2,
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(v => parseFloat(v) || 0),
        href: el.closest('a')?.href,
      });
    }
  }
  // Nodes, not public names/classes, own export groups. No metadata enters the DOM.
  const candidates = [...board.querySelectorAll('[data-el]')].filter(node =>
    !node.matches('[data-stage],[data-artboard]') && sources.some(source => source !== node && node.contains(source)));
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
    const position = { x: px(item.x), y: px(item.y), w: px(item.w), h: px(item.h), objectName: item.name };
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
        rectRadius: item.shapeKind === 'rect' ? px(item.adjust * item.radiusScale) : undefined,
      });
    } else if (item.kind === 'shape') {
      slide.addShape(pptx.ShapeType[item.geometry], {
        ...position, fill: { color: item.fill.color, transparency: 100 - (100 - item.fill.transparency) * item.opacity },
        line: item.stroke ? { color: item.stroke.color.color,
          transparency: 100 - (100 - item.stroke.color.transparency) * item.opacity, width: pt(item.stroke.width) }
          : { transparency: 100 },
        rectRadius: item.geometry === 'roundRect' ? px(item.radius) : undefined,
      });
    } else if (item.kind === 'line') {
      const [x, y, w, h] = item.points;
      slide.addShape(pptx.ShapeType.line, {
        x: px(x), y: px(y), w: px(w), h: px(h), objectName: `${item.name}-border`,
        line: { color: item.color.color, transparency: item.color.transparency, width: pt(item.width) },
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
        x: position.x, y: position.y, w: position.w + px(2), h: position.h + px(2),
        margin: item.padding.map(pt), valign: 'top', fit: 'none', wrap: true,
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
      slide.addImage({ ...position, ...intrinsic, sizing, data: source, transparency: (1 - (item.opacity ?? 1)) * 100, altText: item.name });
    }
  }
  slide.addNotes(data.warnings.length ? `文字和图片均为可编辑元素。以下效果可能简化：\n${data.warnings.join('\n')}` : '文字和图片均为可编辑元素。');
}

// Runs in the existing export browser, on trusted PptxGenJS XML, never design scripts.
export function groupEditableSlideXml({ xml, owners, groups }) {
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
    return values;
  };
  const render = entry => {
    if (entry.node) return entry.node;
    const children = entry.children.map(render);
    if (children.length === 1) return children[0]; // Omit a wrapper that adds no useful grouping.
    const boxes = children.map(bounds);
    const x = Math.min(...boxes.map(box => box[0])), y = Math.min(...boxes.map(box => box[1]));
    const w = Math.max(1, Math.max(...boxes.map(box => box[0] + box[2])) - x);
    const h = Math.max(1, Math.max(...boxes.map(box => box[1] + box[3])) - y);
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
