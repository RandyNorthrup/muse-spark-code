# RLF-SECDEFAULTS — Sensitive reads ask; a memory after untrusted reads asks in Auto (D261, 2026-11-02, macmini)

Recovery lane, brief D of the 2026-11-02 agent-security research
(SEC-DEFAULT-DENY). Branch `rec/rlf-secdefaults` from main 0.19.0 at
`72d8d5003`. No source branches to land. The lane started in Muse Spark
Code (commits `092048e9a`, `138a319cc`) and was finished in Claude Code
when Muse's weekly allowance was kept for merging (`374ff29bd` and this
record). The first part's only model calls were its own session's;
its log names no packed-product run and no contributor model. This part
made no Muse request and no provider call. The real use did not run
(§5).

## 1. What changed

On the Model API backend:

- **Sensitive reads ask.** `read_file` of a file in the built-in set
  asks before its contents go to the model. The set is `.env` and
  `.env.*` (never `.env.example`), `*.pem`, `*.key`, the SSH private-key
  names (`id_rsa`, `id_ed25519`, `id_dsa`, `id_ecdsa` and the `_sk`
  pair), `.npmrc` and `.aws/credentials`, in any folder, judged on the
  canonical path with case ignored (`isSensitiveReadPath` in
  `src/core/protectedPaths.ts`, constants `SENSITIVE_READ_*` beside
  `PROTECTED_FILE_NAMES` in `src/shared/constants.ts`). The engine
  (`src/core/backends/modelapi/permissions.ts`) asks in Manual, Auto and
  Plan and allows in Bypass. No hook, reviewer or command rule settles
  it (`settledBy: 'sensitiveRead'`), and the session grant is keyed on
  the file, never the tool. In Auto an "allow once" records the same
  file grant (`allowedOnce`, added in this part), so Auto asks once per
  file per session. `search` leaves the set out in every mode but Bypass
  and says how many it left out (`searchPaging.ts`).
- **A memory after untrusted reads asks in Auto.** A memory write in a
  turn that read the web (`web_fetch`, the browser check, hosted search)
  or an MCP result asks in Auto, and the card shows the exact text
  (`settledBy: 'untrustedMemory'`, no session choice). The host's own
  compaction flush is exempt by its call id.
- **Both are the person's.** `museSpark.modelApiSensitiveReads`
  (machine scope): unset is the built-in set, a glob list replaces it,
  an empty list turns the ask off, and a value that cannot be read keeps
  the built-in set and says so (`permissionPolicy.ts`).
  `museSpark.modelApiMemoryAfterUntrustedAsk` (machine scope, on) is the
  memory switch. Neither is a cap (D121): the person can empty both.

The brief's open decision, whether (1) is on by default, was taken as
the brief states it (on). The setting is the person's either way.

## 2. Tests (real code only)

- `test/unit/permissions.test.ts`: the set over real relative paths at
  any depth and case; what it leaves out (`.env.example`, `*.pub`,
  `.npmrc.bak`, `.aws/config`, …); Windows spellings through
  `resolveWorkspacePath` on `win32`; a link judged by where it leads
  through `confineWorkspacePath`; the engine's verdict per mode; the
  per-file session grant; Auto's once per file per session (new in this
  part); the untrusted-memory ask in Auto only.
- `test/unit/permissionPolicy.test.ts`: unset, emptied, replaced and
  unreadable settings; the memory switch; a repository rule cannot reach
  either setting.
- `test/unit/toolPaging.test.ts`: `search` over real files in a temp
  workspace leaves sensitive files out and counts them, keeps
  `.env.example`, searches everything with the setting emptied, and only
  the person's list when it is set.

The touched suites, run with the repository's own timeouts:
`permissions`, `permissionPolicy` and `toolPaging`, 3 files, 130 tests,
exit 0.

## 3. Red/green drills (2026-11-02, Claude Code part)

Each drill broke the code on purpose, ran the suite named, recorded the
non-zero exit, restored the file with `git checkout --`, and ran the
suite green again.

| Drill      | Break                                                            | Suite            | Red                   | Green  |
| ---------- | ---------------------------------------------------------------- | ---------------- | --------------------- | ------ |
| D1 set     | drop `'.env'` from `SENSITIVE_READ_FILE_NAMES`                   | permissions      | exit 1, 1 failed / 91 | exit 0 |
| D2 Plan    | Plan allows a sensitive read silently                            | permissions      | exit 1, 3 failed / 91 | exit 0 |
| D3 once    | `allowedOnce` grants in every mode, not only Auto                | permissions      | exit 1, 1 failed / 91 | exit 0 |
| D4 memory  | the untrusted-memory ask allows in Auto                          | permissions      | exit 1, 1 failed / 91 | exit 0 |
| D5 search  | `search` keeps sensitive files out only when asked not to        | toolPaging       | exit 1, 2 failed / 8  | exit 0 |
| D6 emptied | an empty `modelApiSensitiveReads` falls back to the built-in set | permissionPolicy | exit 1, 1 failed / 31 | exit 0 |
| D7 case    | `isSensitiveReadPath` stops ignoring case                        | permissions      | exit 1, 1 failed / 91 | exit 0 |

## 4. Bundle budget

`dist/modelApi.js` was 163 bytes over its 525 KiB budget once
`allowedOnce` was added. The budget was not raised. The lane's own code
was made smaller instead: the engine's two asks use `settled()`,
`sensitiveReadName` takes the arguments JSON (the hook path no longer
builds a call object), the compaction flush is marked by its call id
in place of a flag with try/finally, and `cardNote`'s call parameter is
required. Result: 537,581 bytes against 537,600, `npm run build` exit 0.

## 5. Not run, and why

- **Real use through the packed product.** The lead kept Muse's weekly
  allowance for merging, so this lane made no Muse request. These steps
  are left for the lead:
  1. In Auto, have the agent read `.env` in an empty workspace: one card
     naming `.env` and that its contents go to the model. Allow once,
     then read again: no second card.
  2. In Plan, read `.env`: a card, not a silent read.
  3. In Auto, `web_fetch` a page, then `add_memory`: a card showing the
     exact note.
  4. With `museSpark.modelApiSensitiveReads: []`, read `.env`: no card.

  Expected: about 4 to 8 calls on `muse-spark-1.3-contributor`, counted
  afterwards from the session records.

- **Host wiring without a real-code test.** These paths need a model
  turn, and a stand-in provider is not allowed:
  - the card's note text;
  - the tool-kind card that keeps Edit automatically from answering;
  - the refusals in a scheduled run and in a hook handler's own turn;
  - the turn's web/MCP mark;
  - keeping sensitive reads out of parallel read groups.

  The real use above covers the first and the mark.
