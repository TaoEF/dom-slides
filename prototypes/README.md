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
