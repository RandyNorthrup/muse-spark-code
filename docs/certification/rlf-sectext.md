# RLF-SECTEXT: hidden-character warnings; fresh review fences; flag-aware rm forbids

Base: `72d8d5003` (main at 0.19.0). Branch `rec/rlf-sectext`, worktree
`/Users/randy/lanes/RLF-SECTEXT`, rig `macmini`. Research §6 briefs E
(SEC-HIDDEN-TEXT) and H (SEC-REVIEWER-FENCE) from
`docs/research/agent-security-2026-11-02.md` (read from
`~/lanes/_ctx/research/`; not on this rig's tree). No live model call;
repository timeouts throughout (no `--testTimeout` anywhere). No
`src/RLF-SECTEXT/*` branches existed to land; built from scratch.

## What changed

SEC-HIDDEN-TEXT (`5c41082`): rules files and skill bodies get the
plan-document treatment's warning half. `WorkspaceContext` scans each
loaded rules file (whole text) and each skill (description plus body)
with `findHiddenCharacters` (`src/core/context/hiddenCharacters.ts`),
which warns only on bidirectional controls, zero-width
spaces/joiners outside emoji sequences (a joiner inside an emoji
grapheme cluster, found with `Intl.Segmenter`, is how the emoji is
spelled), and tag characters. A hit warns once per file per session
through `deps.warn`, names the file and the class, and loads the file
unchanged. New sentence plus three class words in English and all 14
tables (`contextHiddenFile`, `contextHiddenBidi`,
`contextHiddenZeroWidth`, `contextHiddenTag`); desktop tables
regenerated. A tab, a soft hyphen, ESC, DEL and anything else Cc/Cf
warn on nothing.

SEC-REVIEWER-FENCE (`7e277e8`): `reviewerInput` and
`judgeStandaloneTurn` take `newMarker` and fence their data between
fresh random markers per request (16 hex chars from 8 random bytes at
the three production call sites, as web fetch does); literal marker
text inside the data is broken up first with a visible middle dot
(`src/shared/markerFence.ts`). Answer parsing is unchanged. Forbid
matching normalises rm's combined `-r`/`-f` shorts (bash only):
clusters expand, the flag run after `rm` sorts and dedupes, so `rm
-rf`, `rm -fr` and `rm -r -f` (by path, under `sudo`, inside `bash
-c`) read as one forbid in Bypass and in Auto. A lone flag, a
filename past `--`, long flags, and non-bash dialects keep today's
word matching. One existing example moved with the behavior: the
kept-forbid compile test now uses `rm --recursive --force x` (still
word-matched, still kept).

Out of scope, noted: `-R`, `--recursive`/`--force`, and rm spelled in
the PowerShell dialect keep word matching; agents' bodies (their
front matter already refuses hidden characters) and memory are
untouched.

## Red/green drills (each: break, red, restore, green)

- A, hidden-text scan: narrowed `BIDI_CHARACTER` to drop U+202A–U+202E.
  `test/unit/contextHiddenCharacters.test.ts` exited 1 with 3 failures
  (the scanner case, the AGENTS.md case, the skill case). Restored
  byte-identical (`git diff` empty); 9/9 green.
- B, marker break-up: `breakMarkerOccurrences` returned its input.
  `autoReviewer` + `judgeSameSession` exited 1 with 2 failures (the
  reviewer hostile-data case, the judge break-up case). Restored
  byte-identical; green with drill C's rerun (115 passed).
- C, forbid normalisation: `isMatchAnywhere` matched raw words.
  `commandRules` + `permissions` exited 1 with 2 failures (the
  rm-spellings case, the Bypass/Auto case). Restored byte-identical;
  green with drill B's rerun (115 passed).

## Tests

Touched suites, repository timeouts, `--maxWorkers=3`:

- `test/unit/contextHiddenCharacters.test.ts`: 9 passed (real temp
  files, real `fileContextIo`, real `WorkspaceContext`; each class in
  a rules file and in a skill body, emoji-plus-tabs silence,
  once-per-session across `refreshSkills`).
- `test/unit/autoReviewer.test.ts`: 19 passed (fences, fresh markers,
  hostile data holding the marker and the marker alphabet).
- `test/unit/commandRules.test.ts`: 75 passed.
- `test/unit/permissions.test.ts`: 84 passed (incl. `rm -r -f`
  refused as the `rm -rf` forbid in Bypass and Auto).
- `test/unit/judgeSameSession.test.ts`: 21 passed.

`vitest related --run`: markerFence+autoReviewer+wording: 62 passed,
1 failed, 1 skipped (64 affected); commandRules+
reviewerEntry+hiddenCharacters+workspaceContext: 63 passed, 1 failed,
1 skipped (65 affected); museCodeReviewer+museCodeSameJudge: 3 passed
(3 affected). The one failure in the first two runs is
`providerHeadersStore.test.ts` (3 tests, `StoreUnavailableError`:
the macOS Keychain is unavailable in this lane's sandbox), measured
identical on the untouched base (`72d8d5003` worktree: 3 failed).
`runtimePanelGit.test.ts` timed out twice under the first related
run's load and passes alone on both trees (6/6 here, 6/6 on base).
`constants.ts`/`en.ts` related runs were not started: both are
imported repo-wide, so related is the whole battery, which the job
rules forbid; their consumers are covered by the suites above and
the build. No test needed a raised timeout.

## Gates (final tree)

- prettier --check on touched files: 0
- eslint --max-warnings 0 on touched files: 0
- `npm run typecheck`: 0
- `node scripts/check-l10n.mjs`: 0
- `npm run check:reference`: 0
- `npm run check:host-api`: 0 (after regenerating the record for the
  three new `node:crypto` imports, 356 to 359)
- `npm run check:plan`: 0 (251 milestones, 0 drift)
- `npm run check:roadmap`: 0 (251 entries, current)
- `npm run check:catches`: 0 (baseline matches; no new catch sites)
- `npm run duplication`: 0 (0 clones)
- `npm run cycles`: 0 (no circular dependency)
- `npm run deadcode`: 0
- `npm run build`: 0 (every budget holds)
- `npm run security:audit`: 0 (2 moderate advisories noted, 0 exceptions)
- SAST (`SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0
npm run security:sast`): 0 (699 rules on 6022 files, 0 findings)
