import { icon } from './icons.js';

// A static, sandboxed view. Never insert the baseline into the editable stage.
export function beforeHTML(html, scope, baseURL) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,frame,object,embed,base,meta[http-equiv],[data-editor-ui],[data-editor-connection],style[data-editor-style]').forEach(n => n.remove());
  doc.querySelectorAll('form').forEach(n => n.replaceWith(...n.childNodes));
  for (const n of [doc.documentElement, ...doc.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) if (/^on/i.test(a.name) || /^data-editor-/.test(a.name) || ['data-editing', 'contenteditable', 'autofocus', 'srcdoc'].includes(a.name) || /^(?:javascript|vbscript):/i.test(a.value.trim())) n.removeAttribute(a.name);
    if (n.matches('a,area')) { n.removeAttribute('href'); n.removeAttribute('target'); }
  }
  if (scope !== 'document' && scope !== 'all') for (const page of doc.querySelectorAll('[data-artboard]')) if (page.dataset.artboard !== scope) page.remove();
  const base = doc.createElement('base'); base.href = baseURL;
  const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
  csp.content = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline' http: https:; img-src data: blob: http: https:; font-src data: http: https:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri ${new URL(baseURL).origin}`;
  doc.head.prepend(csp, base);
  doc.body.inert = true;
  const style = doc.createElement('style'); style.textContent = 'html,body{margin:0!important;min-height:100%!important}body{pointer-events:none!important}*,*::before,*::after{animation:none!important;transition:none!important}'; doc.head.append(style);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

