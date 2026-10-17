// Local scheduled prompts for the Model API backend (PLAN.md M52). Parsing and
// next-fire calculation are pure. The host owns persistence and admission;
// nothing in this module sends a model request.

import {
  HOURS_PER_DAY,
  MILLISECONDS_PER_DAY,
  MINUTES_PER_HOUR,
  SCHEDULE_DEFAULT_INTERVAL_MS,
  SCHEDULE_MAX_INTERVAL_MS,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_MIN_INTERVAL_MS,
} from '../../../shared/constants'
import type { ScheduleCadence } from '../../../shared/schedule'
import { nextCronFire, parseCron } from '../../schedules/time/cron'

export type LoopCommand =
  | { readonly verb: 'create'; readonly cadence: ScheduleCadence; readonly prompt: string }
  | { readonly verb: 'list' }
  | { readonly verb: 'cancel'; readonly id: string }

export type LoopParseResult =
  | { readonly ok: true; readonly command: LoopCommand }
  | { readonly ok: false; readonly reason: 'empty' | 'badCadence' | 'badPrompt' | 'badId' }

const LOOP_PREFIX = /^\/loop(?:\s+([\s\S]*))?$/i
const INTERVAL = /^(\d+)([mhd])$/i
const QUOTED_CRON = /^"([^"]+)"(?:\s+([\s\S]*))?$/
const FIRST_WORD = /^(\S+)(?:\s+([\s\S]*))?$/
const JOB_ID = /^[A-Za-z0-9_-]+$/
const MINUTE_MS = MILLISECONDS_PER_DAY / (HOURS_PER_DAY * MINUTES_PER_HOUR)
const HOUR_MS = MILLISECONDS_PER_DAY / HOURS_PER_DAY
const INTERVAL_UNITS: Readonly<Record<string, number>> = {
  m: MINUTE_MS,
  h: HOUR_MS,
  d: MILLISECONDS_PER_DAY,
}

/** Returns next eligible occurrence; no backlog or replay of missed intervals. */
export function nextScheduleFire(
  cadence: ScheduleCadence,
  afterMs: number,
  expiresAtMs: number,
): number | undefined {
  if (cadence.kind === 'cron') {
    return nextCronFire(cadence.expression, afterMs, expiresAtMs)
  }
  const next = afterMs + cadence.everyMs
  return next < expiresAtMs ? next : undefined
}

/** A local `/loop` command; undefined when the text is an ordinary prompt. */
export function parseLoopPrompt(text: string): LoopParseResult | undefined {
  const match = LOOP_PREFIX.exec(text.trim())
  if (match === null) {
    return undefined
  }
  const body = (match[1] ?? '').trim()
  if (body === '') {
    return { ok: false, reason: 'empty' }
  }
  if (body.toLowerCase() === 'list') {
    return { ok: true, command: { verb: 'list' } }
  }
  if (/^cancel(?:\s|$)/i.test(body)) {
    const id = body.slice('cancel'.length).trim()
    return JOB_ID.test(id)
      ? { ok: true, command: { verb: 'cancel', id } }
      : { ok: false, reason: 'badId' }
  }
  const quoted = QUOTED_CRON.exec(body)
  if (quoted === null && body.startsWith('"')) {
    return { ok: false, reason: 'badCadence' }
  }
  const words = FIRST_WORD.exec(body)
  const interval = words === null ? null : INTERVAL.exec(words[1] ?? '')
  let cadence: ScheduleCadence
  let prompt: string
  if (quoted !== null) {
    cadence = { kind: 'cron', expression: quoted[1] ?? '' }
    prompt = (quoted[2] ?? '').trim()
    if (parseCron(cadence.expression) === undefined) {
      return { ok: false, reason: 'badCadence' }
    }
  } else if (interval === null) {
    cadence = { kind: 'interval', everyMs: SCHEDULE_DEFAULT_INTERVAL_MS }
    prompt = body
  } else {
    const unit = INTERVAL_UNITS[(interval[2] ?? '').toLowerCase()]
    const everyMs = Number(interval[1]) * (unit ?? 0)
    if (
      !Number.isSafeInteger(everyMs) ||
      everyMs < SCHEDULE_MIN_INTERVAL_MS ||
      everyMs > SCHEDULE_MAX_INTERVAL_MS
    ) {
      return { ok: false, reason: 'badCadence' }
    }
    cadence = { kind: 'interval', everyMs }
    prompt = (words?.[2] ?? '').trim()
  }
  return prompt === '' || prompt.length > SCHEDULE_MAX_PROMPT_CHARS
    ? { ok: false, reason: 'badPrompt' }
    : { ok: true, command: { verb: 'create', cadence, prompt } }
}
