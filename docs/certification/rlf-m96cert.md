# RLF-M96CERT — M96 certification on int, with one real enabled-team run (2026-10-30)

Lane `RLF-M96CERT`, worktree `/home/randy/lanes/RLF-M96CERT`, branch
`rec/rlf-m96cert`, on the test rig `linuxlt` (Linux, Node 24.21.0). Base:
int/recovery `0a5ebd7189` (CC-INT5's round; `docs/certification/cc-int5.md`
read first, its known failures not counted against this lane). Model
attempts: **0**. Provider calls: **0**. Muse requests: **0** of the at most
12 the brief allowed (the run never reached a provider; §4). Nothing was
pushed, rebased, stashed or tagged. Scratch (two packed installs, fresh
homes, workspaces, logs, drill backups) lived under the lane's `$TMPDIR`
(`m96cert/`, `m96cert2/`). No credential value was read, printed or stored:
the one probe that would have touched the real HOME's credential store was
rejected at approval and was not retried.

**Headline.** No checklist box in M96, M96b or M96c can be closed on the
evidence on int, each for a named reason (§3). The real team run was
attempted twice through the packed product and stopped both times at the
credential store, before any request (§4): this lane session has no D-Bus
session bus, so the Linux Secret Service the packed agent needs on Linux
is unreachable. Per the rig sandbox rule that part stops here; the exact
rerun recipe for the lead outside the sandbox is §4.4. The probes found
one person-visible defect — an unfilled `{options}` in the `--team`
refusal — fixed in `4e9f04878` with a red/green drill and re-probed
through the rebuilt packed product (§5).

## 1. Which surface the plan names

The brief: the packed product, "the ACP agent or `exec --team`, whichever
the plan's acceptance names". Measured on int:

- M96's and M96c's own "live check" texts name an editor-window scenario
  (`C:\muse-live-ws`, a Pair team, two windows, a pipeline) expecting
  about 29 orchestrator requests plus 17 worker turns (M96) — not a
  packed, at-most-12-request run, and not runnable headlessly here.
- M96b names two surfaces. Only one exists in the packed product:
  `exec --team` (Model API, `acceptEdits`, hard budget; `docs/ci.md`).
  The ACP agent has no team session path: `serve` rejects `--team` as an
  unknown option (measured, §4.3), and `teamSessionAdmission`
  (`src/acp/teamAdmission.ts`) has no production caller in `src/` — it is
  exercised only by `test/unit/teamAvailability.test.ts`.

So the run is `muse-spark-code-acp exec --team` from the packed
`muse-spark-code-acp-0.19.0-linux-x64.tgz`, orchestrator
`muse-spark-1.3-contributor`, worker entry
`muse-wonder-full-1.0-contributor` (both by name, with
`--allow-contributor-models`; the run refuses before dispatch if a model
has no known tariff, so a silent non-contributor resolution cannot bill).

## 2. Evidence gathered on int in this lane

Suites run directly in the worktree, `npx vitest run … --maxWorkers=3`,
repository timeouts (no `--testTimeout` anywhere):

| Suites                                                                                             | Exit | Result                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `metaRequestGoldens`, `invariants`, `teamSingleModel`                                              | 0    | 65 passed                                                                                                                              |
| `teamLandingPause`, `teamLandingKilled`, `teamSchedulerRecovery`                                   | 0    | 5 passed (real processes, real git)                                                                                                    |
| `teamAvailability`, `execTeamLedger`, `execTeamSweep`                                              | 0    | 36 passed. `execTeamSweep`'s "removes the dead run" case fails on the macOS base (CC-INT5 §5 row 2); it passes whole on this Linux rig |
| `execTeamFlags`, `acpTeamContracts`, `execArgs` (after the §5 fix)                                 | 0    | 131 passed                                                                                                                             |
| `npx vitest related src/acp/teamAdmission.ts src/runtime/exec/execArgs.ts src/runtime/backends.ts` | 0    | 38 files, 706 passed, 3 skipped, 1 file skipped                                                                                        |

Build and pack:

