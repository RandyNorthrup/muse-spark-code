// Durable, workspace-local Model API schedules (PLAN.md M52). Each job is a
// file in VS Code's workspace storage. An occurrence is admitted by creating
// its receipt with `wx`: two windows cannot admit the same fire. A receipt is
// never rolled back after admission, so a crash cannot silently replay a
// possibly billed request.

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { SCHEDULE_CLAIM_RETENTION_MS } from '../../shared/constants'
import {
  scheduledPromptSchema,
  type ScheduledPrompt,
  type ScheduleStore,
} from '../../shared/schedule'
import type { Logger } from '../logger'
import { describeStoreError, storeErrorCode } from './storeErrors'

export interface FileScheduleStoreDeps {
  readonly directory: string
  readonly now: () => number
  readonly log: Logger
}

const JOB_FILE = '.json'
const CLAIM_FILE = '.claim'
const ID = /^[A-Za-z0-9_-]+$/
const ENOENT = 'ENOENT'
const EEXIST = 'EEXIST'
const receiptSchema = z.object({ admittedAtMs: z.number() })

function assertId(id: string): void {
  if (!ID.test(id)) {
    throw new Error('A schedule identifier cannot name a file')
  }
}

function claimName(id: string, occurrenceMs: number): string {
  assertId(id)
  if (!Number.isSafeInteger(occurrenceMs) || occurrenceMs < 0) {
    throw new Error('A schedule occurrence must be a positive epoch millisecond')
  }
  return `${id}.${String(occurrenceMs)}${CLAIM_FILE}`
}

