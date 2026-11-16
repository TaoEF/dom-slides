# Saved-file layout and contrast QA (v1)

Run from the complete [source runtime](runtime.md), with dependencies and a local
browser installed:

```sh
node html-design/qa.mjs check input.html
node html-design/qa.mjs check work-copy.html --base-url http://127.0.0.1:8876/designs/input.html
```

The command checks **saved bytes**, not unsaved browser DOM. Obtain the latest
work copy through the normal [AI handoff](collaboration.md) when editing an
active document. QA does not flush, take ownership, rewrite, repair or commit.
The default temporary read-only server serves resources inside the input's
folder; outside-root symlinks are denied. Use an existing loopback file URL for
resources outside that folder or an AI work copy's original resource base.
Document scripts and navigation are blocked by response CSP and navigation interception; only trusted measurement and local diagnostic code execute. All artboards are checked after
removing editor stage zoom. No persistent service or API key is required. `npm ci` installs the pinned production dependency `axe-core@4.10.3`; QA never fetches an engine from a CDN.

## Result and interpretation

One JSON result on stdout contains `schemaVersion: 1`, `status: ok|issues`,
`source: {kind: saved-file, path, revision}`, `units: css-px`, `pageCount`,
`textCount`, `checkedCount`, `truncated`, `coverage`, and `issues`.
`path` is an absolute real path; `revision` is the saved-byte SHA-256.
`checkedCount` retains the existing text-check meaning: measurable text blocks,
including overflowing ones. `coverage.text.linesChecked` counts blocks whose
actual rendered lines were reliable enough for punctuation/orphan checks.
Coverage separately reports seen/checked elements, hidden/unsupported text and
elements, unmarked painted containers, scanned graphemes, suppressions, admitted issue bytes and omitted issues/evidence. Seen counts are
lower bounds when truncated. Never interpret missing issues as a clean result
without checking `status`, `truncated` and coverage.

`VISUAL_CONTAINER_UNMARKED` reports a visible div that paints a background, border, outline or shadow but lacks `data-el`. Its `evidence.path` is the zero-based child-index path from the artboard, and `evidence.box` locates it in CSS pixels. Pure Grid/Flex wrappers without their own paint are excluded. An intentional decorative container may use `data-qa-ignore="VISUAL_CONTAINER_UNMARKED"`; the suppression is counted. Editor click-to-mark is a separate, undoable action and QA never writes the file.

`coverage.contrast` is independent of text-layout support: `seen`, `checked` (passes plus known failures), `low`, `unverified`, `hidden`, `inapplicable`, `unmarked`, `suppressed`, `truncated`, `complete`, `limit`, and `engine`. Counts describe text items and inventoried native controls; non-text controls are counted inapplicable, and rich-text children can share one editable object ID. `complete` is false for unknown or truncated contrast coverage; hidden text and disabled native controls are counted separately. Unmarked/invalid identities still follow the existing non-clean QA semantics.

Each issue has a stable `code`, `severity: warning|error`, nullable `pageId` and
`elementId`, and bounded `evidence`. IDs are null when missing, non-unique or longer than 256 UTF-16 units; overlong IDs report `ID_INVALID` with their length rather than a shortened locator. This also bounds clipping-ancestor identifiers.
Line evidence includes a 1-based rendered line number, at most 80 characters,
and a rectangle relative to its artboard. Boxes and height budgets are CSS
pixels. Resource evidence contains a bounded URL; embedded image data is omitted.
Errors print `status: error` and `error.code/message` on stderr without invented
metrics. Exit **0** means checked without reported issues, **2** means issues or
incomplete coverage, **1** means input/execution failure. No next-action command
is embedded in feedback.

## Contrast facts and limits

Only the local axe `color-contrast` rule runs. AA requires 4.5:1 for normal text,
3:1 for at least 24 CSS px, or at least 18.667 CSS px bold text. The engine
classifies using its unrounded calculation; a displayed rounded ratio does not
override its pass/failure. Editor stage zoom is removed before checking. All
artboards, including text outside the viewport, participate in the same snapshot.

- `TEXT_LOW_CONTRAST`: a known insufficient ratio. Evidence includes 1-based
  `page`, up to 80 text code units, `foreground`, effective `background`, design
  `fontSize` in CSS px, computed `fontWeight`, `ratio`, `required`, and `engine`.
- `CONTRAST_UNVERIFIED`: unknown or unsupported contrast, including an engine
  incomplete result, missing engine report or failure. `reason` is an English
  factual code. `possible-same-color` preserves axe's 1:1 incomplete result;
  it means the text may have the same color as its background. Unknown colors
  and ratios are null rather than inferred.

