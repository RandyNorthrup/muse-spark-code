import type { LaunchConfirmation, TeamLaunchRecord } from './processLifetime'

/** OS adapters return only this projection; environment values never escape their scan. */
export interface OrphanObservation {
  readonly pid: number
  readonly group: string
  readonly startTime: string
  readonly command: string
  readonly launchId: string | undefined
}

export interface OrphanProcess extends OrphanObservation {
  readonly launchId: string
  readonly match: 'matched' | 'uncertain'
}

export interface OrphanRecoveryDriver {
  /** Only processes owned by the current OS user may be returned. */
  scan(launchIds: readonly string[]): Promise<readonly OrphanObservation[]>
  /** Exact current sample immediately before the signal, or undefined if gone. */
  observe(pid: number): Promise<OrphanObservation | undefined>
  signalGroup(group: string): Promise<void>
}

function isSameConfirmation(observation: OrphanObservation, confirmation: LaunchConfirmation) {
  return observation.pid === confirmation.pid && observation.startTime === confirmation.startTime
}

/** Recovery reads foreign records, never mutates their journal, copy, branch or refs. */
export function createOrphanRecovery(driver: OrphanRecoveryDriver) {
  return {
    async find(records: readonly TeamLaunchRecord[]): Promise<readonly OrphanProcess[]> {
      const open = records.filter((record) => record.end?.descendants !== 'proved')
      if (open.length === 0) return []
      const observations = await driver.scan(open.map((record) => record.id))
      const found: OrphanProcess[] = []
      for (const observation of observations) {
        const matched = open.find((record) => record.id === observation.launchId)
        const uncertain = open.find(
          (record) =>
            record.confirmation !== undefined &&
            isSameConfirmation(observation, record.confirmation),
        )
        const record = matched ?? uncertain
        if (record !== undefined) {
          found.push({
            ...observation,
            launchId: record.id,
            match: matched === undefined ? 'uncertain' : 'matched',
          })
        }
      }
      return found
    },
    async stop(
      orphan: OrphanProcess,
      isUserConfirmed: boolean,
    ): Promise<'stopped' | 'changed' | 'kept'> {
      if (!isUserConfirmed) return 'kept'
      const current = await driver.observe(orphan.pid)
      if (
        current?.pid !== orphan.pid ||
        current.group !== orphan.group ||
        current.startTime !== orphan.startTime ||
        (orphan.match === 'matched' && current.launchId !== orphan.launchId)
      )
        return 'changed'
      // PID reuse between this final check and signal remains the documented kill residual.
      await driver.signalGroup(current.group)
      return 'stopped'
    },
  }
}
