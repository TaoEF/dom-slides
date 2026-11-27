---
id: feature.export
type: feature
status: active
owners:
  - html-design/export.mjs
  - html-design/pptx.mjs
  - html-design/src/export.js
  - html-design/export-cli.mjs
updated: 2026-11-26
sources:
  - path: html-design/export.mjs
    status: current
  - path: html-design/pptx.mjs
    status: current
  - path: html-design/src/crop-geometry.js
    status: current
  - path: html-design/src/geometry.js
    status: current
  - path: html-design/src/export.js
    status: current
  - path: html-design/src/portable-html.js
    status: current
  - path: html-design/export.test.mjs
    status: current
  - path: html-design/export-cli.mjs
    status: current
  - path: html-design/export-cli.test.mjs
    status: current
  - path: html-design/references/export-cli.md
    status: current
related:
  - architecture.html-design
  - module.editor
  - method.verification
confidence: high
---

# PDF 与可编辑 PPTX 导出

## Summary

编辑器导出点击时的当前 DOM 快照，含未保存编辑；文件 CLI 导出一次读取的已保存 HTML，二者来源不能混淆。PDF 按画板逐页渲染；PPTX 将支持的文字、图片和形状映射为独立对象。

标记 `svg[data-shape]` 的基础形状由导出器识别为原生 PPTX 几何，不按一般 SVG 截图导出；普通作者 SVG 仍走原有图形路径。颜色、线宽与矩形圆角映射为原生属性。星形内径和箭头的细部调整目前在 HTML 中可编辑，PPTX 使用相近的原生预设外形，细部不保证一致；导出后仍可在 PowerPoint 中调整原生形状。


## Source Of Truth

浏览器 `src/export.js` 提交快照；服务 `/__html-design/export/pdf|pptx`；`export.mjs` 使用 Playwright、pdf-lib、PptxGenJS 与运行时 JSZip；`pptx.mjs` 收集和映射对象，并用现有浏览器 DOMParser/XMLSerializer 包装原生组合。


## Contracts

导出不重新读取旧磁盘 HTML。脚本通过 CSP 禁止执行，等待字体图片；最多 100 页，尺寸 1–4096px。PDF 允许逐页不同尺寸；PPTX 页面宽高比须一致。普通文字与 img 不整页扁平化；SVG/canvas 可转为图片。

「导出 → 下载 HTML」使用点击时的序列化 DOM，将可读取的图片、CSS（含 url() 字体和背景资源）及外部编辑器脚本内联为单文件；链接改为绝对 URL。资源读取失败、暂不支持的媒体嵌入或 CSS @import 会中止下载，避免发出表面成功但离线缺失内容的文件。普通保存与源码下载仍保持源文件引用，不承担离线打包语义。

PPTX 每个文字元素对应一个可编辑文本框。普通段落开启 `wrap="square"`，不自动缩小字号或按文字撑宽；浏览器实测单行的标题、页眉页脚、编辑器文本框和行内标签使用 `wrap="none"`。以文字 Range 的行带判定富文本是否同一行，已发生换行的文本片段与紧行高下重叠的多行继续保持可重排。标题和普通行内文字保留字号，inline-block 短标签延续自动适应。多行标题继续使用可重排文本框。只保留 HTML 的显式换行（br、块段落、white-space 保留的换行），不将浏览器因当前宽度产生的软折行固化。普通空白按 CSS 合并，跨 span 保留词间空格，pre/pre-wrap/break-spaces 保留空格。富文本样式继续按 run 映射，混合字号或基线差异不能凭字符几何位置推断换行。Flex/Grid 子项会被浏览器块化，横排子项不能因此各自变成硬段落；正 column-gap 简化为词间空格，Flex column 子项保留纵向分隔。含有已标记子对象的卡片也收集其独立的未标记文本块，按文字块自身坐标导出，并避免重复发出已标记的文字。

带 `data-pptx-font-size="editor"` 的舞台按 72 个画布单位对应 1 英寸导出 PPTX，保留编辑器字号数值及版面比例。此模式同时缩放尺寸、坐标、字号、线宽和间距。常规文档仍按 96 个单位对应 1 英寸。

