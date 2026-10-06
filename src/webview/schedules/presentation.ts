import * as z from 'zod/mini'
import { MILLISECONDS_PER_DAY, UI_TEXT } from '../../shared/constants'
import { fill, uiLocale } from '../../shared/l10n/text'
import {
  scheduleFireRecordSchema,
  type ScheduleFireRecord,
  type ScheduleCreator,
  type ScheduleTarget,
  type ScheduleGrantRule,
} from '../../shared/scheduleV2'

const settlementSchema = z.strictObject({
  type: z.literal('scheduleFire'),
  fire: scheduleFireRecordSchema,
})

export function parseScheduleSettlement(
  output: string,
): { readonly ok: true; readonly fire: ScheduleFireRecord } | { readonly ok: false } {
  try {
    const parsed = settlementSchema.safeParse(JSON.parse(output))
    return parsed.success ? { ok: true, fire: parsed.data.fire } : { ok: false }
  } catch {
    return { ok: false }
  }
}

export function scheduleCreatorText(creator: ScheduleCreator): string {
  return creator.kind === 'user'
    ? UI_TEXT.scheduleV2.editor.user
    : fill(UI_TEXT.scheduleV2.messages.setBy, {
        agent: creator.agentId,
        session: creator.sessionId,
      })
}

export function scheduleTargetText(target: ScheduleTarget): string {
  const label = UI_TEXT.scheduleV2.targets[target.kind]
  switch (target.kind) {
    case 'conversation': {
      return `${label} (${target.sessionId})`
    }
    case 'worker': {
      return `${label} (${target.workerId})`
    }
    case 'role': {
      return `${label} (${target.teamId}/${target.roleId})`
    }
    case 'team': {
      return `${label} (${target.teamId})`
    }
    case 'node': {
      return `${label} (${target.nodeId})`
    }
    case 'newConversation': {
      return label
    }
  }
}

export function scheduleDateTime(atMs: number, zone: string): string {
  return new Intl.DateTimeFormat(uiLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(atMs)
}

export function scheduleWeekdayText(weekday: number): string {
  // 1970-01-04 was Sunday; UTC preserves the label on every machine.
  return new Intl.DateTimeFormat(uiLocale(), { weekday: 'long', timeZone: 'UTC' }).format(
    Date.parse('1970-01-04T00:00:00Z') + weekday * MILLISECONDS_PER_DAY,
  )
}

export function scheduleGrantRuleText(rule: ScheduleGrantRule): string {
  switch (rule.kind) {
    case 'tool': {
      return rule.name
    }
    case 'command': {
      return rule.prefix
    }
    case 'path': {
      return `${rule.access}: ${rule.glob}`
    }
  }
}
