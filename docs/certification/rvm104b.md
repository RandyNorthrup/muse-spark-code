# RVM104B — independent review of M104 lane B (cc/m104b) before merge

Review lane (Muse Wonder Full) on the owner's MacBook, branch `rv/m104b`
from `cc/m104b` `420167ddb`. Read first: `docs/certification/cc-m104b.md`
(handoff and final report) and `docs/certification/cc-rlm104.md` "Remaining"
item 1. Every lane-B source file, the shared-code diffs it carries
(`extension.ts`, the conversation controller, ACP, git/GitHub sharing), and
its suites were read against int's own code. Five findings were fixed on
this branch, each with a real-code test that failed before the fix and
passes after (the commit messages carry the drills). No paid or live model
call, no browser, no keychain, vault or credential-store suite was run.

## Verdict

Do not merge without F0 and F1 (both fixed here). With the five fixes
below, lane B is sound to merge as far as this review can prove: its paid
path composes int's `PaidUseConsent` through `AcpPaidUse` exactly as ACP
does, no spending is checked without a limit the person set, the daily
budget is enforced in int's backend transport (unchanged), no git or
workspace write runs before the editor's trust (plan writes now recheck at
publish), settings land only in the runtime's own files under its named
lock, malformed and oversized stdio frames are refused in words, no
credential reaches output or logs, and ACP's turn path is untouched by the
registry extraction. The one P2 left open (F4) is the lane's own recorded
remainder, said in words wherever a person meets it.

## Findings

