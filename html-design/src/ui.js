import styles from "./editor.css";
import { icon, button as b } from "./icons.js";
import { reviewHTML } from './review.js';
const shapeIcons = {
  rect: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  triangle: '<path d="M12 3 22 20H2Z"/>',
  diamond: '<path d="M12 2 22 12 12 22 2 12Z"/>',
  star: '<path d="m12 2 2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.3l7.1-.7Z"/>',
  line: '<path d="M2 12h20" fill="none"/>',
  arrow: '<path d="M2 12h20m-7-7 7 7-7 7" fill="none"/>',
  blockArrow: '<path d="M2 8h12V3l8 9-8 9v-5H2Z"/>',
};
const shapeLabels = { rect: '矩形', ellipse: '椭圆', triangle: '三角形', diamond: '菱形', star: '星形', line: '直线', arrow: '线箭头', blockArrow: '块箭头' };
const shapePalette = Object.entries(shapeIcons).map(([kind, drawing]) =>
  `<button type="button" data-act="shape-insert" data-shape-kind="${kind}" title="${shapeLabels[kind]}" aria-label="${shapeLabels[kind]}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${drawing}</svg></button>`
).join('');
export function toolbarHTML({ HANDLES }) {
  const fmt = (cmd, name, label) =>
    `<button type="button" data-fmt="${cmd}" title="${label}" aria-label="${label}" class="icon-only">${icon(name)}</button>`;
  return `<style>${styles}</style>
  <header class="head" aria-label="编辑器工具栏">
    <div class="grp document">${b("nav", "PanelLeft", "显示或隐藏页面栏", { cls: "icon-only nav-toggle", attrs: 'aria-pressed="true"' })}<span class="document-title title"></span>
      <button class="save-state" data-act="status" title="保存状态"><span class="state-icon">${icon("Check")}</span><span class="state-text">正在连接</span></button></div>
    <div class="grp tools" hidden>${b("undo", "Undo2", "撤销 (Ctrl/⌘ Z)", { cls: "icon-only" })}${b("redo", "Redo2", "重做 (Ctrl/⌘ Shift Z)", { cls: "icon-only" })}
      <div class="seg layout-toggle" role="group" aria-label="编辑模式"><button type="button" data-act="flow" title="自动排版：保留页面原有布局" aria-pressed="true">自动排版</button><button type="button" data-act="artboard" title="手动：自由调整当前页位置" aria-pressed="false">手动</button></div>
      <button type="button" data-act="add-text" class="icon-only add-text" title="添加文字" aria-label="添加文字">${icon("Plus")}${icon("Type")}</button>${b("add-image", "ImagePlus", "添加图片", { cls: "icon-only" })}<button type="button" data-act="add-shape" class="icon-only add-shape" title="添加形状" aria-label="添加形状" aria-expanded="false" aria-haspopup="menu">${icon("Square")}${icon("ChevronDown")}</button></div>
    <div class="grp actions">
      ${b("edit", "Pencil", "编辑画布", { text: "编辑", cls: "edit-button", attrs: 'aria-pressed="false"' })}${b("done", "Check", "完成编辑，返回画布预览", { text: "完成", cls: "done-button", attrs: "hidden" })}
      <button data-act="preview" class="preview-button" title="播放" aria-label="播放" aria-expanded="false" aria-haspopup="menu">${icon("Play")}<span>播放</span>${icon("ChevronDown")}</button>
      <button data-act="export" class="primary" aria-expanded="false" aria-haspopup="menu">${icon("Download")}<span class="export-label">导出</span>${icon("ChevronDown")}</button>
      ${b("more", "Ellipsis", "更多选项", { cls: "icon-only", attrs: 'aria-expanded="false" aria-haspopup="menu"' })}</div>
  </header>
  <aside class="nav" aria-label="页面管理"><div class="nav-head"><strong>页面</strong>${b("page-add", "Plus", "新增页面", { cls: "icon-only" })}</div><div class="thumb-list" role="list" aria-label="页面缩略图"></div></aside>
  <footer class="footer"><div class="page-controls">${b("prev", "ChevronLeft", "上一页 (PageUp / ←)", { cls: "icon-only" })}<span class="pageno"></span>${b("next", "ChevronRight", "下一页 (PageDown / →)", { cls: "icon-only" })}<button class="page-title" data-act="page-rename" title="重命名当前页面"></button></div>
    <div class="zoom">${b("zoom-out", "Minus", "缩小 (Ctrl/⌘ −)", { cls: "icon-only" })}<button data-act="zoom-reset" class="zv" title="恢复 100% (Ctrl/⌘ 0)">100%</button>${b("zoom-in", "Plus", "放大 (Ctrl/⌘ +)", { cls: "icon-only" })}${b("zoom-fit", "Scan", "适应窗口 (Ctrl/⌘ 1)", { cls: "fit", text: "适应" })}</div></footer>
  <div class="tbar" role="toolbar" aria-label="元素工具" hidden>
    <span class="selection-count" role="status" aria-live="polite" hidden></span>
    <div class="text-tools"><input class="fs" type="number" min="6" max="999" aria-label="字号" title="字号，单位 px">${fmt("bold", "Bold", "加粗 (Ctrl/⌘ B)")}
      <label class="color-control" title="文字颜色" aria-label="文字颜色"><span class="color-swatch"></span><input type="color" class="cpick" aria-label="文字颜色"></label>
      ${b("text-align", "AlignLeft", "左对齐；点击切换为居中", { cls: "icon-only text-align" })}</div>
    <div class="image-tools" hidden>${b("image-replace", "RefreshCw", "替换图片", { text: "替换" })}<div class="seg" role="group" aria-label="图片填充模式"><button data-act="image-fit" title="完整显示，保持比例">适应</button><button data-act="image-cover" title="裁切铺满，保持比例">填充</button></div></div>
    <div class="shape-tools" hidden><label class="color-control shape-color shape-fill-color" title="填充色"><span class="shape-swatch"></span><input type="color" data-shape-prop="fill" aria-label="填充色"></label><label class="color-control shape-color shape-stroke-color" title="描边色"><span class="shape-swatch"></span><input type="color" data-shape-prop="stroke" aria-label="描边色"></label><div class="shape-width-control" role="group" aria-label="线宽"><span>线宽</span><div class="shape-number-field"><input type="number" min="0" max="16" step="1" data-shape-prop="width" aria-label="线宽"><div class="shape-steps"><button type="button" data-act="shape-width-up" title="增加线宽" aria-label="增加线宽">${icon("ChevronUp")}</button><button type="button" data-act="shape-width-down" title="减小线宽" aria-label="减小线宽">${icon("ChevronDown")}</button></div></div></div><label class="shape-number shape-adjust">调整<input type="range" min="0" max="50" step="1" data-shape-prop="adjust"></label></div>
    <div class="object-tools">${b("element-more", "Ellipsis", "元素操作", { cls: "icon-only", attrs: 'aria-expanded="false" aria-haspopup="menu"' })}</div>
  </div>
  <div class="sel">${HANDLES.map((h) => `<i data-h="${h}" title="${h.length === 2 ? "拖动缩放（文字角点同步缩放字号）" : "调整边界，不改变字号"}"></i>`).join("")}</div>
  <div class="menu-panel text-layout-panel" data-menu="text-layout" role="menu" hidden><strong>文字适配</strong><p class="text-layout-status" role="status" aria-live="polite"></p>${b("text-height", "TextCursorInput", "保持字号，按内容调整文本框高度", { text: "高度随内容" })}${b("text-fit", "Type", "保持文本框，缩小字号以完整显示（最小 6px）", { text: "缩小字号适配" })}</div>
  <div class="menu-panel" data-menu="play" role="menu" hidden>${b("scroll-play", "PanelsTopBottom", "滚动播放：上下滚动浏览全部页面", { text: "滚动播放" })}${b("fullscreen", "Maximize", "全屏播放", { text: "全屏播放" })}</div>
  <div class="menu-panel shape-palette" data-menu="shape" role="menu" aria-label="选择形状" hidden>${shapePalette}</div>
  <div class="menu-panel pop" data-menu="export" role="menu" hidden>
    ${b("pdf", "FileText", "下载 PDF", { text: "PDF 文档" })}${b("pptx", "Presentation", "下载 PPTX（文字和图片可编辑）", { text: "PowerPoint · 可编辑" })}<div class="menu-separator"></div>
    ${b("download", "Download", "下载 HTML", { text: "下载 HTML" })}${b("copy", "Copy", "复制 HTML", { text: "复制 HTML" })}${b("print", "Printer", "浏览器打印 / PDF", { text: "打印" })}
  </div>
  <div class="menu-panel" data-menu="more" role="menu" hidden>${b("source", "Code", "查看或修改源码", { text: "源码" })}${b("save", "Save", "立即保存 (Ctrl/⌘ S)", { text: "立即保存" })}<div class="menu-separator"></div>${b("help", "TextCursorInput", "快捷键与使用帮助", { text: "快捷键与帮助" })}</div>
  <div class="menu-panel" data-menu="element" role="menu" hidden><div class="more-text-section" hidden><div class="more-text-formats" role="group" aria-label="更多文字格式">${fmt("italic", "Italic", "斜体")}${fmt("underline", "Underline", "下划线")}${fmt("strikeThrough", "Strikethrough", "删除线")}</div>${b("text-layout", "TextCursorInput", "文字适配：检测溢出、调整高度和字号", { text: "文字适配", attrs: 'aria-expanded="false" aria-haspopup="menu"' })}<button data-fmt="removeFormat">${icon("Type")}清除文字格式</button><div class="menu-separator"></div></div>${b("element-duplicate", "Copy", "复制元素 (Ctrl/⌘ D)", { text: "复制元素" })}${b("element-front", "BringToFront", "置于顶层", { text: "置于顶层" })}${b("element-back", "SendToBack", "置于底层", { text: "置于底层" })}${b("element-delete", "Trash2", "删除元素 (Delete)", { text: "删除元素" })}</div>
  <div class="menu-panel" data-menu="page" role="menu" hidden>${b("page-add", "Plus", "在此后新增页面", { text: "新增页面" })}${b("page-copy", "Copy", "复制页面", { text: "复制页面" })}${b("page-rename", "TextCursorInput", "重命名页面", { text: "重命名" })}<div class="menu-separator"></div>${b("page-up", "ArrowUp", "上移页面", { text: "上移" })}${b("page-down", "ArrowDown", "下移页面", { text: "下移" })}<div class="menu-separator"></div>${b("page-delete", "Trash2", "删除页面", { text: "删除页面" })}</div>
  <div class="menu-panel status-panel" data-menu="status" role="menu" hidden><p class="status-detail"></p>${b("retry", "RefreshCw", "重试保存", { text: "重试", attrs: "hidden" })}${b("recover", "RefreshCw", "恢复未保存草稿", { text: "恢复草稿", attrs: "hidden" })}${b("conflict", "Download", "下载当前副本并同步最新文件", { text: "下载副本并同步", attrs: "hidden" })}</div>
  <div class="empty-canvas" hidden>${icon("Presentation")}<p>从第一页开始</p>${b("page-add", "Plus", "新增页面", { text: "新增页面", cls: "primary" })}</div>
  <div class="play-controls"><button data-act="prev" aria-label="上一页">${icon("ChevronLeft")}</button><span class="pageno"></span><button data-act="next" aria-label="下一页">${icon("ChevronRight")}</button><span class="play-title"></span>${b("stop", "X", "退出播放 (Esc)", { cls: "icon-only" })}</div>${b("stop", "X", "退出播放 (Esc)", { cls: "icon-only play-exit" })}
  <div class="modal" role="dialog" aria-label="HTML 源码" aria-modal="true" hidden><div class="box"><div class="mh"><b>源码</b><span class="hint">Ctrl/⌘ Enter 应用；新脚本保存后重新打开运行。</span><span class="sp"></span>${b("src-copy", "Copy", "复制源码", { text: "复制" })}${b("src-download", "Download", "下载源码", { text: "下载" })}<button data-act="src-apply" class="primary">应用</button>${b("src-close", "X", "关闭源码", { cls: "icon-only" })}</div><textarea spellcheck="false" aria-label="HTML 源码"></textarea></div></div>
  ${reviewHTML()}
  <input type="file" accept="image/*" multiple hidden class="file"><div class="toast" role="status" aria-live="polite"></div>`;
}
