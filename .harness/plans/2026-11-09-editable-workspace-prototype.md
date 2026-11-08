# #37 editable workspace prototype iteration

User feedback explicitly prioritizes real content editing, cross-artboard movement/reuse and unchanged original thumbnail navigation. This supersedes the readonly-only prototype scope for this isolated iteration; it does not authorize main integration or production release. Previous e190ad1 view-only prototype remains intact for comparison. Base3fcca5c original editor is reused on the independent #37 branch; #35/#36 candidate remains frozen in its separate worktree, no dependency/main merge.

## Ownership / readiness
Repo-Issue-Manager and Dev-Manager root admit Developer root to this user-authorized iteration, active coding WIP1. Previous candidates retain acceptance ownership but have no concurrent coding commands. Shared modules changed only in this isolated branch. Issue37 P2/high/L, queue3; this feedback names current work. No live original demo overwritten; create prototypes/workspace-editor.html as a new document. Existing workspace.html stays readonly unchanged.

## Implementation
- Add opt-in prototype mode using data-workspace-prototype on stage. Original editor header/Edit/Done, element controls, left thumbnails/page operations, saving/review and playback remain the same; only a single/workspace text toggle and contextual reuse help are added for opt-in documents.
- Extend viewport with temporary automatic per-page placement via editor-only CSS, zoom/pan/Fit all, current-page centering. No canonical workspace x/y or second document model. Internal frame dimensions do not change when switching view. Default canvas preview preserves native HTML interactions; Edit explicit in either view.
- Clicking a workspace artboard activates its existing thumbnail without panning. Sidebar/next navigation centers that frame. Workspace editing reuses selection/text/resize/rotate/crop/group/history code.
- Cross-frame drop moves logical roots (including groups), preserving stable IDs. Alt/Option drop copies and allocates new element/DOM IDs. Internal Ctrl/Meta C/V clipboard reuses captured content on current frame; input/IME/menu/source/crop/native image paste retain their meanings. No cross-frame multi-selection or frame free-layout persistence.
- At transfer only, preserve rendered styles and supported 2D geometry and place moved objects absolutely in the target frame. Existing source/target sibling CSS remains authored. Generated/unsupported geometry refuses and restores; do not flatten unrelated pages. Add transient ghost/drop highlight; all editor attributes/overlays excluded from serialization.
- One history action restores parents/order/attributes for move, or removes/restores cloned identities for copy. Cancel restores before-drag state. No transfer before pointerup; lost editing permission/page context/handoff follow existing lifecycle.

## Tests / evidence
- Default preview and explicit Edit/Done in both views; real double-click text editing and side/corner resize.
- Original .thumb-list thumbnails/menus/170px nav and page IDs/ratios unchanged; no custom navigation replaces them.
- Pointer transfer of text, image, multiple same-page roots/group across unequal frames at50/100/200%; copy modifier, stable/fresh IDs, typography/rotation, pointer landing and undo/redo; Escape/pointercancel/readonly do not mutate.
- Clipboard copy then target-frame activation/paste, typing native copy/paste and image paste unaffected.
- Save/reopen and PDF/PPTX keep canonical artboard geometry; no workspace CSS/ghost/drop attributes in saved HTML. Page reorder/new/delete keeps layout and selection coherent.
- Related production regression on documents without opt-in, bounded desktop/narrow visual pass, exactly one independent review of uncovered iteration delta, focused repairs, clean local candidate and separate prototype URL. No push/PR/main merge until exact acceptance.

## Primary verification
- Focused pointer/text/group/clipboard/serialization/export coverage: nine cases passed; managed autosave/reopen/viewer lease and desktop1440/narrow640 cases passed separately.
- Real browser sample: explicit Edit → selected p1-tag → dragged to portrait p2 (current-page/thumbnail synchronized) → one Undo restored p1 → Fit all. Saved state reached. No direct demo overwrite; white background and bundle patch used AI handoff.
- Bounded desktop/narrow screenshots in .html-design/evidence/. Detector returned no regex findings, degraded because optional parser modules were unavailable; no claim of full computed/a11y detection. Wiki/project checks and whitespace check passed.
- Full default suite at528d807:232/232 passed, no skipped/fail (/tmp/dom-workspace-editor-full.log). Clean FF candidate from exact origin/main3fcca5c passed27/27 workspace+original UI checks (/tmp/dom-workspace-acceptance.log).


## Independent audit and focused repair
- Exactly one isolated read-only audit: e190ad139ba6a049e77e1053dfe022d93c4e7871..528d80747d2df4e9edd50dc746d571611c40f393, reviewer editable_workspace_audit. Two accepted P2 findings: target CSS could force a different angle; target CSS could hide a rich-text descendant while the root dimensions stayed constant.
- Repair compares normalized resulting angle, visibility/display/content-visibility and rendered subtree bounds against capture. Inline root blockification caused by absolute placement is allowed only with matching subtree geometry. Conflicts restore parents/order/attributes atomically for move and copy; no extra history action or orphan clones.
- Focused repair verification:12/12 workspace tests including actual-pointer forced-rotation/hidden-descendant move+copy regressions (/tmp/dom-workspace-review-fixes.log). Full232 run is pre-repair evidence; repair scope is opt-in transfer validation. No routine second audit/full rerun.
- Latest prototype script upgraded via begin/commit handoff, with non-script bytes unchanged. Final delivery packet in ignored .html-design/workspace-delivery.md records exact revision, clean candidate and stable preview. No push/PR/main integration/deployment authorized.