- `npm run build`: exit **1**, the same four bundles over as CC-INT5 §3,
  at identical sizes: `dist/teamHost.js` 140.2 of 130 KiB,
  `dist/teamRunners.js` 78.4 of 75, `dist/teamScheduler.js` 76.5 of 75,
  `dist/uiText.js` 125.3 of 125. No budget raised. Re-measured after the
  §5 fix: exit 1, still exactly 4 OVER rows. Consequence: the documented
  `npm run package:acp` cannot complete on int (it builds first); the
  tarball below came from `node scripts/package-acp.mjs --target
linux-x64` over the `dist/` the failing build produced (exit 0,
  4,018,038 bytes, 248 files).

## 3. The checklists, box by box

Every box stays open. "Waits for" names the smallest thing that would let
the evidence close it, in the plan's words.

### M96 (13 boxes)

| Box                                                                                                                      | Evidence on int                                                                                                                                                                                                                                                                                                                                                        | Waits for                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The golden request test landed first, on main's bytes                                                                    | The goldens exist and pass (§2), but their provenance is the M91-G harness capture (`invariants.test.ts` header), and `08-team-on.json` was regenerated twice after landfall (`ff680ef87`, `d3c0f2ec3`): today's bytes are int's builders', not main's as landed                                                                                                       | A record tying the landed-first bytes to main, or the lead's rewording to what the goldens now prove                                           |
| Step 1's captures recorded with their counts, and the constants set from them                                            | Lane 0's record (`m96-0.md`) is strings and constants, not step-1 captures; `m96-t.md` records the MCP timeout capture still absent (`TEAM_COLLECT_WAIT_MAX_SECONDS` is 0 until captured)                                                                                                                                                                              | The step-1 capture run itself, with counts                                                                                                     |
| Acceptance 1–50, each with its test and drill (`docs/certification/m96.md`)                                              | `m96.md` does not exist. Several acceptances are known unmet or unproven on int: roles-file loaders and the ACP/Muse worker entries unwired (M96 status, RLF-TEAMWIRE); "the plan runs before the merge card" has no real-code test (CC-INT5 §8 item 2); `requestCheckSlot` has no production caller; the depth bound has no setting and no reader (CC-INT5 §8 item 4) | The acceptance record, written acceptance by acceptance over real-code tests                                                                   |
| Single-model golden broken on purpose: check forced to "team", all seven fixtures failing, restored, exit codes recorded | **Drill run twice here (§6). As worded it does not reproduce:** forcing `decideTeamConversationMode` to `team` fails `teamSingleModel` (9 cases, exit 1) but every golden fixture still passes (42/42), because the golden suite passes `teamTools` to the builder directly and never calls the check. Forcing the team tools into the builder fails 19 golden cases   | A golden path that reads the single-model check (or the lead's rewording to the builder-level drill), then this drill recorded against it      |
| Lane K's tests on all three platforms                                                                                    | Linux here (landing suites green, §2) and macOS in CC-INT5 §4; no Windows execution on int anywhere (`winteam.md`: the hosted windows-latest probe remains the lead's gate; `m96-k.md` is a partial checkpoint on an old base)                                                                                                                                         | Hosted CI's Windows legs on the int tree, per crash point                                                                                      |
| The SoL-Pi team tests on the real engine after M91                                                                       | No record on int of SoL-Pi team tests run on the real engine; `invariants` covers the request-shape rules over recorded inputs only                                                                                                                                                                                                                                    | The SoL-Pi team run on the real engine                                                                                                         |
| Single-model duplicate-model, all-unrunnable, provider-down and not-loaded baselines, with the zero-traffic spy          | The baselines are proven as decision cases (`teamSingleModel`: duplicate, every-entry-unavailable, not-loaded, nothing-configured, key-entries-off, Solo, switch-off; 15 cases green). There is no zero-traffic spy anywhere, and a spy would be a stand-in under the no-fakes rule; byte-equality of the goldens is the real-code form                                | The lead's ruling on the spy's real-code replacement (golden byte equality plus no bundle load), then the box reworded or closed on that proof |
| The rubric's evaluation meets its held-out floors, with its count                                                        | No evaluation record on int; `m96-t.md`: "Live rubric floors … remain for P/the lead"                                                                                                                                                                                                                                                                                  | The rubric evaluation run, with its counted requests                                                                                           |
| The integration test at the 1.99 floor and at stable                                                                     | Not run on int in any lane record (Electron; two editor versions)                                                                                                                                                                                                                                                                                                      | The integration runs at both versions                                                                                                          |
| The live check recorded, with its counts and spend                                                                       | Attempted twice here through the packed product (§4): 0 requests, $0 settled, stopped at the credential store. The plan's own live-check scenario (editor windows, ~29+17 requests) has never run                                                                                                                                                                      | A machine with a running, unlocked Secret Service (or the editor scenario on the owner's machine), under the live-spend rule                   |
| Bundle sizes measured and within budget                                                                                  | Measured: **4 over** (§2). Hosted CI's build step is red on int today                                                                                                                                                                                                                                                                                                  | The bundle-fit lane (CC-INT5 §8 item 1: team MCP server and Traffic into lazy bundles, keys into deferred English; never a raised budget)      |
| README, PRIVACY, CHANGELOG, AGENTS.md, CONTRIBUTING and this record updated                                              | README and CHANGELOG carry the team text; `docs/PRIVACY.md` has no runner/journal/hint-file section (its only "team" line is a storage quota), CONTRIBUTING has no cross-process team test section, and the record (`m96.md`) does not exist                                                                                                                           | The PRIVACY and CONTRIBUTING sections, and `m96.md`                                                                                            |
| The upstream requests filed, or dropped by step 1, with their URLs                                                       | PLAN's own words: drafted, not filed; no URL is recorded for U1–U8                                                                                                                                                                                                                                                                                                     | The lead filing them after the duplicate search, URLs recorded                                                                                 |

