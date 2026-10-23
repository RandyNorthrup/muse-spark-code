# RLF-HOSTS2 certification — M66 Vim and Xcode 26.3 (PLAN.md D60)

Recorded 2026-10-22, lane `rec/rlf-hosts2` on the macmini rig
(Macmini8,1, Intel, macOS 15.7.4), base int/recovery at 0.19.0
(`397aca3dd`). RLHOSTS's source (`src/RLF-HOSTS2/01-rec-rlhosts`,
`83371f6f1`) merged first; its M62b/M63c/M65/M66/M94b record is
`docs/certification/rlhosts.md`. The merge's only conflict was the
generated `ROADMAP.md` fingerprint, resolved by regenerating
(`npm run roadmap:generate`; `check:roadmap` green).

No model was called anywhere on this lane: every run below is install,
handshake, activation and locally answered commands. The expected live
spend was 3 prompts (at most 4 model requests) on
`muse-spark-1.3-contributor`; the spend is zero because both live runs
are blocked, each recorded below with its exact cause and rerun.

## M66 — Classic Vim: the plugin is built, shipped and host-checked

System Vim 9.1 (patches 1-1752, `/usr/bin/vim`, `+job/+channel`) needed
no Homebrew install. `editors/vim/` is a pure-Vimscript ACP client over
the packed agent's NDJSON stdio (protocol version 1, per
`@agentclientprotocol/sdk` 1.8.0): `:MuseSpark` opens the chat and runs
initialize plus `session/new`; `:MuseSparkSend` sends the lines below
the last `You:` marker; replies stream in; tool calls, diffs, plans and
notices render as notes; permissions answer with `:MuseSparkAllow {n}`
(an unknown pick refuses) or `:MuseSparkDeny`; `:MuseSparkModel` and
`:MuseSparkMode` switch the running session; anything the wire adds
later shows raw. `g:muse_spark_mcp_servers` passes MCP servers through
(the Xcode recipe below). The package stages all four files
(`scripts/package-acp.mjs` refuses a half plugin), `docs/acp.md` guides
it, and `hosts.yml` runs `test/hosts/vim.sh` on POSIX CI.

`test/hosts/vim.sh` (exit 0 here, twice, plus the refusal branch):
real Vim drives the installed package — the wire helpers over a
captured initialize response, the initialize handshake pinned to the
installed version, a real session running `/whatsnew` to `[stop:
end_turn]` with a non-empty reply, `:MuseSparkNew` starting a second
session, `:MuseSparkClose` closing. Without the Muse Code CLI the same
check proves the agent's refusal surfaces (`[error] session/new: ...
not installed in any known location`) and the agent survives (exit 0).

Two findings from the red drills, both fixed in the lane:

- The first red drill (an unknown method name) exposed `v:t_null`, which
  does not exist in Vim (`v:null` has type `v:t_none`): every error path
  threw E121. Removed; the re-run trips exactly line 89 of the driver
  with `[error] initialize: "Method not found"` shown (exit 1), and the
  restored tree is green again.
- `--model` is exec-only: `serve` refuses it (`Unknown argument`), so an
  early live attempt died at startup (exit 2). The model is picked with
  `:MuseSparkModel` after the session starts; every guide now says so.

## M66 — Classic Vim: the live conversation is sandbox-blocked

The committed drill `test/e2e/vim.live.e2e.test.ts` (`MUSE_LIVE_VIM=1`,
never CI) holds the 3-turn contributor conversation through real Vim
and the packed plugin — READY, the `notes.txt` quote through an
allow-once read permission, DONE — then counts model attempts from the
CLI's own trace log (`test/e2e/liveCli.ts`, budget 200 for three turns
at the measured 25–45 attempts each) and asserts every completed
request's model from the session log (verified against real 0- and
1-response logs). It skips cleanly without the flag (4 skipped).

It cannot run in this lane's sandbox: starting a signed-in session
(`HOME=/Users/randy`) fails inside `muse serve` with `failed to read
skill file at /Users/randy/.claude/skills: Operation not permitted`,
with and without `--trust-workspace` (zero model calls either way; the
read is unconditional at session start). The lane shell itself gets
`Operation not permitted` on that path. No product flag avoids it, and
copying the sign-in elsewhere is forbidden, so the lead reruns it
outside the sandbox:

```sh
MUSE_LIVE_VIM=1 MUSE_LIVE_VIM_TARBALL=dist/muse-spark-code-acp-<version>-<target>.tgz \
  npx vitest run test/e2e/vim.live.e2e.test.ts
