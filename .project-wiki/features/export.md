---
id: feature.export
type: feature
status: active
owners:
  - html-design/export.mjs
  - html-design/pptx.mjs
  - html-design/src/export.js
  - html-design/export-cli.mjs
updated: 2026-10-29
sources:
  - path: html-design/export.mjs
    status: current
  - path: html-design/pptx.mjs
    status: current
  - path: html-design/src/export.js
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

编辑器插入并标记 `svg[data-shape]` 的八种基本形状由导出器识别为原生 PPTX 几何，不按一般 SVG 截图导出；普通作者 SVG 仍走原有图形路径。颜色、线宽与矩形圆角映射为原生属性。星形内径和两种箭头的细部调整目前在 HTML 中可编辑，PPTX 使用相近的原生预设外形，细部不保证一致；导出后仍可在 PowerPoint 中调整原生形状。


## Source Of Truth

浏览器 `src/export.js` 提交快照；服务 `/__html-design/export/pdf|pptx`；`export.mjs` 使用 Playwright、pdf-lib、PptxGenJS 与运行时 JSZip；`pptx.mjs` 收集和映射对象，并用现有浏览器 DOMParser/XMLSerializer 包装原生组合。


## Contracts

导出不重新读取旧磁盘 HTML。脚本通过 CSP 禁止执行，等待字体图片；最多 100 页，尺寸 1–4096px。PDF 允许逐页不同尺寸；PPTX 页面宽高比须一致。普通文字与 img 不整页扁平化；SVG/canvas 可转为图片。

PPTX 每个文字元素对应一个可编辑文本框，开启 `wrap="square"`，不自动缩小字号或按文字撑宽。只保留 HTML 的显式换行（br、块段落、white-space 保留的换行），不将浏览器因当前宽度产生的软折行固化。普通空白按 CSS 合并，跨 span 保留词间空格，pre/pre-wrap/break-spaces 保留空格。富文本样式继续按 run 映射，混合字号或基线差异不能凭字符几何位置推断换行。Flex/Grid 子项会被浏览器块化，横排子项不能因此各自变成硬段落；正 column-gap 简化为词间空格，Flex column 子项保留纵向分隔。


四边宽度、颜色/透明度一致且为可见实线，配合可可靠表达的统一圆角和未旋转/缩放几何时，容器背景与边框使用同一个原生 shape；透明背景也保留边框，无边框或全透明边框不发出冗余边线。CSS 边框位于 border-box 内，原生 stroke 的中心线内缩半边宽；圆角使用 PptxGenJS 4 的 `rectRadius`（英寸），减去内缩后写入实际 DrawingML adjustment。胶囊形保留 roundRect，不误作 ellipse；全椭圆可映射为 ellipse。

不同边宽/颜色/样式、非统一或一般椭圆圆角、缩放/旋转等不合并成伪统一描边，保留按边回退并在 notes 提示简化；不支持的圆角背景退为矩形。容器子文字仍是独立可编辑文本框，不整体栅格化。

带 `data-el` 且有实际导出后代的语义容器导出为原生 `p:grpSp`，自身背景/描边与后代文字、图片可一起移动缩放；子对象仍可单独编辑或取消组合。分组只派生于来源 DOM 节点与祖先路径，不按可能重复的 class/objectName 匹配，不写回设计 HTML；不强制组合 stage、整页、无标记布局层，空组与单对象包装省略，支持嵌套组。

PptxGenJS 4 没有公开 addGroup API；生成后以真实 XML 树移动原叶子节点，JSZip 只替换对应 slide XML，图片/超链接关系和原叶子顺序、格式、坐标不变。组边界来自原生对象变换框（包含溢出后代），`off/ext` 与 `chOff/chExt` 初始相同，避免初始偏移或缩放；新组 ID 高于已有对象 ID。对象数或归属顺序不能核对时明确失败，不输出损坏文件。文字超链接写到 PptxGenJS rich run options，确保生成实际 relationship ID，而不是悬空引用。此分组只作用于导出文件，不新增浏览器编辑器内分组功能。

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
