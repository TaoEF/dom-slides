import { isGroup, groupStructureProblem } from './groups.js';
import { cropGeometry } from './crop-geometry.js';
// Read-only facts from the prepared document; no prediction or repair is applied.
import { QA_OUTPUT, usableQaId, appendQaIssue } from './qa-result.js';
import { elementGeometry } from './geometry.js';
import { checkContrast } from './contrast.js';
import { paintedDiv } from './painted-container.js';
const LIMITS = { elements: 2000, texts: 500, graphemes: 100000, perText: 20000, issues: 500 };
const round = v => Math.round(v * 1000) / 1000;
const START = /^[、。，．！？：；）〕］｝〉》」』】〗〙〛’”％‰…]/u;
const END = /[（〔［｛〈《「『【〖〘〚‘“]$/u;
const CJK_ORPHAN = /^\p{Script=Han}[、。，．！？：；）〕］｝〉》」』】’”…]*$/u;
const SUPPRESSIBLE = new Set(['TEXT_OVERFLOW', 'ANCESTOR_CLIP', 'ELEMENT_OUT_OF_BOUNDS', 'LINE_ORPHAN_CJK', 'LINE_ORPHAN_PUNCTUATION', 'LINE_START_PROHIBITED', 'LINE_END_PROHIBITED', 'VISUAL_CONTAINER_UNMARKED']);
const box = (r, b) => ({ x: round(r.left - b.left), y: round(r.top - b.top), width: round(r.width), height: round(r.height) });
const visible = (el, board) => {
  if (getComputedStyle(el).visibility !== 'visible' || !el.getClientRects().length) return false;
  for (let n = el; n && board.contains(n); n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.opacity === '0' || s.contentVisibility === 'hidden') return false;
  }
  return true;
};
const simpleGeometry = (el, board) => {
  for (let n = el; n && board.contains(n); n = n.parentElement) {
    const s = getComputedStyle(n), m = new DOMMatrix(s.transform);
    if (!m.is2D || Math.abs(m.a - 1) > .0001 || Math.abs(m.d - 1) > .0001 || Math.abs(m.b) > .0001 || Math.abs(m.c) > .0001 ||
      !['none', '0deg'].includes(s.rotate) || !['none', '1', '1 1'].includes(s.scale) || Number(s.zoom) !== 1) return false;
  }
  return true;
};

// Equal font metrics are deliberately required: superscripts and mixed baselines
// cannot be assigned to reliable lines by sorting Range.top values.
function renderedLines(el, board, budget) {
  const cs = getComputedStyle(el), nodes = [el, ...el.querySelectorAll('*')];
  if (!simpleGeometry(el, board) || cs.writingMode !== 'horizontal-tb' || cs.direction !== 'ltr' || cs.columnCount !== 'auto' || cs.columnWidth !== 'auto' ||
    /[\u0590-\u08ff]/u.test(el.textContent) || nodes.some(n => {
      const s = getComputedStyle(n);
      return s.fontSize !== cs.fontSize || s.lineHeight !== cs.lineHeight || s.fontFamily !== cs.fontFamily ||
        !['baseline', 'normal'].includes(s.verticalAlign) || (n !== el && !['inline', 'contents'].includes(s.display)) ||
        s.writingMode !== 'horizontal-tb' || s.direction !== 'ltr' || s.columnCount !== 'auto' || s.columnWidth !== 'auto' ||
        ['::before', '::after'].some(p => !['none', 'normal', '""'].includes(getComputedStyle(n, p).content));
    })) return { unsupported: 'Complex text geometry or mixed baselines.' };
  const segments = [[]];
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  let count = 0, unsupported = false, truncated = false;
  const walk = node => {
    if (unsupported || truncated) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR') { segments.push([]); return; }
      if (!visible(node, board)) { unsupported = true; return; }
      for (const child of node.childNodes) walk(child);
      return;
    }
    if (node.nodeType !== Node.TEXT_NODE) return;
    const preserveNewlines = ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(getComputedStyle(node.parentElement).whiteSpace);
    for (const { segment, index } of segmenter.segment(node.data)) {
      if (++count > LIMITS.perText || budget.checked >= LIMITS.graphemes) { truncated = true; break; }
      budget.checked++;
      if (preserveNewlines && /[\r\n]/.test(segment)) { segments.push([]); continue; }
      const range = document.createRange();
      range.setStart(node, index); range.setEnd(node, index + segment.length);
      const rects = [...range.getClientRects()].filter(r => r.width > .01 && r.height > .01);
      if (rects.length > 1) { unsupported = true; break; }
      if (rects.length) segments.at(-1).push({ text: segment, r: rects[0] });
    }
  };
  for (const child of el.childNodes) walk(child);
  if (truncated) return { truncated: true };
  if (unsupported) return { unsupported: 'Text ranges do not form reliable horizontal lines.' };
  const groups = [];
  for (const chars of segments) {
    const lines = [];
    for (const char of chars) {
      let line = lines.at(-1);
      if (!line || Math.abs(line.top - char.r.top) > 1) {
        if (line && char.r.top <= line.top + 1) return { unsupported: 'Text ranges are not in visual line order.' };
        line = { top: char.r.top, chars: [] }; lines.push(line);
      }
      line.chars.push(char);
    }
    groups.push(lines.map(line => ({ text: line.chars.map(c => c.text).join('').trim(),
      rect: { left: Math.min(...line.chars.map(c => c.r.left)), top: line.top,
        width: Math.max(...line.chars.map(c => c.r.right)) - Math.min(...line.chars.map(c => c.r.left)),
        height: Math.max(...line.chars.map(c => c.r.height)) } })).filter(l => l.text));
  }
  return { groups };
}

