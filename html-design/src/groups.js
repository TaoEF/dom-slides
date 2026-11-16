// Groups are semantic DOM wrappers. Their members' CSS remains the only geometry.
export const isGroup = node => !!node?.matches?.('[data-group="1"][data-el]');
export function groupRoots(nodes) {
  const roots = [...new Set(nodes)].filter(n => n?.isConnected);
  const expanded = roots.flatMap(n => isGroup(n) ? groupRoots([...n.children]) : [n]);
  return expanded.filter(n => !expanded.some(other => other !== n && other.contains(n)));
}
export function visibleMember(node) {
  if (!node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') return false;
  for (let n = node; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.opacity === '0' || cs.display === 'none' || cs.contentVisibility === 'hidden') return false;
  }
  return true;
}
export function objectRect(node) {
  if (!isGroup(node)) return node.getBoundingClientRect();
  const rects = groupRoots([node]).filter(visibleMember).map(n => n.getBoundingClientRect());
  if (!rects.length) return new DOMRect();
  const x = Math.min(...rects.map(r => r.left)), y = Math.min(...rects.map(r => r.top));
  return new DOMRect(x, y, Math.max(...rects.map(r => r.right)) - x, Math.max(...rects.map(r => r.bottom)) - y);
}
export function logicalTarget(node, context = null) {
  let target = node?.closest?.('[data-el]');
  if (!target || target === context) return null;
  for (let n = target.parentElement; n && n !== context; n = n.parentElement) if (isGroup(n)) target = n;
  return target;
}
export function groupProblem(nodes) {
  if (nodes.length < 2) return '请选择至少两个同一容器内的对象';
  const parent = nodes[0].parentElement, board = nodes[0].closest('[data-artboard]');
  if (!board || nodes.some(n => n.parentElement !== parent || n.closest('[data-artboard]') !== board)) return '只能组合同页、同一父容器内的对象';
  if (!parent.matches('div,section,article,aside,main,header,footer,nav,figure,figcaption')) return '这种容器暂不支持组合';
  const children = [...parent.children], indices = nodes.map(n => children.indexOf(n)).sort((a,b) => a-b);
  if (indices.at(-1)-indices[0]+1 !== nodes.length) return '请选择顺序相邻的对象，以保留原有绘制顺序';
  const slice = [...parent.childNodes].slice([...parent.childNodes].indexOf(children[indices[0]]), [...parent.childNodes].indexOf(children[indices.at(-1)])+1);
  if (slice.some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) return '对象之间含有独立文字，暂不能安全组合';
  return null;
}
// A live reparent can render correctly but be rewritten by the HTML parser on
// save/reopen. Parse only this board in an inert template before committing it.
export function stableGroupMarkup(board) {
  const template = document.createElement('template');
  template.innerHTML = board.outerHTML;
  return template.content.childNodes.length === 1 && template.content.firstChild.isEqualNode(board);
}
const boxes = node => [...node.getClientRects()].map(r => [r.x,r.y,r.width,r.height]);
const style = (node, pseudo, ignoredStyles) => {
  const cs = getComputedStyle(node, pseudo);
  return [...cs].filter(name => !ignoredStyles.has(name)).map(name => cs.getPropertyValue(name));
};
// Check the live page synchronously before a structural change is committed.
// This catches direct-child/nth-child/ancestor selectors, line wraps and paint order.
export function layoutProbe(board, ignored = [], ignoredStyles = new Set(), { text = true, paintOrder = true } = {}) {
  const nodes = [board, ...board.querySelectorAll('*')].filter(n => !ignored.includes(n));
  const facts = nodes.map(node => ({node, boxes:boxes(node), style:style(node,null,ignoredStyles), pseudo:['::before','::after'].map(p => style(node,p,ignoredStyles))}));
  const texts = [];
  if (text) {
    const walker = document.createTreeWalker(board, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim() || walker.currentNode.parentElement.closest('style,script')) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      texts.push({node:walker.currentNode, boxes:boxes(range)});
    }
  }
  const points = paintOrder ? facts.flatMap(({boxes}) => boxes.flatMap(([x,y,w,h]) => w && h ? [[x+w/2,y+h/2],[x+.5,y+.5],[x+w-.5,y+h-.5]] : [])) : [];
  const paint = ([x,y]) => document.elementsFromPoint(x,y).filter(n => nodes.includes(n));
  const layers = points.map(paint);
  const sameBoxes = (a,b) => a.length === b.length && a.every((r,i) => r.every((v,j) => Math.abs(v-b[i][j]) < .05));
  return () => facts.every(f => f.node.isConnected && sameBoxes(f.boxes,boxes(f.node)) && JSON.stringify(f.style)===JSON.stringify(style(f.node,null,ignoredStyles)) && JSON.stringify(f.pseudo)===JSON.stringify(['::before','::after'].map(p => style(f.node,p,ignoredStyles)))) &&
    texts.every(t => { const range=document.createRange(); range.selectNodeContents(t.node); return sameBoxes(t.boxes,boxes(range)); }) && points.every((p,i) => { const now = paint(p); return now.length === layers[i].length && now.every((n,j) => n === layers[i][j]); });
}

export function groupStructureProblem(group) {
  if (!isGroup(group)) return null;
  const cs = getComputedStyle(group);
  if (cs.display !== 'contents' || cs.transform !== 'none' || cs.rotate !== 'none' || cs.scale !== 'none' || cs.translate !== 'none' || Number(cs.zoom)!==1 || cs.filter !== 'none' || cs.opacity!=='1' || cs.perspective!=='none' ||
    ['::before','::after'].some(p => !['none','normal','""'].includes(getComputedStyle(group,p).content)) ||
    [...group.childNodes].some(n => n.nodeType === Node.ELEMENT_NODE ? !n.hasAttribute('data-el') : n.nodeType === Node.TEXT_NODE && n.textContent.trim()) || !group.children.length)
    return '组合的CSS或结构不受支持，已保留原样';
  return [...group.children].map(groupStructureProblem).find(Boolean) || null;
}
