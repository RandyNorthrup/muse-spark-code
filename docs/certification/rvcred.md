# Review of retired-vault undo, secret-gist publish, and the macOS credential file (lane RVCRED, 2026-10-30)

Machine: macmini (darwin, x86_64), worktree `/Users/randy/lanes/RVCRED`.
No owner's credential store, login keychain, or `auth.json` was read.
Every run that needed a home used its own. Nothing was published.
No paid or live model call. No Muse request.

The three feature branches were not merged together. Each fix sits on
its own branch. This record is the review; the other two commit
messages point here.

| Area                  | Branch                  | Fix commit                                 |
| --------------------- | ----------------------- | ------------------------------------------ |
| Vault undo            | `rv/cred` (this branch) | `5c0e4ec1c9b8064307e397bc000de117f87fbfa7` |
| Secret-gist publish   | `rv/m118`               | `a0e8785b79bca12c6784caf3210bfed344e9ceb0` |
| macOS credential file | `rv/maccred`            | `221f501971e22bd5baa9241e12a58392b6147879` |

Shared history for the three feature deltas is int/recovery at
`f53ef168f`. There is no branch named `int/recovery`. The gist branch
has a follow-up, `7a88f5806`, that narrows the refresh catch and
removes the clones the first fix had added. It is on `rv/m118` only.

## Vault undo (`rv/cred`, D217)

Source record: `docs/certification/rlf-vaultundo.md`. Decision: PLAN.md
D217, unchanged in number. No changelog line: the crash-resume behaviour
has no run on this rig, and a changelog line would claim it.

### P1 — a kill between the legacy write and the active journal row

Evidence, before the fix: `undoRetired` wrote the vault bytes back to
the legacy store and only then saved `phase: 'active'`. A kill in that
gap left the secret in the legacy store while the journal still said
`retired`. The next unlock treated the slot as retired. Undo again
would write the secret back, including after the person had removed
the restored copy.

Fix, at the cause, in `finishUndo`
(`src/core/vault/migrate/migrate.ts`). The journal mark `undoIntent`
is `pending` before the legacy write and `written` only after that
write has been read back as the same bytes. Startup
(`phase === 'retired'` and `undoIntent` set) calls `finishUndo` again.
A conflict, or `written` with the copy now absent, clears the mark and
throws `conflict`: a newer value is not overwritten, and a copy removed
after the write was saved is not written again. `pending` with the copy
absent means the write never became visible, so the restore finishes.
The active row, with the retain window restarted, is saved only when
the re-read is `same`. A conflict on resume is swallowed only for
`VaultMigrationFault` code `conflict`; any other error is thrown.

One residual is still in the engine comment, and it is not closed:
SecretStorage has no compare-and-swap. A kill after the bytes land and
before the `written` mark, if the copy is also gone before resume reads
it, looks like `pending` with nothing there, and the restore runs
again. Shrinking that gap further is the `written` mark immediately
after the verified mirror, which is what the fix does. The mark cannot
move earlier than the write it records.

Drill (written, not executed here): `driveUndoCrashCase` in
`test/unit/helpers/vault/retiredUndoFlow.ts`, child
`test/unit/helpers/vault/undoCrashChild.ts`. Both broker suites call
it: `chatgptSubscriptionMigration.test.ts` (“finishes a retired undo
that was killed between its steps”) and
`credentialMigrationStore.test.ts`. Hang points are `legacy`,
`written`, and `pending`. The parent SIGKILLs the child and expects
`SIGKILL`. Deadline is the suites' existing `FLOW_TIMEOUT_MS`
(300_000), not a raised Vitest timeout.

This rig did not run that case, and did not run the existing retired-undo
or reset cases. A unique-service `@napi-rs/keyring` `AsyncEntry.setPassword`
returns `GenericFailure` with `interaction: true`: “User interaction is
not allowed.” (`errSecInteractionNotAllowed` / `StoreUnavailableError`).
The same abort is named in the RLF-VAULTUNDO record. No `security`
command, no keychain change, no stand-in store. Hosted CI owns both
broker suites. The Windows suite skips on darwin by platform.

### P1 — a retired ChatGPT sign-in dropped out of the set

Evidence: the ChatGPT subscription is not a providers-file row. The
controller added it only when SecretStorage held a non-empty value.
Retire removes that copy, so the next unlock never built the credential
and never resumed its undo.