export async function checkVisualDocument({ boards, candidates, textResult }) {
  const issues = [], elements = [], pageIds = boards.map(b => b.dataset.artboard);
  const idCounts = new Map(), nodeById = new Map();
  const coverage = { elements: { seen: 0, checked: 0, hidden: 0, unsupported: 0, limit: LIMITS.elements },
    containers: { seen: 0, unmarked: 0, limit: LIMITS.elements },
    text: { seen: candidates.length, checked: textResult.checkedCount, linesChecked: 0, unsupported: 0, hidden: 0, unmarked: 0, limit: LIMITS.texts, perTextCodeUnitLimit: 20000 },
    graphemes: { checked: 0, limit: LIMITS.graphemes, perTextLimit: LIMITS.perText }, suppressed: 0, issuesOmitted: 0, issueBytes: 2, evidenceOmitted: 0 };
  const output = { issues, coverage, truncated: false };
  let truncated = textResult.truncated, incomplete = textResult.truncated;
  const target = (board, el) => ({ pageId: usableQaId(board?.dataset.artboard) && pageIds.filter(v => v === board.dataset.artboard).length === 1 ? board.dataset.artboard : null,
    elementId: usableQaId(el?.dataset.el) && idCounts.get(el.dataset.el) === 1 ? el.dataset.el : null });
  const emit = (code, board, el, evidence = {}, severity = 'warning') => {
    const ignored = new Set((el?.getAttribute('data-qa-ignore') || '').split(/\s+/));
    if (SUPPRESSIBLE.has(code) && ignored.has(code)) { coverage.suppressed++; return; }
    appendQaIssue(output, { code, severity, ...target(board, el), evidence });
  };
  for (const board of boards) {
    for (const el of board.querySelectorAll('[data-el]')) {
      const id = el.dataset.el;
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
      nodeById.set(id, el);
    }
  }
  for (const board of boards) {
    if (!usableQaId(board.dataset.artboard) || pageIds.filter(v => v === board.dataset.artboard).length !== 1) { incomplete = true; emit('ID_INVALID', board, null, { kind: 'page', length: board.dataset.artboard?.length ?? 0 }, 'error'); }
    for (const el of board.querySelectorAll('div:not([data-el])')) {
      if (++coverage.containers.seen > LIMITS.elements) { truncated = incomplete = true; break; }
      if (!visible(el, board) || !paintedDiv(el)) continue;
      coverage.containers.unmarked++;
      const path = [];
      for (let n = el; n && n !== board && path.length < 32; n = n.parentElement)
        path.unshift([...n.parentElement.children].indexOf(n));
      emit('VISUAL_CONTAINER_UNMARKED', board, el, { path, box: box(el.getBoundingClientRect(), board.getBoundingClientRect()) });
    }
    for (const el of board.querySelectorAll('[data-el],img')) {
      if (++coverage.elements.seen > LIMITS.elements) { truncated = incomplete = true; break; }
      elements.push({ board, el });
    }
    if (truncated && coverage.elements.seen > LIMITS.elements) break;
  }
  for (const { board, el } of elements) {
    if (el.hasAttribute('data-el') && (!usableQaId(el.dataset.el) || idCounts.get(el.dataset.el) !== 1)) { incomplete = true; emit('ID_INVALID', board, el, { kind: 'element', length: el.dataset.el.length }, 'error'); }
    if (isGroup(el)) {
      const reason=groupStructureProblem(el);
      if (reason) { incomplete=true; coverage.elements.unsupported++; emit('GEOMETRY_UNSUPPORTED',board,el,{reason}); }
      continue;
    }
    if (!visible(el, board)) { incomplete = true; coverage.elements.hidden++; emit('HIDDEN_CONTENT', board, el); continue; }
    const r = el.getBoundingClientRect(), b = board.getBoundingClientRect();
    const cropMarked = el.matches('img[data-crop-image]') && el.parentElement?.matches('[data-crop-frame="1"]');
    const cropFact = cropMarked && cropGeometry(el.parentElement, elementGeometry), cropInternal = cropFact?.supported;
    if (cropMarked && !cropInternal) { incomplete = true; coverage.elements.unsupported++; emit('GEOMETRY_UNSUPPORTED', board, el.parentElement, { reason: cropFact.reason }); }
    if (!cropInternal && (r.left < b.left - 1 || r.top < b.top - 1 || r.right > b.right + 1 || r.bottom > b.bottom + 1))
      emit('ELEMENT_OUT_OF_BOUNDS', board, el, { box: box(r, b), page: { width: round(b.width), height: round(b.height) } });
    if (!simpleGeometry(el, board) && !elementGeometry(el).supported) { incomplete = true; coverage.elements.unsupported++; emit('GEOMETRY_UNSUPPORTED', board, el); }
    else coverage.elements.checked++;
    if (el.tagName === 'IMG') {
      el.loading = 'eager';
      let timer;
      try {
        await Promise.race([el.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image decode timed out.')), 5000); })]);
        if (!el.naturalWidth) throw new Error('Image has no decoded pixels.');
      } catch {
        emit('IMAGE_LOAD_FAILED', board, el.closest('[data-el]'), { source: /^(data|blob):/.test(el.currentSrc || el.src) ? '[embedded]' : (el.currentSrc || el.src).slice(0, 200) }, 'error');
      } finally { clearTimeout(timer); }
    }
  }
  const legacyCodes = { unmarked: 'TEXT_UNMARKED', 'invalid-id': 'ID_INVALID', hidden: 'HIDDEN_CONTENT', unsupported: 'TEXT_UNSUPPORTED', error: 'TEXT_MEASUREMENT_FAILED' };
  const uncheckable = new Set();
  for (const item of textResult.issues) {
    const board = boards.find(b => b.dataset.artboard === item.pageId), el = nodeById.get(item.elementId);
    if (legacyCodes[item.status]) {
      incomplete = true; uncheckable.add(el);
      if (item.status === 'unsupported') coverage.text.unsupported++;
      if (item.status === 'hidden') coverage.text.hidden++;
      if (item.status === 'unmarked') coverage.text.unmarked++;
      emit(legacyCodes[item.status], board, el, { reason: item.code || item.status }, ['error', 'invalid-id'].includes(item.status) ? 'error' : 'warning');
    } else {
      if (item.overflow) emit('TEXT_OVERFLOW', board, el, { requiredHeight: item.requiredHeight, availableHeight: item.availableHeight, box: item.box });
      if (item.clippedBy?.length) {
        if (item.clippedBy.length > QA_OUTPUT.clippingAncestors) {
          truncated = incomplete = true;
          coverage.evidenceOmitted += item.clippedBy.length - QA_OUTPUT.clippingAncestors;
        }
        const clippedBy = item.clippedBy.slice(0, QA_OUTPUT.clippingAncestors).map(ancestor => {
          const bounded = { ...ancestor };
          for (const key of ['elementId', 'id']) {
            if (ancestor[key] !== null && ancestor[key] !== undefined && !usableQaId(ancestor[key])) {
              incomplete = true;
              emit('ID_INVALID', board, el, { kind: 'clipping-ancestor', attribute: key, length: ancestor[key].length }, 'error');
              bounded[key] = null;
            }
          }
          // Custom element tag names are author controlled as well.
          if (ancestor.tag.length > QA_OUTPUT.idCodeUnits) {
            bounded.tag = null;
            truncated = incomplete = true;
            coverage.evidenceOmitted++;
          }
          return bounded;
        });
        emit('ANCESTOR_CLIP', board, el, { clippedBy, box: item.box });
      }
    }
  }
  for (const { board, el, marked } of candidates.slice(0, LIMITS.texts)) {
    if (!marked || uncheckable.has(el) || !usableQaId(el.dataset.el) || idCounts.get(el.dataset.el) !== 1 || !visible(el, board)) continue;
    const result = renderedLines(el, board, coverage.graphemes);
    if (result.truncated) { truncated = incomplete = true; coverage.text.unsupported++; emit('SCAN_LIMIT', board, el, { kind: 'graphemes' }); continue; }
    if (result.unsupported) { incomplete = true; coverage.text.unsupported++; emit('LINE_UNSUPPORTED', board, el, { reason: result.unsupported }); continue; }
    coverage.text.linesChecked++;
    let lineNumber = 0;
    for (const lines of result.groups) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i], evidence = { line: ++lineNumber, text: line.text.slice(0, 80), box: box(line.rect, board.getBoundingClientRect()) };
        if (i > 0 && START.test(line.text)) emit('LINE_START_PROHIBITED', board, el, evidence);
        if (i < lines.length - 1 && END.test(line.text)) emit('LINE_END_PROHIBITED', board, el, evidence);
        if (lines.length > 1 && i === lines.length - 1 && CJK_ORPHAN.test(line.text)) emit('LINE_ORPHAN_CJK', board, el, evidence);
        if (lines.length > 1 && /^\p{P}$/u.test(line.text)) emit('LINE_ORPHAN_PUNCTUATION', board, el, evidence);
      }
    }
  }
  const contrastIncomplete = await checkContrast({ boards, coverage, emit, output });
  incomplete ||= contrastIncomplete;
  if (truncated) emit('SCAN_LIMIT', null, null, { limits: LIMITS });
  truncated ||= output.truncated;
  return { schemaVersion: 1, status: issues.length || incomplete || truncated ? 'issues' : 'ok', units: 'css-px',
    pageCount: boards.length, textCount: textResult.textCount, checkedCount: textResult.checkedCount, truncated, coverage, issues };
}
