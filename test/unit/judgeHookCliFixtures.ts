import { readFileSync } from 'node:fs'
import type { JudgeOutcome } from '../../src/core/judge/schema'
import { answered } from './judgeCliFixtures'

export const CAUTION = 'Judge caution: existing checks and approvals still apply.'
export const QUESTION = {
  type: 'noul',
  instructions: 'Can this action cause irreversible damage?',
} as const
export const PAYLOAD = {
  hook_event_name: 'PreToolUse',
  tool_name: 'bash',
  tool_input: { command: 'git status' },
  model: 'payload-model-must-not-select',
}

export function riskOutcome(noul = 1, isPartial = false): JudgeOutcome {
  const outcome = answered()
  if (outcome.outcome !== 'answered') throw new Error('fixture')
  const meta = outcome.result.muse['risk']
  if (meta === undefined) throw new Error('fixture')
  return {
    ...outcome,
    result: {
      ...outcome.result,
      answers: { risk: { type: 'noul', noul, probabilities: { true: noul, false: 1 - noul } } },
      muse: { risk: { ...meta, partial: isPartial } },
    },
  }
}

/** A recorded hook payload, as the editor sent it. */
export function capture(file: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/hookFormats/captured/${file}`, import.meta.url), 'utf8'),
  )
}
