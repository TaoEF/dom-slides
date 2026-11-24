---
id: method.verification
type: method
status: active
owners:
  - package.json
  - scripts/
  - .github/workflows/ci.yml
updated: 2026-11-24
sources:
  - path: package.json
    status: current
  - path: html-design/build.mjs
    status: current
  - path: html-design/documents.test.mjs
    status: current
  - path: html-design/export.test.mjs
    status: current
  - path: html-design/ui.test.mjs
    status: current
  - path: html-design/guides.test.mjs
    status: current
  - path: html-design/selection.test.mjs
    status: current
  - path: html-design/crop.test.mjs
    status: current
  - path: html-design/rotation.test.mjs
    status: current
  - path: html-design/text-measure.test.mjs
    status: current
  - path: html-design/qa.test.mjs
    status: current
  - path: html-design/text-layout.test.mjs
    status: current
  - path: .github/workflows/ci.yml
    status: current
related:
  - contract.ai-review
  - architecture.html-design
  - contract.document-collaboration
  - feature.export
  - architecture.ai-development-system
  - contract.text-measurement
confidence: high
---

# 验证、资料迁移与知识维护

## Summary

用现有行为测试验证产品，用初始化与图谱检查验证知识结构。Wiki 不依赖某个人机器上的技能路径。


## Source Of Truth

`npm run project:check` 检查已选能力和发布协议；`npm run wiki:check` 检查实体 ID/关系；`npm run wiki:graph` 派生临时图谱。这些脚本来自初始化技能配套工具，在 scripts/ 中随仓库维护。


## Contracts

`npm run build` 成功后运行 `npm test`。CI 安装锁定依赖与 Chromium，再构建并执行产品和 Wiki 检查。测试写临时目录；不能重建或改写人工编辑稿作为验证手段。

每次发布前使用当次验收稿的最终快照实际导出 PPTX。检查产物能打开、页数、形状类型和关键 XML 参数，再对照渲染验证文字、位置和关键图形尺寸。记录测试环境、字体缺失和仍待 Office 客户端验证的交互。


## Workflows

先看任务相关实体和代码；改动后跑相应测试，再同步长期事实。raw/ 接收新资料，核验后晋升到 Wiki，原始资料本身不作权威。


## Failure Modes

浏览器全屏进入/退出是异步状态切换；回归用 waitForFunction 等待实际 fullscreenElement，不能在点击后立即读取后断言。首次 Linux CI 曾因此33/34通过，见 Issue #1。仅检查模板存在无法证明 GitHub 标签或 Project 已配置；仅检查图谱无法证明文字正确；旧 HTML 内嵌脚本不自动随 build 升级。


文字测量回归补充中英文预测/浏览器对照、复杂样式回退、50%/100%/200%缩放、富文本比例与单步撤销、离线保存重开、最小字号失败和字体异步期间退出编辑。演示页只使用分支新建稿，不覆盖主目录人工稿。

本地文字 CLI 回归补充多候选宽度与 DOM 对照、源文件不写回/版本标记、脚本禁用、相对 CSS 和失败字体、隐藏/未知/无效ID/截断不可误报通过。浏览器编辑测试需等待实际 editing/contenteditable 状态；双击后立即 fill 在并行负载下曾读到尚未可编辑节点。

独立工具审查增加三类回归：meta refresh 不可切换文档或执行目标脚本，无标注/嵌套直接文字不可遗漏，祖先透明/隐藏及裁切不可误报通过。内容脚本在浏览器上下文禁用，导航拦截导致的错误统一说明导航失败，不能返回其他页面的测量结果。

Flex 示例回归使用真实浏览器指针拉伸边点，验证兄弟框宽度与位置联动；保存重开保持 Flex，导出为原生自动换行文本框。富文本缩小适配后保存重开保持节点与格式，PPTX 保持多字号与颜色，PDF 保持页数。真实 web font 请求失败必须拒绝测量/适配且不改原稿，移除失败字体后恢复浏览器实测。

