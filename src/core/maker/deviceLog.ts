import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { redactSecrets } from '../../shared/redact'
import { MachineError } from './registry'

export const deviceLogEntrySchema = z.strictObject({
  time: z.number(),
  machine: z.string(),
  action: z.enum(['observe', 'connect', 'program', 'actuate', 'stop']),
  payload: z.string(),
  digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  approval: z.nullable(z.string()),
  outcome: z.enum(['attempt', 'sent', 'sentOutcomeUnknown', 'refused', 'failed', 'stopped']),
})
export type DeviceLogEntry = z.infer<typeof deviceLogEntrySchema>
export interface DeviceLogPolicy {
  readonly maxBytes: number
  readonly maxEntryBytes: number
  readonly now: () => number
  readonly secretValues: () => Promise<readonly string[]>
}
export type DeviceLogInput = Omit<DeviceLogEntry, 'time' | 'digest' | 'payload'> & {
  readonly payload: string | Uint8Array
}
export interface DeviceLogPort {
  append(entry: DeviceLogInput): Promise<void>
}
export function payloadDigest(payload: string | Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex')
}

function isWithinWorkspace(directory: string, workspace: string): boolean {
  const relative = path.relative(workspace, directory)
  return (
    relative === '' ||
    (relative !== '..' && !path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`))
  )
}

/** The host supplies an outside-repository, per-workspace storage directory. */
export class DeviceLog implements DeviceLogPort {
  private pending: Promise<void> = Promise.resolve()
  private readonly file: string
  constructor(
    private readonly directory: string,
    private readonly workspace: string,
    private readonly policy: DeviceLogPolicy,
  ) {
    if (
      !path.isAbsolute(directory) ||
      isWithinWorkspace(path.resolve(directory), path.resolve(workspace))
    )
      throw new MachineError('deviceLogInWorkspace')
    this.file = path.join(directory, 'device-log.jsonl')
  }
  private async checkDirectory(): Promise<void> {
    const resolvedDirectory = await realpath(this.directory)
    const resolvedWorkspace = await realpath(this.workspace)
    if (isWithinWorkspace(resolvedDirectory, resolvedWorkspace))
      throw new MachineError('deviceLogInWorkspace')
    const directoryStat = await lstat(this.directory)
    if (directoryStat.isSymbolicLink()) throw new MachineError('deviceLogSymlink')
  }
  append(entry: DeviceLogInput): Promise<void> {
    const previous = this.pending
    const result = (async () => {
      await previous
      const raw = deviceLogEntrySchema.parse({
        ...entry,
        payload:
          typeof entry.payload === 'string'
            ? entry.payload
            : `hex:${Buffer.from(entry.payload).toString('hex')}`,
        time: this.policy.now(),
        digest: payloadDigest(entry.payload),
      })
      const literals = await this.policy.secretValues()
      const safe = {
        ...raw,
        machine: redactSecrets(raw.machine, literals),
        payload: redactSecrets(raw.payload, [
          ...literals,
          ...literals.map((value) => Buffer.from(value).toString('hex')),
        ]),
        approval: raw.approval === null ? null : redactSecrets(raw.approval, literals),
      }
      const text = `${JSON.stringify(safe)}\n`
      const length = Buffer.byteLength(text)
      if (length > this.policy.maxEntryBytes) throw new MachineError('deviceLogEntrySize')
      await mkdir(this.directory, { recursive: true })
      await this.checkDirectory()
      try {
        const existing = await lstat(this.file)
        if (!existing.isFile() || existing.nlink !== 1) throw new MachineError('deviceLogSymlink')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      const lock = await open(
        `${this.file}.lock`,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        constants.S_IRUSR | constants.S_IWUSR,
      )
      try {
        const handle = await open(
          this.file,
          constants.O_WRONLY |
            constants.O_APPEND |
            constants.O_CREAT |
            constants.O_NOFOLLOW |
            constants.O_NONBLOCK,
          constants.S_IRUSR | constants.S_IWUSR,
        )
        try {
          const before = await handle.stat()
          if (!before.isFile() || before.nlink !== 1) throw new MachineError('deviceLogSymlink')
          if (before.size + length > this.policy.maxBytes) throw new MachineError('deviceLogSize')
          await handle.chmod(constants.S_IRUSR | constants.S_IWUSR)
          await handle.writeFile(text)
          await handle.sync()
        } finally {
          await handle.close()
        }
      } finally {
        await lock.close()
        await unlink(`${this.file}.lock`)
      }
    })()
    this.pending = (async () => {
      await Promise.allSettled([result])
    })()
    return result
  }
  async read(): Promise<readonly DeviceLogEntry[]> {
    await this.pending
    await this.checkDirectory()
    const handle = await open(
      this.file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > this.policy.maxBytes)
        throw new MachineError('deviceLogSize')
      const text = await handle.readFile('utf8')
      return text
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
          const parsed: unknown = JSON.parse(line)
          return deviceLogEntrySchema.parse(parsed)
        })
    } finally {
      await handle.close()
    }
  }
}