完全位于 `overflow:hidden/clip/scroll/auto` 祖先可见范围之外的对象在 PPTX 收集阶段跳过，避免原 HTML 中被容器遮住的形状重新出现在幻灯片上；横向与纵向分别按其 overflow 值判断。此规则只处理完全不可见对象；部分越界的祖先裁切仍是现有映射边界，不能宣称与浏览器像素一致。


四边宽度、颜色/透明度一致且为可见实线，配合可可靠表达的统一圆角和可靠的2D旋转/正向均匀缩放几何时，容器背景与边框使用同一个原生 shape；透明背景也保留边框，无边框或全透明边框不发出冗余边线。CSS 边框位于 border-box 内，原生 stroke 的中心线内缩半边宽；圆角使用 PptxGenJS 4 的 `rectRadius`（英寸），减去内缩后写入实际 DrawingML adjustment。胶囊形保留 roundRect，不误作 ellipse；全椭圆可映射为 ellipse。

不同边宽/颜色/样式、非统一或一般椭圆圆角、不支持的反射/skew/3D变换等不合并成伪统一描边，保留按边回退并在 notes 提示简化；不支持的圆角背景退为矩形。容器子文字仍是独立可编辑文本框，不整体栅格化。

旋转后的按边回退保留实际有向端点；序列化线段时以最小坐标角和绝对宽高建立非负DrawingML外框，再用flipH/flipV恢复端点方向，不能只取abs尺寸导致线段镜像/偏移。独立对象与原生组合均遵守此约束，覆盖正负角、跨象限与直角。带 `data-shape-endpoints` 的普通直线和默认开口箭头通过 SVG 屏幕矩阵求得页面坐标，输出原生线与起末端箭头。PowerPoint 预设箭头以档位和描边宽度决定头部尺寸。修改头部长度、宽度、几何比例或描边宽度后的直线箭头，使用静态 SVG 路径输出 DrawingML 自定义几何，保留实际头部大小。折线、独立箭头形状同样使用 M/L/Q/Z 指令输出可编辑路径与圆角。兼容早期没有 `data-shape-arrow` 标记的端点箭头。遇到镜像等无法可靠转换自定义路径的变换时，开口直线箭头沿用原生有向线段位置，并在导出备注说明头部尺寸近似。

带 `data-el` 且有实际导出后代、或同一节点发出多个原生叶子的语义容器导出为原生 `p:grpSp`，自身背景/描边与后代文字、图片可一起移动缩放；子对象仍可单独编辑或取消组合。分组只派生于来源 DOM 节点与祖先路径，不按可能重复的 class/objectName 匹配，不写回设计 HTML；不强制组合 stage、整页、无标记布局层，空组与单对象包装省略，支持嵌套组。

直接文字卡片的背景/统一边框shape与自身可编辑文本框拥有同一源DOM，导出为自身子组，外层语义组保留其嵌套；不同边框回退线也跟随同一节点归属。空组和单叶包装仍省略，不按名称或class合并。

PptxGenJS 4 没有公开 addGroup API；生成后以真实 XML 树移动原叶子节点，JSZip 只替换对应 slide XML，图片/超链接关系和原叶子顺序、格式、坐标不变。组边界来自原生对象旋转后的可见外框（包含溢出后代），`off/ext` 与 `chOff/chExt` 初始相同，避免初始偏移或缩放；新组 ID 高于已有对象 ID。对象数或归属顺序不能核对时明确失败，不输出损坏文件。文字超链接写到 PptxGenJS rich run options，确保生成实际 relationship ID，而不是悬空引用。此分组只作用于导出文件，不新增浏览器编辑器内分组功能。

文字垂直对齐按CSS布局轴映射原生top/middle/bottom：Flex row使用align-items、column使用justify-content并区分reverse的flex-start/end；常见Grid按block轴的轨道剩余空间/align-content和align-items处理。可表达的实际文字item `align-self` 优先于容器的cross-axis `align-items`；Flex column的垂直轴仍由 `justify-content` 决定。混合item位置、固定Grid轨道与轨道内对齐冲突等不能用整框anchor表达时回退顶部并写notes，不能静默居中。普通block保持顶部，不能一律居中。非对称padding+border按实际四边映射；PptxGenJS4文字margin序列化顺序为left/right/bottom/top，不能直接传CSS的top/right/bottom/left。换行/字号/旋转仍保留原生重排，分布式、多轨或竖排等复杂布局沿notes提示近似，不承诺任意CSS对齐完全一致。