### M96b (no certification checklist; its Tests and Gates bullets)

| Item                                                                                                 | Evidence on int                                                                                                                                                                                                                                                                                 | Waits for                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ACP host checks: labelled permission request, merge request, `plan`                                  | Not buildable as worded (it names fakes, now banned) and not built at all: the ACP agent has no team session path (§1). `docs/acp.md` documents no team behaviour                                                                                                                               | The ACP team wiring (session admission caller, `team` tools over ACP, merge permission), proven with real code |
| Headless: the budget covers the workers, approvals become denials, the patch holds the merged change | Proven in real-code form up to the provider boundary: `execTeamLedger`, `execTeamSweep`, `teamAvailability`'s `prepare` cases over real folders (all green here, §2); the packed refusals measured in §4. The merged-patch end of a live run has never been observed through the packed product | The §4 run completed outside the sandbox                                                                       |
| Each has a red drill                                                                                 | Headless: yes (CC-INT5 §7's lease drill; RLF-TEAMGATE's four). ACP: none                                                                                                                                                                                                                        | ACP wiring first                                                                                               |
| Gates, security, docs, plus `docs/acp.md` and `docs/ci.md`                                           | `docs/ci.md` carries the full `exec --team` contract; `docs/acp.md` has no team section because there is no ACP team behaviour to document                                                                                                                                                      | As M96's docs box, plus the ACP wiring                                                                         |

### M96c (11 boxes)