export function createReview({ ui, persistence, navigate, view, restoreTarget, toast }) {
  const bar = ui.querySelector('.review-actions'), summary = ui.querySelector('.review-summary'), trigger = summary.querySelector('.review-trigger'), panel = summary.querySelector('.review-panel'), list = summary.querySelector('.review-list');
  const projection = ui.querySelector('.review-before'), hint = ui.querySelector('.review-hint');
  let state = { review: { items: [], generation: 0 }, revision: '' }, drawn = '', busy = false, active = null, epoch = 0, frame, loaded = null, lastView = '', expanded = false, raf;
  const cache = new Map();
  const pageId = () => view().board?.dataset.artboard || '';
  const cacheKey = id => `${state.revision}:${state.review.generation}:${state.review.scope}:${id}`;
  const enabled = () => state.canReview && !busy && !state.review.conflict;
  function endBefore() {
    epoch++; active = null; loaded = null; projection.hidden = true; projection.replaceChildren(); frame = null; hint.hidden = true;
  }
  function setExpanded(on, focus = false) {
    expanded = on; panel.hidden = !on; trigger.setAttribute('aria-expanded', String(on));
    if (focus) (on ? panel.querySelector('button') : trigger)?.focus();
    position();
  }
  function button(text, command, item) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.dataset.reviewCommand = command; b.dataset.reviewId = item.id;
    if (command === 'undo') b.title = item.kind === 'added' ? '放弃新增页面' : '悬停或聚焦查看修改前；点击放弃';
    return b;
  }
  function actions(container, item, documentScope = false) {
    container.replaceChildren();
    const undo = button(documentScope ? '放弃整份文档修改' : '放弃', 'undo', item);
    if (documentScope) undo.title = '悬停或聚焦查看当前页修改前；点击确认后放弃整份文档的待审阅修改';
    const accept = button('接受', 'accept', item); accept.className = 'review-accept'; container.append(undo, accept);
  }
  function update(next) {
    const changed = next.revision !== state.revision || next.review.generation !== state.review.generation;
    if (changed || next.reviewing || (state.canReview && !next.canReview)) endBefore();
    state = next;
    if (changed) cache.clear();
    const documentScope = state.review.scope === 'document';
    const key = JSON.stringify([state.review.generation, state.review.scope, state.review.items]);
    if (key !== drawn) {
      drawn = key; list.replaceChildren();
      for (const item of state.review.items) {
        const row = document.createElement('div'); row.className = 'review-item review-row'; row.dataset.reviewRow = item.id;
        const title = document.createElement('button'); title.type = 'button'; title.className = 'review-name'; title.title = item.title; title.dataset.reviewCommand = 'locate'; title.dataset.reviewId = item.id;
        if (documentScope || item.kind === 'deleted') title.disabled = true;
        if (!documentScope) { const number = document.createElement('span'); number.className = 'review-page'; number.textContent = `${item.kind === 'deleted' ? '原第' : '第'} ${item.kind === 'deleted' ? item.originalPage : item.currentPage} 页 ·`; title.append(number); }
        const name = document.createElement('span'); name.className = 'review-title'; name.textContent = item.title; title.append(name);
        const kind = document.createElement('span'); kind.className = 'review-kind'; kind.textContent = { added: '新增', updated: '修改', deleted: '删除' }[item.kind];
        const controls = document.createElement('div'); controls.className = 'review-item-actions'; actions(controls, item, documentScope);
        const info = document.createElement('div'); info.className = 'review-info'; info.append(title, kind);
        row.append(info, controls); list.append(row);
      }
    }
    summary.querySelector('.review-count').textContent = state.review.conflict ? 'AI 审阅异常' : documentScope ? '整份文档' : `${state.review.items.length} 页修改`;
    summary.querySelector('.review-message').textContent = state.review.conflict ? '文件在审阅之外发生变化，基线已保留，请下载副本后排查。' : documentScope ? `放弃将撤回整份文档中所有尚未接受的 AI 修改。${state.review.reasons.join('；')}` : state.canReview ? '可直接处理；人工修改并保存某页，会接受该页的 AI 改动。' : '可直接处理；点击后将自动同步编辑权限。';
    summary.querySelector('[data-review-command=accept-all]').disabled = !enabled();
    position();
    if (!raf && (state.review.items.length || state.review.conflict)) raf = requestAnimationFrame(tick);
  }
  function position() {
    const v = view(), id = v.board?.dataset.artboard || '', review = state.review;
    const item = review.scope === 'pages' ? review.items.find(i => i.id === id && i.kind !== 'deleted') : null;
    const scene = `${id}:${v.playing}:${innerWidth}:${innerHeight}:${v.layoutWidth}:${v.layoutHeight}`;
    if (scene !== lastView) {
      const previous = active, samePage = lastView.split(':')[0] === id;
      lastView = scene; endBefore(); const serial = epoch;
      if (previous && samePage && !v.playing) queueMicrotask(() => { if (serial === epoch && previous.isConnected && (previous.matches(':hover') || ui.activeElement === previous)) startBefore(previous); });
    }
    const showSummary = review.conflict || review.scope === 'document' || review.items.length > 1 || review.items.some(i => i.kind === 'deleted') || (review.items.length === 1 && !item);
    summary.hidden = !!v.playing || !showSummary;
    bar.hidden = !!v.playing || !item || review.conflict;
    if (!showSummary) setExpandedSilently(false);
    if (bar.dataset.reviewId !== (item?.id || '')) {
      bar.dataset.reviewId = item?.id || '';
      if (item) actions(bar, item);
      else bar.replaceChildren();
    }
    for (const b of ui.querySelectorAll('[data-review-command=undo],[data-review-command=accept]')) {
      b.setAttribute('aria-disabled', String(!enabled())); b.disabled = busy || state.reviewing || (b.dataset.reviewCommand === 'accept' && !enabled());
    }
    for (const row of list.children) row.toggleAttribute('data-current', row.dataset.reviewRow === id);
    const bounds = v.bounds, margin = 8;
    summary.style.maxWidth = `${Math.max(160, bounds.w - 2 * margin)}px`;
    summary.style.right = `${Math.max(12, innerWidth - bounds.x - bounds.w + margin)}px`;
    summary.style.bottom = `${Math.max(48, innerHeight - bounds.y - bounds.h + 16)}px`;
    panel.style.maxHeight = `${Math.max(80, bounds.h - (bar.hidden ? 72 : 112))}px`;
    if (!bar.hidden) {
      const r = v.rect || { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, bottom: bounds.y + bounds.h };
      const w = bar.offsetWidth, h = bar.offsetHeight;
      const x = Math.max(bounds.x + margin, Math.min(r.x + r.width / 2 - w / 2, bounds.x + bounds.w - margin - w));
      let y = Math.max(bounds.y + margin, Math.min(r.bottom - h - 12, bounds.y + bounds.h - margin - h));
      if (!summary.hidden) { const s = summary.getBoundingClientRect(); if (x < s.right + 8 && x + w > s.x - 8 && y + h > s.y - 8) y = Math.max(bounds.y + margin, s.y - h - 8); }
      Object.assign(bar.style, { left: `${x}px`, top: `${y}px` });
    }
    if (!projection.hidden && loaded) {
      const r = v.rect || { x: bounds.x + (bounds.w - loaded.width * v.zoom) / 2, y: bounds.y + (bounds.h - loaded.height * v.zoom) / 2 };
      Object.assign(projection.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.w}px`, height: `${bounds.h}px` });
      const clip = projection.firstElementChild;
      Object.assign(clip.style, { left: `${r.x - bounds.x}px`, top: `${r.y - bounds.y}px`, width: `${loaded.width * v.zoom}px`, height: `${loaded.height * v.zoom}px` });
      Object.assign(frame.style, { left: `${-r.x}px`, top: `${-r.y}px` });
      for (const [name, value] of Object.entries({ left: `${r.x - loaded.x * v.zoom}px`, top: `${r.y - loaded.y * v.zoom}px`, transform: `scale(${v.zoom})` })) loaded.stage.style.setProperty(name, value, 'important');
    }
  }
  function setExpandedSilently(on) { expanded = on; panel.hidden = !on; trigger.setAttribute('aria-expanded', String(on)); }
  function tick() { raf = null; position(); if (state.review.items.length || state.review.conflict) raf = requestAnimationFrame(tick); }
  async function startBefore(b) {
    const item = state.review.items.find(i => i.id === b.dataset.reviewId);
    if (!item || item.kind === 'added' || busy || state.reviewing || state.review.conflict || view().playing) { endBefore(); return; }
    endBefore(); active = b; const serial = epoch, current = pageId(), key = cacheKey(item.id);
    hint.textContent = '正在加载修改前…'; hint.hidden = false;
    try {
      let pending = cache.get(key);
      if (!pending) {
        pending = persistence().reviewRead(item.id, state.review.generation); cache.set(key, pending);
        pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
      }
      const result = await pending;
      if (serial !== epoch || active !== b || current !== pageId() || key !== cacheKey(item.id)) return;
      const doc = new DOMParser().parseFromString(result.html, 'text/html');
      const targetId = state.review.scope === 'document' ? (current || doc.querySelector('[data-artboard]')?.dataset.artboard) : item.id;
      if (![...doc.querySelectorAll('[data-artboard]')].some(n => n.dataset.artboard === targetId)) { hint.textContent = '新增页面没有修改前版本'; return; }
      const v = view(), width = v.layoutWidth || 1280;
      frame = document.createElement('iframe'); const ownFrame = frame; frame.title = 'AI 修改前，只读预览'; frame.setAttribute('sandbox', 'allow-same-origin'); frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
      Object.assign(frame.style, { width: `${innerWidth}px`, height: `${innerHeight}px` });
      const clip = document.createElement('div'); clip.className = 'review-projection'; clip.append(frame); projection.style.visibility = 'hidden'; projection.hidden = false; projection.replaceChildren(clip);
      frame.addEventListener('load', async () => {
        try {
        await ownFrame.contentDocument?.fonts?.ready;
        if (serial !== epoch || frame !== ownFrame || current !== pageId()) return;
        const d = ownFrame.contentDocument, target = [...d.querySelectorAll('[data-artboard]')].find(n => n.dataset.artboard === targetId);
        for (const n of d.querySelectorAll('[data-artboard]')) if (n === target || n.contains(target) || target.contains(n)) n.setAttribute('data-review-projection-target', '');
        const fix = d.createElement('style'); fix.textContent = `html,body{overflow:hidden!important}[data-artboard]:not([data-review-projection-target]){display:none!important}[data-stage]{display:block!important;width:${width}px!important;position:fixed!important;inset:auto!important;left:0!important;top:0!important;transform:none!important;transform-origin:0 0!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;gap:0!important;margin:0!important;padding:0!important;overflow:visible!important}[data-artboard]{margin:0!important;flex:none!important}`; d.head.append(fix);
        const rect = target.getBoundingClientRect();
        // Transform the stage inside the real window viewport, so vw/vh and media queries stay faithful.
        loaded = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, stage: target.closest('[data-stage]') };
        if (!loaded.stage) throw new Error('页面缺少画布容器');
        hint.hidden = true; projection.style.visibility = ''; projection.hidden = false; position();
        } catch (error) { if (serial === epoch) { endBefore(); toast(`无法显示修改前：${error.message}`, 6000); } }
      }, { once: true });
      frame.srcdoc = beforeHTML(result.html, 'document', location.href);
    } catch (error) { if (serial === epoch) { endBefore(); toast(error.message, 6000); } }
  }
  ui.addEventListener('pointerover', e => {
    const b = e.target.closest('[data-review-command]'); if (!b || b.contains(e.relatedTarget)) return;
    if (b.dataset.reviewCommand === 'undo') startBefore(b); else if (b.dataset.reviewCommand === 'accept') endBefore();
  });
  ui.addEventListener('pointerout', e => { const b = e.target.closest('[data-review-command=undo]'); if (b && !b.contains(e.relatedTarget)) endBefore(); });
  ui.addEventListener('focusin', e => { const b = e.target.closest('[data-review-command]'); if (b?.dataset.reviewCommand === 'undo') startBefore(b); else if (b?.dataset.reviewCommand === 'accept') endBefore(); });
  ui.addEventListener('focusout', e => { if (e.target.closest('[data-review-command=undo]')) endBefore(); });
  ui.addEventListener('click', async e => {
    const b = e.target.closest('[data-review-command]'); if (!b || busy) return;
    const command = b.dataset.reviewCommand, id = b.dataset.reviewId;
    if (command === 'expand') { setExpanded(!expanded); return; }
    if (command === 'close') { setExpanded(false, true); return; }
    if (command === 'locate') { endBefore(); navigate(id); position(); bar.querySelector('[data-review-command=accept]')?.focus(); return; }
    if (!['undo', 'accept', 'accept-all'].includes(command)) return;
    if (!enabled()) { toast('连接或交接暂不可用，请稍后再试'); return; }
    const item = state.review.items.find(i => i.id === id), initialPage = pageId(), initialEpoch = view().intentEpoch;
    if (command !== 'accept-all' && !item) return;
    const expectedGeneration = state.review.generation;
    const confirmDocumentUndo = command === 'undo' && state.review.scope === 'document';
    if (confirmDocumentUndo && !confirm('放弃整份文档中所有尚未接受的 AI 修改？此操作可能影响多个页面。')) return;
    endBefore(); busy = true; update(state);
    if (command === 'undo' && item?.kind === 'deleted') restoreTarget(id);
    try {
      await persistence().reviewAction(command === 'accept-all' ? 'accept' : command, command === 'accept-all' ? 'all' : id, expectedGeneration, {
        confirmDocumentUndo,
        stillCurrent: () => initialEpoch === view().intentEpoch && initialPage === pageId() && !view().playing,
      });
    }
    catch (error) { toast(error.message, 6000); }
    finally {
      restoreTarget(null); busy = false; update(state);
      if (!b.isConnected || b.closest('[hidden]')) (bar.hidden ? summary.hidden ? ui.querySelector('[data-act=edit]') : trigger : bar.querySelector('[data-review-command=accept]'))?.focus();
      const hovered = ui.querySelector('[data-review-command=undo]:hover');
      if (hovered && !state.reviewing) startBefore(hovered);
    }
  });
  function key(e) {
    if (e.key !== 'Escape' || (!active && projection.hidden && !expanded)) return false;
    e.preventDefault(); e.stopImmediatePropagation();
    if (active || !projection.hidden) endBefore(); else setExpanded(false, true);
    return true;
  }
  return { update, key };
}

export function reviewHTML() {
  return `<div class="review-before" aria-label="修改前只读投影" hidden></div><div class="review-actions" role="group" aria-label="当前页 AI 修改" hidden></div><span class="review-hint" role="status" hidden></span><aside class="review-summary" aria-label="AI 修改汇总" hidden><div class="review-panel" id="ai-review" role="region" aria-label="AI 修改审阅" hidden><div class="review-heading"><strong>AI 修改</strong><button type="button" data-review-command="close" class="icon-only" aria-label="收起审阅">${icon('X')}</button></div><p class="review-message"></p><div class="review-list"></div></div><div class="review-summary-bar"><button type="button" data-review-command="expand" class="review-trigger" aria-expanded="false" aria-controls="ai-review"><span class="review-count"></span>${icon('ChevronDown')}</button><button type="button" data-review-command="accept-all" class="review-accept">全部接受</button></div></aside>`;
}