| #   | Severity        | Where                                                                          | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Disposition                                                                                                                                                                    |
| --- | --------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F0  | P1 blocks merge | `src/runtime/features/paid.ts` gate `isAvailable`                              | The term was `backend === 'modelApi' \|\| !configured`, where VS Code's gate uses `!isDefaultPaidOn` (configured). On Muse Code a feature the person never set showed on and was flagged to the backend, and one they set explicitly was unavailable: review never asked its price and `turnOn` returned false (D78 inverted). The rig masked it: it reported a modelApi backend while settings named Muse Code.                                           | Fixed `49c520443`: mirrors VS Code, with its auto-compaction latch; the rig now names its backend in settings. Red: all four features on, unset, on Muse Code. Green: none.    |
| F1  | P1 blocks merge | `src/runtime/settingsStore.ts` `updateSetting`/`slot`                          | The governor's eight settings are machine-scoped (manifest `scope: machine`; `readResourceSettings` reads the user's value alone) but are not in `MACHINE_SCOPED_SETTINGS`, and their slot is the user's `resources.json` in either scope: a workspace-scope `settings/update` silently landed in the person's machine file (D15).                                                                                                                         | Fixed `20ca7448f`: workspace scope refuses resource settings with `MHP_STATE_MACHINE_SETTING`. Red: the store accepted the write. Green: 13/13.                                |
| F2  | P2 must fix     | `src/runtime/panel/panelSession.ts` `initialized`                              | `gate.review()` ran beside `openInitialSurface` and the flagged set was never compared again, so a price accepted at the start review showed on in the badge while the handshake-built backend (build-time flag snapshot) denied every use until an unrelated settings change rebuilt it.                                                                                                                                                                  | Fixed `5bfb3edd1`: review first; when flags moved, rebuild before the first surface. Red: `paid.isOn('webSearch')` false after acceptance. Green: 17/17.                       |
| F3  | P2 must fix     | `src/runtime/features/plans.ts` `createPlanIo`                                 | Plan saves had no edit guard: a save published into `.agents/plans/` even when trust was withdrawn or the conversation let go between the controller's checks and the publish. VS Code's plan IO runs through `workspaceActionGuard`, which rechecks at the write.                                                                                                                                                                                         | Fixed `cbfd74021`: the IO rechecks signal and trust inside `edit`, in the plan-restricted words. Red: second save landed untrusted. Green: new `runtimePlans` suite 1/1.       |
| F4  | P2 open         | `src/runtime/main.ts` `runtimeFor`; `src/runtime/features/paid.ts` usage       | Calls through the panel are in no usage history and Account & usage is refused in words; backend-initiated paid uses (a search in a turn) also never reach the panel's own `PaidUsage` tally, so the badge undercounts what was billed. Enforcement is unaffected (admission is in the backend transport).                                                                                                                                                 | Open, the lane's recorded remainder: extract `serve`'s usage/accounts/resources composition for both entries (open question 3). Too large for a review fix; nothing is silent. |
| F5  | P3 should fix   | `src/acp/paid.ts` `forget`                                                     | Lane B's Ask again dropped the folder consent and rotated feature generations (which lapses account grants by mismatch) but never revoked the folder's account consents as VS Code's `PaidUseConsent.forget` does (`accounts.forget`): durable epochs did not advance, kept account grants and open questions were not cleared by the revocation itself. No billed use slips through (the generation already fences kept and in-flight answers), hence P3. | Fixed `32a8587e9`: revokes the folder's loaded account route. Red: no epoch marker after forget. Green: `acpPaidGrants` 4/4.                                                   |
| F6  | P3 open         | `src/runtime/backends.ts` `sessionBudgetUsd`                                   | A person-set `modelApiSessionBudgetUsd` has no effect in any runtime backend (the manager is handed the default 0, none). Not a silent cap of ours, but a limit the person set in the panel's settings table is unenforced. Pre-existing int behaviour in ACP and `serve`, not a lane B regression.                                                                                                                                                        | Open for the lead (runtime-wide wiring decision).                                                                                                                              |
| F7  | P3 open         | `src/runtime/features/unavailable.ts`; `workspaceFiles.ts` `readConfinedBytes` | One sentence ("not available through this editor yet") answers many distinct refusals, including an attachment outside the workspace or over its bound. Said in words in every table, but not the reason.                                                                                                                                                                                                                                                  | Open (wording pass when the first host ships).                                                                                                                                 |
| F8  | P3 open         | `test/unit/helpers/panelConversation.ts`                                       | The sessions rig reports its Model API host ready without the OS credential store (disclosed in the helper and the lane record; the store itself fails the suite if read). The real ready path is therefore unproven hermetically; the packed suite proves the not-ready gate. This is int's own rig pattern, and the credential-store suites may not run on this MacBook.                                                                                 | Open (real-life run on a rig with a store; lead).                                                                                                                              |
| F9  | P3 open         | `src/runtime/panel/panelSession.ts` `applySettings`                            | Overlapping settings notices are not serialised; two in flight can each compare flags and rebuild the backend twice (a surface flicker, no wrong billing observed: flag snapshots are taken inside the serialised `replacing` chain's `createBackend`). Unproven harm; recorded from reading, no drill.                                                                                                                                                    | Open.                                                                                                                                                                          |

One further correction with no behaviour change: the comment in
`src/runtime/features/editorContext.ts` claimed excerpt sharing required a
trusted file; neither the panel nor VS Code checks trust there (indexed
and unprotected is the shared rule), and the comment now says so (in this
record's commit).

## Checked and clean

- **Paid use.** Panel ask = `AcpPaidUse` with `paid.ask` attached in
  `createBackend`; Allow once / Always (only when trusted, kept in ACP's
  grants file) / Deny, closed question = Deny, conversation let go while
  asked = Deny (signal plus currency rechecks). Turn-on confirms before
  the setting changes; a decline writes the setting back off. No
  reservation, ledger read or cap exists in the panel path (D208); the
  question names the person's daily limit or that none is set, on the
  Model API backend as VS Code's does. Unpriced-use pre-checks in VS
  Code's `askPaidUse` cover features the panel cannot bill (its four are
  fixed-price or engine-priced before asking, as in ACP).
- **Trust and security.** Git opens only when trusted and the native
  service re-reads trust at every await; mention listing runs no git
  untrusted; attachment reads are confined, identity-checked and bounded,
  and only for a file the person picked; plan writes now recheck (F3);
  edit review rechecks in its admission. Stdio lines are bounded before
  decode, envelopes and results are schema-checked both ways, refusals
  are stable contract codes. Settings writes validate by the setting's
  own schema and refuse credential-shaped names and values; files are
  0600 under one writer (queue plus named lock). Logs carry fixed words
  or failure kinds (`failureForLog`), never values, paths or messages.
  Sign-in keys are typed only in the editor's terminal (`env: {}`).
- **ACP unchanged.** The agent diff is delegation only (registry,
  `forget`, claim names); slash handling, resource sessions, the outbound
  error allow-list and `acpAccounting` are untouched. ACP suites below.
- **Tests.** No `vi.mock`, fake timers, spy replacements or invented
  provider data in any new suite. The editor side is the counterparty
  speaking the frozen contract; stores, git, the controller and bundles
  are the product's own (F8 is the one disclosed seam).
- **Words and limits.** New strings are in English and all 14 tables
  (`check-l10n` 0). No limit of ours was found: the only numeric bounds
  are MHP's frozen envelope/queue limits, a 60-character file-name stem
  (255-byte file-system cap), and the 10 s close grace (cited as five
  times vscode-languageclient's 2 s). No deadline waits on a person.

## The lane's five open questions

The lead's answers stand in the lane record's PLAN status. Where this
review lands on each:

1. **Ask again lapses Always in every folder — keep.** Agree. It errs in
   the safe direction (asks again, never bills silently), it is what
   turning a feature off already does through the same generation file,
   and per-folder grants are read live, so no folder shows a stale
   Always. One addition: the Account & usage words for Ask again are VS
   Code's per-workspace wording; when a host ships, say in the panel's
   help that Ask again is every folder (F7's wording pass), rather than
   build a per-folder store operation now.
2. **Checkpoints unavailable — keep.** Agree. The port is explicit
   (`store: undefined`, disabled), and a real store needs the D51/D63
   design for non-VS Code windows plus tool-IO write recording. Building
   a panel-only store now would be a second checkpoint design to undo.
3. **Extract `serve`'s composition later — keep, but first.** Agree it
   is its own lane; disagree only on urgency: it is also F4 (usage
   history, the panel tally, accounts, the resource governor), so it
   should be the next panel lane and land before any editor ships the
   panel as a person's main surface. Until then every gap it leaves is
   refused in words, which is the right interim state.
4. **No CHANGELOG until a host ships — keep.** Agree. The owner's rule
   is that nothing is claimed until used for real through the packed
   product; no editor carries `panel --stdio` and no real model call
   has gone through it.
5. **Sign-out stays as words — keep.** Agree. Muse Code's login is the
   CLI's to end, and removing the Model API key from the panel needs a
   credential-store suite that may not run where the key lives, for a
   destructive action the terminal already performs where the person
   can see it. The sentence names both commands; revisit only when a
   host ships and can be tested with a real store on a rig.

## Drills (red before, green after; repository timeouts throughout)

| Fix | Break shown by                                  | Red                                              | Green                            |
| --- | ----------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| F0  | new D78 case in `runtimePanelSessions`          | features all on, unset, on Muse Code             | 16/16, then 17/17 with F2's case |
| F1  | machine-scope case in `runtimeSettingsStore`    | "the store accepted what it should refuse"       | 13/13                            |
| F2  | new start-review case in `runtimePanelSessions` | `paid.isOn('webSearch')` false after acceptance  | 17/17                            |
| F3  | new `runtimePlans` suite                        | untrusted second save landed in `.agents/plans/` | 1/1                              |
| F5  | new account case in `acpPaidGrants`             | no `epoch-N` marker after forget                 | 4/4                              |

Each red ran on the pre-fix code in this worktree; each fix commit's
message restates its drill. The pre-commit hook's formatting was
re-read after every commit (rule 15): the F2 commit's hook reflowed the
new test case only.

## Gates (final tree, 2026-10-30, owner's MacBook)

Exit codes are each command's own, run directly in this worktree.

| Gate                                                                          | Exit                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build` (every budget holds; none raised)                             | 0                                                                                                                                                                         |
| `npm run typecheck` (all projects)                                            | 0                                                                                                                                                                         |
| eslint `--max-warnings 0`, prettier `--check` on every touched file           | 0                                                                                                                                                                         |
| `node scripts/check-l10n.mjs` (14 tables, 0 problems)                         | 0                                                                                                                                                                         |
| `npm run check:reference` / `check:host-api` / `check:plan` / `check:roadmap` | 0                                                                                                                                                                         |
| `npm run check:catches` (no count moved)                                      | 0                                                                                                                                                                         |
| `npm run duplication` (0 clones) / `cycles` / `deadcode`                      | 0                                                                                                                                                                         |
| `npm run security:audit` (7 advisories noted, 0 exceptions)                   | 0                                                                                                                                                                         |
| `npm run security:sast`                                                       | 1, NOT RUN: `semgrep is not installed` on this rig (no global installs); cc-m104b measured SAST on the Mac mini as 6 findings identical on its base, none in lane B files |

Suites, `npx vitest run <files> --maxWorkers=3`, at most three files per
run, repository timeouts (no `--testTimeout` anywhere):

- Panel: `runtimePanel` 9, `runtimePanelConversation` 2,
  `runtimePanelSessions` 17, `runtimePanelGit` 6, `runtimeTransfer` 4,
  `runtimePortableBundles` 4, `runtimePlans` 1, `runtimeSettingsStore`
  13, `wireEntry` 2: all pass.
- `runtimeReview` 4/6: the two `/review` cases fail at fixture setup
  with `spawnSync git EPERM`. Measured cause, not lane code:
  `test/unit/helpers/fixtureGit.ts` resolves git through
  `xcrun --find git` with a PATH-only environment, which on this
  MacBook selects the Xcode.app toolchain whose exec the sandbox
  refuses (`env -i PATH=/usr/bin:/bin /usr/bin/git --version` reproduces
  it outside the suite); the CommandLineTools git the lane runs under
  works. The fixture is not a lane B file. BLOCKED-BY-SANDBOX for the
  lead to run outside it; no workaround was built.
- ACP: `acpSessionRegistry` 2, `acpPaidGrants` 4, and batches
  `acpBackendNotice`/`acpElicitation`/`acpEstimate` 11,
  `acpMediaPort`/`acpMediaRefusal`/`acpNoticeUpdates` (pass),
  `acpPermissionAsk`/`acpProxyWarning`/`acpResources` 44,
  `acpSignInLoss`/`acpStableMethods`/`acpSubagentAdmission` 18,
  `acpTeamContracts`/`acpTranslate`/`acpTurnFailure` 107: all pass.
  `acpVaultAttach` not run (vault suite on the owner's MacBook).
- `acpServeHandshake` 0/2 here, the same generic-failure instead of the
  sign-in refusal that cc-m104b measured identically on an archive of
  the int base (`acb48b7f35`); the refusal path it exercises is not in
  lane B's diff. Not re-measured on a base archive in this lane.
- `npx vitest related` for the sources this review changed
  (`settingsStore`, runtime `paid`, `plans`, ACP `paid`): 18 files,
  95 tests, all pass. Panel session sources resolve no related suites
  (they are exercised through `dist/`); those suites ran directly above.

Not run, and why: VS Code integration (Electron cannot start here; the
shared-composition change to `extension.ts` is proved only by typecheck,
lint and the controller suites — hosted CI), a real-life run through a
real editor host with a model (no carrier ships yet; no paid call was
authorised), OS credential-store and vault suites (owner's MacBook),
the GitHub device flow and `gh` (network and credential store).

## Commits (this review, on `rv/m104b`)

| Commit      | Fix                                               |
| ----------- | ------------------------------------------------- |
| `20ca7448f` | F1 resource settings refuse the workspace scope   |
| `49c520443` | F0 paid gate matches VS Code on Muse Code (D78)   |
| `5bfb3edd1` | F2 start-review acceptance flags the backend      |
| `cbfd74021` | F3 plan save rechecks trust and lifetime          |
| `32a8587e9` | F5 Ask again revokes account consents             |
| (this)      | the record; the editor-context comment correction |

No CHANGELOG entry (open question 4). PLAN.md gains one dated line under
lane B's M104 status naming this review and its five fixes.