Fix, in `CredentialMigrationController.engine`
(`src/host/vault/migrateCredentials.ts`). The slot is included when
SecretStorage holds a non-empty value, or, when it does not, when the
vault snapshot contains `journalItemId(providerSecretKey('chatgpt'))`.
A snapshot failure is caught and warned, so one vault-read failure does
not skip every other key. The value is never kept or logged. A slot
that was never migrated has no journal row and stays out.

The proof is the same broker undo path (the crash case retires the
ChatGPT slot, kills the undo, and expects the next unlock to finish
it). That path did not run here, for the keychain reason above.

### Checked and found sound

- A deleted or emptied slot is not restored. `written` plus absent, or
  any byte conflict, clears the mark and throws `conflict`. The existing
  `driveUndoRetiredCase` already refuses an emptied or changed slot in
  its own sentence. Not re-run here.
- Reset does not write the secret back to the legacy store. Reset is
  broker-side: the journal rows and vault copies go with the vault.
  The confirmation already says retired entries are deleted too
  (`resetWarning`, RLF-VAULTUNDO). `driveResetCase` covers it. Not
  re-run here.
- Another process or user does not get an undo drive. The panel and
  the palette go through `undoRetired`, which allows only a key the
  fresh snapshot lists as retired; anything else is the said
  `useChanged` refusal. The engine's migration lock is in-process, not
  an authentication boundary, and this review did not pretend it was
  one. No new cross-user entry point was added.
- Retired material at rest matches live material. The vault copy is the
  same encrypted item. The journal row holds a digest and the undo
  mark, not the secret. `listRetired` is value-free. Nothing in the
  undo mark changes that.
- The terminal `vault undo` stays unbuilt. It follows T5, as the
  RLF-VAULTUNDO record says. This review did not add it.

## Secret-gist publish (`rv/m118`, D218)

Source record: `docs/certification/rlf-m118.md`. The gist decision was
D217 on that branch and collided with vault undo. It is D218 there
only. D217 on this branch stays the vault undo. No gist UI was added.
No live publish. The request body below is the body the real client
builds; the test fetch records it and then fails, or, where a delete
has to be proved, returns a scripted status. That scripted status is
not a stand-in for GitHub. Live gist capture stays with the lead.

### P1 — a 404 with no scope header was treated as “gist missing”

Evidence: `isGistScopeMissing` treated an absent `X-OAuth-Scopes` header
as the gist scope missing, then asked for consent and retried. An absent
header is not a scope list.

Fix: missing is `missing?.includes(GITHUB_GIST_SCOPE) === true`. No
header means no consent and no retry.

Drill: `test/unit/gistShareSend.test.ts`, “does not ask or retry when a
404 carries no scope header”. The 404 JSON has no `X-OAuth-Scopes`.
The error is `GitHubError` not-found. Consents stay 0. Passed with the
suite below.

### P1 — the gist grant asked for `repo` and replaced the repository token

Evidence: the device-flow body was `scope=repo gist` (the join of the
repository scopes plus `gist`), and `publish()` wrote the resulting
token over `GITHUB_DEVICE_FLOW_SECRET_KEY`, the repository sign-in.

GitHub's own rule (docs.github.com, “Authorizing OAuth apps” and
“Creating multiple tokens for OAuth apps”, read 2026-10-30): a grant
for a different scope combination does not revoke the other token.
Revocation of an existing token happens only after more than ten tokens
for the same user, application, and scope combination. Asking for
`repo` and `gist` together was a wider grant than gist, and storing it
in the repository slot replaced that sign-in locally even though GitHub
would have kept the two grants apart.

Fix: `GITHUB_GIST_SCOPES` is `['gist']` only. `GITHUB_PERMITTED_SCOPES`
(`repo`, `read:org`) and `GITHUB_AUTH_SCOPES` (`['repo']`) are unchanged,
and ordinary sign-in still refuses `gist`. The gist token is stored at
`GITHUB_GIST_SHARE_SECRET_KEY` (`museSpark.github.gistShare`), never in
the repository slot. `publish()` still writes only the git key.
`publishGist` writes only the gist key. Once `storedGistGrant` /
`ports.gistCredential` resolves, gist calls send that token and do not
call the repository credential. `signOut` deletes both keys. A rejected
gist bearer deletes only the gist key. A device-code POST whose fetch
rejects throws `DeviceFlowFailure` reason `network`; it does not resolve
undefined, and it does not write either slot.

