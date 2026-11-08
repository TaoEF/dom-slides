---
id: module.editor
type: module
status: active
owners:
  - html-design/src/
  - html-design/editor.js
updated: 2026-11-09
sources:
  - path: html-design/src/editor.js
    status: current
  - path: html-design/src/pages.js
    status: current
  - path: html-design/src/viewport.js
    status: current
  - path: html-design/build.mjs
    status: current
  - path: html-design/src/selection.js
    status: current
  - path: html-design/src/groups.js
    status: current
  - path: html-design/groups.test.mjs
    status: current
  - path: html-design/src/shortcuts.js
    status: current
  - path: html-design/shortcuts.test.mjs
    status: current
  - path: html-design/selection.test.mjs
    status: current
  - path: html-design/src/guides.js
    status: current
  - path: html-design/src/crop.js
    status: current
  - path: html-design/crop.test.mjs
    status: current
  - path: html-design/src/crop-geometry.js
    status: current
  - path: html-design/src/oriented-selection.js
    status: current
  - path: html-design/oriented-selection.test.mjs
    status: current
  - path: html-design/src/geometry.js
    status: current
  - path: html-design/rotation.test.mjs
    status: current
  - path: html-design/guides.test.mjs
    status: current
  - path: html-design/guide-feedback.test.mjs
    status: current
  - path: html-design/src/text-layout.js
    status: current
  - path: html-design/text-layout.test.mjs
    status: current
  - path: DESIGN.md
    status: current
related:
  - contract.ai-review
  - architecture.html-design
  - contract.document-collaboration
  - feature.export
  - method.verification
  - contract.text-measurement
confidence: high
---

# 浏览器编辑器模块

## Summary

原生 JavaScript 编辑器按职责拆分，构建为可内嵌的单脚本。默认画布预览；编辑权限与显式编辑模式是独立状态。


## Source Of Truth

`editor.js` 组合交互；`ui.js` / `editor.css` 负责界面；`pages.js` 负责页面；`viewport.js` 负责缩放、播放；`text-layout.js` 封装 Pretext 1.0.0、字体就绪、测量和适配计划；`typography.js`、`guides.js`、`layers.js` 负责文字、吸附和叠层；`selection.js` 负责多选、框选和方向扩选；`persistence.js` / `drafts.js` 负责保存恢复；`export.js` 序列化导出。具体模块以当前 import 为准。


## Contracts

临时选框、辅助线、缩放和 UI 不得写进保存和导出。框选与元素相交即选中；viewer 通过「编辑」一次完成安全交接并进入普通编辑；页面管理与审阅则在预览态显式激活后后台交接，不进入 editing。保留文档布局与手动内联样式。Lucide 许可由构建脚本嵌入产物。


## Workflows

修改 `src/`，运行构建与相关回归。已有文档使用 begin/commit 交接更新内嵌脚本；不能直接运行示例生成器替换用户稿件。


## 文字测量与适配边界

文字「适配」菜单提供溢出检测、保持字号调整高度、保持框按比例缩小字号（最小6px）。纯文本预测通过浏览器校验后采用，否则回退实测；混合字号不宣称由 Pretext rich-inline 覆盖。排版计划在隐藏副本上计算，仅操作确认时修改原节点，保留 HTML 结构；无布局缓存/分行持久化，PPTX 保留原生自动换行与显式段落。复杂块结构/伪元素/多栏/竖排/截断不自动适配。每次仍测量 DOM，不承诺性能收益。AI 只读测量/扫描通过独立本地命令提供，见 contract.text-measurement。

排版模式保留原 CSS，不能将原来绝对定位的示例当成 Flex 联动。独立 demos/flex-text-layout.html 用真实 Flex 兄弟文字框验证边点拉伸的挤压、测量不改布局、单步撤销、保存重开与可编辑导出；已有人工稿不重建、不随 build 更新。

## 紧凑 UI

