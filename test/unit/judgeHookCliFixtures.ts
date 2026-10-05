import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import type { JudgeOutcome } from '../../src/core/judge/schema'
import type { JudgeCliSource } from '../../src/runtime/judge/commands'
import {
  runJudgeHookCommand,
  type JudgeHookCliDeps,
  type JudgeHookCliSettings,
} from '../../src/runtime/judge/hook'
import { runJudgeCommand } from '../../src/runtime/judge/commands'
import { answered, command, io, source } from './judgeCliFixtures'

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

export function hookDeps(selected?: JudgeCliSource): JudgeHookCliDeps {
  const fake = source()
  fake.judge.mockResolvedValue(riskOutcome())
  return {
    runAsk: runJudgeCommand,
    question: QUESTION,
    cautionText: () => CAUTION,
    resolveSource: vi.fn(() => Promise.resolve(selected ?? fake.value)),
  }
}

export function capture(file: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/hookFormats/captured/${file}`, import.meta.url), 'utf8'),
  )
}

const MUSE_SETTINGS = { format: 'muse' } as const

export async function invoke(
  payload: unknown = PAYLOAD,
  settings: JudgeHookCliSettings = MUSE_SETTINGS,
  deps = hookDeps(),
  options = command().options,
  signal?: AbortSignal,
) {
  const streams = io(JSON.stringify(payload))
  const code = await runJudgeHookCommand(options, settings, streams, deps, signal)
  return { ...streams, code, deps }
}
