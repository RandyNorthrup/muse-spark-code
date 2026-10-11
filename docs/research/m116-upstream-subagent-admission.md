# Draft: let the host decide `subagent_spawn` in every permission mode

Status: local draft for lead dedupe and filing. No issue has been posted.
Evidence: the Muse Code 1.3.0 approval capture (M18; `test/harness`
`approval-tool`), PLAN D96.17, `docs/certification/m116.md` ("Commit 5").
A trace from Muse Code 1.4.4 is owed and is not claimed here.
Nearest existing items, for the dedupe: M96's upstream list U3 and U5, and
issue #43.

## Body

A host that orchestrates work (review rounds, a limit on fix rounds, a
required redesign) needs to admit or refuse a subagent before it starts. Muse
Code starts its own subagents, and the only point at which a host can speak is
the approval request for the `subagent_spawn` tool.

That request is a permission question for the person, so it exists only where
the person is asked:

- In the prompting modes the CLI sends `approval/requested` for
  `subagent_spawn`, and the host can hold it, decide it, or pass it on.
- With `allowAll`, with `onRequest` when the call is not escalated, after a
  session-scoped approval, and under the user's own allow rules, no request is
  sent. The host first learns of the child from its `item/started` row, when
  it is already running.

So a host policy can be enforced in some modes and only reported in the
others. Our extension says so to the person in plain words, but the gap is not
one a host can close.

## Reproduction

1. Start `muse serve` in an empty workspace with a client that records every
   frame.
2. In a prompting mode, ask for a task that makes the model start a subagent.
   `approval/requested` arrives with `toolName: "subagent_spawn"` before any
   `item/started` of kind `subagent`.
3. Approve with the session-scoped choice and ask for another subagent, or
   repeat step 2 with `allowAll`. No request arrives; the `subagent` row
   starts.

The lead supplies the scrubbed 1.3.0 frames. Steps 2 and 3 have not been
repeated on 1.4.4.

## Expected

A host-decided admission for `subagent_spawn` that does not depend on the
permission mode or on the user's rules, separate from the person's permission
decision. For example: a capability the host declares at the handshake, after
which the CLI asks the host before every spawn (the role, the objective and
the parent turn), and the host answers allow, or refuse with a reason the
model is given. Modes and rules would keep deciding whether the person is
asked; the host's answer would decide whether its policy admits the work.
