import { createHash } from 'node:crypto'
import { PLAYBOOK_LAUNDER_WINDOW_MS } from '../../../shared/constants'
import type {
  PlaybookAction,
  PlaybookCommand,
  PlaybookRecord,
  PlaybookWhyNote,
} from '../../../shared/playbook'

/** Hash only normalized effect/subject, never shell text. A different agent,
 * team or tool spelling cannot change a recorded refusal's identity. */
export function actionIdentity(action: PlaybookAction): string {
  return createHash('sha256')
    .update(JSON.stringify([action.effect.trim(), action.subject.trim()]))
    .digest('hex')
}

export function commandBlock(
  command: PlaybookCommand,
  records: readonly PlaybookRecord[],
  at: number,
): PlaybookWhyNote['code'] | undefined {
  if (command.kind === 'gate' && command.skip) return 'gateSkipped'
  if (
    command.kind === 'edit' &&
    command.paths.some((path) => /(?:^|[/\\])\.husky(?:[/\\]|$)/iu.test(path))
  )
    return 'hookTampering'
  if (command.kind === 'shell') {
    const text = command.command.replaceAll(/["']/gu, '')
    if (
      /--no-verify\b|core\.hookspath\b|(?:^|[/\\\s])\.husky(?:[/\\]|\s|$)|\bHUSKY(?:_SKIP_HOOKS)?\s*=\s*(?:0|1)\b/iu.test(
        text,
      )
    )
      return 'hookTampering'
    if (/--skip-(?:checks|gates)\b/iu.test(text)) return 'gateSkipped'
  }
  const identity = actionIdentity(command)
  const refusals = records.filter(
    (record) =>
      record.kind === 'note' &&
      record.value.rule === 'neverAround' &&
      record.value.actor !== undefined &&
      record.value.module === identity,
  )
  if (
    refusals.some((record) => record.kind === 'note' && record.value.code === 'classifierBlocked')
  )
    return 'classifierBlocked'
  return refusals.some(
    (record) =>
      record.kind === 'note' &&
      ['permissionLaundering', 'hookTampering', 'gateSkipped'].includes(record.value.code) &&
      at - record.value.at < PLAYBOOK_LAUNDER_WINDOW_MS,
  )
    ? 'permissionLaundering'
    : undefined
}