Inherited colors, transparent ancestors and determinable alpha use engine
facts. Image/gradient backgrounds that participate behind the text, blending/filters, generated text and SVG text
remain unverified. An opaque pure-color layer can mask more distant backgrounds without discarding confirmed engine facts; obscured text follows engine uncertainty. Visible text without
an engine report never counts as passed. Visible saved form text is inventoried (password previews are masked); checkbox/radio/range/color/image/file controls do not expose their internal values as visible text. Missing `data-el` on form-only or generated text reports `TEXT_UNMARKED` with null identity and incomplete coverage.
Disabled native controls are inapplicable, while `aria-hidden` alone does not
hide visually present text. This is not an arbitrary-overlap detector.

The contrast inventory has separate limits of 500 text elements, 100,000 text
code units and 2,000 elements inspected for generated/form text. The shared issue
count/byte and 30-second browser deadline still apply. Engine loading or timeout
can fail the command with exit 1; an engine failure normalized inside the scan
returns incomplete coverage with exit 2. Neither can produce clean output.

## Checks and intentional exceptions

- `TEXT_OVERFLOW`, `ANCESTOR_CLIP`: reuse existing text inspection once, including
  font readiness. Required/available heights and clipping ancestors are facts;
  intentional clipping is possible.
- `ELEMENT_OUT_OF_BOUNDS`: visible marked objects crossing their artboard.
- `IMAGE_LOAD_FAILED`, `RESOURCE_FAILED`: failed image decoding or CSS/font
  requests. Failed fonts do not become successful fallback measurements.
- `LINE_ORPHAN_CJK`: a soft-wrapped final line with one Han grapheme, optionally
  followed by closing punctuation (for example `定。`).
- `LINE_ORPHAN_PUNCTUATION`: a soft-wrapped line containing one punctuation mark.
- `LINE_START_PROHIBITED`, `LINE_END_PROHIBITED`: common Chinese closing marks
  at a soft line start or opening marks at a soft line end.

Line checks use actual DOM Range/grapheme geometry, not Pretext predictions.
Explicit `<br>` and preserved newlines divide author-controlled segments; a
single-character explicit line is not an accidental soft-wrap orphan. Mixed
font sizes/baselines, vertical writing, columns (either `column-count` or `column-width` on applicable text/descendants), complex transforms, generated
text, nested text containers or unreliable Range order are reported as
`LINE_UNSUPPORTED`, `TEXT_UNSUPPORTED` or `GEOMETRY_UNSUPPORTED`, with incomplete
coverage. They are not guessed or treated as checked. Ordinary inline weight
changes, Flex/Grid positioning and translations can remain measurable.

For deliberate typography, set space-separated rule codes **only on that
object**, for example:

```html
<p data-el="p1-poem" data-qa-ignore="LINE_ORPHAN_CJK LINE_START_PROHIBITED">…</p>
```

`TEXT_LOW_CONTRAST` can also be explicitly suppressed on its owning `data-el` object; contrast and total suppression counts both increase. `CONTRAST_UNVERIFIED` cannot be suppressed.

The text-overflow, ancestor-clip, element-bounds and four line-warning codes
above can be suppressed; suppressions are counted. Identity errors, hidden or
unsupported coverage, resource/measurement failures and limits cannot be
suppressed into a clean pass. Unaffected content needs no new attributes.

Limits: 32 MiB input, 100 artboards, 500 text candidates, 2,000 elements/images,
20,000 UTF-16 units before inspecting one text block, 20,000 graphemes per block,
100,000 total graphemes, 500 issues, 128 KiB of JSON issue bytes and a 30-second browser scan. Issues are admitted one at a time against both count and byte limits, including resource diagnostics. Clipping evidence includes at most 32 ancestors; omitted evidence also marks truncation. QA source paths are at most 4,096 UTF-16 units and execution-error messages at most 512; with metadata the CLI JSON remains below 160 KiB. Image decoding
has a five-second per-image bound. Truncation returns incomplete coverage.

This is a set of layout and text-contrast diagnostics, not a complete visual/aesthetic or
arbitrary-overlap audit. Supported 2D-rotated objects retain BCR page-boundary facts, while rotated text
lines remain unsupported. Version-1 crop frames are validated against actual clipping
and image geometry; only trusted internal image overflow is exempt from page-boundary
warnings. Hidden or unreliable crop geometry leaves coverage incomplete rather than
passing silently. Semantic `display:contents` groups receive structural checks;
their marked members remain the geometry targets. Automated AI-commit feedback and editor QA UI remain
[Issue #7](https://github.com/TaoEF/dom-slides/issues/7); the command adds no gate.
The existing [text measure/check interface](text-measurement.md) remains stable.
