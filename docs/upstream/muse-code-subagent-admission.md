# Host admission before a subagent starts

Status: **needs live check**. Do not file until the serve capture below
shows that a spawn still starts with no approval request. The 1.4.14 schema
has no admission method. That half does not need a model call.

Local draft: `docs/research/m116-upstream-subagent-admission.md`.

## Version and OS

- Schema check, 2026-11-02: Muse Code 1.4.14 (1.4.14-R7309.1). macOS 15.7.4
  (24G517). `uname -mprs` prints `Darwin 24.6.0 x86_64 i386`.
- The behavioural captures in the draft are Muse Code 1.4.4 and 1.4.6,
  `muse serve --trust-workspace`, delegation
  `run.subagent_delegation_mode` set to `auto`. This pass did not repeat
  them.

## Steps

Schema, offline:

```sh
muse schema generate-json-schema --out <scratch>/schema
```

Live check, only if a filing is still under consideration. Empty workspace,
frame-recording client, one contributor model by the explicit id
`muse-spark-1.3-contributor`:

1. `muse serve --trust-workspace` with
   `run.subagent_delegation_mode` set to `auto`.
2. Ask for one delegated task under `promptUnmatched`, then `onRequest`,
   then `allowAll`.
3. Record whether `approval/requested` arrives before the child starts, and
   the timestamps of the spawn tool row and the first subagent row.

## Expected

A host can allow or refuse the start before the child runs: an
`approval/requested` for the spawn in prompting modes, or a dedicated
admission method. A refusal starts no child.

## Actual

Schema half, measured on 1.4.14: the method list has `subagent/close`,
`subagent/followupTask`, `subagent/interrupt`, `subagent/readResult`,
`subagent/reopen`, `subagent/resume`, `subagent/sendMessage` and
`subagent/stop`. Those control a child that already exists. There is no
admission method, no pre-exec method and no execution-plan method.
`ApprovalSubject.kind` is `shell`, `fileAccess`, `network`, `unixSocket`,
`process` or `tool`. There is no spawn kind.

Behaviour half, last measured on 1.4.4 and 1.4.6: prompting modes, Auto and
Bypass sent no `approval/requested` for the spawn. The child started
milliseconds after the model reply. `denyUnmatched` denied by policy with
no approval request and no subagent row. This pass did not re-measure that
on 1.4.14, so it is not filed from the schema alone.

## Ask

If the live check still shows no approval before the child starts, file a
new bug on `meta-models/muse-code-sdk` (area "The MSP protocol declarations
or schema") asking for that admission. If an approval request now arrives
in time to refuse the start, file nothing.

## Duplicate search

2026-11-02, public issue search on `meta-models/muse-code-sdk`:

- #49 is hook visibility (`hook/list`, `hook/started`, `hook/completed`).
  Not spawn admission.
- #39 is settings over the session protocol. Not this.
- #43 is permission profiles, the approval judge, trust and worktrees.
  Related surface, not a request for admission before a subagent starts.
- #80 is the serve approval judge. The changelog says that landed in 1.4.6
  (see `followups.md`). It is not this request.
- #90 is shell pre-exec. A different spawn.

No open or closed issue asks for host admission before a subagent starts.

## Template fields

Hold the bug form until the live check fails.

- Where is the problem? The MSP protocol declarations or schema
- What happened, and what did you expect instead? See Actual and Expected.
- Version and environment: Muse Code 1.4.14 (1.4.14-R7309.1), plus the
  1.4.4 / 1.4.6 captures named in the draft.

## Workaround

The product counts observed rounds and tells the person it cannot stop a
start. Leave that until a capture shows an admission request that arrives
before the child starts.