Drill: `test/unit/githubGist.test.ts` — scopes exactly `['gist']`; a
wider set and `[]` throw `scopeRefused`; the device-flow body is
`scope=gist` and does not contain `repo`.
`test/unit/gistGrantStore.test.ts` (four cases, the established Map
store the device-flow tests already use; the OS keychain cannot be
written in this session): a stored gist grant is served with zero
fetch and the git slot unchanged; `GitHubSignIn.storedGistGrant` returns
that bearer with zero fetch and login not called; a failed device flow
rejects `{ name: 'DeviceFlowFailure', reason: 'network' }`, the body is
`scope=gist` and not `repo`, the git slot is unchanged, and the gist
key is absent; `rejected` with the gist bearer deletes only the gist
key, and `signOut` deletes both.
`test/unit/gistShareSend.test.ts`, “sends the stored gist grant and
does not call the repository sign-in”: the gist bearer is the only
token sent.

`gistShare` + `gistShareSend` + `githubGist`: 33 passed, exit 0.
`gistGrantStore`: 4 passed, exit 0. Repository timeouts. No
`--testTimeout`.

### P2 — the send path could upload outside the consented scope

Evidence: consent names the gist, but the create body was not run
through the share scrub, and a file name could carry a path or the
account.

Fix: `publishGistShare` scrubs with the existing
`scrubShareText` (`redactSecrets(normalisePaths(redactSecrets(redactRegisteredSecrets)))`)
before any fetch. An unsafe file name is refused before any fetch
(`shareGistFileUnsafe`, English plus all 14 tables): empty, `.` / `..`,
a slash or backslash, `..`, any scrub marker, or the account as its own
segment. Bare words are not scrubbed; an identity field and a home path
are. No size cap was added (D121). The consent sentence still names
only the gist.

Drill: “sends only the scrubbed file, as a secret gist, and keeps the
token out of the body and the error”. The description is
`account: someone`. The content holds a `ghp_` token and a
`/Users/someone/...` path. The recorded POST body has `public: false`,
files exactly `['share.md']`, and does not contain the bearer, the
token, `/Users/someone`, or `someone`. “refuses a file name with a
folder or an account before any request”: `../notes.md`, `someone.md`,
and a Windows path throw `shareGistFileUnsafe`, and fetch is never
called. `check:l10n` on that branch was exit 0 before the commit.

### P2 — a create that is not a confirmed secret gist could be left up, and a hostile link could be shown

Evidence: `createGist` schema-threw on a reply it did not trust, so a
created gist was abandoned. A hostile `html_url` could be shown.

Fix: `readGistReply` keeps a safe id (`/^[A-Za-z0-9]+$/`) even when the
schema fails. Success requires `isPublic === false`, an `https` URL
whose host is exactly `gist.github.com` with no userinfo, and a
non-empty id. Otherwise, an empty id throws `shareGistNotSecret` and
does not delete. A present id is deleted. If that delete fails and the
reply is `public: true` with a real gist URL, the error is
`shareGistLeftPublic` with that URL. Any other URL, including a hostile
one, is `shareGistNotSecret` and the URL is not shown. A successful
delete of an unconfirmed gist also throws `shareGistNotSecret`.

Drill: a 201 `{ id, html_url: 'https://evil.example/gist', public: false }`
then DELETE 204 is one POST and one DELETE, the message is
`shareGistNotSecret`, and `evil.example` is absent. A 201
`{ public: true }` with no id is one POST and no DELETE.

### Checked and found sound

- `parseGistTarget` allows only `https` and host `gist.github.com`.
- Ordinary sign-in still refuses the gist scope.
- A declined consent does not upgrade.
- `GitHubError` redacts the token.
- `public: false` is in the body the real client builds, proved by the
  recorded POST above. That does not prove GitHub stored it as secret.
  Live capture stays with the lead.
- A confidential workspace is still blocked by `admitShareRelease`.
- The person can find a gist that was confirmed: the client returns the
  gist URL only for a confirmed secret gist. An unconfirmed one is
  deleted, or, when the delete of a confirmed-public gist fails, named
  with the real gist link.
- A refused publish (unsafe name, declined consent, absent scope header,
  failed device-code POST) performs no create. A failed create with no
  id performs no delete and leaves no id behind in the client.

## macOS credential file (`rv/maccred`, RLF-HARVEST H9)

