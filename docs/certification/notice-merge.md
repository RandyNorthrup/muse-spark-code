# Notice merge: one row per repeated notice (PLAN.md D26)

Recorded 2026-10-03. The fix is on branch `fix/notice-merge` from main
`d182b180`. It covers what the owner saw on 2026-10-03, when Muse Code
1.4.2 stopped answering (`muse serve` wedged at about 100% CPU). The panel
stacked dozens of identical notices over the conversation: "Could not load
the output: Muse Code did not answer item/readOutput within 60 s" five times,
and "Reasoning effort could not be applied: …" seven times.

## Evidence

The investigator's report, `harness-wedge-report.md` in the session
scratchpad, read in full. It is built from:

- the window's `Muse Spark.log` (lines 362-363 and 544-707);
- the CLI trace;
- session `01a0fcee-f38b-71c1-b108-f8de2a2ac65b`.

What it found on the webview side:

- `withNotice` (`src/webview/state/uiState.ts`) appended every notice to
  the transcript as a new row.
- 26 `item/readOutput` timeouts at 10:09:16 came from the open edit rows
  reading their patch again after the resume (`ToolRow.tsx`, `usePatchPages`).

No live model call was made for this lane: the tests run against the
reducer, the components and the harness's fake host.

## What changed

- **The reducer** (`uiState.ts`, `isSameNotice` and `withNotice`):
  - A notice with the same level and text as one already in the
    transcript replaces it. The earlier row is removed, and the new row is
    appended at the end with `repeatCount` (2, 3, …).
  - The row takes a new id, so a fault notice whose button was spent
    offers its buttons again for the new failure. `ActionNotice` is keyed
    by the id, so its local "spent" state starts over.
  - A file restore's notice (`redoRestoreId`) never merges: its Redo is for
    that restore.
  - Each repeat is still announced in the live region, as before, and an
    error notice still unlocks the question cards.
- **The schema** (`transcriptEntries.ts`): `repeatCount` is optional on the
  notice entry. A snapshot saved before this change still parses. Unknown
  keys are stripped, so an older build reading a newer snapshot drops only
  the count. `WEBVIEW_SNAPSHOT_VERSION` is unchanged; it lives in
  `constants.ts`, which another lane owns, and no bump is needed.
- **The row** (`Transcript.tsx`, `RepeatCount`): after the text, plain and
  fault notices show a small outlined count ("7×",
  `UI_TEXT.noticeRepeatBadge`).
  - The glyph is `aria-hidden`. A `sr-only` span reads "Shown 7 times"
    (`UI_TEXT.noticeRepeated`, plural forms), and the same words are the
    badge's tooltip.
  - Restore notices never merge, so they have no count.
- **The look** (`styles.css`):
  - `.notice-repeat` is outlined in `currentcolor`, so its contrast is the
    notice's own.
  - `.notice-error` now uses the theme's text colour on the error tint,
    with a 2 px red inline-start edge (`inputValidation-errorBorder`). See
    the accessibility section below.
- **Text** (`en.ts`, all 14 tables in `l10n/`): `noticeRepeatBadge` and
  `noticeRepeated`, translated with each language's plural categories in
  the same way as PR #90 (`approvalDockCount`).
  - `noticeRepeatBadge` (`{count}×`) is listed under `"*"` in
    `l10n/untranslated.json`, as `namedFilesMore` is.
  - `npm run check:l10n`: 14 tables, 0 problems.
- **Harness**: the scenario `notice-repeat` (`test/harness/index.html`,
  registered in `scripts/lib/harnessServer.mjs`).
  - It shows the conversation followed by five identical output-read
    timeouts, seven identical effort failures, one info notice, and an
    error notice said twice.

### Bounds that were checked and kept

- Notices are transcript rows. There is no separate notice stack, cap or
  timeout, and no dismiss control on them. The only dismissible banner is
  the composer's upload banner (`state.banner`), which is one value and is
  replaced, never stacked.
- The transcript is bounded where it is saved, by `WEBVIEW_STATE_MAX_CHARS`
  (`snapshot.ts`); that is unchanged. Merging only removes rows.

### Item 2: the edit-row re-read was checked and left as it is

`usePatchPages` (`ToolRow.tsx`) already reads only while the row is
expanded:

- `if (!isOpen)` returns before any read.
- A page that never came is asked for again on the next expand. Since
  PR #90 the read also waits until the edit has finished.

The burst after a resume has a different cause. Shell and edit rows start
expanded (`useState(presentation.body === 'shell' || … === 'edit' …)`, as
Claude Code shows them). The resume drops the fetched pages, so every
mounted edit row is "expanded" and reads again at once. Focus view folds the
rows and mounts none.

A new test pins the expanded-only rule: a collapsed edit row reads nothing
when a resume drops its pages, and reads once when it is expanded. Gating the
reads on the viewport (an `IntersectionObserver`), or starting edit rows
collapsed after a resume, would change more than the brief asked. That is
left to the lead.

## Tests

All test runs were on the Kubuntu rig (`rig-test.sh kubuntu … notices`).

