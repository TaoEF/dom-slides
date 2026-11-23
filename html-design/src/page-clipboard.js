export const PAGE_CLIPBOARD_TYPE = 'application/x-dom-slides-page+json';
const limit = 12 * 1024 * 1024;
const maxNodes = 1800;
const htmlTags = new Set('section article main aside header footer nav div span p h1 h2 h3 h4 h5 h6 a b strong i em u s del ins mark sub sup small big code pre kbd samp time abbr br wbr hr blockquote cite q dl dt dd ol ul li figure figcaption img table caption colgroup col thead tbody tfoot tr td th'.split(' '));
const svgTags = new Set('svg g path rect circle ellipse line polyline polygon text tspan defs clippath mask lineargradient radialgradient stop pattern marker symbol use image title desc'.split(' '));
const cssProperty = /^(?:width|height|(?:min-|max-)?(?:width|height|inline-size|block-size)|display|position|(?:top|right|bottom|left)|inset(?:-.+)?|box-sizing|aspect-ratio|margin(?:-.+)?|padding(?:-.+)?|border(?:-(?!image).+)?|overflow(?:-[xy])?|opacity|visibility|color|background(?:-.+)?|box-shadow|outline(?:-.+)?|font(?:-.+)?|line-height|letter-spacing|word-spacing|(?:text|white-space)(?:-.+)?|overflow-wrap|word-break|hyphens|vertical-align|direction|writing-mode|flex(?:-.+)?|grid(?:-.+)?|(?:row-|column-)?gap|(?:align|justify|place)(?:-.+)?|order|table-layout|border-collapse|border-spacing|caption-side|empty-cells|object-(?:fit|position)|list-style(?:-.+)?|transform(?:-.+)?|translate|rotate|scale|z-index|isolation|mix-blend-mode|filter|backdrop-filter|clip-path|(?:-webkit-)?mask(?:-.+)?|fill(?:-.+)?|stroke(?:-.+)?|paint-order|vector-effect|stop-color|stop-opacity|dominant-baseline|alignment-baseline|baseline-shift|text-anchor|marker-(?:start|mid|end)|d|cx|cy|r|rx|ry|x|y)$/;
const preserveAuto = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|top|right|bottom|left|margin(?:-.+)?|(?:padding|inset)-.+|grid-template-(?:columns|rows)|flex-basis)$/;
const visualProperties = ['display', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'white-space', 'visibility'];
const transient = /^(?:contenteditable|data-bbox|data-editor(?:-|$)|data-thumb(?:-|$)|data-qa-.*)$/;
const urlAttributes = new Set(['href', 'xlink:href', 'src']);
const plainAttributes = /^(?:id|class|title|lang|dir|alt|role|aria-[\w-]+|colspan|rowspan|scope|headers|span|start|reversed|value|width|height|viewbox|preserveaspectratio|[dc]?x[12]?|[dc]?y[12]?|r[xy]?|d|points|pathlength|transform|opacity|(?:fill|stroke)(?:-[\w-]+)?|clip-path|clip-rule|mask|vector-effect|text-anchor|dominant-baseline|alignment-baseline|baseline-shift|(?:offset|stop-(?:color|opacity))|(?:gradient|pattern|mask|clipPath)[\w-]+|fx|fy|fr|lengthadjust|textlength|marker[\w-]+|orient|ref[xy]|xmlns(?::xlink)?)$/i;
const dataAttributes = /^data-(?:artboard|title|mode|el|flow-style|text-box|(?:shape|crop|group)(?:-[\w-]+)?)$/;

