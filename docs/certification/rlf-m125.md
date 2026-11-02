# RLF-M125 — M125, the Judge: the open rows int can carry (2026-11-02)

Recovery lane `RLF-M125`, worktree `/Users/user/lanes/RLF-M125`, branch
`rec/rlf-m125`, on the test rig `macbook` (macOS, Darwin 24.6.0, Intel
x86_64, Node 24.21.0). Base: int/recovery `0a5ebd7189`
(`docs/certification/cc-int5.md`, whose known failures are not counted
against this lane). Model attempts: **0**. Provider calls: **0**. Muse
requests: **0** (the brief names no real use). Nothing was pushed,
rebased, stashed or tagged. No browser or GUI app was started, no
keychain or credential-store suite was run, and no model or runtime was
downloaded. Scratch files lived in the worktree's ignored `temp/`
(the stat proof: policy header, CLT-built binaries, the proof script).

This lane read the whole M125 section, D107 and D217 with their design
records, and the certification records the plan names (`m125.md`,
`m125-f1a.md`, `m125-f1.md`, `m125-f2.md`, `judge-bench.md`,
`rlf-judgefix.md`, `paritymac.md`, `cc-int5.md`), grepped every lane's
files on int, and built the open rows int can carry now. RLM125 plus
RLF-JUDGEFIX, RVINT4 and PARITYMAC had already landed most of M125 on
int; what is still open is inventoried below with exactly what each
row waits for.

## 1. Lane inventory: what int has, what this lane built

