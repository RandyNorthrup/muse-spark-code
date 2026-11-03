# Bind shell approval to the process Muse Code starts

Status: **duplicate (comment)**. Do not open a new issue. Do not post a
comment. The open issue is this draft, filed 2026-10-06, and it has no
comments.

Target: <https://github.com/meta-models/muse-code-sdk/issues/90>

Title on #90: bind shell approval to the exact process Muse Code starts
(approval-time execution-plan binding or a blocking pre-exec hook)

## Version and OS

- The filed report's capture is Muse Code 1.4.2-R4684.1, 2026-10-02, against
  a loopback stand-in. This pass did not repeat that capture.
- Schema check, 2026-11-02: Muse Code 1.4.14 (1.4.14-R7309.1). macOS 15.7.4
  (24G517). `uname -mprs` prints `Darwin 24.6.0 x86_64 i386`.
- Offline `muse schema generate-json-schema` and `generate-ts` on that
  binary. No model request.

## Steps

The behavioural repro is the one already on #90: hold shell preparation
after an approval, change the host's device identity or unattended state,
and release preparation. The host needs a way to stop the spawn.

The schema check is:

```sh
muse schema generate-json-schema --out <scratch>/schema
muse schema generate-ts --out <scratch>/schema-ts
```

## Expected

An approval-time binding of the exact execution plan, or a blocking
pre-exec check, covering the resolved executable, argv, cwd and effective
environment. A changed plan or a failed check starts no process.

## Actual

#90 is still open. The 1.4.14 changelog page
(<https://dev.meta.ai/docs/muse-code/changelog>, read 2026-11-02, newest
published section 1.4.13) has no pre-exec or execution-plan entry.

The 1.4.14 stable schema has no method for a pre-exec check or an
execution plan. `ApprovalSubject` is an open union whose `kind` values are
`shell`, `fileAccess`, `network`, `unixSocket`, `process` and `tool`. None
of those is a spawn-admission or pre-exec kind. The schema text contains
no `pre-exec`, `preExec` or execution-plan method.

This pass did not re-measure the 2026-10-02 spawn race on 1.4.14.

## Ask

Leave #90 as the request. No second issue and no new comment until a live
1.4.14 capture shows a change.

## Duplicate search

2026-11-02, public issue search on `meta-models/muse-code-sdk`, open and
closed, for pre-exec:

- #90 is this text.
- #96 is a Windows sandbox ACL lock that makes shell calls time out. It is
  not this request.

## Template fields

Do not submit a new issue.

## Workaround

Nothing in this note is cleared by the 1.4.14 schema. The local guard stays
until a capture shows the binding or the pre-exec check.
