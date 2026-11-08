---
name: dom-slides
description: 生成和局部修改可视化编辑的 HTML 演示、PPT 设计、海报或多页画板，支持浏览器编辑、AI 修改审阅及 PDF/可编辑 PPTX 导出。用户要求制作这类设计、修改已有 HTML 设计稿或将其导出为 PDF/PPTX 时使用。
---

# dom-slides

产出是**单个 HTML 文件**：内容 + 样式 + 内嵌编辑器。人在浏览器中可编辑、管理页面和播放，并保存为 HTML；外链图片、字体、CSS 仍需要其资源可用。AI 和人改的是同一份文件，必须保留下列结构和用户状态。

先区分**安装的 skill 目录**与**完整源码根目录**：读取 skill 内的 `editor.js` 可用于新稿内嵌，但协作、测量、导出服务命令必须在含根 `package.json`、`package-lock.json` 和已安装依赖的源码目录运行。需要本地服务时先读 [运行环境](references/runtime.md)，优先复用已有匹配源码和服务；不要在安装目录直接执行 `npm start`。

## 1. 文件骨架（必须）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>标题</title>

<!-- 设计变量：颜色、字体、圆角、间距。全局改风格只改这里 -->
<style data-design>
:root{
  --primary:#2f6bff; --text:#1a1a1a; --muted:#6b7280; --bg:#ffffff;
  --font:"Inter","PingFang SC",system-ui,sans-serif;
  --radius:12px; --gap:24px;
}
</style>