| Lane                       | int already has (grepped, not trusted)                                                                                                                                                                                                                                          | This lane                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Contract / strings       | `fast/classes.ts` with the shared `eligible`; 42 `JUDGE_*` constants; `museSpark.judge.engine` (`auto` = the fast judge), `fastPathOff`, the **Set Up Local Judge** command; English plus all 14 tables; the catalog entries                                                    | nothing open                                                                                                                                                      |
| R Deterministic checks     | `fast/reflex/{loop,triage,effort,relevance,skills,failures,done}.ts`, read by both backends (`ModelApiHost` shares `toolRepeatKey`, `MuseCodeHost` shares `detectLoop`); `RepeatGuard` still guards Model API turns as the witness layer beside them, no clone                  | nothing open                                                                                                                                                      |
| E Engine resolver          | the pure modules (`resolve`, `latency`, `slack`, `cascade`, `pack`); `sides.ts` builds a verified-local side when ports supply one                                                                                                                                              | open, waits for profiles + live wins (§6.1): no production caller resolves an engine, no latency sample is fed, no dispatch runs, `ports.local` is never supplied |
| H Hardware scan / setup    | `judge/hardware/**`, `judge/setup/**`, `judgeModels.json` with its source-and-date schema, `judgeHardware` fixtures, the scan/setup/remove CLI, the wizard; setup installs a private runtime even where an Ollama runs (isolation, by design: reuse was deliberately not built) | open, owner's go (§6.2): any download, the preload capture and parser                                                                                             |
| J Verified local fast path | the hold broker (`fast/blobHold.ts`), the Linux lease holder (`native/blobhold/`), its build script and drills; every verified dispatch runs the full two-pass disk proof first, on every platform                                                                              | open (§6.3): the hold wiring into dispatch (needs a lifecycle owner, M98's call, and a Linux rig), the Windows helper (a Windows rig), the `m125-j.md` timings    |
| L Calibration              | `calibration/{schema,apply,profiles}` with technique `systemone` and the nine binary families; unknown families, techniques and non-binary labels rejected                                                                                                                      | open, live runs (§6.4): no fitted profile qualifies (200 independent labels per family); every model-backed family reports `profile-missing` and stays off        |
| W Wizard                   | the shared React app, host bridge, panel host, Judge section (re-scan, change, remove), status item, walkthrough step, palette command, headless CLI, `docs/judge.md` and `docs/acp.md`                                                                                         | open (§6.5): the MHP mapping for other editors (D84's review plus the hostsland merge), Update in Settings (unproven download path)                               |
| K Accuracy checks          | `fast/checks/**` with the gate: calibrated verdicts at or above each family's precision bar, log-only below it or without a profile                                                                                                                                             | open with E: no engine asks yet, so every check stays log-only                                                                                                    |
| M Model API wiring         | `fastJudge()` in `ModelApiHost` (effort, tail hints and notes, context, loop hint and stop, compaction keep-list, skip emits, turn records); off/abstaining goldens byte-identical                                                                                              | nothing open                                                                                                                                                      |
| C Muse Code wiring         | the lane-C code in `MuseCodeHost` (the switch, turn tracking, tail hints, post-turn notes, the stuck chip); no effort frame; MSP goldens; the live-SDK replay suite                                                                                                             | nothing open                                                                                                                                                      |
| P Providers                | `fast/engines.ts`: logprob/stated/effort admission over M95 records, all fail-closed                                                                                                                                                                                            | nothing open                                                                                                                                                      |
| F1a B1 core                | the Linux helper, grammar, runner, probes and self-tests with D217's stat-from-walk; the macOS Seatbelt helper (PARITYMAC)                                                                                                                                                      | **built: macOS stat-from-walk (D217 parity, §3)**; open (§6.6): macOS certification and enabling (lead), Windows stays an owner-recorded exception                |
| F1b Approval integration   | `approval.ts` (floor, race, hold), `b1Hold.ts`, the audit schema and journal; inert on three locks (no helper path supplied, no certified platform, no helper ships)                                                                                                            | nothing open                                                                                                                                                      |
| F2 B2 core                 | the grammar, definition closure, config keys, owner baseline over real git, frozen snapshot, the capture-verified allow-list                                                                                                                                                    | open (§6.7): the contained run path (a Linux-rig lane)                                                                                                            |
| U Usage and panel          | turn records on both backends, the panel rolls and rows, the Judge section, status states, usage strings in all 15 tables                                                                                                                                                       | open (§6.8): V-report persistence (no producer for `measuredMsPerTurn`; waits for a design decision)                                                              |
| V Measurement              | the nine frozen arms, four judge tasks, the replay recorder with the ship rule, runner wiring, fake-replay wiring receipts                                                                                                                                                      | open, live runs (§6.4): the owner's go with counts, independent labels, the live harness                                                                          |
| D Docs / integration       | `docs/judge.md`, README, `docs/acp.md`, CHANGELOG, walkthrough, §8 rows, the wizard integration test, the roadmap entry                                                                                                                                                         | **built: the PRIVACY and SECURITY rows (§4)**; open: the walkthrough art still wants the owner's sign-off                                                         |

## 2. Acceptance rows 1–17

1. Off/abstaining byte-identical: **have** (Model API goldens, Muse Code
   MSP goldens, the forced-decision drill).
2. Default user: **have** for the deterministic path (no download, key,
   call or prompt; the walkthrough shows with its completion event; the
   status item opens the wizard). The silent verified-local use waits
   for E's runtime half (§6.1).
3. No I/S dispatch to the chat model: **have** (the resolver forbids it
   and a test fails if one does; nothing dispatches at all today).
4. Deadlines, fallback, late-answer discard: **have** (the cascade, the
   late-engine drill, deterministic miss within the same deadline).
5. Skip/readmit/reprobe/samples: **have** as pure logic (rolling p95
   over complete calls, misses as infinite latency, suspension by the
   third miss, three-probe requalification, consented preload
   recovery); the runtime feeding waits for E (§6.1).
6. Tail-only context/triage: **have** (keep-list, triage gates, the
   history-edit drill; `ide` triage off on Muse Code).
7. Effort lowered-only as a request field; no effort frame on Muse
   Code: **have** (the scale read, the abstention bytes, the MSP
   golden and its drill).
8. Confidential workspaces: **have** for the engine path (deterministic
   checks and verified local only) and the hosted dispatch guards.
   Gap, recorded not built: the wizard's Advanced step still offers
   its hosted button there; the button only opens the judge settings
   page, and the downstream gates hold, but the plan says it is never
   offered. Hiding it is UI work with a look owed, left for a rig
   with a browser.
9. Scan/recommendation: **have** (per-class fixtures, source-and-date
   schema, `eligible`-gated classes, the benchmark budget, the
   over-budget drill).
10. Install: **have** as code and UI (consent names what/where/size/
    time, SHA-256 gate, resume, Cancel and Set Up Later at every
    step, the Advanced gate, preload before registration, health and
    smoke through the verified path, Done from `eligible` and the
    profiles, Remove and Re-scan semantics). Unproven in real use:
    no download, install or smoke has run (§6.2).
11. Checks above a fitted bar: **have** the gate; vacuous in product
    (no profile, §6.4). 2b still rejects unknown families,
    techniques and non-binary labels; a smoke never creates a profile.
12. M75 arms and the ship rule: **have** the wiring; the live wins
    and default-on rulings are the lead's first live check (§6.9).
13. Usage rows: **have** (time saved per turn, tokens, calls, checks,
    method named, unknown as unknown).
14. F1: **have** on Linux (the floor table, executable/environment
    drills, the B1-1 to B1-14 boundary drills, probes and self-tests,
    the 5 s veto window, byte-identical off, audit rows). macOS:
    implemented plus this lane's stat (§3); the live-sandbox drills
    run on hosted macOS CI. Windows, Muse Code, git, `rg` and root
    never skip.
15. ACP and every editor: **partial.** Have: the shared core and
    webview, the headless `judge scan|setup|remove` (run against the
    built agent), the VS Code-floor integration test. Open: the
    native editors (RLF-HOSTSLAND's nine hosts sit on
    `lanes/rlf-hostsland`, not on int; the MHP wizard mapping waits
    for D84's review). No editor beyond VS Code and headless is
    recorded.
16. Lane J: **partial.** Have: every 2j provenance drill still red,
    the broker drills, macOS full-proof-by-construction. Open: the
    hold-integration drills and per-platform timings (§6.3).
17. F2: **have** the core proofs; the run-path drills (B2-1 to B2-31)
    wait for the contained run (§6.7).

## 3. Built: macOS B1 reports stat from the walk (D217 parity)

D217 rules that the confinement helper answers `stat` itself, yet the
macOS helper executed `/usr/bin/stat`: a BSD-shaped answer behind the
same grammar that yields the GNU-shaped helper report on Linux. The
mac run path now mirrors the Linux stat branch: a recursive stat
refuses; no program is verified and no profile is armed; the
walk-verified operand descriptors stay open until the report; the
report reads them with `fstat` (never resolving a path again),
re-applies the device, file-type and link-count predicates, and
prints the default report in the Linux shape with numeric owners and
UTC times; operand opens that fail with `EMFILE`/`ENFILE` refuse
with `limits`; and `stat` names no program, so a stat that reached
program verification would refuse there too. The tool arguments must
mirror the walked operands, as on Linux. No TypeScript changed: the
confined protocol line is unchanged, and unknown refusal words
already read as the runner's generic refusal.

Files: `native/confine/MuseSparkConfineMac.c` (the branch, the
predicates, the report, the `MUSE_FSTAT` variant hook);
`test/unit/helpers/inspectMacStat{NoExec,Race,Nlink,Checks,Limits}.c`;
seven cases in `test/unit/inspectNative.test.ts` (two refusal cases
in the pre-confinement group, five in the new `macOS stat reports`
group). The stat cases need the compiler but no live sandbox.

Proof on this MacBook, where the rig's `xcode-select` points at a
missing `/Applications/Xcode.app` so `/usr/bin/cc` fails (the
PARITYMAC rig note, unchanged): the committed tests build through
`/usr/bin/cc` and skip visibly here — 17 skipped, 0 failed. Every
binary below was compiled with the direct CLT compiler at the
repo's exact flags (`-std=c11 -O2 -Wall -Wextra -Werror
-Wconversion -Wshadow`), and every committed assertion was executed
against those binaries by `temp/stat-proof/proof.ts` (kept in the
ignored scratch, with its policy-header generator): 7/7 pass. The
before/after is sharp: the HEAD helper prints the confined line and
dies in `sandbox-exec` here (exit 71, `sandbox_apply: Operation not
permitted`); the new helper answers exit 0 with the report, no
profile written, nothing executed — and the NoExec variant, which
fails every `execve`, answers identically. Field-by-field the report
matches `fs.statSync` (size, inode, device, links, octal mode,
owners, three UTC nanosecond times, birth). Hosted macOS CI runs
the committed cases for real.

## 4. Built: lane D's PRIVACY and SECURITY rows

`docs/PRIVACY.md` gains the local-judge scan (its facts never leave
the machine), setup (the consent gate; no download has run and the
install/smoke steps are unproven) and fast-judge checks
(deterministic checks local, model-backed checks off without fitted
profiles, B2 with no run path). `SECURITY.md` gains the F1/F2
posture: present but inert on three locks (no helper path supplied,
no certified platform, no helper ships), the B1 boundary proven
outside the product on Linux and macOS with stat from the walk, and
B2's core without its contained run. Every sentence was grepped
before it was written.

## 5. Red/green drills

Each: one edit in the mac helper, the affected variant rebuilt with
the CLT compiler, the proof script red, the helper restored
byte-identical (`cmp` against a copy), the variant rebuilt, the
proof green.

| Break                                                    | Caught by                            | red | green  |
| -------------------------------------------------------- | ------------------------------------ | --- | ------ |
| `check_stat`: the link-count clause removed              | mirror-nlink (exit 0, expected 125)  | 1   | 0, 7/7 |
| `resolve_operand`: both `limits` refusals read `operand` | mirror-limits (`/limits/` unmatched) | 1   | 0, 7/7 |

## 6. Open rows and what each waits for

### 6.1 The engine runtime (lanes E and K)

No host builds engine descriptors, feeds latency samples, runs the
warm-up/reprobe/preload machinery, supplies `ports.local`, or asks a
model for a check. This waits for fitted profiles (§6.4): without
one every model-backed decision stays off by design (acceptance
11), so wiring dispatch now would be dead code. After the profiles:
a lane that binds live sides to the resolver, feeds the windows,
and runs the preload on 2j's actual path.

### 6.2 Downloads and the install path (lane H)

Any model or runtime download, the Ollama preload capture and
parser, and a real install and smoke: the owner's go, with expected
sizes and counts first. Ollama is not installed on this MacBook and
nothing here was downloaded.

### 6.3 The hold integration (lane J)

Wiring the hold into verified dispatch needs a lifecycle owner on
the 2j session boundary (`JudgeRuntime` has no dispose; a holder
started per dispatch is pointless and a holder never stopped is a
leak), which is M98's owner's call, plus a Linux rig for the
end-to-end proof. The Windows helper needs a Windows rig (C# the
lane cannot execute is not written). Then the hold-integration
drills and the `m125-j.md` per-platform timings. Until then every
verified dispatch keeps its full two-pass proof: safe, slower.

### 6.4 Profiles and live measurement (lanes L and V)

Fitted profiles need 200 independent labels per family from lane
V's independent sets, which need live runs: the owner's go with
counts, the D77 labelling pass, and the live harness binding a real
`JudgeUse`. See the lead's first live check (§6.9).

### 6.5 The other editors (lane W)

The MHP wizard mapping waits for D84's review, which owns that
surface, and for the `lanes/rlf-hostsland` merge (nine hosts, read
at `f04ef71070` but not merged: this brief lists no merge). Update
in Settings waits for the update execution path, whose download is
§6.2, and a look the MacBook cannot do.

### 6.6 macOS B1 certification (lane F1a)

Enabling macOS is the lead's: the Mac mini Seatbelt capture and
drill receipt, fresh independent reviews (the F1a record's own
requirement), then a commit that certifies the platform, packages
the helper per platform and architecture, and supplies the session
helper path. Windows stays the owner-recorded exception.

### 6.7 The B2 contained run (lane F2)

The frozen-snapshot runner, bubblewrap orchestration, helper init
and reaper modes, agreement and shadow-run machinery, and the
`strace -f` captures on x86_64 and arm64: a Linux-rig lane with
bubblewrap 0.11.0 or later. Nothing here runs a check in
confinement.

### 6.8 V-report persistence (lane U)

`measuredMsPerTurn` has no producer: persisting V reports where the
host can read them, with backend/model matching and freshness, has
no design in the plan. Proposed as a lead question (§6.10); the
savings row reads unknown until it lands. A reader without a
producer would be dead code, so none was written.

### 6.9 The two live checks (stay with the lead)

1. Per-decision M75 wins and live receipts on each backend
   (acceptance 12): with the owner's go and the expected call
   counts stated first, run the M75 paired runner with the live
   harness binding a real `JudgeUse` whose `onFence` records with
   its labels, on the Model API and Muse Code backends, on the
   cheapest contributor model by its explicit name; then apply the
   ship rule per decision before any decision is on by default.
2. The packed-product real-life run: with the owner's go and the
   expected sizes and call counts stated first, download and
   install the private runtime and model for real, run the
   ten-question smoke, then `node scripts/real-life/run.mjs` in an
   empty workspace; count afterwards and report.

### 6.10 Open questions for the lead

1. Where V reports persist (host-readable store, backend/model
   matching, freshness): recommend the run's usage-trace area with
   a dated envelope, exact shape to be designed.
2. Whether the wizard's hosted button stays offered in
   confidential workspaces (§2.8): recommend hiding it once a
   browser rig can take the look; the downstream gates already
   hold.
3. The walkthrough art still wants the owner's sign-off against a
   curated capture (carried from RLM125).

## 7. Commits

`0a5ebd7189` → this record, on `rec/rlf-m125`, hooks on, no push:

- `6b37b2870` feat(judge): macOS B1 reports stat from the walk,
  never started (D217)
- `54bb8b23c` docs(judge): M125 lane D privacy and security rows
  for the fast judge
- `32fba3b25` test(judge): share the B1 stat cases between the Linux
  and macOS suites
- (this record, the PLAN status and the CHANGELOG entry land
  together next)

## 8. Gates

Every exit code is the command's own, on the final tree.

| Command                                                                  | Exit  | Result                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check --ignore-unknown` on touched files                     | 0     | clean                                                                                                                                                                                                                                                |
| `eslint --max-warnings 0` on touched JS/TS files                         | 0     | empty output                                                                                                                                                                                                                                         |
| `npm run typecheck` (host, webview, unit, e2e, integration, faults)      | 0 × 6 | no `error TS` line                                                                                                                                                                                                                                   |
| `node scripts/check-l10n.mjs`                                            | 0     | 14 UI + 14 usage tables, 284 manifest strings, 0 problems                                                                                                                                                                                            |
| `npm run check:reference`                                                | 0     | current                                                                                                                                                                                                                                              |
| `npm run check:host-api`                                                 | 0     | 392 APIs, 0 problems                                                                                                                                                                                                                                 |
| `npm run check:plan`                                                     | 0     | 244 milestones, 0 drift                                                                                                                                                                                                                              |
| `npm run check:roadmap`                                                  | 0     | current                                                                                                                                                                                                                                              |
| `npm run check:catches`                                                  | 0     | baseline matches, nothing rose                                                                                                                                                                                                                       |
| `npm run duplication`                                                    | 0     | 0 clones (mid-lane it found the 9 mac/Linux test clones; fixed by the shared-cases module, not by re-running)                                                                                                                                        |
| `npm run cycles`                                                         | 0     | no circular dependency                                                                                                                                                                                                                               |
| `npm run deadcode`                                                       | 0     | knip clean (5 tag hints, as the base)                                                                                                                                                                                                                |
| `npm run build`                                                          | 1     | **the same 4 pre-existing overs as CC-INT5**, byte-identical figures (`teamHost` 140.2/130, `teamRunners` 78.4/75, `teamScheduler` 76.5/75, `uiText` 125.3/125); no new over, no judge bundle touched — this lane changes no shipped TypeScript      |
| `npm run security:audit`                                                 | 1     | 10 advisories, 0 exceptions; no dependency changed in this lane (empty diff on `package.json`/`package-lock.json`), so none is from it (CC-INT5: 7; the count grew upstream)                                                                         |
| `npm run security:sast`                                                  | —     | **NOT RUN**: semgrep 1.180.0 cannot install on this MacBook (`pip install` fails generating metadata: `rustup could not choose a version of cargo to run, because one wasn't specified explicitly, and no default is configured`); hosted CI runs it |
| `npx vitest run test/unit/inspectNative.test.ts`                         | 0     | 17 skipped (no compiler through `/usr/bin/cc` on this rig); the module loads and every case registers                                                                                                                                                |
| shared stat cases against CLT-built binaries (temp proof, repo timeouts) | 0     | 8/8 pass (the 7 committed cases plus a trivial), plus the 7/7 assertion mirror                                                                                                                                                                       |

`npx vitest related` has no TS source to map here: the lane changes C,
one test file, one test helper and docs. The owning suite is
`inspectNative.test.ts` (above); no other suite imports the touched
files. The vault, OS credential-store, browser and Electron suites
were never run on this MacBook, per the brief.
