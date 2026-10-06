import { UI_TEXT } from '../../shared/constants'
import { fill, uiLocale } from '../../shared/l10n/text'
import type { ScheduleCreator, ScheduleTarget, ScheduleGrantRule } from '../../shared/scheduleV2'

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