| Run                                                                                | Result                 |
| ---------------------------------------------------------------------------------- | ---------------------- |
| uiState, Transcript, App, snapshot, l10n, hostL10n, toolRows (first cut)           | 7 files, 340 passed    |
| The same seven files on the final tree, after the drills (snapshot `rt-notices`)   | 7 files, 340 passed    |
| The three owning files (uiState, Transcript, App), clean, as each drill's base     | 290 tests              |
| `tsc -p src/webview`, `tsc -p test/unit`, `tsc -p tsconfig.json` (host, for en.ts) | exit 0                 |
| `eslint --max-warnings=0` (changed TS/TSX/MJS), `stylelint`, `prettier --check`    | exit 0                 |
| `node scripts/check-l10n.mjs`                                                      | 14 tables, 0 problems  |
| `node scripts/a11y.mjs notice-repeat checkpoint-restore resume transcript` (host)  | 16 pages, 0 violations |

New tests:

- `uiState.test.ts`:
  - "merges a notice said again into one row at the end, with its count":
    three timeouts around a user message and another notice, count 3, a
    new id, announced each time, and the count restored from a snapshot.
  - "keeps notices apart when the text or the level differs, and each
    restore's own": the negative case, two texts, two levels and two
    restores with the same text.
  - "offers a spent fault notice's way on again when the fault is said
    again".
- `Transcript.test.tsx`:
  - "shows how many times a notice was said after its text, read out in
    words": no badge on a single notice; the badge, `aria-hidden`, tooltip
    and words on a plain notice and on a fault notice.
  - "reads a collapsed edit row's patch only once it is expanded, after a
    resume too" (item 2).
- `App.test.tsx`: "shows a notice said again as one row with its count, and
  a different one apart", through the real store.

## Red drills

Each guard was broken on purpose in the working tree. The three owning test
files ran on the Kubuntu rig, and the file was put back byte for byte, with
its SHA-256 checked (scratchpad `notice-merge/drills.mjs`, `drills.jsonl`,
`drill-<n>.log`).

| #   | Guard broken                                                       | File                                 | Exit | Tests                      |
| --- | ------------------------------------------------------------------ | ------------------------------------ | ---- | -------------------------- |
| 1   | reducer: a notice said again is merged at all                      | `webview/state/uiState.ts`           | 1    | 4 failed, 286 passed (290) |
| 2   | reducer: a different text stays apart                              | `webview/state/uiState.ts`           | 1    | 3 failed, 287 passed (290) |
| 3   | reducer: a different level stays apart                             | `webview/state/uiState.ts`           | 1    | 1 failed, 289 passed (290) |
| 4   | reducer: each restore keeps its own notice (its Redo)              | `webview/state/uiState.ts`           | 1    | 1 failed, 289 passed (290) |
| 5   | reducer: the earlier row goes (one row, at the end)                | `webview/state/uiState.ts`           | 1    | 4 failed, 286 passed (290) |
| 6   | reducer: the count carries over                                    | `webview/state/uiState.ts`           | 1    | 2 failed, 288 passed (290) |
| 7   | reducer: the merged row takes a new id (a spent button comes back) | `webview/state/uiState.ts`           | 1    | 2 failed, 288 passed (290) |
| 8   | snapshot: the count survives a reload (field dropped from schema)  | `webview/state/transcriptEntries.ts` | 1    | 1 failed, 289 passed (290) |
| 9   | row: a plain notice shows its count                                | `webview/components/Transcript.tsx`  | 1    | 2 failed, 288 passed (290) |
| 10  | row: a fault notice shows its count                                | `webview/components/Transcript.tsx`  | 1    | 1 failed, 289 passed (290) |
| 11  | row: a notice said once has no count                               | `webview/components/Transcript.tsx`  | 1    | 2 failed, 288 passed (290) |
| 12  | row: the glyph is hidden from screen readers                       | `webview/components/Transcript.tsx`  | 1    | 1 failed, 289 passed (290) |
| 13  | row: the count is read out in words                                | `webview/components/Transcript.tsx`  | 1    | 2 failed, 288 passed (290) |
| 14  | tool row: a collapsed edit row reads nothing until expanded        | `webview/components/ToolRow.tsx`     | 1    | 2 failed, 288 passed (290) |

Drill 14 breaks code this lane did not change. It shows that the new
item-2 test, and PR #90's re-expand test beside it, both guard the
`!isOpen` early return.

## Accessibility and screenshots

The accessibility gate failed on the new scenario before the style fix,
which was a red result nobody planned. `node scripts/a11y.mjs notice-repeat
checkpoint-restore` exited 1 with `color-contrast` (serious) on 4 elements:

- In Light, `.notice-error` and its count measured 2.59:1 (`#f85149` on
  `#f2dede`).
- In Dark, the same pair measured 3.84:1 (`#f85149` on `#5a1d1d`).

No existing scenario had shown an error notice, so the gate had never
measured one. With `.notice-error` on the theme's text colour,
`notice-repeat checkpoint-restore resume transcript` gave 16 pages
(4 scenarios × 4 themes), 0 violations, exit 0. The 8 exempt entries are
`checkpoint-restore`'s chevrons under its open menu, as on main.

Screenshots (harness renders, viewed):

- `notice-merge-dark.png`: the scenario in Dark.
- `notice-merge-light.png`: the same in Light.
- `notice-merge-ru.png`: in Russian, with the harness's default colours.
  The notice texts are the host's, so they stay English.

All three are of the final tree. The error notice reads in the theme's text
colour, with the red edge.
