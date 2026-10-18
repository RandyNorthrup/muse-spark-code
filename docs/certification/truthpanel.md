# Lane TRUTHPANEL — the panel's retry message says the real cause

## The site

`src/host/conversation/conversationController.ts` — `controlSubagent`, the
owner's Agent-map Retry/Continue path (lines 9286–9320). After the owner
confirms, the panel re-reads the session; when the agent row is no longer
there (`agent === undefined`), line 9309–9312 throws the retry-mapped
message:

```ts
if (agent === undefined)
  throw new Error(
    action === 'retry' ? UI_TEXT.agentRetryUnavailable : UI_TEXT.agentContinueUnavailable,
  )
```

The catch at 9315–9319 renders it as an error notice:
`The agent command was refused: <message>`.

## What the person sees now (wrong)

Retry on an agent that has left the conversation says:

> The agent command was refused: Retry is unavailable: this backend provides
> no isolated worktree checkpoint. Shared workspace changes are kept.

That blames a missing worktree checkpoint for an agent that is simply gone.
Only a backend without a checkpoint may say that sentence (the Muse Code CLI
backend in `MuseCodeHost.controlSubagent`, which genuinely has none).

## What the person will see (this lane)

- Missing agent (either action): `The agent command was refused: ` plus the
  new `UI_TEXT.agentGone` — the agent is gone, no checkpoint blame.
- Agent changed under the confirm dialog: `agentContinueUnavailable`
  (unchanged).
- Backend refusal (including a backend that truly has no checkpoint):
  the backend's own message, carried unchanged after
  `The agent command was refused: ` — the panel no longer remaps any retry
  failure to the checkpoint sentence.

Mirrors PR #237 (`fix/acp-error-truth`) on the ACP side, built on current
main.
