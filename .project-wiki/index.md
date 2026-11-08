# dom-slides 项目知识库

先读 [schema.md](schema.md)，再按任务选择实体并核对源代码。

- [系统架构](architecture/html-design.md)：自包含 HTML、浏览器编辑器、本地服务。
- [编辑器模块](modules/editor.md)：源码职责、构建与文档升级边界。
- [保存与 AI 协作契约](contracts/document-collaboration.md)：单写者、版本校验、交接、恢复。
- [AI 修改审阅](contracts/ai-review.md)：聚合基线、部分接受、保护撤回与崩溃恢复。
- [AI 本地文字测量](contracts/text-measurement.md)：候选宽度、文字溢出、布局 QA、只读快照与覆盖边界。
- [PDF / PPTX 导出](features/export.md)：当前 DOM 快照、可编辑对象与限制。
- [验证与知识迁移](methods/verification.md)：测试入口、CI、资料状态。
- [AI 开发系统](architecture/ai-development-system.md)：角色与开发流程。
- [GitHub 对象与发布决策](decisions/github-object-planning.md)：Issue、PR、七阶段证据。

`raw/` 接收未经核验的资料；Wiki 只保存可追溯的长期事实。
使用 `npm run wiki:check` 与 `npm run wiki:graph` 检查关系；图谱不入库。

- [Canvas Runtime](contracts/canvas-runtime.md)
