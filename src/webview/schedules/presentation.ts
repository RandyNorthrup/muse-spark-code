import { MILLISECONDS_PER_DAY, UI_TEXT } from '../../shared/constants'
import { fill, uiLocale } from '../../shared/l10n/text'
import {
  scheduleTargetSchema,
  type ScheduleCreator,
  type ScheduleTarget,
  type ScheduleGrantRule,
} from '../../shared/scheduleV2'

import type { ScheduleTargetChoice } from './ports'

// The lazy schedule surfaces' text helpers. A restored settlement row's parser
// lives in settlement.ts so chat startup never reaches this module's English.

export function scheduleCreatorText(creator: ScheduleCreator): string {
  return creator.kind === 'user'
    ? UI_TEXT.scheduleV2.editor.user
    : fill(UI_TEXT.scheduleV2.messages.setBy, {
        agent: creator.agentId,
        session: creator.sessionId,
      })
}

export function scheduleTargetText(
  target: ScheduleTarget,
  choices: readonly ScheduleTargetChoice[] = [],
  currentConversationId?: string,
): string {
  const identity = JSON.stringify(scheduleTargetSchema.parse(target))
  const supplied = choices.find(
    (choice) => JSON.stringify(scheduleTargetSchema.parse(choice.target)) === identity,
  )
  let label = supplied?.label ?? UI_TEXT.scheduleV2.targets[target.kind]
  if (target.kind === 'conversation') {
    label = supplied?.label ?? UI_TEXT.scheduleV2.targets.namedConversation
    if (target.sessionId === currentConversationId) label = UI_TEXT.scheduleV2.targets.conversation
  }
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
