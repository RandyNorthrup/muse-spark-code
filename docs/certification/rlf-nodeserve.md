# RLF-NODESERVE: the Muse Node serve binding (A1/M104)

2026-10-23, rig `linuxlt`, worktree `/home/randy/lanes/RLF-NODESERVE`,
branch `rec/rlf-nodeserve`. Base main at 0.19.0, then merges of
`src/RLF-NODESERVE/01-rec-rlm104` (RLM104 M104 editors) and
`src/RLF-NODESERVE/02-rec-rlm110b` (RLM110B `/peek`). Model attempts: **0**.
No paid or live model call, no credential read or printed (the drill's
single-use setup code lived only in its removed temp root), no push,
rebase, reset or stash. Local commits keep the installed hooks on.

## What landed

`node dist/node.js serve` serves for real. It boots the service, takes the
exclusive service lock, loads the A1 passkey verifier and S0 issuance from
the lazy `dist/nodeAuth.js` bundle (shape-checked at load; a missing or
misshapen bundle fails serve with one fixed sentence), ensures the pinned
TLS leaf (reusing the committed pair or issuing through the installed
`openssl`), and listens on the interface `init` selected, printing the full
colon-separated SHA-256 fingerprint. `stop` signals the recorded supervisor
and waits until the process is gone. Files, terminal, dashboard, audit and
step-up methods are bound to the verified session; writes, git, the maker
action and PTY work say `unavailable` until C's tools peer and M103's
runtime land. H19 step-up per physical action and H20 console recovery are
unchanged from the accepted threat model.

Handoffs bound: `N-A1-VERIFIER`, `N-A1-S0-TLS`, `N-C-LISTENER`,
`N-M104-METHODS`, `N-U2-TERMINAL`. Waiting: `N-M103-ACTION` (RLM103
running; the action stays registered but unrunnable), the operator control
transport (`lock`, `unlock` and live `status` still refuse `unavailable`),
and the lead's second-PC passkey join.

## Live drill: serve on 127.0.0.1:7463

Built `dist/node.js` plus `dist/nodeAuth.js`, fresh root under `temp/`
(removed afterwards). `init` needs absolute paths; relative ones fail with
the fixed `failed` word.

- `init`: exit 0, prints the one-time setup code and its expiry.
- `serve`: prints `Certificate fingerprint:
32:F4:DF:7C:A4:0C:D1:94:7B:34:FC:22:CF:47:36:36:AF:7D:63:8C:
68:68:01:26:5A:7A:1E:AA:D1:99:8F:53`.
- `openssl s_client` shows the presented leaf's SHA-256 fingerprint byte-identical
  to the printed line.
- `POST /node/dashboard/read` with the configured host and same-origin
  metadata, no bearer: `401 {"code":"unauthenticated"}`.
- Same with `Authorization: Bearer [REDACTED] `401 {"code":"unauthenticated"}`.
- Same with a wrong host: `403 {"code":"forbidden"}` (the host guard, not auth).
- `stop`: exit 0; the port goes dark (repeated twice).

`/livez` answers 403: the health handler is C's loopback deployment
binding and this lane wires no health route; the listener refuses the
unknown route. Not a regression.

## Resume live drill (2026-10-30, after the serve split)

Re-ran against the current build (`dist/node.js` + lazy `dist/nodeServe.js`

- `dist/nodeAuth.js`), fresh root under `temp/` (removed afterwards),
  port 7463:

* `init`: exit 0.
* `serve`: prints `Certificate fingerprint:
B0:01:B8:2E:71:BC:58:AC:DF:7B:51:AB:7C:87:2A:7B:9D:94:F6:13:
6D:84:B9:9A:91:3A:0A:67:B4:D2:DD:57`.
* `openssl s_client` leaf fingerprint byte-identical to the printed line.
* Wrong bearer: `401 {"code":"unauthenticated"}`.
* Wrong host: `403 {"code":"forbidden"}`.
* `stop`: exit 0; serve exits 0; the port goes dark.

## Red/green drills (break, non-zero exit, restore, green)

Each drill records the source SHA-256, breaks the guard, runs
`npx vitest run test/unit/nodeServeBinding.test.ts --maxWorkers=3` with the
repository's own timeout, restores the file and re-verifies the hash and
the green run.

- **A — no verifier refuses.** Redone at resume (2026-10-30) against the
  final tree (serve split, then the committed-pair extraction):
  neutralized the shape check (`loadAuthBundle`'s `isNodeAuthBundle`
  clause `&& false`). Red: exit 1, `serve without the auth bundle refuses
