# RLF-EDITFUZZ — certification record (2026-11-02)

Lane: RLF-EDITFUZZ (pi-solpi R4/R5: fuzzy edit fallback parity, overflow
and strict-tool error sync). Rig: macmini. Worktree:
`/Users/randy/lanes/RLF-EDITFUZZ`. Branch: `rec/rlf-editfuzz`.

## Verdict: built and certified

66 tests pass across the three lane suites; one red/green drill per
part fired and returned to green; every brief gate exits 0. The resend
call site in `streamResponse` is review-only: no test can show it a
live provider strict-limit refusal without a live call or a stand-in,
and both are out (no live calls; no fakes in tests). Its decision
inputs — the 400 status read, the refusal detector, the strict-tool
presence check, the restoration — are all covered.

## What landed

### Part 1 — fuzzy edit parity (Pi `edit-diff.ts`, M101 item 12)

M101 item 12 had already landed (`matchRange` exact-first, one
normalised retry requiring a unique match, original-byte splice,
`find == replace` refused in `editSinglesOf`, CRLF/BOM preserved). One
gap against Pi's current `normalizeForFuzzyMatch` remained and is now
closed:

- `src/core/toolEdit.ts` — `fuzzyLine` dash class extended from
  U+2013/U+2014/U+2212 to Pi's whole set
  U+2010/U+2011/U+2012/U+2013/U+2014/U+2015/U+2212. Spaces already a
  superset of Pi's; quotes identical; NFKC and trim identical.
- `test/unit/editFuzzy.test.ts` (new) — real files in a real temp folder
  through the real IO (`headlessToolIo`) and `executeTool`: five
  normalisation cases (quotes+dash, non-breaking hyphen, no-break
  space, trailing space, NFKC ligature), ambiguous normalised match
  refused with bytes unchanged, untouched lines byte-exact, CRLF+BOM
  preserved across a normalised edit, `find == replace` refused with
  bytes unchanged. 9 tests.

### Part 2 — overflow classifier (Pi #11494, Copilot 413)

- `src/core/context/overflow.ts` —
  - `/context[_ ]?window[_ ]?exceeded/i` in `RESPONSE_PATTERNS`
    (responses, chat): LiteLLM's pre-call check, spaced or as the bare
    `ContextWindowExceededError` code.
  - `/exceeds the limit of \d+/i` on chat: Copilot's prompt-token shape.
  - `LARGE_BODY_413_PATTERNS` per format, consulted only when
    `status === 413`: Anthropic's documented `request_too_large` pair,
    Copilot's `failed to parse request` (chat only), generic HTTP
    `request entity too large` / `payload too large`. A bare 413 stays
    unclassified. The 429/rate-limit/quota vetoes still run first.
- `test/unit/providersOverflow.test.ts` — three rows added to the shared
  table (LiteLLM x2, Copilot x1, all also veto-checked at 429), plus
  bare-code per-format, Copilot per-format, seven-row 413 table,
  bare/gated/foreign 413, and guard tests. 49 tests in the file.

### Part 3 — strict-limit fallback (Pi #11416)

Pi retries once with `strict: "prefer"` tools non-strict. Here every
strict tool is preferred (no require tier), and strict is currently
sent only on the Meta-direct route, so the fallback is wired there;
the BYO client sends no strict tools today and is untouched (the same
helpers wire in when BYO strict binds).