| Box                                                                                  | Evidence on int                                                                                                                                                                                        | Waits for                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Step 1's captures recorded with their counts                                         | Lane 0c's record says it plainly: "No capture is claimed"                                                                                                                                              | The capture run, with counts                                                                |
| Acceptance 1–32, each with its test and drill (`docs/certification/m96c.md`)         | `m96c.md` does not exist; acceptance 31 (sizes) is measurably unmet (§2)                                                                                                                               | The acceptance record                                                                       |
| The owner's eight tests, each seen to fail on its drill                              | The drills are to be recorded in `m96c.md` (absent). The old `m96c-int-drills.json` is round-1/2 history on base `dfbedc5c`, with lanes C and O explicitly left for the lead                           | The eight re-run against the scheduler on int, drills recorded in `m96c.md`                 |
| Pause-before-rename, killed-lander and crash-recovery on all three platforms         | Linux green here (§2), macOS green in CC-INT5 §4, Windows nowhere on int                                                                                                                               | Hosted CI's Windows legs                                                                    |
| The real feature-lane throughput scenario recorded                                   | Never run (needs a live team; §4)                                                                                                                                                                      | The live run, then the four-string lane scenario                                            |
| Single-model mode re-checked against M96's golden fixtures and frames with this code | Fixtures: re-checked green here (§2, §6 drill B). Frames: `test/fixtures/golden-frames/` (4 MSP session frames) has **no consumer anywhere** in `test/`, `src/` or `scripts/` — nothing re-checks them | A real-code frame check (or the frames' retirement by the lead), then the re-check recorded |
| The rubric's evaluation meets its floors, with its count                             | As M96's rubric box                                                                                                                                                                                    | The evaluation run                                                                          |
| The integration test at the 1.99 floor and at stable                                 | As M96's integration box                                                                                                                                                                               | Both runs                                                                                   |
| The live check recorded, with its counts and spend                                   | §4: 0 requests, $0                                                                                                                                                                                     | As M96's live-check box                                                                     |
| Bundle sizes measured and within budget                                              | Measured: 3 of the 4 over are this milestone's (`teamHost`, `teamRunners`, `teamScheduler`)                                                                                                            | The bundle-fit lane                                                                         |
| README, PRIVACY, CHANGELOG, AGENTS.md, CONTRIBUTING and this record updated          | `m96c.md` absent; PRIVACY/CONTRIBUTING as M96's docs box                                                                                                                                               | The missing sections and `m96c.md`                                                          |

## 4. The real run: two attempts, both stopped at the credential store

### 4.1 Setup (a person's steps, the packed product only)

1. `node scripts/package-acp.mjs --target linux-x64` (§2), then
   `npm install <tarball>` into a new empty folder under `$TMPDIR`.
2. A fresh home: `HOME`, `XDG_DATA_HOME` and `XDG_CONFIG_HOME` all point
   into a new empty `$TMPDIR/m96cert/home`; no other environment is
   inherited (`env -i`, PATH and TMPDIR only).
3. An empty workspace: a fresh git repository with one seed commit
   (`index.js`).
4. The two-model setup the way the docs name it: a `TeamSnapshot` at
   `<data>/acp/<workspaceKey>/team.json` with one `engineering` entry,
   `{"kind":"engine","model":"muse-wonder-full-1.0-contributor","pays":"key"}`,
   `concurrent: 2`; the run's own model `muse-spark-1.3-contributor`.
5. The task (at least two workers and a merge): delegate two engineering
   tasks at the same time — `add.js` exporting `add(a, b)`, `mul.js`
   exporting `mul(a, b)` — then collect both and merge both.

**Stated before the run:** at most **12 model requests**
(`--max-requests 12`; estimate at most 10: orchestrator delegate /
collect / two merges / final, plus two workers at up to 3 each) and a
hard budget of **$1.00** (`--max-budget-usd 1`). If either model name
resolved to anything but its contributor self the run was not to start.

### 4.2 Attempt 1 (before any fix), attempt 2 (after the §5 fix, rebuilt and repacked)

The exact command, both times:

```text
muse-spark-code-acp exec --team --backend modelApi \
  --permission-mode acceptEdits --model muse-spark-1.3-contributor \
  --allow-contributor-models --max-budget-usd 1 --max-requests 12 \
  --cwd <ws> --prompt-file <prompt> --output json
```

Both attempts, identically: exit code **3**, result
`{"status":"backend_unavailable","backend":"modelApi",…}` with error
"This computer's credential store cannot be used (unavailable). On Linux
the agent needs a running, unlocked Secret Service, such as GNOME
Keyring or KWallet." **Requests: 0. Settled: $0.000000. Uncertain: $0.**
No session was created (`sessionId: null`), so there is no session
record to count beyond the result's own `usage.requests: 0` — that is
the after-count, and it agrees with the workspace being untouched
(`index.js` only, verified by listing after attempt 2). Expected 12 at
most, actual **0**.

