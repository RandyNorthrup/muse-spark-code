# M113 renderer goldens

These 60 files hold one Markdown, HTML, terminal text and canonical JSON
output for each of the 15 `report-v1` kinds. The `.golden` suffix preserves
the renderer's exact bytes; the general formatter does not rewrite them.
All have LF and exactly one trailing newline.

The normalized documents come from `test/unit/reportRenderFixtures.ts`,
using lane 0's document builder, fixed time, versions, locale and themes.
The real fixed-date Git fixture is built once in `determinism.test.ts`; its
two commit subjects are checked against the normalized golden facts.
The fixture includes Needs you priorities, every source status, unknown
freshness, row provenance, omitted counts and source punctuation. These are
renderer fixtures, not evidence that the collectors or future milestone
bindings are implemented.

The four `render.*.test.ts` files compare bytes without updating them.
Changes require a reviewed regeneration: bundle the fixture module with
the repository's pinned esbuild into the worktree's ignored `temp/`
directory, call `renderFixture(kind)` and each exported `RENDERERS` entry
with `en` and `REPORT_THEME`, and write its string to the matching golden.
Inspect the diff, run all four owning files, and repeat the determinism and
redaction suites. No production source, credential or network input is
used to update a golden.

`report-320-light.png` is the static HTML in Chrome at 320 pixels after the
four-theme, two-width axe run. The machine, assertions and exact-restoration
receipts are in the lane R certification record.
