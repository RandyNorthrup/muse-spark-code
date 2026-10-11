import type { ItemSnapshot, TodoItem } from '../../shared/agentEvents'
import type { AgentEvidence } from '../../shared/agentEvidence'
import { agentCommandOf } from '../../shared/agentReceipt'
import { AGENT_CHECK_COMMAND_WORDS } from '../../shared/constants'

function isCheckCommand(command: string): boolean {
  const [runner, verb, script] = command.trim().split(/\s+/, AGENT_CHECK_COMMAND_WORDS)
  return runner === 'npm' || runner === 'npm.cmd'
    ? verb === 'test' ||
        (verb === 'run' &&
          script !== undefined &&
          ['test', 'check', 'lint', 'typecheck', 'quality'].some(
            (prefix) => script === prefix || script.startsWith(`${prefix}:`),
          ))
    : (runner === 'npx' || runner === 'npx.cmd') &&
        ['vitest', 'tsc', 'eslint', 'prettier'].includes(verb ?? '')
}

/** Owned harness evidence; no attempt to interpret an assistant's prose. */
export function finishedAgentEvidence(
  items: readonly ItemSnapshot[],
  todos: readonly TodoItem[],
  stopReason: NonNullable<AgentEvidence['stopReason']>,
  requiredChecks: readonly { readonly name: string; readonly command: string }[],
): AgentEvidence {
  const last = new Map<string, NonNullable<AgentEvidence['finalCheck']>>()
  const record = (name: string, outcome: string | undefined, exitCode: number | undefined) => {
    const command = requiredChecks.find((check) => check.name === name)?.command ?? name.trim()
    let result: NonNullable<AgentEvidence['finalCheck']> = 'unknown'
    if (
      outcome === 'failed' ||
      outcome === 'timedOut' ||
      (exitCode !== undefined && exitCode !== 0)
    )
      result = 'failed'
    else if (outcome === 'notRun') result = 'missing'
    else if (outcome === 'passed' || exitCode === 0) result = 'passed'
    last.set(command, result)
  }
  // Classification never uses the size-capped display receipt: older failures matter.
  for (const item of items) {
    const command = agentCommandOf(item)
    if (
      command !== undefined &&
      (isCheckCommand(command) || requiredChecks.some((check) => check.command === command.trim()))
    )
      record(command, undefined, item.exitCode)
    if (item.thenRun !== undefined)
      record(item.thenRun.command, item.thenRun.outcome, item.thenRun.exitCode)
    const verified = item.verifySummary?.checks ?? []
    for (const check of verified) record(check.name, check.outcome, undefined)
  }
  const checks = new Set(last.values())
  const unfinished = todos.filter((todo) => todo.status !== 'completed').map((todo) => todo.text)
  const isMissing = requiredChecks.some((check) => !last.has(check.command))
  let finalCheck: NonNullable<AgentEvidence['finalCheck']> = 'passed'
  if (checks.has('failed')) finalCheck = 'failed'
  else if (isMissing || checks.has('missing')) finalCheck = 'missing'
  else if (checks.has('unknown')) finalCheck = 'unknown'
  return {
    stopReason,
    // A structured task list is the owned harness's completion declaration.
    ...(todos.length > 0 && { reportedComplete: unfinished.length === 0 }),
    unfinished,
    worktree: 'shared',
    checksRequired: requiredChecks.length > 0,
    finalCheck,
  }
}
