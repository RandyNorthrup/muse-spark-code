// RLF-SAFEFIX item 2 (D121, RVINT5 P3): a failed deferred schedule event
// retries with capped exponential backoff, at most 5 fire attempts, then
// stops and says why in the host record. The real engine over the real
// store on a real filesystem, with a controlled clock and no delivery
// binding. The failure is a corrupted workspace index (the journal's own
// scheduleStoredJsonInvalid), written through the real fs port, so the
// fire throws while loading, before any hold or dispatch. Rows written
// before the bound carry no count and read as a first attempt. One engine
// serves both cases from two workspaces, so setup and close run once.
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import type { CoreLogger } from '../../src/core/logging'
import type { ScheduleFsPort } from '../../src/core/schedules/journal'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { scheduleEventSchema } from '../../src/shared/scheduleEvents'
import { scheduleV2Schema } from '../../src/shared/scheduleV2'
import { scheduleFixture } from './helpers/reporting/reportKindFixtures'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

const silentLog: CoreLogger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const deferredRowSchema = z.object({
  dueMs: z.number(),
  failures: z.optional(z.number()),
})
const deferredFileReader = z.array(deferredRowSchema)

interface RetryShared {
  readonly engine: Awaited<ReturnType<typeof createScheduleEngine>>
  readonly fs: ScheduleFsPort
  readonly root: string
  readonly reported: readonly unknown[]
  setNow(value: number): void
  readDeferred(): Promise<z.infer<typeof deferredFileReader>>
}

const sharedBox: { current?: RetryShared | undefined } = {}

function useShared(): RetryShared {
  if (sharedBox.current === undefined) throw new Error('expected the retry engine')
  return sharedBox.current
}

function onlyRow(rows: z.infer<typeof deferredFileReader>): z.infer<typeof deferredRowSchema> {
  expect(rows).toHaveLength(1)
  const row = rows[0]
  if (row === undefined) throw new Error('expected the deferred row')
  return row
}

function reportedTexts(reported: readonly unknown[]): readonly string[] {
  return reported.map((error) => (error instanceof Error ? error.message : String(error)))
}

/** The workspace index snapshot, wherever this store generation keeps it. */
async function indexSnapshot(fs: ScheduleFsPort, workspace: string): Promise<string> {
  const entries = await fs.names(`${workspace}/index`)
  for (const name of entries) {
    const candidate = `${workspace}/index/${name}/state.json`
    try {
      if ((await fs.read(candidate)) !== undefined) return candidate
    } catch {
      continue // Not a generation folder (the pointer hint is a file).
    }
  }
  throw new Error('expected the index snapshot')
}

/** Corrupts a workspace index through the real port and defers one event row for it. */
async function corruptIndexAndDefer(
  context: RetryShared,
  scheduleId: string,
  failures?: number,
): Promise<void> {
  const { fs } = context
  const workspace = workspaceKey(path.resolve(path.join(context.root, scheduleId)))
  const event = scheduleEventSchema.parse({
    source: 'agents',
    eventKey: 'turn:probe',
    kind: 'turnFinished',
    fields: {},
    observedAt: 999_000,
  })
  await fs.replace(await indexSnapshot(fs, workspace), 'not json{{{', undefined)
  const row = { workspaceKey: workspace, scheduleId, event, dueMs: 999_000 }
  await fs.replace(
    'runtime/deferred-events.json',
    JSON.stringify([failures === undefined ? row : { ...row, failures }]),
    undefined,
  )
}

// The backoff waits: the base minute doubling per failure, capped at eight.
const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000]

describe('deferred event retry', () => {
  beforeAll(async () => {
    const root = await temporaryDir('schedules-deferred-retry-')
    const fs = createNodeScheduleFs(root)
    const queue = createNodeScheduleQueue(root)
    let nowMs = 1_000_000
    const reported: unknown[] = []
    const engine = await createScheduleEngine({
      log: silentLog,
      fs,
      queue,
      now: () => nowMs,
      onError: (error: unknown) => {
        reported.push(error)
      },
    })
    for (const id of ['sched-deferred-a', 'sched-deferred-b']) {
      const job = scheduleV2Schema.parse(
        scheduleFixture(workspaceKey(path.resolve(path.join(root, id))), {
          id,
          trigger: { kind: 'event', source: 'agents', event: 'turnFinished', conditions: [] },
        }),
      )
      await engine.store.create(job)
    }
    sharedBox.current = {
      engine,
      fs,
      root,
      reported,
      setNow: (value: number) => {
        nowMs = value
      },
      readDeferred: async () => {
        const raw = await fs.read('runtime/deferred-events.json')
        return raw === undefined ? [] : deferredFileReader.parse(JSON.parse(raw))
      },
    }
  })

  afterAll(async () => {
    const current = sharedBox.current
    sharedBox.current = undefined
    if (current === undefined) return
    try {
      await current.engine.runtime.close()
    } finally {
      await removeFolder(current.root)
    }
  })

  it('retries with capped backoff, then stops and says why', async () => {
    const context = useShared()
    const { engine } = context
    // A row written before the bound: no failure count.
    await corruptIndexAndDefer(context, 'sched-deferred-a')
    const reportedBefore = context.reported.length
    // Five attempts: four requeues with doubling waits, then the drop.
    let current = onlyRow(await context.readDeferred())
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const atMs = current.dueMs + 1
      context.setNow(atMs)
      await engine.scanDeferred()
      const after = await context.readDeferred()
      if (attempt < 5) {
        current = onlyRow(after)
        expect(current.failures).toBe(attempt)
        const expectedDelay = RETRY_DELAYS_MS[attempt - 1]
        if (expectedDelay === undefined) throw new Error('expected the backoff delay')
        expect(current.dueMs - atMs).toBe(expectedDelay)
      } else {
        expect(after).toHaveLength(0)
      }
    }
    // Every failure reached the host record, and so did the give-up sentence.
    expect(context.reported.length - reportedBefore).toBe(6)
    const sentence = reportedTexts(context.reported).find((text) =>
      text.includes('will not run again'),
    )
    expect(sentence).toContain('sched-deferred-a')
    expect(sentence).toContain('failed 5 times')
  })

  it('resumes the count from a persisted row', async () => {
    const context = useShared()
    const { engine } = context
    await corruptIndexAndDefer(context, 'sched-deferred-b', 4)
    const reportedBefore = context.reported.length
    const row = onlyRow(await context.readDeferred())
    context.setNow(row.dueMs + 1)
    await engine.scanDeferred()
    expect(await context.readDeferred()).toHaveLength(0)
    expect(context.reported.length - reportedBefore).toBe(2)
    const texts = reportedTexts(context.reported.slice(reportedBefore))
    expect(texts.some((text) => text.includes('failed 5 times'))).toBe(true)
    expect(texts.some((text) => text.includes('sched-deferred-b'))).toBe(true)
  })
})
