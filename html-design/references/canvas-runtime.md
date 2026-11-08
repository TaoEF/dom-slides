# Canvas Runtime v1

Local snapshot inspection and staged sparse edits for explicit `data-artboard` /
`data-el` objects. UTF-8 HTML/CSS/DOM remain the sole design truth. JSON is derived,
never a parallel document. No MCP server or external API is installed.

## Read

```sh
node html-design/runtime-cli.mjs inspect design.html
node html-design/runtime-cli.mjs inspect design.html --page p2 --element title --details
node html-design/runtime-cli.mjs check design.html
```

`inspect` reads saved bytes; `source.revision` is their SHA-256. It cannot see
unsaved browser edits. For active files obtain a current AI work copy through
[collaboration](collaboration.md), and supply `--base-url` with the original
loopback URL to resolve resources. Without it a temporary read-only resource
server uses the input directory. Content scripts/navigation are disabled.

Environment: 1280×900 CSS-pixel viewport, device scale1; animations and editor
stage transforms disabled. Geometry uses artboard-relative transformed
border-box bounds; local sizes/angle report supported geometry only. This is
not a guarantee of matching another window's media queries or interactive DOM.
Fonts settle before measurement; network and embedded decode failures remain explicit. Staging also waits for faces activated by mutations and rejects failed required fonts/images. Per-page
size contains actual border-box dimensions and inline/computed declarations.

The design section returns up to64 root design-token declarations and computed values; editable:false explicitly marks unsupported stylesheet structure.

Object capabilities describe the limited mutation set. Unmarked content is not
a discovered editable object. Missing/duplicate IDs remain null/invalid; they
are not invented. Semantic groups and crop objects refuse direct style patches.
Style facts separate inline declarations from computed values. `--details`
adds at most8 matching declarations/property and unreadable stylesheet evidence;
`resolution: evidence-only` does not claim complete cascade/provenance or human
edit attribution. Inspect includes at most100 objects, 1000 text units/object,
100 pages,2000 scanned objects,500 images and350k JSON characters for page/object
payload. Coverage states seen/returned/truncated; unknown or truncated is not a
clean pass. Do not treat missing entries as absent from the source.

`check` invokes existing [QA](qa.md), with its own coverage and limits. No new
QA engine, automatic fixes or aesthetic score is introduced.

## Stage sparse edits

```sh
node html-design/collaborate.mjs begin designs/design.html
node html-design/runtime-cli.mjs apply /absolute/session.json request.json
node html-design/collaborate.mjs commit /absolute/session.json
```

Only `apply` stages edits, only in a live collaboration work copy. The required
request revision identifies the **current work-copy bytes**, distinct from the
canonical baseline in session.json. Inspect a work copy to get its revision.
Existing commit alone writes canonical HTML and starts existing AI review;
cancel remains available. A staged result has `committed: false`.

```json
{
  "revision": "<64-character SHA-256 of current work-copy bytes>",
  "operations": [
    {"op":"replaceText","pageId":"p2","elementId":"p2-title","text":"A shorter title"},
    {"op":"setStyle","pageId":"p2","elementId":"p2-body","style":{"color":"#202020"}},
    {"op":"setPageSize","pageId":"p3","width":1080,"height":1080}
  ]
}
```

Each operation is self-contained; only intentionally changed properties belong
in `style`. Omitted properties remain unchanged. `null` explicitly removes an
inline declaration, exposing authored CSS. Unknown fields, unsafe values,
unsupported targets and stale revisions reject the entire batch before writing.
No default values are synthesized. One operation/target and1–32 operations/batch.
Plain-text replacement refuses nested/rich markup and escapes HTML characters. Text must be well-formed Unicode with LF newlines and no NUL; HTML-parser normalization must not silently change the requested text.

Style allowlist: color,background-color,font-size,font-weight,line-height,
letter-spacing,text-align,width,height,min-width,max-width,min-height,max-height,
padding,gap,object-fit,object-position,border-radius,opacity. CSS values must be
supported and at most240 units; URLs,semicolon/braces/HTML and !important are
rejected. Structural/position/transform operations remain direct-HTML work.

`setToken` takes only `op,name,value`, e.g.
`{"op":"setToken","name":"--brand","value":"#123456"}`. It requires exactly one
inline `style[data-design]` containing a single `:root` rule. Complex token CSS
is explicitly unsupported. Token writes affect the document and may be masked
by local overrides. No assumption that changing a declaration changes rendering.

A batch renders in an isolated browser first, writes exact source ranges, and reparses to verify unchanged element/attribute structure (except intended style fields);
unrelated HTML bytes stay unchanged. `changes` distinguishes applied/no-op;
failed batches return status failed and no work-copy write. No-op keeps byte
identity. Lease and work revision are rechecked before replacement, and a local
exclusive lock prevents competing Runtime apply calls. External programs that
bypass this lock can still race ordinary filesystem writes; canonical commit
continues to enforce the existing revision/lease protocol.

`affected` includes directly changed targets and observed text/style/geometry
changes among the first500 objects. `impactCoverage: bounded-observation` and
`affectedTruncated` explicitly limit this feedback: it is not a complete CSS
dependency graph. Changing tokens can require document-wide QA. Each change includes effective computed values for the requested fields (or actual page size), so declaration writes masked by CSS do not imply a visible change. Results contain
facts, no next-tool instructions. `source` returns previous/new work revision
and original documentRevision. Exit0=ok/applied/no-op,2=issues/incomplete,
1=invalid request/conflict/execution failure. Output schemaVersion1.

## Size contract

Explicit page sizing uses integer border-box CSS px1–4096, matching current
export limits. The original box-sizing/padding/borders stay intact; requested
size is converted to a content-box declaration if needed. Conflicting min/max
or important CSS rejects and rolls back. UI resize is one undo/redo action;
undo restores absence of the original inline style. Content keeps its original
responsive CSS and is not scaled automatically. New pages inherit current-page
size (empty documents default1280×720); copied pages retain source dimensions.
PDF retains each page's actual dimensions. PPTX normalizes same-ratio pages to
the first page and rejects mixed ratios. Workspace position is not page size.

## Future thin MCP mapping (not implemented)

An adapter can map canvas.inspect to inspectFile, canvas.apply to applySession,
and canvas.check to existing checkFile. It must preserve source kind, environment,
revision, sparse optional fields/null semantics, atomic rejection, bounded
coverage, effective results and committed:false. It must not synthesize full
style payloads from computed state or implicitly commit staged edits. Browser
UI and CLI can reuse the same trusted sizing/geometry functions. Live unsaved
DOM inspection, tool-bound schemas/authentication and wider mutation coverage
require separate extensions; this local API is not a remotely exposed service.
