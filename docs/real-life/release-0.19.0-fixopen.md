# Real use: 0.19.0 open defects (FIXOPEN, macOS)

Version 0.19.0, branch `fix/0190-open-defects`. Platform: MacBook Pro
(darwin/arm64), owner's laptop, worktree `/Users/user/lanes/FIXOPEN`.
Product: the repository's own production build run directly in the worktree
as `node dist/acp.js`. `/usr/bin/git` on this machine is the Xcode stub
without a working developer directory (exits 71 naming xcodebuild); a working
git exists at `/Library/Developer/CommandLineTools/usr/bin/git` but is not
on PATH. The credential store is unreachable from this agent sandbox.

Build: `npm run build` stops at the What's New bound (CHANGELOG 0.19.0
decodes to 147,798 bytes over the 76,800 bound; the join trims the notes),
so every build below ran with a LOCAL-ONLY trim that was never committed:
0.19.0 kept to Highlights only, backup under `$TMPDIR`, full file restored
immediately after each build and verified by `git status` before every
commit. The packed bytes below carry the trimmed What's New notes,
everything else untrimmed.

Model calls: 3 invocations named `--model muse-spark-1.3-contributor`, all
refused before dispatch (`requests 0; settled $0.000000` on every run, exit
3). Nothing was billed. Against 20 / $1.00: 3 dispatches attempted, 0 turns
run, $0.00. No live model turn was possible in this sandbox: the Muse Code
backend never leaves readiness (`Backend Unavailable`, envelope
`"message":"Internal error"`, requests 0), and governed child processes are
refused (`Resource admission unavailable`, see fix 4).

## 1. Exec-turn usage: what Muse Code reports, and what now gets recorded

Investigation (code plus the recorded wire, no live turn available):

- Session records (`src/core/backends/musecode/sessionRecords.ts`) carry
  goals, todo items and snapshots. They carry no usage.
- The SDK's per-turn usage event is `session/tokenUsage`. The recorded
  exchange (2026-10-08, CLI 1.4.2,
  `docs/research/m105-captures/u16-2026-10-08.jsonl`) shows each notify
  carrying per-completion `usage` (input/output/cached/cacheWrite/
  cacheRead/reasoning) beside session `cumulative` (prompt/output/total,
  plus `cacheReadTokens` once caching starts). The cumulative never carries
  reasoning.
- The mapper (`mapNotification.ts`) kept only cumulative prompt/output and
  dropped everything else, so `MuseUsageDeltas` journaled input/output only
  and Cached Input read Unknown even where the wire reported cache reads.
  The per-completion counters stay dropped by design (D26: they do not sum
  across providers); the cumulative cache reads sum on the same basis as
  the prompt total, so they are now carried. The event already had the
  optional `cachedTokens`/`reasoningTokens` fields and the exec envelope
  already consumed them (`runExec.ts` `latestTokens`); only the producer
  dropped them.
- The journal, the aggregate and the usage text already support cached
  splits end to end; only Muse Code data never filled them.

What changed: `session/tokenUsage` mapping carries
`cumulative.cacheReadTokens` as `cachedTokens` where the wire reports it;
`MuseUsageDeltas` journals the cached delta with the same baseline guards
as input/output, plus one coherence guard: a cached delta journals only
inside its input delta, so a bad count can never lose the note's input and
output to the journal's refusal. A report without cache counters only moves
the baseline, never invents a split. Reasoning stays Unknown everywhere on
Muse Code: the cumulative never carries it, and that is exactly what the
words say (no sentence claims otherwise; the Unknown rows are the honest
rendering the B7 record already passed).

Proof: `test/unit/mapNotification.test.ts` (recorded 2026-10-08 shape maps
to `cachedTokens: 24945`; per-completion usage still dropped, break-proof
seen red) and the new `test/unit/museUsageDeltas.test.ts`: the recorded two
frames through the real mapper, the real deltas, the real recording and a
real on-disk journal — two notes with input/output and no invented cached
split. The third-event carry (a cached delta journaling) is covered by the
mapper case plus the guard; a live multi-turn session (lead drill below)
shows Cached Input as a number.

Lead drill (needs a host with working spawns): run two contributor turns,
then `usage summary`. Before: Cached Input Unknown with no records. After:
turn records carry input/output, and Cached Input reads the cache-read
total once the session's cumulative reports it; Reasoning stays Unknown.

## 2. `providers usage` / `auth status` silent exit 1

Cause: the crashed-Connect recovery wrapper (`recoverAccountJournal`)
caught the store read failure and returned `{notices: [], failed: true}`,
so all five wrappers returned 1 printing nothing. (`connect` prints; these
did not.)

Before (packed, this rig):

```console
$ node dist/acp.js providers usage openrouter; echo "EXIT=$?"
EXIT=1
$ node dist/acp.js auth status; echo "EXIT=$?"
EXIT=1
```

Zero bytes on stdout and stderr both times. The AUDITCLI branch is not in
this clone, so instead of matching an unseen diff the fix reuses the exact
sentence `auth status` already prints for this case (the B9 wording).

After (packed, this rig): both print the cause on stderr and exit with the
documented failure code:

```console
$ node dist/acp.js providers usage openrouter; echo "EXIT=$?"
This computer's credential store cannot be used (credential recovery failed). On Linux the agent needs a running, unlocked Secret Service, such as GNOME Keyring or KWallet.
EXIT=1
```