侧栏170px，缩略图宽按列表内宽计算并保留顶部安全边距。页头模式显示「自动排版 / 手动」，内部 flow/artboard 语义不变。元素工具条为黑底浅色，文字对齐单击按左/中/右/两端循环并反映状态；文字适配位于元素更多菜单，面板锚定可见的元素更多按钮，避免隐藏菜单项造成坐标或焦点丢失。颜色入口改为圆点但原生选色器不变；图片为适应/填充、RefreshCw 替换。更多类菜单190px。预览/只读时当前项及悬停项保留缩略图更多入口；页面菜单和新增入口在预览态可用，通过共享 withLease 后台取得写权限，AI pending/lease 和真实冲突时禁用。拖动仅drop后提交，未确认rename阻止刷新/yield，确认后校验稳定目标和版本。

独立审查补充：从菜单项打开异步适配面板，键盘激活需将焦点先转给可见触发器，再在检测完成后进入可用操作；Esc 返回可见触发器。菜单方向键跳过祖先隐藏的文字项。窄窗口始终保留保存状态图标，错误、重试和草稿恢复入口不能因压缩页头消失。

## 等距智能参考线

`guides.js` 在现有边缘/中心对齐上增加水平、垂直等距居中与相邻间距延续。候选使用实际 BCR 的画布坐标，相关对象须有共同正交投影和非负间隙，只取局部相邻对象；画板不作为重复间隔对象。第三个可见对象侵入任一候选间隔时拒绝该候选，包括跨过参考对象边缘的重叠对象，不能过滤掉阻挡物后向远处寻找参考间隔。排除选中对象、自身祖先/后代、其他页及隐藏/透明祖先内的对象，多选使用整体外框。每轴取最小修正量，平局保持原边缘/中心吸附，其他轴修正后失去投影相交时回退原对齐。普通对齐落点同时满足真实等距时仍显示间距反馈；仅检查最终落点，不扩大吸附范围或标注近似但不相等的间距。

吸附范围仍为6屏幕px、Alt/Option绕过；每轴最多一组间距标记，数值为设计像素、仅显示四舍五入整数，不反向量化几何。间距线使用现有翠绿SVG叠加层，数值采用与旋转角度一致的深色圆角底和白字、固定屏幕字体/端点，随缩放刷新，位于Shadow DOM而非正式stage。结束、Escape、pointercancel、切页/失权沿原拖动生命周期清理，单次拖动仍单步Undo。此能力不修改Flex/Grid gap、模式或容器结构，不提供一键分布；旋转对象继续按浏览器轴对齐BCR参与对齐/等距，旋转编辑使用下面的独立局部几何。

## DOM语义群组

当前可编辑对象仍需显式data-el；DOM提供真实布局与文字信息，不自动发现任意未标记元素。groups.js集中解析data-group="1"/data-el/display:contents群组、实际成员根与外框、当前组内逻辑选择。包装无自身盒且不写变换，成员CSS是真值；群组外框仅取实际可见成员，检查成员与祖先的opacity、display和content-visibility，全隐藏组不参与参考线或逻辑选择。移动/旋转展开为多根，角点缩放以共同锚点写成员均匀CSS scale并补偿中心，保留原transform/scale/origin，不另存坐标模型。组不提供边点非等比拉伸。

至少两个同页同父、DOM顺序连续的根可组合；保留节点身份和中间空白文本。同步layoutProbe核对当前页原节点的实际盒、computed/pseudo样式、重新建立的文字Range及采样绘制顺序，失败原子恢复并还原未提交的元素序号，不入历史/dirty。移动DOM后旧Range端点会被浏览器调整，不能复用旧Range作为验证真值。普通Grid/Flex不改变成员布局参与关系；不连续对象、特殊内容模型容器及无法保持的结构CSS拒绝；链接父容器内不插入块级组合，整个链接仍可作为合法父容器下的成员。组合和取消提交前都将当前画板放入inert template做HTML重解析并验证树结构相等，防止live DOM渲染不漂移但保存时解析器拆段落、移位或补节点。当前渲染等价不承诺未来CSS/媒体查询或内容脚本变更的兼容。

