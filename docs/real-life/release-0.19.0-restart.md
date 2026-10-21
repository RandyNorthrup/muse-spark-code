# Real use: Restart Muse Code, then continue from History (lane RESTART0190, rig `linuxlt`)

Version: **0.19.0**. Base tree: `7501d8413f` (the final 0.19.0 tree).
Fix commit: `4d0869e88a`. Platform: Linux x64, Xvfb `:97`, real VS Code
1.139.0 with an isolated `--user-data-dir`/`--extensions-dir` under
`temp/rig/`. Backend throughout: **Muse Code** (the person's signed-in CLI;
HOME/XDG never changed for it). Model named in the panel before every
send: **`muse-spark-1.3-contributor`** (pill read back after each
selection; sends refused unless the pill showed it). No key read or stored.

## Build and package

`npm ci`, `npm run build` (exit 0, budgets green), then
`node scripts/package-vsix.mjs --target linux-x64`. Packaging needed the
pinned `zopfli==0.4.3` (`.github/vsix-compress/requirements.txt`), which
was installed into a project-local `.venv` via `uv` with a lane-local
`UV_CACHE_DIR` (the shared uv cache is read-only on this rig); the `.venv`
was removed right after. Result:
`muse-spark-code-linux-x64-0.19.0.vsix`, **3588828 bytes (budget 3788800)**, installed with `--force` into the rig profile, VS Code
relaunched so the fixed build loads (CDP `:9333`).

## Defect 2 (fixed): History resume rejected, send failed silently

Base-tree repro (prior run on this tree): turn 1 on contributor answered
`RESTARTONE`; `New Conversation`, then History-open of the old id; the
panel showed `Could not resume the conversation: command … rejected:
session MCP configuration conflicts with the loaded session runtime`
(log: `A session could not be continued`), and the new turn was silently
not sent. Probes against the live CLI showed the contract: resuming with
a _different_ presented `ide` MCP config than the serve runtime was loaded
with is rejected; a fresh process accepts any config (it loads the runtime
from what resume presents).

Cause: every `IdeMcpServer.bindCaller` minted a fresh secret, so the
resume always presented a config the restarted `muse serve` had never
loaded — including on the schedule `bindSession` path. Fix (`4d0869e88a`):
the server records the secret minted for each session id
(`bindCaller(resolve, sessionId)`, `noteSessionSecret` for the start path
whose session id arrives after the bind) and re-presents it on later
binds, re-registering the entry when it is gone; multi-entry secrets and
mid-request rebind stay authenticated (`sameCredential`). The backend's
conflict check is untouched.

Post-fix proof on the packed product (CDP-driven, real turns):

- Turn C (`RESTARTFIXC`) on contributor: answered.
- `Muse Spark: Restart Muse Code`: chat (1844 chars) and Models & Agents
  (462 chars) panels present and non-blank.
- `Developer: Reload Window`, `New Conversation`, History-open of S
  (titled by turn A): restored text contains turns A and C,
  **no `Could not resume`**.
- Turn E (`RESTARTFIXE`) in restored S on contributor: answered.
- Turn D (`RESTARTFIXD`) in a second conversation on contributor:
  answered.

Two runs of the model picker missed on the first real Enter (pill stayed
on the base model); a focus-then-Enter with pill read-back and up to 3
retries fixed it, and the scripts refuse to send unless the pill shows
contributor — which is how turns A/B below went out on the base model
before the guard existed.

## Defect 1 (not reproduced): blank panels until reload

Five restart variants on the fixed build all kept both panels' content:
chat-only, Models & Agents open, after window reload, after a completed
countdown turn (`RESTARTFIXF`, contributor), and mid-stream into a story
turn (`RESTARTFIXG`, contributor, `streaming=true`, 3292 chars at
restart). The base tree never showed it either. No product change was made
for it: there is no repro to fix.

## Model calls (journal proof, `run.model.configured` / reconfigure)

Session `01a15bda-0409` (conversation S): A@28 base, B@122 base,
C@191/194 contributor, E@282/283/288 contributor. Session `01a15be6-cecc`
(conversation S3): D@28 contributor. Prior run: `RESTARTONE` contributor,
`RESTARTDEAD` base. Total this lane: **6 contributor turns** (ONE, C, D,
E, F, G-partial) and **3 base turns** (DEAD, A, B — the misses above,
reported as off-tier). Contributor calls stay under the 12-call budget.
`muse-wonder-1.0` lines in the logs are catalog metadata, with no
configured request behind them.

## Gates (final tree, fix included)

`prettier` clean; `eslint` 0 errors on touched files (6 of mine fixed:
void-expression arrow, ternary/logical-operator, member order, boolean
name, early return, conditional spread); `typecheck` exit 0;
`test/unit/ideSessionEndpoints.test.ts` 5/5 green with repo timeouts
(3 fail while the lookup is broken); suites importing
`conversationController` green (`uploadDeleteFailed`, `sessionDelete`,
`nativeGitAdapter` 20/20, `paidMoneyStructure` 46/46); `cycles` clean;
`knip` exit 0; `check:l10n` 0 problems; `npm run build` exit 0 with
budgets. Pre-existing on the untouched base (proved on a pristine
worktree at `7501d8413f`): `check:catches` fails on
`reportJournal.ts` GENERIC drift and `duplication` reports its one clone
in the same file. My diff adds no `try/catch` and no clone.