`auth status` answers identically. The recovery carries the store error;
the refused-cleanup path keeps its composed notice; the committed path
keeps its stored-key note. (The parenthetical is the recovery's own report:
the lease absorbs the OS-level error one layer down, so the sentence names
the failing layer truthfully.) Proof: `test/unit/providerJournalRecovery.test.ts`
(break-proof seen red). Committed as `bb7d3fb52`.

## 3. Attach refusal reason in human output

Cause: the human path of the exec sink printed only `finalMessage`
(`message withheld: the response did not complete`) while the envelope's
`error.message` carried the reason.

Before (packed): stdout was `message withheld: the response did not
complete`. After (packed, exit code unchanged at 3):

```console
$ node dist/acp.js exec --backend museCode --attach note.txt "..."
This session has no file upload service, so video and audio cannot be sent. Use the Model API backend with a Meta key.
```

JSON and jsonl output are byte-identical to before; empty reasons still
fall back to the final message. Proof:
`test/unit/execHumanReason.test.ts`, built on the recorded attach-refusal
envelope captured for it (packed `--output json`, refused before dispatch,
$0). Committed as `032bf17a2`.

## 4. Report generation where git is the Xcode stub

Three parts, one defect:

- The PR #243 combine dropped `dist/reportInputs.js` and
  `dist/playbookSchedulesInputs.js` from the production bundle list, so
  every source-reading `report` kind failed at the inputs-bundle load on
  this branch. The two lines are restored byte-identically to the sibling
  Revmerge2 fix (`ec322932f`), which the join carries for its side; the
  size budgets and `.vscodeignore` already expect both files. (The old
  `pathGuard.test.ts` planted-git case from the review no longer exists on
  this branch — it went out with the fake-test purge — so there is nothing
  to keep green there.)
- `reportGitIo` resolved only the first absolute PATH git (the stub) and
  ran it. It now resolves every absolute PATH git in order — the PATH guard
  is unchanged, still absolute entries only, never the working directory —
  probes each with `--version`, and runs the first that answers. Where the
  only answer is the stub, it throws a branded `XcodeStubGitError`
  (boolean brand, bundle-safe like `LocalSourceError`); the core git source
  maps that to `LocalSourceError('failed', reportText.reportUi.gitXcodeStub)`,
  so the record names the cause and the fix instead of a raw exit code:

  > Git cannot run on this Mac: it resolves to Apple's Xcode stub, whose
  > developer tools cannot start. Install the Command Line Tools
  > (xcode-select --install), or switch to the installed tools (sudo
  > xcode-select --switch
  > /Library/Developer/CommandLineTools), then try again.

  Both clauses are load-bearing on this machine: the Tools are installed
  here, but the active developer directory points at a missing Xcode
  (`DEVELOPER_DIR=/Library/Developer/CommandLineTools /usr/bin/git
--version` answers `git version 2.50.1`). The sentence is localized in
  all 14 tables (`check:l10n` 0 problems). Stub detection requires the
  stub's signature together — darwin, exit 71, an xcodebuild/xcode-select
  complaint on stderr — so a genuine git failure is never misdiagnosed.

- Live status on this rig: NOT provable in-sandbox. Governed spawns are
  refused here (`Resource admission unavailable` from a bare in-process
  probe; the resource governor fails to start, hence the standing
  `[warn] This reading is unavailable on this machine.` lines), so the
  probe can never observe exit 71 and `report changes` fails generically
  with or without a working git on PATH. This is the rig-note sandbox
  case: the spawn-dependent half stops here. Unit proofs are complete
  (`test/unit/reportGitStub.test.ts`: recorded stub exchange recognized,
  non-stub shapes refused, brand matched across bundle copies, stub error
  mapped to the sentence in the source record; `resolveAllExecutables`
  order in `test/unit/executables.test.ts`; every break-proof seen red).

Lead drill (needs a host with working spawns, e.g. directly on this Mac
outside a sandbox): in any git checkout, `node dist/acp.js report changes`.
Stub-only PATH shows the git source unavailable with the sentence above;
with `/Library/Developer/CommandLineTools/usr/bin` on PATH the report
uses the working git and succeeds.

## 5. Packaging cleans its `dist/*-package` stage

`npm run package` left `dist/vsix-package` and `dist/acp-package` behind
(the scripts removed them only at the start of the next run), and later
gates scanning `dist/` tripped over the staged copies. Both packagers now
remove their stage in a `finally`, on success and on failure; the ACP
packager writes `dist/acp-stage-files.json` naming every staged file, which
the release SBOM reads for its membership check instead of probing the
stage directory (the SBOM runs after packaging in CI). The gates ignore
nothing new. Proof: `test/unit/packageStage.test.mjs` over real temp dirs
(listing, receipt round trip, removal, missing/malformed receipt refusals;
both break-proofs seen red), plus two live failure drills against the
production `dist/` (local-only What's New trim, nothing committed):
`package-vsix.mjs` threw mid-stage (`Required Linux created-path helper
excluded from VSIX: x64` — the helpers build only on Linux) and
`dist/vsix-package` is gone afterwards; `package-acp.mjs` threw before
staging (`Required Darwin created-path helper is missing`, built only in
CI) with nothing left behind. The success path (receipt written, stage
removed after pack) needs CI's helpers; the receipt and removal it uses
are the unit-proven functions. Committed as `cfb204d54`.