- `src/core/backends/modelapi/schemas.ts` —
  `isStrictToolLimitErrorMessage` (Pi's three messages verbatim) and
  `withoutStrictTools` (original parameters restored, `strict: false`,
  `previewFields` descriptor preserved, non-strict tools identical;
  the `FunctionToolDefinition[]`/`ToolDefinition[]` overloads mirror
  `withStrictTools`).
- `src/core/backends/modelapi/client.ts` — `streamResponse` sends
  through one closure over the attempt's frozen billing route; a 400
  strict-limit refusal with strict tools still on and no abort is sent
  exactly once more with non-strict tools, then stands (D121 bound
  stated in code; NARROW catch: the named condition resends,
  everything else rethrows). The refused 400 was never billed, and the
  transport owns `paid.isSent`, so settlement is unchanged.
- `test/unit/strictToolFallback.test.ts` (new) — detector positives
  (three verbatim messages) and negatives, and a strictify/restore
  round trip over the product's own `toolDefinitions('linux')`
  (parameters byte-equal, `strict: false`, descriptors preserved,
  untouched tools identical). 8 tests.

### Records

- `PLAN.md` §6: `RLFEDITFUZZ` milestone (unhyphenated: the plan
  reader's milestone id is `[A-Z]{2}[A-Z\d]*`), dated status line.
- `docs/roadmap/entries.json` + regenerated `ROADMAP.md` (251 entries).
- `CHANGELOG.md` `[Unreleased]` → Fixed: three entries in the person's
  words, one per change.

## Drills (each: break, red, restore, green)

All on this rig, 2026-11-02, repository timeouts, `--maxWorkers=3`.

1. Fuzzy matcher: `fuzzyLine` dash class cut to U+2010 only.
   `test/unit/editFuzzy.test.ts` → 1 failed (`edits through quotes
and dash`: the U+2014 line no longer normalises), 8 passed.
   (The U+2011 case still passed: NFKC folds U+2011 to U+2010, which
   the cut class still mapped.) Restored → 9 passed.
2. Overflow classifier: the `context[_ ]?window[_ ]?exceeded` line
   removed. `test/unit/providersOverflow.test.ts` → 1 failed
   (`detects the bare ContextWindowExceededError code on
OpenAI-compatible formats only`), 48 passed. (The full-message
   LiteLLM rows still passed: `Context Window exceeded` matches the
   older `context (length|window)…exceed` pattern; the bare-code test
   is the one proving the new line.) Restored → 49 passed.
3. Strict detector: `The compiled grammar is too large` suffixed with
   ` BROKEN`. `test/unit/strictToolFallback.test.ts` → 1 failed
   (`detects the refusal: The compiled grammar is too large`),
   7 passed. Restored → 8 passed.
4. Final: all three files together → 3 files, 66 tests, all green.

## Gates (all exit 0 unless said)

- `prettier --check` on touched files: 0 (one format fix applied to
  `test/unit/providersOverflow.test.ts`).
- `eslint --max-warnings 0` on touched files: 0 (19 errors fixed:
  `every` over negated `some`, direct boolean reads, `\u{…}`
  escapes, no top-level assignment, overloads on
  `withoutStrictTools` mirroring `withStrictTools`).
- `npm run typecheck`: 0 (the overloads above fixed the last two
  errors).
- `node scripts/check-l10n.mjs`: 0.
- `npm run check:reference`: 0.
- `npm run check:host-api`: 0.
- `npm run check:plan`: 0 (`RLFEDITFUZZ` heading; the first
  `RLF-EDITFUZZ` spelling failed `milestone-heading`).
- `npm run check:roadmap`: 0 after `npm run roadmap:generate`.
- `npm run check:catches`: 0. The new `streamResponse` catch
  classifies NARROW (line 778, verified through the inventory's own
  classifier); the baseline tracks only SWALLOW/GENERIC/CLEANUP sites,
  so no regen.
- `npm run duplication`: 0 clones.
- `npm run cycles`: 0.
- `npm run deadcode`: 0 (its `unused tag` notes are pre-existing, in
  files this lane never touched).
- `npm run build`: 0, every budget holds.
- `npx vitest related` on the four touched sources: 185 files, 2261
  tests; the lane's three suites all pass, and the only failures are
  six unrelated files that fail identically on pristine HEAD
  (`72d8d5003`, separate checkout): `providerHeadersStore` (3, real
  OS keychain), `providerSpend` (1), `execTeamSweep` (1),
  `teamProcessWorkers` (9 here and on pristine, 2 on a rerun),
  `acpUpdateNotSent` (fails only under the loaded related run;
  passes standalone here and on pristine) and
  `team/externalOrchestrator` (failed in one loaded run here,
  passed the repeat here and standalone on pristine). Pristine
  full-related: 15 failed / 2191 passed; this
  branch: 16 then 8 failed across two runs. None covers the lane's
  change; all stay with their owners. The pristine checkout was
  removed afterwards.
