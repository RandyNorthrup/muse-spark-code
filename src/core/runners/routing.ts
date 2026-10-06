import type { ResourceLevel, ResourceSettings } from '../../shared/resources'

export interface ResourceRunnerRouting<T> {
  level: ResourceLevel
  relocation: ResourceSettings['relocate']
  queued: boolean
  keepHere: boolean
  /** M96c's approved, matching SSH runners only; this port confers no new authority. */
  approvedRunner(): T | undefined
}

/** A routing proposal only. R owns confirmation, admission, rows and dispatch. */
export function resourceRunnerPreference<T>(routing: ResourceRunnerRouting<T>) {
  if (
    !routing.queued ||
    routing.keepHere ||
    routing.relocation === 'off' ||
    (routing.level !== 'relocate' && routing.level !== 'pause')
  )
    return
  const runner = routing.approvedRunner()
  if (runner === undefined) return
  return {
    runner,
    level: routing.level,
    reason: 'machineBusy' as const,
    requiresConfirmation: routing.relocation === 'ask',
  }
}