<!-- 组件与排版样式 -->
<style>
body{margin:0;background:#e9e9ec;font-family:var(--font);color:var(--text)}
[data-stage]{display:flex;flex-direction:column;align-items:center;gap:40px;padding:40px 0}
[data-artboard]{position:relative;width:1280px;height:720px;overflow:hidden;
  background:var(--bg);box-sizing:border-box;padding:64px}
/* …组件 class… */
</style>
</head>
<body>
<main data-stage>
  <section data-artboard="p1" data-title="封面" data-mode="flow" class="page cover">
    <h1 data-el="p1-title" class="title">主标题</h1>
    <p data-el="p1-subtitle" class="subtitle">副标题</p>
  </section>
  <section data-artboard="p2" data-title="目录" data-mode="flow" class="page">
    …
  </section>
</main>

<!-- 编辑器：把 editor.js 原文完整放进来，一个字都不要改 -->
<script data-editor>/* editor.js 原文 */</script>
</body>
</html>
```

## 2. 页面（画板）

- 每一页是 `<main data-stage>` 下的一个 `<section data-artboard="pN" data-title="…">`。
- `data-artboard` 在整个文件里唯一，按 `p1, p2, p3…` 编号。新增页面编号取现有最大编号与舞台 `data-page-seq` 的较大值 +1，并更新 `data-page-seq`；**不要复用删除过的编号**，不要因为插入或排序去给已有页面重新编号。
- `data-title` 写简短的页面名，会显示在左侧缩略图下面。
- 新页面一律写 `data-mode="flow"`（排版模式）。**不要自己生成 `data-mode="artboard"`**：画板模式只能由人在编辑器里切换，这样才会留下可以还原排版的快照。
- 页面尺寸写在 CSS 里（默认 1280×720）。同一个文件里的页面尺寸尽量一致。
- 所有页面都保留在舞台中，显隐交给编辑器管理。**编辑画布仅提供单页居中预览**；连续展示仅用于「滚动播放」；不要自行隐藏其他页面，翻页说明见第 6 节。

## 3. 元素（data-el）

- 当前编辑对象由 `data-el` 显式标记，尚不自动发现任意普通 HTML；真实 DOM 负责几何和排版。人可能想移动、改字、替换的每个可见块都要加 `data-el`，包括标题、段落、按钮、图片、卡片、图标、装饰图形。
- 命名格式是 `页id-语义`，例如 `p1-title`、`p3-card2`、`p3-card2-icon`。**整个文件内唯一**，已有的 id 永远不要改。
- 可以嵌套：卡片是 `data-el`，卡片里的标题、文字也是 `data-el`。只有不嵌套 `data-el` 的元素才能双击改字，所以文字要放在自己单独的 `data-el` 元素上。
- 纯布局用的包装层（只用来做 flex 或 grid）不需要加 `data-el`。
- 文字直接写在 HTML 里，不要用 JS 或 CSS `content` 生成。

## 4. 样式规则

- 颜色、字体、圆角等都引用 `data-design` 里的变量，不要到处写死。
- 用 class 写样式，同一个组件复用同一个 class。
- 排版优先用 flex 或 grid，让元素按排版自然排列，**不要自己写大量 `position:absolute`**。需要精确摆放时，由人切到画板模式处理。
- 常规排版直接使用浏览器原生 CSS Grid/Flex，无需 Bootstrap 等框架；用户明确要求框架或已有稿依赖框架时沿用其选择。
- 根据内容选择布局：Grid 适合图文分栏、卡片矩阵和跨行列关系；Flex 适合单轴排列、页眉页脚与内容组。两栏可用 `1fr 1fr` 或 `1fr 1.5fr`，等宽三栏可用 `repeat(3, minmax(0, 1fr))`，间距用 `gap`。12列只在多区域跨度需要共同基准时采用，不作为所有页面的固定模板。
- 多列内容易受长文字或图片的默认最小尺寸撑开：按需使用 `minmax(0, 1fr)`、子项 `min-width:0`；固定高度内容区还需检查行轨道与子项最小高度。让浏览器计算实际几何，再按第9节检查换行和越界，不用缩放整块内容掩盖排版问题。
- **不要使用 CSS 的 `translate` 属性**（编辑器用它来记录拖动），位移请用 `transform`。
- 不要给 `data-el` 元素的 `position / left / top / width / min-height / translate / margin` 加 `!important`，否则编辑器写的内联样式会失效。
- 可以用入场动画，但动画的结束状态必须是可见的（用 `animation-fill-mode: both` 或 `forwards`）。
- **不要让内容依赖 JS 才变得可见**，例如"滚动到了才加 `.visible`"这类效果。没触发前元素是透明的，缩略图也会是空白。
- 字体用 `<link rel="stylesheet">` 或 `@font-face` 引入，不要用 JS 加载。
- 图片用稳定的 URL 或 data URI，并给出宽高或比例，避免加载后布局跳动。
- 不要给 `[data-stage]` 写 `transform` 或 `margin-bottom`，编辑器的缩放功能要用它们。
- 编辑器顶部工具栏 52px、左侧页面栏 170px、底部状态栏 40px（窄屏会适配）。重要内容应相对画板布局，不要依赖窗口 `position:fixed`。舞台的居中、缩放和平移由编辑器的临时样式处理，页内留白应写在画板里。
- 不要写 `html-design-editor`、`html > *`、`html > :last-child` 这类会选中 `<html>` 直接子元素的选择器。
- 不要让页面自己隐藏非当前页（比如 `.slide{display:none} .slide.active{display:block}`）。编辑器默认只显示当前页，它会给当前页加上 `data-editor-current` 属性。如果确实需要自己的翻页逻辑，就监听 `editor:goto` 事件。
- 文字放在 `data-el` 元素里，不要再嵌套 `data-el`。嵌套了 `data-el` 的元素不能直接改字。
- 图片用 `<img data-el>`，这样才能双击裁切、通过工具条替换、拖动改大小。

## 5. 脚本规则

内容可以有交互（tab、手风琴、轮播、按钮等）。查看模式下这些交互正常运行；编辑模式下编辑器会拦截它们，内容脚本不需要做任何处理。

- 交互脚本写在单独的 `<script>` 里，放在 `<script data-editor>` 之前。
- **必须能重复运行。** 保存时存的是当前 DOM，重新打开后脚本会再跑一遍。不要在加载时生成元素；如果确实要生成，先检查元素是否已经存在。
- 不要在 window 的捕获阶段对 pointer/click/key 事件调用 `stopPropagation`。
- 不要在加载时删除或重建 `[data-artboard]` 或 `[data-el]` 元素。
- 以下名字是保留的，不能使用：`window.__htmlDesignEditor`、`<html-design-editor>` 元素、以 `data-editor` 开头的属性（包括 `data-editor-on`、`data-editor-nav`、`data-editor-single`、`data-editor-current`）、`data-editing`、`data-flow-style`、`data-thumb-*`、`editor:goto` 事件。

## 6. 编辑、页面管理与 AI 审阅

编辑器提供单页居中、左侧缩略图管理、页脚翻页，以及滚动播放和全屏播放，不需要内容脚本重复实现。所有页面保留在 DOM 中，不要用自己的 class 或 CSS 隐藏非当前页；打印和导出仍包含全部页面。

默认是画布预览。普通元素拖动、改字和源码应用需点击「编辑」；页面新增、复制、重命名、上下移动、删除和缩略图排序可直接在预览操作。它们在后台等待原窗口保存并交接写权限，保持预览模式；AI 接管等待与修改阶段锁定写操作。

AI 经协作 `commit` 后，待审阅页底显示「放弃｜接受」：悬停或键盘聚焦「放弃」原位查看修改前，离开或 Escape 返回修改后，点击才撤回；「接受」只更新审阅记录。多页修改在右下汇总，可逐页处理或「全部接受」，列表以真实页码和独立状态标签关联页面，删除页显示原页码。人工修改并保存某页会隐式接受该页 AI 结果，选择、缩放和只读测量不会接受。

共享 CSS、脚本、页外结构或已有页顺序变化使用整份文档范围，放弃会恢复整份文档（保留之前已接受成果）；文档级待审阅后的人工修改会接受整次审阅。不要为了小改动无故触及全局范围。放弃成功后刷新会清空原来的普通撤销/重做历史，不能跨恢复重放旧命令。审阅可在预览直接执行，后台安全交接；等待时切页或播放会取消这次操作，返回后需重新选择。详见 [协作与审阅](references/collaboration.md)。

多选同页同父容器的相邻对象可「组合」，双击逐级进入，Esc结束局部编辑后返回上层；组支持整体移动、旋转、沿方向框的等比角点缩放与取消组合，保存重开保留组参考方向；临时多选方向随当前选择集合保留。编辑画布时 Ctrl/⌘ G、Shift G 组合/取消，Ctrl/⌘ A 全选当前页或组内逻辑对象；输入与裁切保持局部语义，平台键位见「更多 → 快捷键与帮助」。保留 `data-group="1"`/`display:contents` 语义包装和成员CSS，不改写为坐标JSON。布局无法安全保持时拒绝操作；详见[编辑器操作](references/editor-controls.md#组合)。

文字选中后可用「更多 → 文字适配」查看溢出：选择「高度随内容」保持字号、调整文本框，或「缩小字号适配」保持框、按比例缩小到最小 6px；均可一次撤销。适配需明确操作，检测本身不改文档，不是自动 DesignQA。

如果确实需要自己的翻页逻辑，监听 `editor:goto` 事件，通过 `e.detail.index`（从 0 开始）和 `e.detail.id`（画板编号）同步状态。不要自行写入编辑器维护的 `data-editor-current` 属性。

## 7. 编辑器维护的属性（只读，不要手动修改）

| 属性 | 位置 | 含义 |
|---|---|---|
| `data-editor-single` | `<html>` | 编辑器当前启用单页显示 |
| `data-editor-current` | 页面 | 编辑器标记的当前页 |
| `data-mode` | 页面 | `flow` 是排版模式，`artboard` 是画板模式 |
| `data-flow-style` | 画板模式下的页面和顶层元素 | 切换前的 `style` 快照，用于切回排版模式 |
| `data-bbox` | `data-el` | 保存时测得的 `x,y,w,h`（px，相对页面内边距框），供 AI 粗略定位保存时的版面 |
| 内联 `translate` | `data-el` | 排版模式下人拖动的位移 |
| 内联 `left/top/width/min-height/height` | 可编辑元素 | 人调整的位置和尺寸，必须保留 |
| 内联 `font-size/line-height/letter-spacing/word-spacing` | 文字及内部子元素 | 角点缩放或格式工具产生的排版，必须保留 |
| 内联 `object-fit` | 图片 | `contain` 为 Fit，`cover` 为 Cover，必须保留 |
| `data-group="1"` 与 `display:contents` | 语义组合包装 | 保留成员DOM与CSS变换，不作为一个有盒布局容器或改为坐标JSON |
| `data-group-angle-v1` | 组参考方向标量 | 相对真实父坐标轴的UI提示；保留它，不将它再次应用到CSS或导出几何 |
| `data-crop-frame="1"` / `data-crop-image` | 外框 / 内部真实图片 | 外框保留原 `data-el`，内部图片保留 id/class/src/alt；不可拆散或给内部图重复加 `data-el` |
| `data-page-seq / data-element-seq` | 舞台 | 编辑器生成标识的递增计数；删除页面/元素后不回退 |

`data-bbox` 只在保存时更新，是可能过期的粗略线索，不能凭它确认当前重叠、溢出或真实文字排版。当前页面以浏览器 DOM、实际边界和渲染为准。已有实际 DOM 测量时复用结果，不再为同一问题重复调用测量；尚未渲染的纯文本候选可用 Pretext 比较宽度与高度，再由浏览器校验。复杂富文本、Flex/Grid 和不支持的样式回退实测，详见 [文字测量](references/text-measurement.md)。

## 8. 局部修改（用户让你改已有文件时）

**原则：只改需要改的地方，不重新生成整个文件。** 人在编辑器里做过的拖动、尺寸调整和改字都属于需要保留的设计状态，整个重写会把它们丢掉。

通过本地服务打开的 v6 及更新版本文件会自动回写原 HTML。**修改已有文件前，先读取 [协作流程](references/collaboration.md)，使用 `collaborate.mjs begin` 等待浏览器保存并交接，只修改返回的工作副本，再用 `commit` 提交。** 不要直接覆盖原路径，也不要运行首次生成脚本重建已有设计。版本冲突时保留工作副本，重新同步后局部修改。

离线或旧版文件没有自动回写。若浏览器中仍有编辑页，先同步当前 DOM 或最新下载 HTML；读取含 base64 图片的 DOM 时应分块提取并校验总长度，避免工具截断。升级编辑器时尤其不能以旧磁盘文件覆盖未保存的页面。

1. 先读文件，用 `data-artboard` 和 `data-el` 定位要改的页面和元素。
2. 用最小的文本替换来修改，替换锚点用含 `data-el="…"` 的那一行或那个元素。
3. 不同类型修改的处理方式：
   - **改文字**：只替换元素内部的文字，保留标签和全部属性，包括 `style`、`data-bbox`、`data-flow-style`。
   - **改样式**：优先改 class 或 `data-design` 变量；不要删除人留下的内联 `translate/left/top/width/height/font-size/line-height/object-fit`，除非用户要求"重新排版""复位"。
   - **画板模式的页面**（`data-mode="artboard"`）：新增的顶层元素也要写 `position:absolute;left;top;width`，放在空白位置。如果修改了某个元素的 class 或排版相关样式，同时删掉这个元素的 `data-flow-style`，免得以后切回排版时还原出旧样式。
   - **新增页面**：按第 2 节的递增编号规则分配新编号，在合适的位置插入 `data-mode="flow"` 的画板，`data-el` 用新页面前缀。
   - **复制页面**：分配新的 `data-artboard`，所有 `data-el` 都重新编号；重映射 DOM `id` 及 SVG/链接引用，删除旧 `data-bbox` 和临时属性。保留当前模式、位置、尺寸、字号、图片模式和有效的 `data-flow-style` 快照，维持原有外观。
   - **删除页面或元素**：整个删掉，其他元素的 id 不要变。
4. **不要局部修改 `<script data-editor>` 里的内容。** 编辑器源码在完整源码根目录的 `html-design/src/`，修改后在该根目录运行 `npm run build` 生成 `html-design/editor.js`。升级 HTML 时在协作工作副本中把内嵌脚本整体替换成新版构建产物，保持页面内容不变。
5. 改完后简要说明改了哪些页面、哪些 `data-el`。

## 9. 生成后自检

文字密集或文本框尺寸不确定时，按需使用 [文字测量](references/text-measurement.md) 比较尚未渲染的候选，或检查保存快照；已有当前 DOM 事实时直接依据它局部调整，避免重复测量。保存快照还可按需运行 [布局 QA](references/qa.md)，查看溢出/越界、坏图、实际软折行的避首尾及文字对比度；对比度独立于布局支持，需同时查看未确认/同色提示与覆盖边界。检查不替代最终浏览器视觉检查，也不提供自动整体设计评价。

- [ ] 有 `<meta charset="utf-8">`、`<main data-stage>`，`<script data-editor>` 放在 body 最后
- [ ] 每页是 `section[data-artboard][data-title][data-mode="flow"]`，编号唯一
- [ ] 所有可见内容块都有 `data-el`，全文件唯一，文字放在没有嵌套 `data-el` 的元素上
- [ ] 内容 CSS 没有使用 `translate` 属性，没有给定位属性加 `!important`
- [ ] 内容自身不隐藏非当前页，页面显隐由编辑器管理；内容没有依赖 JS 才显示的效果
- [ ] 交互脚本可以重复运行，加载时不生成 `data-el` 元素
- [ ] 内容没有超出页面尺寸（文字不溢出、元素不越界）

## 10. 交付

给出文件路径和可用的预览入口，简述改动的页面/元素与检查结果。只说明本次相关操作：如本地自动保存、AI 修改的放弃/接受、文字适配或导出；不用每次附完整快捷键手册。常用编辑、选择、播放与缩放操作见 [操作参考](references/editor-controls.md)。协作、私有审阅和编辑器的 PDF/PPTX 按钮需要常驻本地服务。

从已保存 HTML 直接导出时可用 `node html-design/export-cli.mjs pptx input.html --output result.pptx`（或 `pdf`），无需打开编辑器或常驻服务；CLI 自行处理临时只读资源。先读 [文件导出说明](references/export-cli.md)，不要把保存快照当作未保存的浏览器 DOM。

## 已知限制

当前已提供文字适配、只读文字检查与布局与文字对比度 QA（含可靠实际软折行的避首尾检测；复杂背景明确未确认）；整体 DesignQA、编辑器反馈 UI 和 AI commit 自动 QA 反馈仍在 [Issue #7 规划](https://github.com/TaoEF/dom-slides/issues/7)。图片已支持按需迁移的框/图裁切、拖图取景、缩放、框边角调整与可撤销会话；布局、变换及导出限制见[操作参考](references/editor-controls.md)。Recharts 图表引擎、调色板与图片色彩语义分析尚未交付。

- 插入的图片会以 base64 写进 HTML，图片多的话文件会变大。
- 在“源码”里应用修改时，新加的 `<script>` 不会马上运行，要保存后重新打开。
- 文字格式用浏览器自带的 `execCommand` 实现，结果是带 style 的 `<span>`。不同浏览器生成的标签可能略有不同。
- 内嵌编辑器可离线普通编辑、撤销、下载 HTML 与浏览器打印；外链图片、字体、CSS 不会自动打包。自动回写、跨窗口交接、AI 私有审阅和编辑器的 PDF/PPTX 按钮依赖常驻本地服务；文件 CLI 可自行启动临时只读资源服务。下载 HTML 不含服务端审阅基线。
- PPTX 保留独立文字和图片，以及作者写出的 `<br>`、段落和保留空白模式的显式换行；浏览器因宽度产生的软折行不固化，PowerPoint / WPS 改框宽后可重新排版。复杂 CSS、滤镜与圆角可能简化；所有画板需相同宽高比，目标电脑需有所用字体，折行不保证与浏览器逐像素一致。


文字、样式或画布尺寸的精确局部修改，可按需使用本地 [Canvas Runtime](references/canvas-runtime.md) 读取保存快照、对有效 AI 工作副本执行稀疏修改，再走既有交接提交与 QA；省略字段保持原样。它只支持显式标识对象和文档列出的操作，不替代复杂 HTML/CSS 编辑。