Source record: `docs/certification/rlf-maccred.md`. The H9 parser was
not changed: a version-1 file with an `api_key` string is `inline` on
darwin, including an empty string. This review did not invent a
non-empty rule. No PLAN heading was added on that branch: no open
milestone owns this read (M23 is archived).

### P1 — a symlink was followed and could be reported as `inline`

Evidence, red, before the fix: `readCredentialFile` used `stat`, which
follows a link, then read that target. `npx vitest run
test/unit/cliCredentialFile.test.ts --maxWorkers=2` exited 1. Five
passed, one failed: “a symlink is not the credential file it points
at”. Expected `{ signature: 'unreadable', verdict: 'unrecognized' }`.
Received a signature of the target's size and `verdict: 'inline'`. The
target was the captured v1 fixture
(`test/fixtures/maccred/v1-auth-set.json`), a regular file of 81 bytes.
The placeholder in that fixture is not a live key. The owner's
`auth.json` was not read. The oversized-file case already passed on the
old size cap; the hole was the link, not the cap.

A device or FIFO was already unrecognised: `isFile()` is false, so the
old code returned without reading. The hole was a regular file behind
a symlink.

Fix, in `readCredentialFile` (`src/host/auth/cliAccount.ts`). `lstat`
first. A symlink, or anything that is not a regular file, returns
`{ signature: 'unreadable', verdict: 'unrecognized' }` and is not
opened. The open is `O_RDONLY` plus `O_NOFOLLOW` where that flag exists
(`Reflect.get(constants, 'O_NOFOLLOW')`, 0 where it does not). The read
is `readSync` on that descriptor. On Windows, where there is no
`O_NOFOLLOW`, `fileIdentityKey` plus `sameFile` require the descriptor
to be the same file the `lstat` named (`src/core/fs/fileIdentity.ts`,
used, not modified). An unusable id (`ino <= 0` or `dev < 0`) is
refused rather than trusted. Paths are not compared and `realpath` is
not used. The 64 KiB cap is the descriptor's size, checked before
`Buffer.alloc`. Nothing from the file is logged. The text is passed
only into `credentialFileVerdict`, which drops the values. The one
remaining catch is the existing generic “unreadable” return. The host
GENERIC count fell from 95 to 94; the baseline was regenerated
(`scripts/catch-baseline.json`). No SWALLOW or CLEANUP site was added.
`closeSync` is in `finally` with no inner catch, so a close failure is
not a new cleanup site.

Drill, green, after the fix, repository timeouts, `--maxWorkers=2`:
`cliCredentialFile.test.ts` 6 passed, exit 0 (the link is
`unrecognized`; the target itself is still `inline`; the link result's
JSON does not contain `api_key` or the placeholder; a dangling link is
the same unrecognised object, not a throw and not “no file”; an
oversized file is unrecognised and its signature starts with that
size). `authFastSignIn.test.ts` 4 passed, exit 0. `cliPeek.test.ts` 3
passed, exit 0. Those are the only test importers of `cliAccount`
besides the file suite. `check:catches` then “All catch sites and counts
match the baseline”, exit 0. `duplication` 0 clones, exit 0. `cycles`
exit 0. The change a person notices is the changelog bullet on that
branch: a link put in place of the credential file is not treated as a
sign-in.

### Checked and found sound

- Malformed JSON is `unrecognized`, and the `SyntaxError` is not logged
  (`credentialFileVerdict`). The parser was not changed.
- A non-string key, and an `access_token` without `api_key`, stay
  unrecognised.
- An empty version-2 file stays `unrecognized` on darwin. The
  keychain-sign-in case that would recognise a real empty version-2
  file is uncaptured. This review did not invent that rule. The
  RLF-MACCRED record already says so.
- A missing file is “no file” (`undefined`), not unrecognised. A
  directory is unrecognised. A symlink cycle is unrecognised (ELOOP on
  the old `stat`, `isSymbolicLink()` on `lstat`).

## Gates on `rv/cred`

Repository timeouts. No `--testTimeout`. Budgets were not raised.
`npx vitest run test/unit/vault/credentialMigration.test.ts --maxWorkers=2`:
6 passed, 1 skipped (the Windows shell), exit 0. The broker suites
(`chatgptSubscriptionMigration.test.ts`,
`credentialMigrationStore.test.ts`) were not run: this session's keyring
write aborts with “User interaction is not allowed.” Hosted CI owns them.
`vitest related` on the migration sources pulls those broker suites, so
it was not used as a substitute for them.