原生旋转采用共用elementGeometry的未旋转border-box尺寸×累积uniform scale、实际BCR中心与累积角度；PPTX的rotate为页面方向，组本身仍identity，避免双重旋转。缩放后的字体/行高/字距、CSS padding+border映射文本margin、统一描边/圆角一并缩放，文本框不再额外加2px。图片保留cover/contain取景及实际hyperlink关系。SVG/canvas仍按既有可见截图路径，不把其已栅格化的旋转重复应用。XML回归和PDF/浏览器对照不能替代原生Office人工视觉验收。

裁切 frame 只导出一个原生 pic，内部完整 img 不重复发出；实际 CSS cover/zoom/focus 派生原图 srcRect，使用同一个全源图 relationship。窗口使用局部真实尺寸/中心、累积角度，外框背景描边与 pic 保留语义组合。统一圆角用 XML picture prstGeom=roundRect 和真实 adjustment，不使用 PptxGenJS 的 ellipse rounding 冒充；后处理按叶子顺序对应，不按重复名称匹配。PDF 直接渲染同一两层 DOM。QA 内部裁切 img 仍检查解码，但预期隐藏部分不作为页面越界；外框仍正常检查。

## Workflows

`node html-design/export-cli.mjs <pptx|pdf> input.html --output result.xxx` 复用同一 exportDocument，无需打开编辑器或常驻服务。输入限定普通文件、最多32MiB，打开前先校验类型，非阻塞/拒绝跟随替换后符号链接的打开配合打开后再校验，避免 FIFO 在检查前阻塞和中断失效；摘要返回实际字节 SHA-256 revision 和绝对输入/输出路径；不写源文件，不自动交接活跃稿。默认随机 loopback 临时只读服务按 realpath 限定输入目录/显式 root，拒绝根外 symlink、隐藏路径与非GET/HEAD；--base-url 只接收 loopback HTTP(S) IP 原稿 URL，使用已有服务且不关闭它。输出独占创建，不覆盖源/已有输出，失败只清理本次拥有的部分文件；finally 关闭临时服务，SIGINT/SIGTERM 通过可选 signal 关闭现有浏览器。具体调用见 references/export-cli.md。

本地预览中选择导出；macOS 可使用已安装 Chrome，其他环境安装 Playwright Chromium，或设置 HTML_DESIGN_CHROME。离线 HTML 保留下载和浏览器打印能力。


## Failure Modes

复杂 CSS、滤镜、非统一/不支持的圆角与字体可能简化；目标机器缺字体会改变显示。图片加载错误、比例不符或并发导出会明确失败，不能发布不完整产物。

固定浏览器软折行并关闭文本框换行，会导致 WPS / PowerPoint 拉宽后段落仍无法重新排版（Issue #3）。需同时修正文本内容和 wrap 属性；仅打开 wrap 无法删除已固化的换行。PPTX 原生排版与浏览器可能存在折行差异，以可编辑段落语义为准；PDF 继续保留浏览器布局。导出回归检查真实生成的 slide XML，覆盖中英文、富文本、显式空行和空格。


## Update Rules

新增映射、限制、字体或快照逻辑时同步 README、导出测试与本页。


## Open Questions

不承诺复杂 CSS 与 PowerPoint 完全等价；尚无正式分发或兼容性支持矩阵。

裁切标记本身不证明几何可靠。共用cropGeometry读取真实clip、content-box、内图尺寸/方向/均匀scale/object-position/translate与实际中心；QA只在契约成立时豁免内部预期越界，否则报GEOMETRY_UNSUPPORTED并保持不完整覆盖；PPTX拒绝该不可靠裁切而不凭标记伪造srcRect。PDF仍按实际DOM显示。

Issue #6 审查补充：原生图片几何按容器geometry.type选择，非方50%圆角的框和pic均为ellipse，不得把geometry对象与字符串比较后误发capsule。普通roundRect保留原adjustment。可接受的contain仅居中100%重置；非标准contain缩放/偏心和内部隐藏图片会明确拒绝PPTX映射，避免忽略CSS取景或导出不可见源图；PDF仍按真实DOM。

编辑器`data-group-angle-v1`仅描述UI参考方向，导出不将它作用到子对象或p:grpSp变换；真实成员CSS仍决定位置/角度/取景。回归对同一DOM有无提示逐页XML完全相等，避免重复加角。