整体单击、逐层双击进入，框选/方向选择/右键统一逻辑边界。Escape先处理drag/crop/menu/modal/text，再退出一层组；切页、源码替换、结束编辑和AI交接清理上下文。组合/取消各一次结构Undo，取消保留变换后CSS，复制重键、删除和清空组合均保留可逆节点身份。保存保留语义DOM，运行时选择上下文不落盘。PPTX复用DOM祖先groupPath，无自身盒的语义组由QA检查结构与实际成员，不伪报隐藏空盒。

## 旋转与局部几何

geometry.js的自包含elementGeometry由编辑器和PPTX浏览器复用：CSS border-box局部尺寸、实际BCR中心、累积2D方向/正向均匀尺度与父级线性逆变换（元素自身CSS zoom也影响其定位基），不重置作者transform/scale/origin、不持久化第二套矩阵。新旋转写individual rotate，必要位移补偿保留单选中心；多根选择绕共同外框中心转动，自身角度同步变化。反射、skew、3D/perspective等不可靠几何保留原稿并禁用几何动作；普通inline首次有效变换时可逆转为inline-block。

单选方向选框/控制点、固定24×24屏幕px圆形外侧手柄和实时角度，手柄显式覆盖通用按钮最小宽度，窄屏夹紧。90°附近3°吸附、Shift15°、Alt自由；数值和重置仅单选，为页面绝对方向（包含祖先/原transform）。指针角度连续跨360，整圈0.01°误差内no-op。resize按局部轴和原border-box尺寸，重新测实际对侧锚点并用父级逆矩阵补偿；文字角点保留富文本比例与6px下限，拖动/键盘微移按页面方向转入父坐标。沿既有Undo/取消/切页/失权收尾，AI交接完成当前拖动后保存；收尾闭包不依赖可能已被清空的S.drag。选框/反馈只在Shadow DOM。

## 按需图片裁切

crop.js 负责有限 cover/pan/resize 数学和裁切会话。有效操作才将原 img 放进版本1 frame，原 data-el 归外框，原节点/id/class/src/alt 和链接仍在内部 img。Typed OM 转移当前布局 CSS（保留 %/auto）、原边框/圆角/变换；内部自然高度使原 auto 占位继续随宽度响应。标准 object-fit/object-position/scale/百分比 translate 与三个 CSS变量是取景真值，运行态派生数学，不增加竞争 JSON。content-box clip 保留 padding 和边框；不支持 API/几何、picture、复杂 mask/filter/clip 或同步 marked 布局探针不等价时拒绝并完整恢复。

会话局部历史按有效手势存结构+属性快照，不进入主 Undo/dirty。完成时逐项合入主历史，取消还原进入状态并丢弃局部记录；Undo 首次迁移恢复原 img，Redo 同一节点回框。无操作/夹住/回起点不迁移；拖框用局部逆变换和实际中心补偿锁定对侧锚点，旋转和非中心 origin 不用 BCR 当原尺寸。保存/导出/页面/选择/编辑结束/AI handoff 完成会话，isBusy 阻止旁路 autosave；serialize(false) 的草稿克隆恢复进入前裁切表示，不修改现场。替换先解码再记录；失败保留原图；Fit/Cover 重置实际取景。

安全转换验证当前布局，无法保证未来外部选择器/媒体查询变化仍改变已移到外框的职责；这不是全 CSS 兼容层。实际普通 Grid/Flex item、百分比/auto/inline/absolute、padding/边框、链接、复制和撤销有行为覆盖；复杂不可保持的当前布局明确拒绝。

## AI 修改审阅

当前页底自动「放弃｜接受」，多页右下默认收起汇总，删除/异页singleton和文档级保留入口。review.js 的before按hover/focus原位投影、保持自然尺寸与相同zoom，使用隔离只读iframe；Accept 只改元数据，Undo 刷新形成普通历史边界。persistence.js 先结束编辑并 flush，再核对 revision/generation；人工保存可隐式接受相关 scope。详见 contract.ai-review。

## Failure Modes

侧栏宽度变化时，画布视口必须读取同一 CSS 宽度变量，不能保留另一套断点常量。自动适应与后续缩放采用相同的三位小数精度，避免内容更新时重算缩放产生亚像素位移。