```

with the owner's sign-in and Vim on `PATH` (or `VIM_BIN`). Expected: 3
prompts, at most 4 model requests, counted afterwards from the CLI's
trace log and session records as the drill does (a request here is one
model turn; the CLI's bundled reminder agents add their own attempts
inside the 200 budget).

## M66 — Xcode 26.3: installed, route broken, our side built

Xcode 26.3 (build 17C529, `xcode-select`ed) is installed on macOS
15.7.4, but its external-agent route cannot run on this machine:
`xcrun mcpbridge` dies at launch (`fatalDyldError`, SIGABRT) because
the system's AppSandbox lacks `ASBBinaryIdentity.teamIdentifier`
(`nm`: 0 matches); the crash reports
(`/Library/Logs/DiagnosticReports/mcpbridge-2026-10-22-1720*.ips`, from
this lane's probes) record it. This Intel mini cannot take the macOS
that carries the symbol, and the brief notes no other Mac can do it, so
no real Xcode session is possible; the GUI launch was not attempted
(headless lane, shared console) as it decides nothing about the route.

Our side per the plan ("using Xcode MCP tools through `xcrun
mcpbridge`") is built: `docs/acp.md` gains the Xcode 26.3 section with
the exact stdio config (command `/usr/bin/xcrun`, args `["mcpbridge"]`;
usage and `MCP_XCODE_PID` verified in the bridge's own strings, the
"Allow external agents to use Xcode tools" toggle in
`IDEIntelligenceChat`'s), `test/unit/acpTranslate.test.ts` pins the
recipe's forwarding (45 passed), and `test/hosts/xcode.sh` (rig script,
not CI) probes bridge health plus a zero-call session offering a real
stdio MCP server. Here: probe `BROKEN ... SIGABRT ...
AppSandbox.framework` (exit 0, verdict only), attach `ok, session
01a1665f-… offered muse-spark-self` (exit 0), and with
`XCODE_MCP_SERVER=xcode` the session still starts offering the dead
bridge (exit 0: the offer path holds; the server's death is the
probe's verdict). No `exec` MCP flag was added: the ACP client-offered
route is the designed one, and an attach flag provable only at startup
would be unproven in use.

## Drills (break on purpose, show red, restore, green)

- `test/hosts/vim.sh`: unknown method → exit 1 on the handshake assert
  with the agent's error surfaced; restored → exit 0
  (`PASS session /whatsnew /new /close`). The drill also caught and
  fixed the `v:t_null` E121 above.
- `acpTranslate.test.ts`: dropped `args` in `mcpServersFrom` → the two
  forwarding tests fail (45 tests, 2 failed); restored → 45 passed.
- `test/hosts/xcode.sh`: missing package → exit 1 (`FAIL ... missing
from the installed package`); hidden CLI → exit 2 (`BLOCKED ... not
installed`); restored environment → exit 0.

## Gates (final tree, exit codes)

- prettier --check on touched files: 0
- eslint --max-warnings 0 on touched files: 0
- `npm run typecheck`: 0
- `node scripts/check-l10n.mjs`: 0
- `npm run check:reference`: 0
- `npm run check:host-api`: 0
- `npm run check:plan`: 1 (PLAN.md past 85%; pre-existing on the base,
  deferred in §7; see below)
- `npm run check:roadmap`: 0
- `npm run check:catches`: 0
- `npm run duplication`: 0
- `npm run cycles`: 0
- `npm run deadcode`: 0
- `npm run build`: 1 (three bundle budgets over by identical bytes on the
  untouched base; pre-existing, deferred in §7; see below)
- `npx vitest related` on changed sources: 1 (20 files / 56 tests fail;
  the untouched base fails 25 / 68 with the same signatures — timeouts,
  lock-busy, encoder reads; the two lane-only files pass file-alone on
  both trees; see below)
- `test/unit/acpTranslate.test.ts`: 0 (45 passed)
- `test/e2e/vim.live.e2e.test.ts` without the flag: 0 (4 skipped)
- `test/hosts/vim.sh`: 0 (session branch and refusal branch)
- `test/hosts/xcode.sh`: 0 (self and xcode modes)
- `npm run security:audit`: 0
- SAST (`SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`): 0
  (533 rules, 4154 files, 0 findings; run with
  `SSL_CERT_FILE=/etc/ssl/cert.pem`, without which this rig's semgrep
  binary dies on empty trust anchors before scanning)

`check:plan` is red on the untouched base too (3,668,951 bytes, exit 1;
this tree 3,671,628): the overage predates the lane, which adds ~2.6
KB. Archiving mid-recovery would rewrite the file every recovery lane
edits, so the lead archives at integration; recorded as a justified
deferral in PLAN.md §7, no threshold changed.

`npm run build` is red on the untouched base too (exit 1, byte-identical
overages: `dist/modelApi.js` 527.7/525 KiB, `dist/resourceAdmission.js`
and `dist/vaultActions.js` 25.0/25 KiB). This lane changes no file those
bundles contain; shrinking them belongs to their owning lanes. Recorded
as a justified deferral in PLAN.md §7; no budget raised, no code of
theirs touched.

`npx vitest related` (817 files, 23,212 tests) fails 20 files / 56 tests
on this tree and 25 / 68 on the untouched base: the same vault, schedule
and sampler suites in both, all timeouts, lock-busy refusals,
unavailable encoder readings and one bundle-cap test matching the build
red above. Six files re-ran alone on both trees with identical results;
the two lane-only files (`bestOfN`, `questionExpiryNotice`) pass alone
on both trees. None of the failing suites touches this lane's changed
code (one Tab file, one added constant, test helpers); the suites this
lane touched pass (49 passed, 4 live-drill skipped).
