---
id: contract.canvas-runtime
type: contract
status: active
owners:
  - html-design/runtime.mjs
  - html-design/src/runtime-browser.js
updated: 2026-11-09
sources:
  - path: html-design/runtime-cli.mjs
    status: current
  - path: html-design/runtime.test.mjs
    status: current
  - path: html-design/references/canvas-runtime.md
    status: current
related:
  - module.editor
  - contract.document-collaboration
  - contract.ai-review
  - contract.text-measurement
confidence: high
---

# Minimal Canvas Runtime

## Summary

Issue35最小纵向流程：保存快照inspect、有效AI工作副本稀疏apply、复用现有QA与commit审阅。不是完整实时Runtime或MCP服务。

## Contracts

HTML/CSS/DOM是真值。JSON为有界派生状态。明确saved-file与AI-work-copy、工作revision与canonical基线、1280×900环境、资源状态、真实border-box坐标。省略字段不变、null删除inline、原子batch、一目标一操作、no-op保留字节。只读不申请租约；apply验证有效AI租约，只写workFile，commit走原协议。富文本替换拒绝；groups/crops不直接style patch。样式来源只返回evidence，不伪造完整层叠或人工归因。影响集合是500对象内的有限观测，不是CSS依赖图。

## Workflows

具体字段、限制与命令见references/canvas-runtime.md。QA直接复用qa.mjs。MCP以后只做薄映射。所有操作先隔离渲染验证，再用parse5 source locations局部写；无关字节保留。活跃稿始终先begin。

## Failure Modes

资源加载失败、隐藏/重复ID、复杂CSS、动态交互和窗口差异不可假定为可靠。外部文件编辑绕过本地锁仍可能竞争工作副本；canonical CAS继续兜底。完整CSS provenance、全部编辑动作和自动对象发现留后续阶段。

## Update Rules

接口语义、范围、源快照或持久化边界变化时同步引用文档和测试。

## Independent review repairs

SVG自闭合标记与未引号值中的尾斜线不能靠字符串尾部猜测；新增style放在parse5最后一个真实属性之后，写完重解析结构保持。token先验证CSS接受，声明无变化不重排样式表。document.fonts.ready不代表所有FontFace解码成功；显式检查error和img.decode失败，修改激活新字重字体也要等就绪并拒绝失败。
