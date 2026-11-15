# #37 Workspace prototype

Open `workspace.html` through this worktree's local preview server.

- Same artboard DOM nodes in single/workspace views; six new sample pages only.
- Automatic rows for mixed page sizes, zoom/pan/Fit all, navigation and double-click focus.
- Space + drag or middle-button drag to pan. Ctrl/⌘ + wheel zooms at the pointer.
- Escape returns to workspace; arrows/PageUp/PageDown change current page.
- Readonly navigation prototype: no content editing, no saved free placement,
  no export, no runtime integration, no changes to the production editor bundle.
- View transforms/frame positions are temporary DOM state for this standalone
  page, never a second document model or a production persistence contract.

Scope is Issue37 Phase1 only. No user design was copied or overwritten.
The prototype deliberately has no storage/write endpoints of its own; the source
HTML remains unchanged by browsing. Reopening restores automatic layout.

Verification: `node --test html-design/workspace-prototype.test.mjs`.

## Editable iteration (user feedback)

`workspace-editor.html` reuses the original editor, original 170px thumbnail
sidebar and native page menus, with an opt-in temporary workspace projection.
Default preview keeps document interactions; Edit explicitly enables content
selection, text, resize/rotation, groups and transfer. Footer single/workspace
toggle changes the view, not the artboard content model.

Drag selected logical roots into another frame to move; Alt/Option drop copies.
Copy selected objects, activate another frame, and paste to reuse at its center.
Native text/image paste remains native when the internal clipboard MIME marker
is absent. Transfers have one undo/redo action; moves retain stable IDs, copies
rekey DOM/data-el IDs. Cross-frame multi-selection and persistent free frame
placement remain outside this prototype.

Supported 2D objects preserve rendered styles and positions. The prototype pins
computed styles **only for transferred objects**, converts their outer placement
to absolute coordinates in the target, and refuses generated/unsupported content
or conflicting target CSS. It does not flatten other pages. This prototype
tradeoff should be evaluated before production rollout; it is not a general
CSS component transplant system. Required custom scripts are not rewritten.

The `data-workspace-prototype` opt-in enables the view in the branch's editor
bundle. Documents without it retain the original behavior. View placement CSS,
labels, ghost and drop markers are editor-only and excluded from save/export.
The old readonly `workspace.html` remains unchanged as a comparison artifact.

Verification: `node --test html-design/workspace-editor.test.mjs`; whole original
editor suite also runs for non-opt-in regression coverage.