| Gate                                                           | Exit | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier --check (touched files, after formatting this record) | 0    | The first check exited 1 on this file only; `prettier --write` fixed it                                                                                                                                                                                                                                                                                                                                                                                                            |
| eslint --max-warnings 0 (touched ts)                           | 0    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| npm run typecheck                                              | 0    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| node scripts/check-l10n.mjs                                    | 0    | 0 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| npm run check:reference                                        | 0    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| npm run check:host-api                                         | 0    | 0 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| npm run check:plan                                             | 1    | PLAN.md is 3,775,440 bytes, over the 3,565,158-byte (85%) archive bound. The status phrase is an existing one (`built, pending integration`). Archiving is the lead's call. The bound was already exceeded on the source lane                                                                                                                                                                                                                                                      |
| npm run check:roadmap                                          | 0    | After an internal `RVCRED` entry (`"public": false`). ROADMAP.md changed only its source fingerprint                                                                                                                                                                                                                                                                                                                                                                               |
| npm run check:catches                                          | 1    | Rises are in files this review does not touch (judge, accounts, paid, model API). No new site in `migrate.ts` or `migrateCredentials.ts`. The baseline was not regenerated                                                                                                                                                                                                                                                                                                         |
| npm run duplication                                            | 1    | 7 clones, none in a file this review touches. Same count the source lane recorded                                                                                                                                                                                                                                                                                                                                                                                                  |
| npm run cycles                                                 | 0    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| npm run deadcode                                               | 1    | Pre-existing: `judgeApprovalFixtures.ts`, `MAY_HOLD_SECRET`, `paidAvailability`, `JudgeLintOptions`, knip ignore hints, four unwired tags. `undoCrashChild.ts` is an esbuild entry in `knip.jsonc`, and the re-run no longer lists it                                                                                                                                                                                                                                              |
| npm run build                                                  | 1    | `dist/vaultMigration.js` is 46.7 KiB against 45 KiB. The source lane was already 45.2 KiB; this fix grew it and the budget was not raised. Also over, matching the source lane's red set: `reportingPanel.js` 50.6/50, `resourceGovernor.js` 127.0/125, `resourceAdmission.js` 25.5/25, `modelApi.js` 544.3/525, `modelsPanel.js` 155.3/150, `usageService.js` 100.8/100, `teamScheduler.js` 75.3/75, `vaultActions.js` 25.1/25, `estimateContracts.js` 25.1/25, `wire.js` 76.2/75 |
| npm run security:audit                                         | 1    | Pre-existing highs: `@azure/msal-node` GHSA-xcx6-jx8p-x3h5, `undici` GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm, `zod` GHSA-mrhx-c7xc-m3w5. Not introduced here                                                                                                                                                                                                                                                                            |
| npm run security:sast                                          | 1    | 5 blocking findings, all `detect-replaceall-sanitization` in `src/host/backend/deviceWorkerDarwin.ts`, a file this review does not touch. Semgrep also timed out three rules on `ModelApiHost.ts` and continued                                                                                                                                                                                                                                                                    |

## Gates on `rv/m118`

Head after the follow-up is `7a88f5806` (parent `a0e8785b7`). The
follow-up is the catch and the clones below. Repository timeouts.
`gistShare` 21 passed, `gistShareSend` 6, `githubGist` 6,
`gistGrantStore` 4, all exit 0.

The first pass of `a0e8785b7` had two regressions this review had
added. `check:catches` named a new GENERIC site at
`src/runtime/github/deviceFlowSource.ts` (runtime GENERIC 185 to 200).
The gist refresh catch returned the stored grant for every error.
`7a88f5806` keeps that grant only for a `DeviceFlowFailure` that is
not a refused refresh, and throws anything else. The re-run lists no
site in that file, and runtime GENERIC is 185 to 199, the same
pre-existing rise as this branch. `duplication` found 11 clones, four
of them in `githubSignIn.ts` and `gistShareSend.test.ts`. The same
commit shares the sign-in ask and the send-test helpers. The re-run
is 7 clones, none in those files.

