# #35 / #36 implementation and #37 independent prototype

User accepted the preceding assessment and explicitly authorized #35/#36 implementation and a separate #37 prototype on 2026-11-09. This is plan confirmation for the bounded stages below, not remote delivery authorization. Base origin/main 3fcca5cca471295c9e430a795b9a02ca8cda8478. Primary worktree and active demos remain untouched.

## Ownership and ordering
Repo-Issue-Manager: root; Dev-Manager: root; Developer: root. One serial coding batch #35 minimal contract → #36 product sizing → #35 runtime implementation. #37 Phase1 uses an independent branch and new document after this batch; no competing edits of shared modules. Priority P1 queue1 #35/P1 queue2 #36, P2 queue3 prototype #37; prior queued items follow. Conflicts: editor/pages/viewport/review, QA preparation and object identities. #27 object discovery is not a blocker: explicit data-el only, common stable IDs. No MCP server, full CSS debugger, automatic object discovery, auto-layout rewrite or new QA engine.

## Contract
DOM is the sole design truth. Inspect saved bytes with source SHA, bounded stable IDs, real page-relative CSS-px geometry, declared inline style vs computed values, readable matching rule evidence (unknown provenance explicit), resource/readiness facts and object capabilities. Disabled document scripts; no claim to inspect unsaved browser DOM. Stage editor transforms do not enter measurements.
Sparse apply edits ONLY a valid AI session work copy, expected work-copy revision required, fields omitted unchanged, null explicitly removes a style. Atomic batch validation and exact source-range patches preserve unrelated bytes. Plain-text replacement refuses rich/nested text. Limited safe inline property allowlist, root design-token values, current-page size. No-op remains no-op. Staged revision is distinct from canonical/session baseline revision; existing collaborate commit is the only canonical write and produces AI review. No partial-success commits or silent retries.
Sizing: explicit per-page CSS border-box px 1..4096; current-page UI preserves original declarations for undo. New page inherits reference/current size; duplicate pins measured source dimensions while preserving content. Existing CSS unaffected until explicit resize. Existing responsive CSS may react; no content scaling. Conflicting important/min/max/ratio rules must produce a readable failure and rollback, never false success. PDF preserves page dimensions; PPTX same-ratio normalization, mixed-ratio rejection unchanged. Review before retains original dimensions.

## Implementation
1. Shared page sizing helper and page-size panel in existing page menu; protected focus, presets/custom numbers, error and apply/cancel.
2. Snapshot runtime browser inspector reuses geometry and text infrastructure; Node API and CLI use existing read-only resource loading. Existing QA called directly.
3. Source-range sparse patcher with parse5 locations plus trusted CSS parser, active AI lease verification and staged-file compare before atomic write. Explicit rendering environment and bounded facts.
4. Independently branch workspace prototype: multi-size sample in a quiet existing editor-like shell, readonly automatic layout, pan/zoom/Fit all, focused single-page view; no runtime/editor production change.
5. Docs/wiki, build and focused/full checks, exactly one independent audit per reviewed batch, repairs then focused verification. Clean acceptance candidate and stable local preview; no push/main merge/deploy before exact acceptance.

## Test cases
- Inspect IDs, groups, rotation, inline/computed difference, inaccessible styles, hidden nodes, missing/duplicate identities, no script execution, resource errors, bounded output, snapshot hash.
- Sparse replace only intended plain text; entities escaped; rich text refused; style omit/remove, safe property/value validation; root tokens scope; invalid/stale/expired sessions; mixed batch rejection leaves original bytes; concurrent file change rejected; no-op revision stable; commit produces existing review.
- Three page sizes and ratios; sidebar/fit/current switching, size apply/invalid/cancel, undo/redo including absence of inline style, save/reopen, new/copy; CSS conflict rollback; PDF MediaBox and PPTX mixed-ratio error; before original size.
- Prototype pan/zoom at pointer, Fit all, select/focus/return, responsive controls, no source-document writes and no workspace coordinates in exports.
- Full regression with configured concurrency1, build, Wiki/project checks. Desktop/narrow visual batch and one bounded correction pass, exact-range independent review. No active demo regenerated.
