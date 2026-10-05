# M95b V — VS Code subscription adapters

Kubuntu rig, worktree `/home/randy/lanes/M95BV`, branch `m95b/v`, base
`180c85b2`, 2026-10-05. This certifies the offline adapter lane, not an
integrated or live subscription release. No paid/model call, external
network request, dependency, cast, suppression, gate change, push, merge or
rebase. Hooks resolve through this worktree's `.husky/_/pre-commit`.

## Evidence and scope

Read PLAN D74 and M95b in full, `docs/certification/m95-research.md` §6,
`docs/certification/m95b-s.md`, and the supplied
`/home/randy/lanes/_ctx/codex/M95B-FINDINGS.md`. The owner recorded two
ChatGPT sign-ins on 2026-10-05, runs `acdc0f60…` and `577bc807…`, with
**0 + 1 model attempts**, and revoked both refresh tokens (HTTP 200).
This lane uses their callback fields: `code`, `scope`, `state`, `client_id`.
No model slug is hard-coded. Synthetic OAuth records and generated RSA
keys exist only in tests. The lead still needs the precise capture
workspace/receipts; the supplied findings summarize them.

## ChatGPT host implementation

- `chatgptSignIn.ts` implements lane S's `ChatGptHostPort`: the system
  browser through `vscode.env.openExternal`; a one-shot random-port
  `127.0.0.1` callback at the captured `/auth/callback`; state/field checks
  delegated to the shared parser; a deadline starting at listen, early
  callback retention, explicit cancellation, and active socket cleanup.
  Browser text reuses `UI_TEXT.oauthCallbackDone` at use time, as plain text.
- The subscription record lives only in SecretStorage at
  `museSpark.provider.chatgpt`. The shared core validates the record,
  pins issuers/origins, verifies the ID token, exchanges/rotates tokens and
  revokes before removal. No credential value enters global storage,
  webview messages, logs, hooks, tools or children. Store/browser/JSON
  failures leave through the shared core's fixed technical codes.
- An atomic `open(..., 'wx')` lock in `globalStorageUri` serializes
  initialization, sign-in, refresh and remove across extension-host
  processes. The core rereads SecretStorage while holding it. One opaque
  random installation id persists beside it. Waiting is bounded; the lock
  is released in `finally`. An occupied lock is never stolen on age.
  A crashed owner can leave the lock behind: stale-lock recovery needs a
  separately reviewed design, since timeout-based stealing can rotate
  the same refresh token twice.
- Remote windows can use an existing readable SecretStorage grant, but
  creating a remote callback refuses before opening the browser. Neither
  `asExternalUri` forwarding nor cross-window local/remote SecretStorage
  sharing was captured. The adapter does not claim either route works.

Copilot mapping and the complete integration handoff follow in a separate
commit. Panel/registry contracts still require the owning lanes; this adapter
is not yet shipped by a production entry. Lane X supplies the same shared
core ports for runtime/ACP. Remote forwarding remains uncaptured.

## Checks and red evidence

Checks run directly on Kubuntu. Full quality and the complete suite stay
with the lead as required by the rig/common brief; no gate is weakened.
Each drill runs the entire owning test file with
`--maxWorkers=3 --testTimeout=120000`, never a test-name filter. Each
mutation is restored in `finally`, with SHA-256 equality to the original
bytes. Logs and machine-readable ledgers stay in ignored `temp/m95b-v/`.

The first socket-cleanup drill did not fire because all requests had
finished. Added the incomplete-HTTP connection test and reran the drill;
it now fails as intended. Only firing drills are counted below.

| Guard deliberately broken | Named failed test (substring)                  | Result               |
| ------------------------- | ---------------------------------------------- | -------------------- |
| loopback-bind             | `binds only the captured loopback`             | exit 1; SHA restored |
| callback-path             | `ignores unrelated paths`                      | exit 1; SHA restored |
| callback-method           | `ignores unrelated paths`                      | exit 1; SHA restored |
| callback-validation       | `rejects untrusted callback`                   | exit 1; SHA restored |
| callback-deadline         | `starts its deadline at listen`                | exit 1; SHA restored |
| callback-cancel           | `cancels a pending callback`                   | exit 1; SHA restored |
| callback-close            | `closes active incomplete HTTP connections`    | exit 1; SHA restored |
| early-callback-retention  | `retains an early callback`                    | exit 1; SHA restored |
| exclusive-lock            | `never steals an occupied lock`                | exit 1; SHA restored |
| grant-lock                | `serializes token rotation`                    | exit 1; SHA restored |
| opaque-id-validation      | `rejects a damaged non-opaque installation id` | exit 1; SHA restored |
| opaque-id-persistence     | `persists one opaque host id`                  | exit 1; SHA restored |
| browser-refusal           | `releases the lock after failure`              | exit 1; SHA restored |
| remote-refusal            | `refuses an uncaptured remote callback`        | exit 1; SHA restored |
| secret-delete             | `revokes on remove`                            | exit 1; SHA restored |
| other-credential-store    | `has no dependency on other applications`      | exit 1; SHA restored |

ChatGPT baseline: **17 tests passed**. ESLint and Prettier passed on the
adapter and its tests. Hook setup and gitleaks availability were checked.
Full lane checks follow after the Copilot adapter.

Restored source SHA-256: `7a113dfba2bdcb52bfb0cb9c6ba19040f07d58a5cbddff3d63b160ce912ef50c`.
