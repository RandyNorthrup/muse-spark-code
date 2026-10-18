# Pull-request description: NOLIMITS1 — remove the bounds we kept (branch `fix/nolimits-1-fin`)

Certification: `docs/certification/nolimits-1.md` (proof per piece in
§N1–§N9, merge record in §NOLIMITS1FIN). No model calls, no credentials.

## What changes for a person

Nothing to configure and nothing new to learn: things that used to
refuse now stand. The only hard-coded limits left are each provider's
own; none of ours by default.

- Prompt library: a prompt file of any size imports (was: refused past
  128 KiB); titles, bodies and tags of any length save (only a blank
  title refuses); a scope holds any number of prompts (was: 200).
- Sharing and session move: exports, shares and imports carry any item
  count (was: refused past 20,000). The share view still pages 200 items
  at a time — display paging, it refuses nothing.
- Reports: report sources of any size generate (was: refused past
  16 MiB); the reader streams chunk by chunk.
- Best-of-N: any number of attempts of 1 or more (was: only 2–5).
- Check commands: any number (was: 8); a long check timeout works past
  Node's 24.8-day timer maximum by chaining timers.
- Team delegation and the Action's budget/request ceilings we invented
  ($20, 500 requests, the engine/delegate caps) are gone; the Action
  accepts what exec accepts.

## Real-use steps (lead re-run on the PR tree)

No model, no keys, no network. Build, then drive the built `dist/`
bundles with real files; every step asserts with an exit code
(full scripts and outputs in §N6, which used the lane's `$TMPDIR`):

1. `npm run build` — production bundles plus the size, split,
   host-globals and notices gates, exit 0.
2. Large prompt file: pipe a 168,016-byte body (marker
   `BIG-BODY-MARKER` plus padding) on stdin through built
   `dist/sharingRuntime.js` `prompts save` — exit 0, `kind: saved`,
   the stored file holds all 168,281 characters. The old code refused
   past 128 KiB at the stdin read.
3. Long share: a 20,001-item source through built
   `dist/sharingRuntime.js` `share` (preview, then confirm with the
   preview's own id) — exit 0, `share.json` is 2,418,186 bytes with all
   20,001 items. The old code threw `shareTooLarge`.
4. Large report source: a 17,835,661-byte rollout file through built
   `dist/reporting.js` `generate({kind: 'usage', ...})` — status
   `generated`, the last event's 7777 input tokens in the document. The
   old code refused with `limit` past 16 MiB.
5. Refusal strings gone: `promptLimits`, `shareTooLarge`,
   `exportTooLarge`, `transferTooLarge` appear in no `dist/*.js` bundle
   and no shipped `l10n/ui.*.json`; the new `promptTitleRequired`
   ships in `dist/prompts.js`, `dist/sharingRuntime.js` and all
   14 tables.

## What is withdrawn, honestly

Main's no-stand-ins sweep (PR #183, merged in `1a1d5aa03`) deleted six
test files this branch had touched; the merge keeps the deletions —
every one used `vi.fn`, which the eslint gate now refuses. The
behaviours they covered move to `docs/real-life/unproven.md` (entries
that still named a removed cap carry a dated note saying what is
withdrawn, so a future run cannot re-prove a removed bound). What keeps
automated cover on real code: `promptBoundsRemoved.test.ts` (3 tests,
real temp files, fire drill in the cert), plus the surviving
`bestOfN`, `checkCommands`, `execArgs`, `reportSourceSize`,
`chainedTimeout`, `runLedger`, `sessionTransfer`, `chatShareRange` and
`planStore` suites. `teamConstants.test.ts` takes main's version.

## Gates on the final tree

- prettier `--check` on the changed files: 0
- eslint `test/unit`, `test` minus unit, and everything but `test/`,
  each `--max-warnings=0`: 0
- typecheck (all five projects): 0
- `check:plan`: 0 drift; `check:l10n`: 0 problems;
  `check:reference`: current; `check:host-api`: 0 problems
- `deadcode`: 0; `cycles`: none; duplication: 0 clones
- `security:audit`: 0 (2 advisories, 1 exception on file)
- `npm run build`: 0
- suites above: all pass (promptBoundsRemoved 3/3 in 868 ms)
- `security:sast`: NOT RUN — semgrep's binary aborts in this sandbox
  (`ca-certs: empty trust anchors`); the lead runs it outside.