Why: on Linux the agent reads the Model API key only from the OS Secret
Service (`src/runtime/keyStore.ts`, D61). This lane session has no
`DBUS_SESSION_BUS_ADDRESS` (checked by name in the environment), so no
Secret Service is reachable, fresh home or not. `auth status` under the
fresh home says the same in words (exit 1). Every other route is closed
by the product's own rules: `--key-stdin` needs a key value this lane
must never see (and no key environment is present); subscription and
Muse Code workers are refused headlessly by design; a local model
would not resolve to the two contributor names the brief pins. Per the
rig sandbox rule this part stops here — no shim, no keyring substitute.
The refusal itself is correct product behaviour: in words, before any
request, $0 settled.

### 4.3 Refusal probes through the packed product (all 0 requests)

| Probe                                                            | Result                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `exec --team --backend museCode --permission-mode acceptEdits …` | Refused, but with the §5 defect: "…(--backend modelApi): {options}." After the fix: "…(--backend modelApi): --team." |
| `exec --team --backend modelApi` without `--max-budget-usd`      | "Model API requires --max-budget-usd."                                                                               |
| `serve --team`                                                   | "Unknown option --team for 'serve': … Did you mean '--help'?" (the ACP agent has no team flag; §1)                   |
| `exec --help`                                                    | `--team` line present: engine teams with Model API, `acceptEdits`, hard budget shared by every worker                |
| `providers list` (fresh home)                                    | "No providers are configured.", exit 0                                                                               |

### 4.4 Rerun recipe for the lead (outside the sandbox)

On a Linux desktop session with GNOME Keyring or KWallet running and
unlocked, and the Model API key already stored (`auth set` from a
terminal): rebuild and pack from this branch (`npm run build` is red
until the bundle-fit lane lands; `node scripts/package-acp.mjs --target
linux-x64` packs the produced `dist/`), install into an empty folder,
then repeat §4.1 steps 2–5 verbatim (the fresh home still reaches the
same Secret Service over the session bus). Count afterwards from the
result's `usage.requests` and the session record the run names; the
stated ceiling stands at 12 requests / $1.00. A second 12 is authorised
by the brief only for a fix-and-repeat.

## 5. The defect the probes found, and its fix (`4e9f04878`)

`exec --team` off the Model API backend printed the unfilled template
`These options require the Model API backend (--backend modelApi): {options}.`
Two causes. (a) `teamExecAdmission` (`src/acp/teamAdmission.ts`) returned
`UI_TEXT.execModelApiOnly` without `fill`, and `startTeamWorker`
(`src/runtime/backends.ts`) threw the same unfilled sentence. (b)
`--team` was missing from the as-typed Model-API-only options list in
`parseExec` (`src/runtime/exec/execArgs.ts`), so the early, correctly
filled refusal never named it and the run fell through to (a).

The fix fills both sites with `--team` and adds `team` to that list. No
new strings (the sentence already exists in all 14 tables). The
maintained expectations in `execTeamFlags.test.ts` and
`acpTeamContracts.test.ts` were updated first to the filled sentence:
**red, 2 failed / 62 passed**; after the fix **131 passed** across
`execTeamFlags`, `acpTeamContracts` and `execArgs`; `vitest related`
over the three changed sources green (706 passed, §2). Re-probed
through the rebuilt packed product: the refusal now ends ": --team."
(§4.3). Re-read after the commit hook: the committed diff is the
intended one (5 files, +13/−8).

## 6. The golden drill, run twice (M96's fourth box)

Each break: one edit, the owning suite, restore by byte copy (`cmp`
clean), green.

| Break                                                                                       | Suite                | Red                                                                                                                      | Green after restore                                 |
| ------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| **As worded:** `decideTeamConversationMode` forced to `{mode:'team'}`                       | `teamSingleModel`    | 9 failed, exit 1                                                                                                         | 65 passed (with `invariants`, `metaRequestGoldens`) |
| (same break)                                                                                | `invariants` goldens | **42 passed — the fixtures do not fail**: the suite passes `teamTools` to the builder directly and never calls the check | —                                                   |
| Builder-level equivalent: `toolDefinitions` defaults `teamTools` to `TEAM_TOOL_DEFINITIONS` | `invariants`         | 19 failed / 23 passed, exit 1 (the team-on fixture is among the passes)                                                  | 65 passed                                           |

So single-model request bytes are guarded at the builder, and the
single-model check is guarded by its own suite, but no test joins the
check to the bytes. That gap — not a product defect; the host wiring
reads the decision at `ModelApiHost` — is why the box cannot close as
worded (§3).