function unsupported() {
  return new Error('此页含有暂不支持整页复制的内容');
}
function nodesOf(board) {
  return [board, ...board.querySelectorAll('*')];
}
function validTag(node) {
  const tag = node.localName.toLowerCase();
  return node.namespaceURI === 'http://www.w3.org/2000/svg'
    ? svgTags.has(tag)
    : node.namespaceURI === 'http://www.w3.org/1999/xhtml' && htmlTags.has(tag);
}
function resourceURL(value, base, kind) {
  if (value.startsWith('#')) {
    if (kind === 'image') throw unsupported();
    return value;
  }
  if (kind === 'local') throw unsupported();
  const url = new URL(value, base);
  if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  if (kind === 'image' && /^data:image\/(?:png|gif|jpe?g|webp|avif|svg\+xml|bmp|x-icon)[;,]/i.test(url.href)) return url.href;
  if (base && url.protocol === 'file:' && base.startsWith('file:')) return url.href;
  if (kind === 'link' && ['mailto:', 'tel:'].includes(url.protocol)) return url.href;
  throw unsupported();
}
function cssValue(value, base, kind) {
  // CSSOM serializes URL tokens with quotes. Reject remaining resource syntax
  // (such as image-set string URLs) rather than passing it through.
  const urls = /url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'\\()]+))\s*\)/gi;
  if (/(?:url\s*\(|image-set\s*\(|(?:-webkit-)?image\s*\(|\\)/i.test(value.replace(urls, ''))) throw unsupported();
  return value.replace(urls, (_, double, single, bare) => {
    const url = resourceURL(double ?? single ?? bare, base, kind);
    return `url("${url.replaceAll('"', '%22')}")`;
  });
}
const cssKind = key => /^(?:background|list-style|mask-image)/.test(key) ? 'image' : 'local';
// Local SVG fragment URLs also occur in masks and clipping.
function paintValue(value, base, key) {
  if (key === 'position' && ['fixed', 'sticky'].includes(value)) throw unsupported();
  return cssValue(value, base, cssKind(key) === 'image' && !/^url\(["']?#/.test(value) ? 'image' : 'local');
}
function readAttributes(node, target, base, capturing) {
  for (const {name, value, namespaceURI} of [...node.attributes]) {
    if (transient.test(name) && capturing) continue;
    if (name === 'style' || name === 'data-flow-style') continue;
    if (capturing && ['srcset', 'sizes', 'loading', 'decoding', 'fetchpriority'].includes(name) && node.matches('img')) continue;
    if (urlAttributes.has(name.toLowerCase())) {
      const kind = node.matches('a') ? 'link' : node.matches('img,image') ? 'image' : 'local';
      if (name === 'src' && !node.matches('img') ||
          name !== 'src' && !node.matches('a,use,image')) throw unsupported();
      const url = resourceURL(value.trim(), base, kind);
      target.setAttributeNS(namespaceURI, name, url);
      continue;
    }
    if (!plainAttributes.test(name) && !dataAttributes.test(name)) {
      if (capturing && /^data-[\w-]+$/.test(name)) continue;
      throw unsupported();
    }
    const paint = /^(?:fill|stroke|clip-path|mask|marker-(?:start|mid|end))$/.test(name);
    target.setAttributeNS(namespaceURI, name, paint ? paintValue(value, base, name) : value);
  }
}
function writeStyle(input, output, base, strict = false) {
  for (const key of input) {
    if (!cssProperty.test(key)) {
      if (strict) throw unsupported();
      continue;
    }
    output.setProperty(key, paintValue(input.getPropertyValue(key), base, key), input.getPropertyPriority(key));
  }
}
function flowStyle(node, target, base, capturing) {
  if (!node.hasAttribute('data-flow-style')) return;
  const authored = target.ownerDocument.createElement('div').style;
  const safe = target.ownerDocument.createElement('div').style;
  authored.cssText = node.getAttribute('data-flow-style');
  writeStyle(authored, safe, base, !capturing);
  target.dataset.flowStyle = safe.cssText;
}
function copyNode(node, doc, base, capturing) {
  const target = doc.createElementNS(node.namespaceURI, node.localName);
  readAttributes(node, target, base, capturing);
  if (capturing) {
    const style = getComputedStyle(node), typed = node.computedStyleMap?.();
    for (const pseudo of ['::before', '::after']) {
      if (!['none', 'normal'].includes(getComputedStyle(node, pseudo).content)) throw unsupported();
    }
    for (const key of style) {
      if (!cssProperty.test(key) || key === 'd') continue;
      // Keep percentages and intrinsic sizing so text boxes and flex/grid
      // descendants can still reflow when the contents are edited.
      const value = preserveAuto.test(key) && typed?.get(key)?.toString() || style.getPropertyValue(key);
      // Chromium exposes its default standard family as Times on macOS.
      // Explicit Times resolves to a different face than the UA default.
      target.style.setProperty(key, key === 'font-family' && value === 'Times' ? 'initial' : paintValue(value, base, key));
    }
    // One resolved responsive image variant travels with the slide.
    if (node.matches('img') && node.currentSrc) {
      target.setAttribute('src', resourceURL(node.currentSrc, base, 'image'));
      if (style.aspectRatio === 'auto' && node.naturalWidth && node.naturalHeight)
        target.style.aspectRatio = `auto ${node.naturalWidth} / ${node.naturalHeight}`;
    }
  } else writeStyle(node.style, target.style, base, true);
  flowStyle(node, target, base, capturing);
  return target;
}
function clonePage(board, capturing, base) {
  const nodes = nodesOf(board);
  if (nodes.length > maxNodes || !board.matches('section[data-artboard],div[data-artboard],article[data-artboard],main[data-artboard]') ||
      nodes.some(n => !validTag(n)) || board.querySelector('[data-artboard],[data-stage]')) throw unsupported();
  const ids = nodes.map(node => node.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw unsupported();
  // Build the tree in an inert document. No imported nodes are adopted into
  // the active document before validation.
  const doc = document.createElement('template').content.ownerDocument;
  const clone = node => {
    const target = copyNode(node, doc, base, capturing);
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) target.append(clone(child));
      if (child.nodeType === Node.TEXT_NODE) target.append(doc.createTextNode(child.data));
    }
    return target;
  };
  return clone(board);
}
function geometry(board) {
  const reference = board.getBoundingClientRect();
  const scaleX = reference.width / board.offsetWidth, scaleY = reference.height / board.offsetHeight;
  return nodesOf(board).map(node => {
    const visible = node.getClientRects().length > 0;
    const rect = node.getBoundingClientRect();
    const frame = visible ? [(rect.x - reference.x) / scaleX, (rect.y - reference.y) / scaleY, rect.width / scaleX, rect.height / scaleY] : null;
    const style = getComputedStyle(node);
    return { frame, paint: visualProperties.map(key => style.getPropertyValue(key)) };
  });
}

export function capturePage(board) {
  const copy = clonePage(board, true, board.baseURI);
  const style = getComputedStyle(board);
  for (const key of ['width', 'height']) copy.style.setProperty(key, style.getPropertyValue(key));
  const data = JSON.stringify({version: 1, html: copy.outerHTML, layout: geometry(board)});
  if (data.length > limit) throw new Error('此页内容过大，无法复制到剪贴板');
  return data;
}
export function readPage(data) {
  if (data.length > limit) throw unsupported();
  const wire = JSON.parse(data);
  if (wire?.failed) throw new Error('上次复制页面未成功，请重新复制');
  if (wire?.version !== 1 || typeof wire.html !== 'string' || !Array.isArray(wire.layout)) throw unsupported();
  const template = document.createElement('template');
  template.innerHTML = wire.html;
  const board = template.content.firstElementChild;
  if (!board || template.content.childNodes.length !== 1) throw unsupported();
  const page = clonePage(board, false, location.protocol === 'file:' ? location.href : undefined);
  if (wire.layout.length !== nodesOf(page).length ||
      wire.layout.some(box => !box || !Array.isArray(box.paint) || box.paint.length !== visualProperties.length ||
        box.paint.some(value => typeof value !== 'string') ||
        box.frame !== null && (!Array.isArray(box.frame) || box.frame.length !== 4 ||
          box.frame.some(value => !Number.isFinite(value) || Math.abs(value) > 1e7)))) throw unsupported();
  return {page, layout: wire.layout};
}

export function verifyPage(board, layout) {
  const actual = geometry(board);
  if (actual.length !== layout.length || actual.some(({frame, paint}, i) => {
    const expected = layout[i];
    return paint.some((value, j) => value !== expected.paint[j]) || !!frame !== !!expected.frame ||
      frame?.some((value, j) => !Number.isFinite(value) || Math.abs(value - expected.frame[j]) > 2);
  })) throw new Error('粘贴会改变此页的布局或样式，已保留目标文件原样');
}