export function createFileScheduleStore(deps: FileScheduleStoreDeps): ScheduleStore {
  const jobPath = (id: string) => {
    assertId(id)
    return path.join(deps.directory, `${id}${JOB_FILE}`)
  }
  const receiptPath = (id: string, occurrenceMs: number) =>
    path.join(deps.directory, claimName(id, occurrenceMs))

  const readJob = async (id: string): Promise<ScheduledPrompt | undefined> => {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(jobPath(id), 'utf8'))
    } catch (error: unknown) {
      if (storeErrorCode(error) !== ENOENT) {
        deps.log.warn(`Schedule ${id} skipped: ${describeStoreError(error)}`)
      }
      return undefined
    }
    const parsed = scheduledPromptSchema.safeParse(raw)
    if (!parsed.success || parsed.data.id !== id) {
      deps.log.warn(`Schedule ${id} skipped: invalid stored shape`)
      return undefined
    }
    return parsed.data
  }

  const receiptsFor = async (
    job: ScheduledPrompt,
    names: readonly string[],
  ): Promise<readonly { readonly occurrenceMs: number; readonly admittedAtMs: number }[]> => {
    const result: { occurrenceMs: number; admittedAtMs: number }[] = []
    for (const name of names) {
      if (!name.startsWith(`${job.id}.`) || !name.endsWith(CLAIM_FILE)) {
        continue
      }
      const occurrenceMs = Number(name.slice(job.id.length + 1, -CLAIM_FILE.length))
      if (!Number.isSafeInteger(occurrenceMs) || occurrenceMs < job.nextFireAtMs) {
        continue
      }
      const file = path.join(deps.directory, name)
      let admittedAtMs: number
      try {
        const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
        const parsed = receiptSchema.safeParse(raw)
        if (parsed.success) {
          admittedAtMs = parsed.data.admittedAtMs
        } else {
          const fileStat = await stat(file)
          admittedAtMs = fileStat.mtimeMs
        }
      } catch {
        // A receipt created before a crash still means admitted, never retry.
        const fileStat = await stat(file)
        admittedAtMs = fileStat.mtimeMs
      }
      result.push({ occurrenceMs, admittedAtMs: Math.max(occurrenceMs, admittedAtMs) })
    }
    return result
  }

  const currentJob = async (
    job: ScheduledPrompt,
    names: readonly string[],
  ): Promise<ScheduledPrompt | undefined> => {
    const receipts = await receiptsFor(job, names)
    const last = receipts.toSorted((a, b) => b.admittedAtMs - a.admittedAtMs)[0]
    const schedules =
      last === undefined
        ? undefined
        : await import('../../core/backends/modelapi/schedulesEntry.js')
    const nextFireAtMs =
      last === undefined
        ? job.nextFireAtMs
        : schedules?.nextScheduleFire(
            job.cadence,
            Math.max(last.occurrenceMs, last.admittedAtMs),
            job.expiresAtMs,
          )
    if (nextFireAtMs === undefined) {
      return undefined
    }
    return {
      ...job,
      nextFireAtMs,
      fireCount: receipts.length,
      ...(last !== undefined && { lastFireAtMs: last.occurrenceMs }),
    }
  }

  const readNames = async (): Promise<readonly string[]> => {
    try {
      return await readdir(deps.directory)
    } catch (error: unknown) {
      if (storeErrorCode(error) === ENOENT) {
        return []
      }
      throw error
    }
  }

  const listJobs: ScheduleStore['list'] = async (sessionId) => {
    const names = await readNames()
    const now = deps.now()
    const jobs: ScheduledPrompt[] = []
    for (const name of names) {
      if (name.endsWith(CLAIM_FILE)) {
        const file = path.join(deps.directory, name)
        try {
          const fileStat = await stat(file)
          if (now - fileStat.mtimeMs > SCHEDULE_CLAIM_RETENTION_MS) {
            await rm(file, { force: true })
          }
        } catch (error: unknown) {
          if (storeErrorCode(error) !== ENOENT) {
            deps.log.warn(`Schedule receipt ${name} cleanup failed: ${describeStoreError(error)}`)
          }
        }
        continue
      }
      if (!name.endsWith(JOB_FILE)) {
        continue
      }
      const id = name.slice(0, -JOB_FILE.length)
      if (!ID.test(id)) {
        continue
      }
      const stored = await readJob(id)
      if (stored === undefined) {
        continue
      }
      if (stored.expiresAtMs <= now || stored.nextFireAtMs >= stored.expiresAtMs) {
        await rm(jobPath(id), { force: true })
        continue
      }
      if (stored.sessionId !== sessionId) {
        continue
      }
      const job = await currentJob(stored, names)
      if (job !== undefined) {
        jobs.push(job)
      }
    }
    return jobs.toSorted((a, b) => a.nextFireAtMs - b.nextFireAtMs)
  }

  return {
    async create(job) {
      const parsed = scheduledPromptSchema.safeParse(job)
      if (!parsed.success || job.id !== parsed.data.id) {
        throw new Error('Invalid scheduled prompt')
      }
      await mkdir(deps.directory, { recursive: true })
      // UUID ids are unique; `wx` also refuses a collision across windows.
      await writeFile(jobPath(job.id), JSON.stringify(job), { flag: 'wx' })
    },
    list: listJobs,
    async remove(sessionId, jobId) {
      const job = await readJob(jobId)
      if (job?.sessionId !== sessionId) {
        return false
      }
      await rm(jobPath(jobId), { force: true })
      return true
    },
    async claim(job, occurrenceMs) {
      const jobs = await listJobs(job.sessionId)
      const current = jobs.find((entry) => entry.id === job.id)
      if (
        current?.workspaceRoot !== job.workspaceRoot ||
        current.accountId !== job.accountId ||
        current.prompt !== job.prompt ||
        current.nextFireAtMs !== occurrenceMs ||
        occurrenceMs > deps.now()
      ) {
        return false
      }
      const receipt = receiptPath(job.id, occurrenceMs)
      try {
        await writeFile(receipt, JSON.stringify({ admittedAtMs: deps.now() }), { flag: 'wx' })
      } catch (error: unknown) {
        if (storeErrorCode(error) === EEXIST) {
          return false
        }
        throw error
      }
      // If cancellation won before admission finished, refuse this run.
      const stillStored = await readJob(job.id)
      return (
        stillStored?.sessionId === job.sessionId &&
        stillStored.workspaceRoot === job.workspaceRoot &&
        stillStored.accountId === job.accountId &&
        stillStored.prompt === job.prompt &&
        deps.now() < stillStored.expiresAtMs
      )
    },
  }
}
