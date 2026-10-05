import type { LaunchConfirmation, TeamLaunchRecord } from './processLifetime'
import { readFile, readdir } from 'node:fs/promises'
import process from 'node:process'
import { runProgram } from '../processTree'
import {
  createProcessOwnership,
  isProcessOwned,
  didSignalLinuxProcess,
  type OwnershipDriver,
} from './processOwnership'

const LAUNCH_MARKER = /(?:^|[\s\0])MUSE_SPARK_LAUNCH_ID=([a-f0-9-]{36})(?=$|[\s\0])/
const PROC_START_FIELD = 19
const MAC_START_FIELDS = 5
const MAC_START_INDEX = 3

/** Real user-owned process scan. Only the marker is projected from environment data. */
export function createNativeOrphanDriver(): OrphanRecoveryDriver {
  const uid = process.getuid?.()
  const macEnvironment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }
  const macProjection = (snapshot: string, launchId?: string): OrphanObservation | undefined => {
    const fields = snapshot.trim().split(/\s+/)
    const group = fields[2]
    if (
      group === undefined ||
      Number(fields[0]) !== uid ||
      fields.length <= MAC_START_INDEX + MAC_START_FIELDS
    )
      return undefined
    return {
      pid: Number(fields[1]),
      group,
      startTime: fields.slice(MAC_START_INDEX, MAC_START_INDEX + MAC_START_FIELDS).join(' '),
      command: fields.slice(MAC_START_INDEX + MAC_START_FIELDS).join(' '),
      launchId,
    }
  }
  const observe = async (pid: number): Promise<OrphanObservation | undefined> => {
    if (!Number.isSafeInteger(pid) || pid <= 1) return undefined
    try {
      if (process.platform === 'linux') {
        const directory = `/proc/${String(pid)}`
        const status = await readFile(`${directory}/status`, 'utf8')
        if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) !== uid) return undefined
        const before = await readFile(`${directory}/stat`, 'utf8')
        const fields = before
          .slice(before.lastIndexOf(')') + 2)
          .trim()
          .split(/\s+/)
        if (fields[0] === 'Z') return undefined
        const environment = await readFile(`${directory}/environ`, 'utf8')
        const commandLine = await readFile(`${directory}/cmdline`, 'utf8')
        const command = commandLine.split('\0', 1)[0] ?? ''
        const bootId = await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
        const boot = bootId.trim()
        // Reject exit/reuse during sampling. This grants no journal ownership.
        const after = await readFile(`${directory}/stat`, 'utf8')
        const later = after
          .slice(after.lastIndexOf(')') + 2)
          .trim()
          .split(/\s+/)
        if (fields[PROC_START_FIELD] !== later[PROC_START_FIELD] || fields[2] !== later[2])
          return undefined
        const group = fields[2]
        if (group === undefined || fields[PROC_START_FIELD] === undefined || !/^\d+$/.test(group))
          return undefined
        return {
          pid,
          group,
          startTime: `${boot}:${fields[PROC_START_FIELD]}`,
          command,
          launchId: LAUNCH_MARKER.exec(environment)?.[1],
        }
      }
      if (process.platform === 'darwin') {
        const args = ['-p', String(pid), '-o', 'uid=,pid=,pgid=,lstart=,comm=']
        const env = macEnvironment
        const sample = await runProgram('/bin/ps', args, env)
        const snapshot = sample.trim()
        const fields = snapshot.split(/\s+/)
        if (Number(fields[0]) !== uid || Number(fields[1]) !== pid) return undefined
        const environment = await runProgram(
          '/bin/ps',
          ['-Eww', '-p', String(pid), '-o', 'command='],
          env,
        )
        const resample = await runProgram('/bin/ps', args, env)
        return resample.trim() === snapshot
          ? macProjection(snapshot, LAUNCH_MARKER.exec(environment)?.[1])
          : undefined
      }
    } catch {
      /* Exit, restricted environment or an unavailable /proc entry is not a match. */
    }
    return undefined
  }
  return {
    observe,
    async scan(launchIds) {
      let pids: number[] = []
      if (process.platform === 'linux') {
        const entries = await readdir('/proc')
        pids = entries.filter((name) => /^\d+$/.test(name)).map(Number)
      } else if (process.platform === 'darwin') {
        const markers = new Map<number, string>()
        const environments = await runProgram(
          '/bin/ps',
          ['-Eww', '-ax', '-o', 'uid=,pid=,command='],
          macEnvironment,
        )
        for (const line of environments.split('\n')) {
          const identity = /^\s*(\d+)\s+(\d+)\s/.exec(line)
          const marker = LAUNCH_MARKER.exec(line)?.[1]
          if (marker !== undefined && Number(identity?.[1]) === uid && launchIds.includes(marker))
            markers.set(Number(identity?.[2]), marker)
        }
        const table = await runProgram(
          '/bin/ps',
          ['-ax', '-o', 'uid=,pid=,pgid=,lstart=,comm='],
          macEnvironment,
        )
        const found: OrphanObservation[] = []
        for (const line of table.split('\n')) {
          const pid = Number(line.trim().split(/\s+/, 2)[1])
          const observation = macProjection(line, markers.get(pid))
          if (observation !== undefined) found.push(observation)
        }
        return found
      }
      const found: OrphanObservation[] = []
      // Serial and bounded by the current process table; environment values never reach a log.
      for (const pid of pids) {
        const observation = await observe(pid)
        if (observation !== undefined) found.push(observation)
      }
      return found
    },
    async signal(identity, signal, isGroup) {
      if (process.platform === 'linux') {
        if (isGroup) throw new Error('TEAM_PIDFD_GROUP_INVALID')
        return await didSignalLinuxProcess(identity, signal)
      }
      const mine = await observe(process.pid)
      if (
        !Number.isSafeInteger(identity.pid) ||
        identity.pid <= 1 ||
        (isGroup && identity.group === mine?.group)
      )
        throw new Error('TEAM_ORPHAN_GROUP_INVALID')
      // Ownership is re-read after the self-group check, immediately before kill.
      if (!(await isProcessOwned(observe, identity))) return false
      process.kill(isGroup ? -identity.pid : identity.pid, signal)
      return true
    },
  }
}

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

export interface OrphanRecoveryDriver extends OwnershipDriver {
  /** Only processes owned by the current OS user may be returned. */
  scan(launchIds: readonly string[]): Promise<readonly OrphanObservation[]>
  /** Exact current sample immediately before the signal, or undefined if gone. */
  observe(pid: number): Promise<OrphanObservation | undefined>
}

function isSameConfirmation(observation: OrphanObservation, confirmation: LaunchConfirmation) {
  return observation.pid === confirmation.pid && observation.startTime === confirmation.startTime
}

/** Recovery reads foreign records, never mutates their journal, copy, branch or refs. */
export function createOrphanRecovery(driver: OrphanRecoveryDriver) {
  const ownership = createProcessOwnership(driver)
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
    ): Promise<
      | 'stopped'
      | 'changed'
      | 'kept'
      | { readonly kind: 'partiallyStopped'; readonly notOwned: readonly number[] }
    > {
      if (!isUserConfirmed) return 'kept'
      const result = await ownership.signal(
        { ...orphan, launchId: orphan.match === 'matched' ? orphan.launchId : undefined },
        'SIGTERM',
      )
      if (!result.signalled.includes(orphan.pid)) return 'changed'
      return result.notOwned.length === 0
        ? 'stopped'
        : { kind: 'partiallyStopped', notOwned: result.notOwned }
    },
  }
}