文字自然高度测量必须解除副本的 aspect-ratio / contain / container-type 尺寸约束，并结合真实节点 scrollHeight/clientHeight 验证，避免误报适配成功；坐标和视觉缩放不一致；复制后 ID 引用重复；把 owner 状态当作 editing；跨容器图层或临时 UI 污染保存。


## Update Rules

增删模块、改变模式或持久化字段时更新本页与 DESIGN.md，并添加相应行为回归。


## Open Questions

多选和编辑入口工作已由原开发任务报告完成；首次导入在独立干净副本中复核。未来行为以当前源码和回归为准。

裁切标记本身不证明几何可靠。共用cropGeometry读取真实clip、content-box、内图尺寸/方向/均匀scale/object-position/translate与实际中心；QA只在契约成立时豁免内部预期越界，否则报GEOMETRY_UNSUPPORTED并保持不完整覆盖；PPTX拒绝该不可靠裁切而不凭标记伪造srcRect。PDF仍按实际DOM显示。

Issue #6 唯一审查修复：已裁切框从Fit重入时，只有有效手势才将内部object-fit切回cover；数值/连续缩放回起点、夹住及未操作完成保留原Fit快照，局部和主Undo/Redo都恢复模式与几何。共享裁切契约只接受居中100%的contain重置；手写contain+zoom/偏心以及内图hidden/collapse明确不可靠，不能被标记豁免成QA clean或在PPTX重新暴露隐藏内容。

## 键盘上下文与帮助

Ctrl/⌘ G、Shift G与菜单共用组合/取消动作及写权限守卫；Ctrl/⌘ A选择当前页或当前组内逻辑根。输入/contenteditable/select、IME composition、源码/帮助、菜单、裁切与缩略图优先保留各自语义，预览不接管浏览器全选。裁切Undo/Redo仍走局部历史，Esc先结束文字或局部操作再退出组合；AI/readonly不能通过键盘绕过权限。`shortcuts.js`仅提供平台显示标签，不另建命令框架。更多→快捷键与帮助为持久对话框，Tab约束在关闭按钮与可滚动说明区，Esc返回可见更多按钮；viewport不在模态或IME组词时启动空格平移。

## 群组与多选方向框

`oriented-selection.js`用visibleMember/groupRoots真实border-box角点沿参考轴投影，重算中心与尺寸；不旋转已经膨胀的BCR。普通单选沿原真实方向，显式组方向=真实渲染父CSS累积方向+可选`data-group-angle-v1`数值；缺字段/非法值按本地0。contents祖先提示不相加。只在有效整体旋转时写归一化方向；直接展开的嵌套语义组一起更新，有盒祖先内组随真实父变换，不再加delta。无第二套矩阵/坐标模型。

选框、旋转中心、屏幕固定圆形手柄与角点局部对角线共用selectionFrame；resize cursor按屏幕方向，反馈/工具条仍水平夹紧。组缩放保持真实对角锚点与原文字/元素下限，临时多选不提供缩放。临时方向只跟当前逻辑成员集合（忽略顺序），换集合重置页面轴；Undo/Redo仅在当前同集合恢复运行态方向，不覆盖另一集合。成员CSS和所有受影响组标量同一snap，cancel/no-op还原字段缺失状态；复制保留组标量、取消组合只解包装。保存/AI交接沿原手势收尾。参考线/QA维持实际AABB，PPTX只读真实成员CSS、不应用提示。

## Independent artboard sizing

Issue36在预览页面菜单增加画布尺寸，页级CSS border-box px，保留box-sizing。预设和自定义只作用当前页；已有响应式内容自然布局，不整体缩放。通过页面管理租约和单步历史保存原style（含缺失）；冲突CSS回滚。尺寸输入草稿阻止外部接管，确认走同一输入保护；复制显式保留源尺寸。artboard-size.js供UI与Runtime复用。Chrome CSSOM设置后removeAttribute可能留下空style，回滚先显式设置原字符串再移除缺失状态。

唯一审查修复：复制尺寸必须用setProperty保留原inline !important；只显示当前页时，复制页的尺寸校验必须在withAll中测量。
