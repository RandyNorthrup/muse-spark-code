# Draft: host admission before a subagent starts

Status: local draft for the lead to dedupe and file; no issue posted.
Evidence: contributor-model captures on Kubuntu, Muse Code 1.4.6, and
linuxlt, 1.4.4; stdio `muse serve --trust-workspace`, with delegation set to
`run.subagent_delegation_mode="auto"`. Every frame was recorded. Capture
index: lead-host `live/muse-subagents/index.json`; facts transcribed in
`docs/certification/m116.md`. Existing items for dedupe: M96 U3/U5 and #43.

## Body

A host enforcing review rounds and required redesigns needs to admit or
refuse a subagent before it runs. Muse Code 1.4.4 and 1.4.6 send no
`approval/requested` for `subagent_spawn` in the tested prompting modes,
Auto or Bypass. The earlier draft's 1.3.0 premise was false for these versions.

## Reproduction

1. Start the command above in an empty workspace with a frame-recording client.
2. Ask for a delegated task under `promptUnmatched`, `onRequest` or `allowAll`.
   No approval frame arrives. The spawn tool row precedes the subagent row by
   1–9 ms; the child starts 17 ms after the model reply.
3. The first subagent row is `item/started`, revision 1, controlStatus
   `accepted`, with subagentId and itemId but no childSessionId. That session
   id appears at revision 2, 12–108 ms later. Reminder children are distinct.
4. Under `denyUnmatched`, no request arrives either: `approval/resolved`
   says denied by policy, and the spawn tool completes rejected with
   failureKind `approval_denied`, without a subagent row.

A child's own tool approvals also arrive without a request, tagged with
subagentOrigin and resolved by llmJudge. No judge switch was found. A spawn
that is asked for, a judge escalation to a person, delegation off with a real
model, and the extension's initialize capability set were not captured.

## Expected

Provide a host admission boundary before the child starts: an approval request
for `subagent_spawn` in prompting modes, or a dedicated host admission call.
A capability declared at initialize could require an allow/refuse answer for
every start, independent of the person's permission mode and allow rules,
with the child role, objective and parent turn available before dispatch.
A refusal should reach the model with the host's reason and start no child.

Our host currently counts observed Muse Code rounds and reviews their work,
and tells the person it cannot stop a start. The lead will supply the scrubbed
capture as reproduction; no new live call was made by this lane.
