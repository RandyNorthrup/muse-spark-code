# RLACP certification — M63 ACP editors: land the ACP lanes, hold real conversations

Lane RLACP, recovery release. Worktree `/Users/randy/lanes/RLACP`, branch
`rec/rlacp`, from main at 0.19.0 (`c7bdd3e94`). Rig `macmini`.
Built 2026-10-22. No paid provider call anywhere in this lane; the only
model calls are the two M63b proof turns below, on the contributor model
by its explicit name.

## What landed

| Source                                 | Content                                                                                                                                                                                                                      | Landing                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/RLACP/01-feat-acp-stable-methods` | ACPGAPS stable methods: session/delete (G02), logout (G03), $/cancel_request both sides (G04), mode selector (G05), boolean option (G06), additionalDirectories (G09), chunk messageIds (G10), programmatic tool names (G11) | `8581d5b65`, reconciled in `62a29535c`                   |
| `src/RLACP/02-fix-acp-dogfood`         | ACPGAPS dogfood fixes: settled turn accounting, useful failure logs, Model API ACP-assist bundle (`dist/modelApiAcp.js`)                                                                                                     | `b49b4ecc2`                                              |
| `src/RLACP/03-rv-acpdogb`              | RVACPDOG round-2 repairs                                                                                                                                                                                                     | Nothing to land: every commit already in the 0.19.0 base |
| `src/RLACP/04-fix-acp-refusal-honesty` | Honest ACP refusals: one RequestError identity, caller-owned validation errors, eviction/lifecycle mapping, fixed fault codes                                                                                                | `210a30283`, reconciled with the no-invented-limits rule |
| `src/RLACP/05-rv-acpsay`               | Honest editor answers: /compact reports, notices on the notice channel, model/effort refusals naming the model                                                                                                               | `451f6eda5`, reconciled with error-truth                 |

Reconciliations with current main (all in the merge commits unless noted):

- The /compact one-sentence source is read by the editor protocol and
  shown by the panel; the terminal agent keeps its own form
  (`3715b2467`, `src/core/compactResult.ts`, CHANGELOG, PLAN.md CMDSAY).
- The dogfood lane's own timeout/deadline reads (`withDeadline`,
  `ACP_USAGE_READ_TIMEOUT_MS`) are gone: no timeout of ours (D121/D208).
- `isMissingApiKeyError` exported from the Model API entry for the
  runtime engine (HOTFIX0181 rule), `dist/modelApiAcp.js` shipped in the
  VSIX, lazy registry regenerated (`54829753d`).
- The G04 stop combination named as `combinedStop` (`2d933c122`):
  prettier and `unicorn/no-nested-ternary` disagree on the nested
  ternary, so the merge's expression is a named helper now.
- 16 merged catch sites narrowed or made to carry the cause; the
  inventory recognises `internalFaultForLog` (it returns
  `failureForLog`'s own words) and error-carrying `onError` ports;
  baseline regenerated (`e6fa8366f`, PLAN.md §8 rows).
- The safe refusal list shared between the prompt boundaries
  (`ce997949f`, 0 clones).

## M63b proof: real conversations in installed editors

Expected call count, stated first: 1 model request per editor (one
factual prompt, no tools), at most 4 per editor. The packed agent is
`dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz` built from this tree
and installed into a sandbox prefix. The rig's real Muse Code sign-in
is read by the product itself (`XDG_CONFIG_HOME` pointed at the real
config home; sessions and journals stay in the sandbox); no credential
value was read, printed or stored by this lane.

### Neovim 0.12.5 with CodeCompanion (latest, commit 8611841)

Headless driver: `muse_spark` ACP adapter (wrapper command,
`auth_method = "muse-code-login"`,
`session_config_options.model = "muse-spark-1.3-contributor"`),
one auto-submitted chat. Transcript
(`$TMPDIR/rlacp-nvim-transcript.json`):

- user: "What is the capital of Australia? Reply in one short sentence,
  no tools needed."
- llm: "The capital of Australia is Canberra." followed by the
  turn-finished notice (finding F1).

The product's own usage journal
(`usage/v1/days/2026-10-22`, client `CodeCompanion.nvim`): exactly 1
turn on `muse-spark-1.3-contributor`, session
`01a1643c-0c3a-73d3-b604-ada44bdcb990`, input 28938 / output 96
tokens. 1 request, within the allowance of 4.

### Emacs 31.1 with agent-shell 0.88.3 (acp.el 0.18.2, shell-maker 0.98.2)

Emacs is not installed on the rig and Homebrew cannot write outside
the sandbox (`/usr/local/Cellar is not writable`), so the universal
`Emacs-31.1-universal.dmg` from emacsformacosx.com was installed into
the sandbox. Batch driver: agent-shell config per `docs/acp.md` plus
`:needs-authentication`, `:authenticate-request-maker` with method
`muse-code-login`, and `:default-model-id` returning
`muse-spark-1.3-contributor`. Transcript
(`$TMPDIR/rlacp-emacs-transcript.txt`):

- sign-in confirmed by the CLI: "Muse Code sign-in confirmed by
  account/read: accountLogin (signedIn)"; `muse serve` spawned with
  `--contributor-mode on`.
- model set: "Requesting muse-spark-1.3-contributor... Done".
- user: "What is the capital of Australia? Reply in one short sentence,
  no tools needed."
- answer: "Canberra is the capital of Australia." followed by the
  turn-finished notice (finding F1).

Journal (client `agent-shell`): exactly 1 turn on
`muse-spark-1.3-contributor`, session
`01a16444-6278-7523-8afa-13e1505f7b39`, input 28926 / output 103
tokens. 1 request, within the allowance of 4.

### Zed: blocked in the sandbox, lead runs it

No real conversation in Zed from this lane. Exact reasons, each
measured here:

1. `zed --help` and `zed --version` hang: the launcher starts the GUI
   app and never prints (observed twice, terminated).
2. The launcher has no agent surface: a strings scan of
   `/usr/local/bin/zed` shows no `--agent`/`--acp`/`--config` option.
3. Zed's settings live in the real home
   (`~/Library/Application Support/Zed/settings.json`), which this
   sandbox cannot write (`Operation not permitted`, measured).
4. Driving an agent thread needs GUI automation; the rig has the
   owner's live session (VS Code open), so keystroke injection would
   be irresponsible, and the sandbox lacks Accessibility anyway.

Repro for the lead outside the sandbox: point Zed's `agent_servers`
at the packed agent with `--allow-contributor-models`, pick
`muse-spark-1.3-contributor` in the thread's model selector, send one
factual prompt, and read the journal row for the count.

## Findings from the real conversations (follow-ups, not this lane)

- **F1 — a product notice still reads as model text where the client
  shows no notices.** Both editors' answers end with the verbatim
  `turnForegroundCompleted` sentence ("The turn finished its visible
  work; background checks are still running."). The fallback chunk
  carries no message id, so the client folds it into the model's
  message. This is G10's recorded follow-up ("one-shot notices still
  go out ungrouped"); the CMDSAY promise ("otherwise as a separate
  message") does not hold there yet.
- **F2 — "ACP usage accounting is unavailable" warns on every Muse
  Code turn.** `readRecords` throws when the backend is not Model API
  (`src/runtime/main.ts`, `isEnabled`), and the agent warns. The
  journal records these turns correctly (the counts above come from
  it), so the warning is noise on this backend. Follow-up: offer the
  read on Muse Code, or stay silent where it is not offered.
- **F3 — the MSP schema fingerprint has advanced.** The agent logs
  `schemaFingerprintMismatch` (pinned `sha256:5d3b…`, served
  `sha256:f282ad…` on Muse Code 1.4.11) and proceeds under
  additive-optional evolution. Re-pin after a schema advance (an
  upstream-sync lane's work).

Fixed in this lane while reconciling: the refusal-honesty merge had
replaced the panel surface's safe refusal words with the raw
`error.message` (`src/host/prompts/promptEntry.ts`, the `sharingResult`
error). Unexpected faults would have leaked raw diagnostics to the
panel. The safe helper is restored there, with its record.

## Red/green drills

1. Bundle-split export: removed `isMissingApiKeyError` from
   `modelApiEntry.ts`, rebuilt, `node scripts/check-bundle-split.mjs`
   exits 1 naming the missing member; restored, exits 0.
2. Notice channel: forced the translator's notice branch off,
   `acpTranslate.test.ts` fails 1 (the F82 notice expectations);
   restored, 44 pass.
3. /compact answer: returned the done sentence for a cancelled
   compaction, `compactResult.test.ts` fails 1; restored, 5 pass.
4. Carried cost guard: broke the decimal-refusal match,
   `acpTranslate.test.ts` fails the new malformed-cost case;
   restored, 45 pass.

## Gates (final tree, exit codes)

| Gate                                                    | Exit                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `prettier --check` touched files (115, record included) | 0                                                                                                               |
| `eslint` touched files `--max-warnings=0`               | 0                                                                                                               |
| `npm run typecheck`                                     | 0                                                                                                               |
| `node scripts/check-l10n.mjs`                           | 0                                                                                                               |
| `npm run check:reference`                               | 0                                                                                                               |
| `npm run check:host-api`                                | 0                                                                                                               |
| `npm run check:plan`                                    | 0                                                                                                               |
| `npm run check:roadmap`                                 | 0                                                                                                               |
| `npm run check:catches` (baseline regenerated)          | 0                                                                                                               |
| `npm run duplication` (0 clones)                        | 0                                                                                                               |
| `npm run cycles`                                        | 0                                                                                                               |
| `npm run deadcode`                                      | 0                                                                                                               |
| `npm run build`                                         | 0                                                                                                               |
| `npm run package:acp -- --target darwin-x64`            | 0                                                                                                               |
| `npm run security:audit`                                | 0                                                                                                               |
| `vitest related` (56 changed sources → 733 files)       | triaged: 2 lane failures fixed, rest base-identical or green alone (see below)                                  |
| `npm run security:sast`                                 | blocked: the semgrep binary crashes in this sandbox (`ca-certs: empty trust anchors`); the lead runs it outside |

Related-run triage (25 failed files, every one re-run alone and, where
it still failed, against the untouched base in a paired worktree):

- Fixed in this lane: `providerRegistry.test.ts` (unknown-model
  sentence is the landed decision now), `paletteRegistry.test.ts`
  (B13's "context window" wording).
- Green alone on this tree: `packagedBundles` (8/8),
  `resourceProbesDarwin` (8/8), `skillArchive` (6/6),
  `playbookSchedulesInputs`, `reportPlaybookSchedules`,
  `trafficHarness`, `uploadLedgerTwoProcess`.
- Identical on base (same tests, same mode): `crashMarker`,
  `estimatorSnapshotStrict`, `legalCancel`, `macRss`,
  `nativeGitAdapter`, `nativeGitCore`, `scheduleFireFailures`,
  `scheduleJournalHint`, `schedulePauseAfterFailures`,
  `treeSyncNoDeadline`, `treesLifecycleNative`,
  `vault/brokerSocketDirectory`, `vault/credentialMigrationStore`,
  `vault/writerCrashPosix`, `vsixCompression` (missing pinned zopfli
  on the rig), `nativeGitPullRequestReads` (hook timeout both sides).
  Failure modes are hook/test timeouts on fixture I/O (a manual copy
  of the packagedBundles payload takes 149 s right now), live
  machine-reading races, and sandbox-blocked process introspection —
  each measured, none asserted.
