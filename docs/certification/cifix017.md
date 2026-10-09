# CIFIX017 — 0.17.0 hosted CI repairs

## Round 2, Linux and macOS

Authority: `CIFIX017L2.rig.md`, its original rig brief and shared
`codex/common.md`; resumed on Kubuntu from `a0b3f55c9` on 2026-10-09.
The predecessor's uncommitted shared-package helper copy was reviewed against
`build.mjs`, `build-linux-helper.mjs` and `package-acp.mjs` before retention.
No thresholds, deadlines, gates, baselines or hooks are relaxed. Aggregate
quality belongs to the lead under the bounded rig brief (PLAN §7); this lane
runs scoped checks. No paid/live call, merge, rebase, push or subagent.

Downloaded all five requested failed-job logs with the read-only `gh run view
--repo RandyNorthrup/muse-spark-code --job <id> --log-failed`: unit jobs
113988955097, 113988954932, 113988955057, 113988955244, and installed-agent
macOS job 113990120445. Local logs are in ignored `temp/cifix017l2/`.

### 1. Native created-path fixture

Cause: the global production build generates `native/linux/<arch>/muse-created`,
but the suite copy kept only `dist` from that build. A clean source tree has
no native binary. The exec fixture then wrote only inert foreign-platform
helpers and skipped its missing current Linux architecture. ACP's separate
fixture already compiled the actual created-path protocol.

Fix: preserve generated Linux helpers when copying the shared build; extract
ACP's existing native builder into `test/e2e/createdHelperFixture.ts`, used by
both fixtures. Exec builds a missing current-platform helper from the same
reviewed C source. On macOS this replaces unrelated universal Swift dictation
and screen-recording compilation with the existing C created-path dispatch
used by ACP's fixture. Foreign-platform inert bytes remain test-only.

Linux receipt: complete `execStdio.e2e.test.ts` and `acpStdio.e2e.test.ts`,
`--maxWorkers=3`, repository defaults: **57/57 passed**, 143.02 seconds.
Red receipt: remove the inherited shared-helper copy, run the complete exec
suite: **32 passed, 12 skipped because suite setup failed**, exit 1,
`Required Linux created-path helper is missing: native/linux/x64/muse-created`.
No skipped-test change was made: these are Vitest's setup-failure descendants.
Restore the handoff file byte-exact: SHA-256 before/after
`c43b5066033621ac0e3983ab224e176f73adc0b8bcb683f68d563db7cab0b520`.
Logs: `native-red.log`, `native-green.log`.

### macOS access

The explicitly requested `ssh -o BatchMode=yes -o ConnectTimeout=10 macmini`
route refused with **Host key verification failed**. No SSH trust setting or
known-host file was changed. An approved route or lead-run macOS receipts were
requested while Linux work continued. Local Linux receipts do not certify
macOS; remaining platform receipts will be recorded here explicitly.
