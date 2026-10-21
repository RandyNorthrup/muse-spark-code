# Real use of the 0.19.0 platform group — 2026-10-18 (lane RUPLATFORML)

Group: platform (PRs #246 #216 #247 #236 #244 #220 #222 #218).
Product: production bundles from `npm run build` in this worktree (exit 0),
driven as the packed product: the per-target `.vsix` from
`node scripts/package-vsix.mjs --target linux-x64`, the same `dist/` bytes
the ACP tarball ships (`npm run package:acp` does not complete on a Linux
rig: it requires the macOS-built `native/darwin/muse-dictate` helper; CI
packs it there — environmental, pre-existing), and real VS Code with the
packed `.vsix` installed.
Version: **0.19.0**, git sha **ba5d533709b62dfc8ebb2412ac5d0205a62d9597**
(plus the fix commit below).
Rig: linuxlt (`/home/randy/lanes/RUPLATFORML`), Linux x64. Scratch HOME,
XDG data/config dirs and workspace under the worktree's ignored `temp/`;
the owner's real home, keyring and VS Code were only ever read, never
written. Model calls through the product: **0 of 40, $0.00 of $2.00**
(the browser capture reports `modelAttempts: 0`; no turn was ever sent).

## Behaviours exercised for real

1. **Linux .vsix within the unchanged budget (PR #246). PASS.**
   Did: `node scripts/package-vsix.mjs --target linux-x64`.
   Product: `muse-spark-code-linux-x64-0.19.0.vsix`, **3,393,123 bytes**
   against the unchanged 3,788,800-byte budget; manifest asserts
   `TargetPlatform="linux-x64"`; entry list holds only
   `native/linux/x64/muse-created`, `native/linux/x64/muse-vault-peer`
   and the cross-platform `native/runner/*` — zero Windows/darwin pieces.
   Installed into scratch VS Code (`code --install-extension`, "successfully
   installed") and launched under `xvfb-run`: the extension host ran
   `_doActivateExtension RandyNorthrup.muse-spark-code` on
   `onStartupFinished` with zero errors in `exthost.log`. **PASS.**
   (VS Code's GUI needs `--no-sandbox --disable-gpu` in this container: its
   SUID helper is not configured here. Standard container flags, noted.)

2. **Vault on Linux without a usable Secret Service (PRs #216/#247).
   PASS (honest refusal), one FAIL found and fixed (see 3).**
   This lane shell deliberately has no session bus
   (`DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/lane-has-no-session-bus`);
   the keyring binding is installed but the user bus's secrets provider
   crashes (SIGABRT) when contacted, so no Secret Service is reachable.
   Did: `node dist/acp.js vault status` with a short scratch HOME (socket
   path 102 of 107 bytes).
   Product (exit 1): "The operating system's credential store is not
   available. On Linux, sign in to a desktop session with an unlocked
   keyring (the Secret Service); ..." — the fixed repair sentence, never
   native DBus text. **PASS.**
   Did: `vault setup` with stdin `/dev/null` (non-interactive).
   Product (exit 1): "Vault setup and recovery need an interactive
   terminal; headless runs cannot do them." **PASS.**
   Full store → read-back → lock needs a desktop session with an unlocked
   keyring, out of reach in any lane (by lane design, above). The file
   anchor where the binding is absent is covered by
   `test/unit/vault/brokerWithoutKeyring.test.ts` (see 7). No TPM on this
   rig (`/dev/tpm*` absent), so the Linux TPM2 slot correctly stays
   unoffered. No key or token was printed, logged or stored anywhere.

3. **FAIL (fixed): unstartable broker said "No access" on the terminal.**
   Did: `vault status` / `vault list` in an environment with no bindable
   socket base (129-char sandbox TMPDIR, unset XDG_RUNTIME_DIR, read-only
   `/run/user/1000`, 116-byte home fallback over the 107-byte bind limit).
   Product said "No access" (exit 1): `runVaultCommand` resolves its port
   lazily, so the broker-start failure surfaces after `open()` and the
   `brokerBlocked` sentence fell through `vaultCommandFailure`'s
   refusal-only list; an open failure naming `brokerDisabled` was likewise
   masked as `brokerBlocked`.
   Fix: `vaultCommandFailure` keeps the client's own `brokerBlocked` and
   `brokerDisabled` sentences, and the `open()`-failure branch keeps a
   named sentence, defaulting to `brokerBlocked` only for unnamed ones
   (`src/runtime/vault/vaultCommand.ts`; regression test
   `test/unit/vault/vaultCommandFailure.test.ts`, 4/4 — the two new cases
   failed before the fix).
   Rebuilt, repeated the same real use: "The broker cannot start.
   First-party keys still work; agent uses are refused. Repair the broker
   installation." (exit 1). **PASS after fix.**

4. **Attach Latest Screen Recording on Linux (PR #236; Linux path
   unchanged). PASS end to end.**
   Did: encoded a genuine 30-frame VP8/WebM (13,117 bytes, EBML magic from
   the real encoder) into scratch `~/Videos/Screencasts/`; opened a
   conversation and ran `museSpark.attachLatestScreenRecording` in the
   running packed product via a minimal temp driver extension (no product
   code stubbed).
   Product: command completed without throwing; the packed Linux discovery
   found the minutes-fresh recording, byte-sniffed it, and laid an exact
   private preview copy (13,117 bytes, byte-identical) under the owner-only
   `globalStorage/.../muse-screen/latest-RqCFGB/`. **PASS.**

5. **Browser check on a restricted kernel (PR #222). PASS (honest
   refusal); restart path out of reach here.**
   This rig's kernel has `apparmor_restrict_unprivileged_userns = 1`, so no
   sandboxed browser can start (the product must not bypass that).
   Did: `node scripts/browser-check-restart.mjs dist temp/realuse/browser-storage closed`
   (the workflow's documented restricted-kernel run; pinned runtime
   154.0.8037.92 downloaded for real, 263 MB).
   Product: `result: browserFailed`, `failedExpectations: []`, no browser
   and no check folder left. **PASS.** The default `restartObserved`
   expectation correctly fails here (`browserFound: false`); the #222 wait
   itself (service listed after first pipe answer) needs a running browser
   and is proven by the live suites where kernels allow it. Notably the
   result is `browserFailed`, never the old flaky `unrecognized`.

6. **Windows/macOS-only and CI items: no Linux behaviour. N/A with
   reasons.** PR #220's sealed birth reader and PR #236's Windows/macOS
   discovery run only on those OSs; PR #244's Seatbelt judge, OpenCode-on-
   bun, GPU/disk/headroom probes and protected-names rules are macOS-only
   (its shared walk-budget fix is suite-covered); PR #218 moves CI shards
   with no product surface. `npm run package:acp` needs the macOS helper
   (see headnote).

7. **Vault suites on this machine: measured cause, not hand-waving.**
   `brokerWithoutKeyring` (1 test) times out at the repo's own 5 s;
   `brokerSession` + `brokerSocketDirectory` show 7 failed / 9 passed /
   2 skipped with the identical signature. Root-caused with a fixture
   replica that prints the child error: the broker child exits 1 from
   `assertVaultSocketLength` (`resolveVaultSocket`, `socketDirectory.ts`)
   because every socket base is unusable in this sandbox — 129-char
   TMPDIR over the 107-byte `sun_path` limit, `XDG_RUNTIME_DIR` unset,
   `/run/user/1000` read-only, and the test's tmpdir-based HOME making
   the home fallback too long. The pure-function tests in those files
   pass (9). The product behaves correctly wherever one base fits
   (proved in 2/3 with a fitting HOME). No code change: a broken-everywhere
   socket environment is outside what the product can fix, and the failure
   now reports its repair sentence (see 3).

## Gates after the code change

- `npm run build`: exit 0 (a mid-run 273-problem lazy-registry failure was
  my own stale `dist/vsix-package/` stage from packaging before rebuilding;
  removed, rebuilt green — no product change).
- Focused suite `test/unit/vault/vaultCommandFailure.test.ts`: 4/4 pass at
  the repo default timeout (2 failed before the fix).
- `npm run package` (linux-x64): 3,393,123 of 3,788,800 bytes.
- Typecheck: exit 0. Eslint on changed files: zero warnings.
  Prettier: clean. l10n: 0 problems. Reference: current. Host-api:
  0 problems. Plan: 0 drift. Deadcode (knip): exit 0. Cycles: none.
  Duplication (jscpd): 0 clones.
- SAST: exit 0, 0 findings on 3359 files. Audit: exit 0
  (2 advisories, 1 documented exception; no dependency changed).