AI 审阅增加 review.test.mjs（真树语义、部分接受/恢复、私有基线、租约/并发、事务6故障点、重启/历史轮转）与 review-browser.test.mjs（真实 before 隔离、输入flush、只读、历史边界、下载/离线和导出）。`npm test` 固定执行 `node --test --test-concurrency=1 html-design/*.test.mjs`，本地与 CI 共用并发数 1 的完整回归配置，将浏览器套件按文件串行执行，以减少低资源 Linux 上的资源竞争；保留原测试语义与等待上限，接受运行时间增加。

布局 QA 回归使用真实 CLI 与 DOM Range，验证软折行孤字/标点、显式换行/豁免、混合基线不猜测、Flex/Grid/缩放、非文字越界、坏图/坏字体/外部根symlink、扫描上限及源hash不变。共享只读文件IO的变更同时复用导出CLI普通文件/FIFO/独占输出/信号清理回归。

旋转回归覆盖真实手柄和角度输入、共同中心多选、50/100/200%与非中心origin/原矩阵/均匀scale、局部resize往返与对侧锚点、父逆坐标拖动/微移、富文本最小字号、单步历史/取消/no-op、flow占位/inline还原、复制保存离线重开、真实owner→AI交接。PPTX实际XML检查累积角度/真实尺寸和中心、缩放padding/字体、原生圆角shape、图片crop/链接及identity嵌套组；同快照PDF渲染与浏览器平色连通块对照允许既有CSS→PDF量化1px。一次集中桌面/窄屏视觉和新增UI detector，Office人工验收仍单列。

快捷键回归使用真实Control/Meta事件验证组合/取消与菜单等价、按页/组全选及历史；输入/IME/源码/菜单/预览、裁切局部历史、缩略图复制和真实owner→AI守卫单独覆盖。帮助dialog仅作一次桌面/窄屏合并视觉，平台标签与工具提示同源，并检查键盘焦点约束、关闭返回和持久可见。

群组方向回归用真实手柄覆盖50/100/200%、父20°+外组30°的嵌套50°、混合成员角度/非中心origin和有盒祖先。断言真实角点受方向框包围、同一方向中心旋转和局部对角锚定/最小尺寸；取消/整圈不留源噪音，临时多选换集合Undo不污染另一集合。保存离线重开/复制/取消组、成员删除Undo、真实AI交接，以及有无方向提示的QA facts和PPTX原生XML一致。旧缩放fixture须沿局部对角向量拖动，不能继续用旋转后AABB宽高声称同比20%。

PPTX文字定位回归覆盖实际文字item的align-self覆盖、column反例与80px中心轨道+末端item的显式近似反馈，以及Flex row/column/reverse与常见Grid轨道的top/center/bottom、非对称padding+border及旋转scale；原生文本wrap保持重排。直接文字卡片own shape/text须有自身子组，嵌套path、唯一ID、关系、叶子数量与绘制顺序不变；空/单叶仍跳过。PptxGenJS4文本margin实际顺序left/right/bottom/top必须通过四边不同值的XML验证，等值padding无法发现顺序错误。

## Update Rules

新增测试入口、CI 或改变依赖/浏览器时更新此页与 harness。


## Open Questions

README.md / PRODUCT.md / DESIGN.md：作为当前说明保留在原位，对关键事实逐项核实。demos/recovered/：historical 的本地恢复副本，保留在磁盘并由 Git 忽略；旧预览图为 historical，不自动晋升 Wiki。html-design/SKILL.md：保留现有使用说明，事实以源码为准。尚无历史聊天记录需要复制到 raw/。

裁切回归使用独立编号色块源图，验证数学覆盖、真实旋转局部边角/三个画布缩放、会话取消和每手势历史、%/auto/Grid/Flex/inline/absolute、无操作不迁移、解码失败保护、复制及 managed autosave/AI handoff。srcRect/roundRect/旋转/链接/组关系读取真实 PPTX XML；浏览器 PDF 与独立 LibreOffice UserInstallation 的原生 PPTX→PDF 核对取景/圆角，不能宣称已完成 PowerPoint 人工验收。测试点击图片中心（实际 DOM 几何），不能固定70px偏移而落在小图外；保存断言解析设计 markup，不能误匹配内嵌编辑器源码字面量。