## 7. Gates on the final tree

Every exit code is the command's own, on `4e9f04878` plus this record,
the PLAN statuses and the CHANGELOG entry.

| Gate                                                   | Exit  | Note                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prettier --check` (5 touched files)                   | 0     |                                                                                                                                                                                                                                                                                |
| `eslint --max-warnings 0` (5 touched files)            | 0     |                                                                                                                                                                                                                                                                                |
| `npm run typecheck`                                    | 0     | all projects                                                                                                                                                                                                                                                                   |
| `node scripts/check-l10n.mjs`                          | 0     | no new strings                                                                                                                                                                                                                                                                 |
| `npm run check:reference`                              | 0     | "364 CLI; current". A first invocation in a combined command reported 1 with its output discarded by me; the immediate rerun reads current at exit 0 and nothing changed between: the first exit's cause is UNMEASURED                                                         |
| `npm run check:host-api`                               | 0     |                                                                                                                                                                                                                                                                                |
| `npm run check:plan` / `check:roadmap`                 | 0 / 0 | after the status lines + `roadmap:generate`                                                                                                                                                                                                                                    |
| `npm run check:catches`                                | 0     | no count moved                                                                                                                                                                                                                                                                 |
| `npm run duplication`                                  | 0     | 0 clones                                                                                                                                                                                                                                                                       |
| `npm run cycles`                                       | 0     |                                                                                                                                                                                                                                                                                |
| `npm run deadcode`                                     | 0     | 3 pre-existing unused-tag hints                                                                                                                                                                                                                                                |
| `npm run build`                                        | **1** | the base's 4 OVER bundles (§2), unchanged by this lane; hosted CI red until the bundle-fit lane                                                                                                                                                                                |
| `npm run security:audit`                               | **1** | 10 advisories (CC-INT5: 7 at exit 0); the new blocking one is `GHSA-mrwp-f3q8-3g9p` (high, `follow-redirects`). This lane's diff touches no dependency file (`git diff` over package files: 0). Waits for a bump or a reviewed D29 exception — the lead's call, not fixed here |
| `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` | **1** | 6 blocking findings, the same count and files as CC-INT5 §3 (`os/build.py`, `os/pi/compose.py`, `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`); none is in this lane's 5-file diff                                    |
| Suites and `vitest related`                            | 0     | §2                                                                                                                                                                                                                                                                             |

Not run: the VS Code integration suites and the browser suites (no
Electron proof is claimed here; linuxlt can run them but nothing in this
lane's diff touches the editor host or a webview), the vault and OS
credential-store named suites (the fix touches no store code; the
`related` selection did not name them), Windows-only paths.

## 8. Open for the lead

1. **Make the real run** (§4.4) — it is the only missing proof that an
   enabled team works through the packed product on int, and M96/M96b/
   M96c's live-check boxes, M96b's merged-patch item and M96c's
   throughput box all hang off it. Until then the CHANGELOG must keep
   saying no real team run has been made on this build.
2. **Bundle-fit lane** (CC-INT5 §8 item 1) — `npm run build` and with it
   `npm run package:acp` stay red on int; three of the four overs are
   the team bundles.
3. **`docs/certification/m96.md` and `m96c.md`** — 50 + 32 acceptances,
   each with test and drill; known gaps are listed in §3 so the records
   can start from them.
4. **Golden frames have no consumer** (§3, M96c box 6) and **no test
   joins the single-model check to the golden bytes** (§6): one small
   real-code lane could close both drill wordings.
5. **ACP team wiring** (M96b's ACP half) — admission helper exists,
   nothing calls it (§1).
6. **Audit**: bump `follow-redirects` or record a dated D29 exception.
7. Unchanged from CC-INT5 §8: the upstream filings (U1–U8), the depth
   setting, the dated items (Marketplace PAT by 2026-12-01; ACP SDK
   2.0.2's window on 2026-10-31).

## 9. Commits

`0a5ebd7189` (base) → `4e9f04878` (the §5 fix and its tests) → the
commit carrying this record, the three PLAN status lines, the
regenerated roadmap and the CHANGELOG entry.
