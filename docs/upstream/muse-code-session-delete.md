# `session/delete` is method-not-found on Muse Code 1.4.14

Status: **duplicate (comment)**. Do not open a new issue. The comment below
is already on
<https://github.com/meta-models/muse-code-sdk/issues/51>
(posted 2026-11-02). Do not post it again. `session/delete` is still
method-not-found on 1.4.14. The workaround stays; see `followups.md`.

A second measurement from the same check, the stdio "one client" line, is
recorded below and should stay unfiled.

## Version and OS

- Muse Code 1.4.14 (1.4.14-R7309.1), measured 2026-11-02.
- macOS 15.7.4 (24G517). `uname -mprs` prints `Darwin 24.6.0 x86_64 i386`.
- Schema fingerprint from `initialize`:
  `sha256:c94c3d1f2f51e6424074b9ec43eac3eedcf532d3dcd77351ec1383a87d3049c6`.

## Steps

Throwaway `HOME` and `XDG_*` as in the Keychain note. No auth file is
required for this method check.

```sh
muse serve --provider echo --no-session-log --disable-shell
```

Send these three lines, in order. The `initialized` line is a notification
(no `id`). Wait for the `initialize` result before the third line if you
want the same ordering this run used; this run wrote the notification, waited
200 ms, then wrote both requests.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"repro","version":"0"},"capabilities":{"requestedCapabilities":[]}}}
{"jsonrpc":"2.0","method":"initialized"}
{"jsonrpc":"2.0","id":2,"method":"session/delete","params":{"sessionId":"00000000-0000-4000-8000-000000000001","commandId":"00000000-0000-4000-8000-000000000002"}}
{"jsonrpc":"2.0","id":3,"method":"session/notARealMethod","params":{}}
```

Offline schema of the same binary:

```sh
muse schema generate-json-schema --out <scratch>/schema
```

## Expected

Either `session/delete` is accepted, or the project states in one place that
the 1.4.3 removal is final. A client that still sends `session/delete` because
of the 1.4.2 addition needs that confirmation on the open request.

## Actual

`initialize` returned a result (`serverInfo.version` `1.4.14`). Then:

```json
{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"method not found","data":{"kind":"methodNotFound"}}}
{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"method not found","data":{"kind":"methodNotFound"}}}
```

The invented method gets the same object, so `session/delete` is missing, not
rejected for its parameters.

`msp.schema.json` from `muse schema generate-json-schema` lists these session
methods and does not list `session/delete`:

`session/approvalModeChanged`, `session/branchChanged`, `session/closed`,
`session/compact`, `session/contextUsage`, `session/fork`,
`session/goalChanged`, `session/leave`, `session/leaveCompleted`,
`session/list`, `session/listChanged`, `session/modelChanged`,
`session/modelRouteUnserved`, `session/nameChanged`, `session/read`,
`session/reasoningEffortChanged`, `session/rename`, `session/resume`,
`session/setApprovalMode`, `session/setModel`, `session/setReasoningEffort`,
`session/sideChat`, `session/start`, `session/started`,
`session/statusChanged`, `session/todoListChanged`, `session/tokenUsage`,
`session/userShell`, `session/viewHealthChanged`.

The only `delete` strings in that schema are cron job ids.

The 1.4.3 changelog says: "The session protocol no longer offers
`session/delete`; a client that sends it gets a method-not-found error."
(<https://dev.meta.ai/docs/muse-code/changelog>). 1.4.11 added
`session/leave`. 1.4.14 still has `session/leave` and still answers
`session/delete` with method-not-found.

Sending `session/delete` before the `initialized` notification returns
`-32600` / `notInitialized` instead. That earlier response is the handshake
gate, not evidence about the method.

## Ask

Restore `session/delete`, or reply on #51 that the 1.4.3 removal is final.

## Comment already posted

Posted on #51 on 2026-11-02. Kept here so a later pass can see that the
thread already has it. Do not post it again.

```text
Checked on Muse Code 1.4.14 (1.4.14-R7309.1), macOS 15.7.4 (24G517),
Darwin 24.6.0 x86_64.

After initialize and the initialized notification, session/delete returns:

{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"method not found","data":{"kind":"methodNotFound"}}}

An unknown method on the same connection returns the same error, so this
is method-not-found rather than a parameter rejection.

muse schema generate-json-schema on this binary lists session/leave and
session/leaveCompleted and does not list session/delete.

The 1.4.3 changelog says the session protocol no longer offers
session/delete and that a client that sends it gets a method-not-found
error. The 2026-10-02 comment on this issue said the method was in the
1.4.2 schema. Please restore session/delete, or confirm here that the
1.4.3 removal is final.
```

## Duplicate search

- #51 is open (read 2026-11-02). It asks for `session/delete` among other
  session housekeeping methods. The 2026-10-02 maintainer comment says
  `session/delete` (with `session/deleteCompleted`) was added after the 1.3.0
  report and is in the 1.4.2 schema. The 1.4.3 changelog removes it. No later
  issue was found that says 1.4.14 put the method back; the schema export
  shows it is absent.
- The README sends SDK, protocol, and docs bugs to this repository. A missing
  MSP method is in scope. Area on the bug form would be "The MSP protocol
  declarations or schema", but the existing issue is the right place.

## Template fields

Do not submit a new issue. The comment above is already on #51.

- Where is the problem? The MSP protocol declarations or schema
- What happened, and what did you expect instead? See Actual and Expected.
- Version and environment: Muse Code 1.4.14 (1.4.14-R7309.1), macOS 15.7.4
  (24G517). Schema fingerprint
  `sha256:c94c3d1f2f51e6424074b9ec43eac3eedcf532d3dcd77351ec1383a87d3049c6`.

## Stdio is one client (measured, nothing to file)

`muse serve --help` on 1.4.14 says: "The client owns this process's stdin and
stdout and is its only connection." That matches the recorded observation. It
is the documented stdio contract, so there is no separate bug to file.

`--listen` is the multi-client mode. A custom `unix:<PATH>` is refused: bare
`--listen` serves only the well-known socket under
`$XDG_DATA_HOME/muse/session-server/session-server.sock`. On macOS that path
must be shorter than `SUN_LEN` (the usable limit observed here is 103). A
91-character path bound and logged `muse serve: listening on
<scratch>/session-server.sock`. A longer throwaway path failed with `path
must be shorter than SUN_LEN`.

Two local clients that presented no client credential each received only:

```json
{ "museClientCredential": "rejected" }
```

The same object came back after `session/start` and `session/list`. Those
sockets are not a second MSP client. This pass did not mint a client
credential, and it does not ask upstream to accept unauthenticated clients.