| Gate                        | Exit | Note                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| prettier, eslint            | 0    | touched files, including the follow-up                                                                                                                                                                                                                                                                                                                             |
| npm run typecheck           | 0    | before and after the follow-up                                                                                                                                                                                                                                                                                                                                     |
| node scripts/check-l10n.mjs | 0    | 0 problems, including after the follow-up                                                                                                                                                                                                                                                                                                                          |
| npm run check:reference     | 0    |                                                                                                                                                                                                                                                                                                                                                                    |
| npm run check:host-api      | 0    |                                                                                                                                                                                                                                                                                                                                                                    |
| npm run check:plan          | 1    | PLAN.md is 3,771,739 bytes, over the 3,565,158-byte archive bound. Pre-existing. Not archived                                                                                                                                                                                                                                                                      |
| npm run check:roadmap       | 0    |                                                                                                                                                                                                                                                                                                                                                                    |
| npm run check:catches       | 1    | Pre-existing rises only, after the follow-up. Baseline not regenerated                                                                                                                                                                                                                                                                                             |
| npm run duplication         | 1    | 7 pre-existing clones after the follow-up                                                                                                                                                                                                                                                                                                                          |
| npm run cycles              | 0    | before and after the follow-up                                                                                                                                                                                                                                                                                                                                     |
| npm run deadcode            | 1    | Pre-existing only (`judgeApprovalFixtures.ts`, `MAY_HOLD_SECRET`, `paidAvailability`, `JudgeLintOptions`, knip hints, four tags)                                                                                                                                                                                                                                   |
| npm run build               | 1    | Ten overs, none new: `reportingPanel.js` 50.6/50, `resourceGovernor.js` 126.9/125, `resourceAdmission.js` 25.5/25, `modelApi.js` 544.3/525, `modelsPanel.js` 155.0/150, `usageService.js` 100.8/100, `teamScheduler.js` 75.3/75, `vaultActions.js` 25.1/25, `estimateContracts.js` 25.1/25, `wire.js` 76.2/75. Budgets not raised. Re-measured after the follow-up |
| npm run security:audit      | 1    | The same pre-existing highs as this branch                                                                                                                                                                                                                                                                                                                         |
| npm run security:sast       | 1    | On `7a88f5806`: 5 blocking findings, all in `deviceWorkerDarwin.ts`. None in the gist files                                                                                                                                                                                                                                                                        |

## Gates on `rv/maccred`

Head `221f50197`. Repository timeouts. `cliCredentialFile` 6 passed,
`authFastSignIn` 4, `cliPeek` 3, exit 0. `providerHeadersStore` was
not run: it uses the login keychain and fails here with no default
keychain.

The worktree's `node_modules` had been installed from another branch,
so the first typecheck and build exited 1 on missing
`@simplewebauthn/server`, `@sigstore/bundle`, `@sigstore/tuf`, and
`@sigstore/verify`. Those are in this branch's `package.json`. After
`npm ci --ignore-scripts` from this branch's lockfile, typecheck
exited 0 and build exited 0. Budgets held. `dist/vaultMigration.js`
is 38.3 KiB. No budget was raised.

| Gate                        | Exit | Note                                                                                                                                                                                                                                                                                |
| --------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier, eslint            | 0    | the five touched files                                                                                                                                                                                                                                                              |
| npm run typecheck           | 0    | after the lockfile install. The earlier exit 1 was the missing packages                                                                                                                                                                                                             |
| node scripts/check-l10n.mjs | 0    | no new sentence                                                                                                                                                                                                                                                                     |
| npm run check:reference     | 0    |                                                                                                                                                                                                                                                                                     |
| npm run check:host-api      | 0    |                                                                                                                                                                                                                                                                                     |
| npm run check:plan          | 0    |                                                                                                                                                                                                                                                                                     |
| npm run check:roadmap       | 0    |                                                                                                                                                                                                                                                                                     |
| npm run check:catches       | 0    | host GENERIC 95 to 94, baseline regenerated in `221f50197`                                                                                                                                                                                                                          |
| npm run duplication         | 0    | 0 clones                                                                                                                                                                                                                                                                            |
| npm run cycles              | 0    |                                                                                                                                                                                                                                                                                     |
| npm run deadcode            | 0    |                                                                                                                                                                                                                                                                                     |
| npm run build               | 0    | after the lockfile install                                                                                                                                                                                                                                                          |
| npm run security:audit      | 0    |                                                                                                                                                                                                                                                                                     |
| npm run security:sast       | 1    | 6 blocking findings, none in `cliAccount.ts`: `os/build.py`, `os/pi/compose.py`, `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`. Semgrep timed out rules on `ModelApiHost.ts` and `conversationController.ts` and continued |

The three branches are not merged together.
