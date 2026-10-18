// Muse Code 1.4.2-R4684.1's multi-stage approval frames and faults, as
// captured live on 2026-10-02 (docs/certification/approval-decisions.md):
// `muse serve --provider meta` against a loopback fake of the Responses API,
// in an isolated home and an empty temporary workspace, no credential, no
// model attempt beyond 127.0.0.1. The owner's session log of the same day
// carries the same shapes (Muse Code 1.4.0-R4302.1 and 1.4.2-R4684.1).

export const RACE_APPROVAL_ID = '01a10056-7873-7d40-9215-8caf27873119'
const COMMAND =
  "git show HEAD:a.yml | Out-String | Select-Object -First 1; Write-Output '---LINES---'; git show HEAD:a.yml | Measure-Object -Line; Write-Output '---CONTENT---'; git show HEAD:a.yml"

const STAGE_ARGV: readonly (readonly string[])[] = [
  ['git', 'show', 'HEAD:a.yml'],
  ['Out-String'],
  ['Select-Object', '-First', '1'],
  ['Write-Output', '---LINES---'],
  ['git', 'show', 'HEAD:a.yml'],
  ['Measure-Object', '-Line'],
  ['Write-Output', '---CONTENT---'],
  ['git', 'show', 'HEAD:a.yml'],
]

/** "Always allow in this workspace: <first words> ..." as 1.4.2 labels a stage's rule. */
function prefixOf(argv: readonly string[]): readonly string[] {
  return argv[0] === 'git' ? argv.slice(0, 2) : argv.slice(0, 1)
}
export function prefixLabel(sourceIndex: number): string {
  return `Always allow in this workspace: ${prefixOf(STAGE_ARGV[sourceIndex] ?? []).join(' ')} ...`
}

function requirement(sourceIndex: number) {
  return { approvalId: RACE_APPROVAL_ID, sourceIndex }
}

/** The subject's stages; the first `decided` were resolved by an "Always allow". */
function stages(decided: number) {
  return STAGE_ARGV.map((argv, index) => ({
    argv: [...argv],
    argvComplete: true,
    position: index + 1,
    requirementId: requirement(index),
    resolution:
      index < decided
        ? { argvPrefix: [...prefixOf(argv)], kind: 'policyAmendment' }
        : { kind: 'unresolved' },
    suggestedPrefix: { argvPrefix: [...prefixOf(argv)], label: prefixLabel(index) },
    totalStages: STAGE_ARGV.length,
  }))
}

function choices(sourceIndex: number) {
  return [
    { choiceId: 'allow_once', decision: 'approved', label: 'Allow once', scope: 'once' },
    {
      choiceId: 'allow_local_prefix',
      decision: 'approvedPolicyAmendment',
      label: prefixLabel(sourceIndex),
      rulePreview: prefixLabel(sourceIndex),
      scope: 'localPersistent',
    },
    { acceptsFeedback: true, choiceId: 'abort', decision: 'abort', label: 'Reject', scope: 'once' },
  ]
}

/** `approval/requested` for the eight-stage line, waiting on `sourceIndex`. */
export function raceRequested(sessionId: string, sourceIndex = 0): Record<string, unknown> {
  return {
    approvalId: RACE_APPROVAL_ID,
    availableChoices: choices(sourceIndex),
    currentRequirementId: requirement(sourceIndex),
    itemId: RACE_APPROVAL_ID,
    judgeEscalated: false,
    protectedWrite: false,
    rawArgs: JSON.stringify({ command: COMMAND, description: 'repro' }),
    sessionId,
    sourceRange: {},
    subject: { command: COMMAND, kind: 'shell', stages: stages(sourceIndex) },
    taskId: RACE_APPROVAL_ID,
    toolCallId: 'call_1',
    toolName: 'powershell',
    turnId: '01a10056-75de-7001-8cfb-d47e0e296d0b',
    viewCursor: 'v:1',
  }
}

/**
`approval/updated` after stage `resolved - 1` was decided: 1.4.2 moves the
card to `resolved`, the stage after it, even when an "Always allow" just
made would allow it (stage 4 after stage 0's `git show` rule).
*/
export function raceUpdated(sessionId: string, waiting: number): Record<string, unknown> {
  return {
    approvalId: RACE_APPROVAL_ID,
    availableChoices: choices(waiting),
    change: {
      choiceId: 'allow_local_prefix',
      decision: 'approvedPolicyAmendment',
      kind: 'stageResolved',
      requirementId: requirement(waiting - 1),
    },
    currentRequirementId: requirement(waiting),
    sessionId,
    sourceRange: {},
    subject: { command: COMMAND, kind: 'shell', stages: stages(waiting) },
    viewCursor: `v:${String(waiting + 1)}`,
  }
}