after a fixed sentence` fails, 13 pass. Restored `serve.ts` to
  `beed9c2db6ac473024aaca609f097e3b88b94bc8065f91eedf05e0d54b8c8bcb`;
  green: exit 0, 14 pass. (The 2026-10-23 drill ran against the pre-split
  file and its hash no longer verifies; this redo replaces it.)
- **B — a wrong Bearer [REDACTED]** Changed the verifier-failure mapping in
  `listenerGuard.ts` (`nodeAuthenticate` catch) from `unauthenticated` to
  `unavailable`. Red: exit 1, `a missing or wrong Bearer [REDACTED] a
privileged route` and `stop and lock run through the service; the lock
ends sessions` fail
  (the second replays a revoked bearer), 12 pass. Restored
  `listenerGuard.ts` to
  `f19b0abe2c71bc9c9adc8161c704772fa029931b4dc7ab37484aeb717078baa5`;
  green: exit 0, 14 pass.
- **C — a proof bound to another digest refuses.** The binding is triply
  redundant by construction (presented-vs-computed, the verifier's
  bound-vs-presented with burn-on-mismatch, post-consume
  recorded-vs-computed); each pair implies the third, so removing the
  method-layer pre-check alone, trusting the caller-presented digest alone,
  or both together all stay green, as does removing all three method-layer
  checks together. The combined removal that fails is the verifier's
  digest compare in `auth/sessions.ts` (neutralized to `false`) together
  with the post-consume `proof.actionDigest` clause in
  `listenerMethods.ts`: red, exit 1, `an action proof bound to a different
digest refuses` fails (the smuggled proof reaches the maker port's 503),
  13 pass. Restored `sessions.ts` to
  `d5247a655894dfc9b8204f149ee722c85ccd58f570ea9cbb8494ddc74ccd7023` and
  `listenerMethods.ts` to
  `8df7823e454652cd2a1811296135742a4a1962d4fa5ee5c1861dba26ce208500`;
  green: exit 0, 14 pass.

The m110-n refusal suites keep testing the refusals that remain true:
unbound serve, the held service lease, and `lock`/`unlock`/live `status`
until the control transport lands. No test asserts serve-refusal anymore.

## `/peek`: no transport on these branches

`/peek` stays the ACP-side text fallback (`runPeekText` prints the agent's
own tap as JSONL). Wiring it to the node needs all of: a subscribe route on
the companion listener (D22's fetch-based stream with bearer and a
read-only scope the guard refuses elsewhere), the read-only peek page in
the node's web UI that `/peek` would link to, the `acp peek` CLI, and a
stream source — the node runs no agents, and the pair's E2E fan-out to the
orchestrator does not exist here. None of that is on these branches, so
nothing was wired; 02's own drills record the same wait on A0/transport.

## Gates and budgets

Full gate table with exit codes is in the lane's final report. Budget
notes for the lead: no budget was raised. `dist/node.js` measures 72.9 KiB
under its unchanged 75 KiB cap; the binding itself ships as the new lazy
`dist/nodeServe.js` (61.9 KiB under its own 75 KiB cap), and the passkey
verifier as the new lazy `dist/nodeAuth.js` (470.3 KiB under its own
550 KiB cap). The split gate pins that no auth value leaks into
`dist/node.js`. (An earlier draft of this record described a 125 KiB
`node.js` budget from before the serve split; that draft never matched the
committed budget lines and was corrected at resume.)
