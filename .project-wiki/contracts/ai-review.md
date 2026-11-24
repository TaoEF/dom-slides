---
id: contract.ai-review
type: contract
status: active
owners:
  - html-design/documents.mjs
  - html-design/review-html.mjs
  - html-design/review-store.mjs
  - html-design/src/review.js
updated: 2026-11-19
sources:
  - path: html-design/review-html.mjs
    status: current
  - path: html-design/review-store.mjs
    status: current
  - path: html-design/documents.mjs
    status: current
  - path: html-design/src/persistence.js
    status: current
  - path: html-design/src/review.js
    status: current
  - path: html-design/review.test.mjs
    status: current
  - path: html-design/review-browser.test.mjs
    status: current
  - path: html-design/references/collaboration.md
    status: current
related:
  - contract.document-collaboration
  - module.editor
  - method.verification
  - feature.export
confidence: high
---

# AI 修改审阅契约

## Summary

AI commit 后当前 HTML 是 after，私有聚合 baseline 只用于未接受修改的恢复。页底「放弃｜接受」分别调用保护Undo与元数据Accept；逐页/整份 Accept 不重写设计。HTML/CSS 仍是设计真值。

## Source Of Truth

review-html.mjs 使用服务端 parse5@8.0.0 真树和 source locations 分析与局部恢复；review-store.mjs 保存单文件 prepared envelope；documents.mjs 复用规范路径的 exclusive 队列；persistence.js 负责 flush、权限和刷新边界；review.js 负责固定像素页底操作、默认收起右下汇总和隔离原位before。

## Contracts

- 页内变更按 data-artboard 稳定标识归类新增/修改/删除；共享 head/样式/全局属性/页外结构、任何内容脚本、已有页重排、重复/缺失标识、非 stage 直接子页等保守归为文档级。style/stylesheet link 即使位于页内也按全局比较，内联 style 属性仍可页级；stage 内显著空白保留，共同页占位用于避免仅增删页造成伪全局。
- 等价属性次序/引号、编辑器 runtime/connection/UI、bbox、临时属性与序号不产生 pending。保留真实文本/pre 空白、data-mode/data-flow-style 和内容样式。
- 聚合 baseline 保留首次未接受版本；Accept 某页把该页当前状态写入 baseline，其他 before 保留。人工保存更新被修改范围的 baseline；全局人工修改或文档级 pending 后的人工修改接受整个审阅。派生差异不接受。
- 保存仍使用现有 CAS、备份与原子替换。review/read 按需返回 before，review/accept 与 review/undo 以 revision/generation/scope/requestId 校验，服务器决定恢复内容。仅当前 owner 且无 AI/待交接可处理。
- 整份撤回必须显式确认。文档级审阅只在汇总中提供「放弃整份文档修改」，取消确认时不发写请求。服务端对整份 Undo 要求 `confirmDocumentUndo: true`，缺少确认的请求以 409 拒绝，包括旧 HTML 内嵌编辑器发来的请求。单页 Undo 仍只恢复对应的 `data-artboard`，接受操作无此确认要求。
- 审阅写进行中整体关闭普通编辑与新自动保存，允许本次请求前已有修改完成 flush。Undo 响应后再检查 dirty/generation/source/busy；若出现新内容则保留 DOM/草稿并提示冲突，不导航。刷新只在实际 pagehide 时释放 token，取消导航不会提前失效连接或永久锁在 refreshing。
- `.html-design/reviews/<canonical hash>/state.json` 为 0600，独立于10份历史轮转；prepared 内保存旧 state/from/to/next。磁盘等于 to 时 finalize，等于 from 时 rollback，否则保留证据并阻止所有写入。metadata-only 也做近端文件版本检查。
- 轻量摘要不传 baseline；页码由现有 before/after 解析顺序只读派生，修改/新增显示当前第 N 页，删除显示原第 N 页，状态为独立非交互 label；恢复后保留当前 runtime、单调序号，刷新清空旧 DOM closures。下载/离线不携带审阅状态，原离线编辑仍可用。
- before 按revision/generation/scope缓存并取消迟到投影，保留兄弟DOM与stage继承，iframe内仅隐藏非目标页；投影以真实after锚点、before自然尺寸和相同zoom呈现。iframe始终保持父文档实际窗口宽高，隔离文档内的fixed stage执行投影缩放/偏移，避免大页改变vw/vh/媒体查询；resize重建测量。before 清洗脚本/事件/表单/导航/嵌套活动内容，并置于 sandbox（仅 allow-same-origin，无 allow-scripts/forms/top-navigation）与 script-src none CSP 中。允许同源以保留原字体/资源，iframe 内容不进入 stage、序列化、history 或导出。

## Workflows

正常 AI begin/commit 后，只有当前页有页级审阅项时，页底才出现「放弃｜接受」。悬停或聚焦显示原位 before，点击才执行 Undo。右下默认收起的汇总可逐项定位、处理与全部接受，也提供删除页、非当前页、文档级和异常的入口。文档级悬停预览当前页，写入范围由汇总按钮和确认文案说明。owner/viewer 都可直接激活处理，后台使用既有 takeover→原owner flush/yield→grant，不进入普通编辑；hover不接管。切页与进入/退出播放同步递增临时意图代数，旧动作一经离开上下文就失效，快速往返也不能复活；该代数仅运行态，不进入设计 HTML。共享有界 withLease 同样服务预览态页面管理，AI pending/lease 锁写，脏内容/源码/重命名草稿保护不变。正在输入时处理会先结束编辑并 flush；如果基线因人工编辑或其他窗口发生变化，刷新列表后重新选择，不自动重试旧写入。

`node html-design/review-demo.mjs` 只创建独立新稿并通过相同服务存储实现种入两页 pending；默认随机文件名，已有文件以 wx 拒绝覆盖。它不是升级已有稿的工具。

## Failure Modes

存储错误不会静默清空记录。HTML rename 后响应失败，可由下一次读取/重启 finalize，并通过同一 AI token 重试确认；重复 review 写仅显式 requestId 与相同原 revision/generation/scope 的最近收据可重放，后续内容变化后旧请求拒绝。

本窗口合法 flush 已同步新版本时，旧审阅意图应停止并更新列表，不额外刷新该已是最新的 DOM；只有远端/磁盘 revision 与本地实际 revision 不同才尝试保护刷新；一次性“更新后旧操作未执行”提示随现有视图状态保留，在刷新后消费，不携带重放命令。总体等待超时只终止当前动作，不将仍有效的连接误标断开；真实请求超时、网络失败与401仍拒绝写并恢复连接。

普通 undo/redo 不能跨恢复刷新执行旧节点命令。全局变化不能伪装为页级恢复。下载的 bundle 虽包含审阅代码，但没有 connection 或私有 baseline，不能离线撤回服务端 AI 提交。已有稿要走协作流程更新 bundle。

## Update Rules

改变 semantic scope、恢复、持久事务、权限、隐式接受或 before 隔离时同步协作说明、README 与 review Node/browser 回归。测试矩阵按 Issue #5 Planner 计划执行，不能用截图替代崩溃一致性证明。

## Open Questions

不支持跨服务进程协调、跨设备持久审阅、三方合并或离线审阅。外部第三版本冲突保留记录并拒绝盲目恢复，暂无自动合并/冲突解除产品流程。

基线保存 HTML/CSS 声明与资源引用，不快照被原地覆盖的外部图片、字体或 CSS 文件。同一 URL 下资源字节的外部变化不能由本次 HTML diff 撤回。
