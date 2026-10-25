// C-M115-4's production event intake over the real store, the real claim
// files and the real engine: subscribed events enqueue, matured bursts
// drain into the scheduler exactly once across two processes, and bursts
// clear on discard. Manual triggers never travel the intake.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  scheduleEventRunId,
  scheduleEventSchema,
  type ScheduleEvent,
  type ScheduleEventSource,
  type ScheduleHistoryRange,
  type SchedulePollingEventSource,
} from '../../src/shared/scheduleEvents'
import type { ScheduleV2 } from '../../src/shared/scheduleV2'
import { createScheduleStore } from '../../src/core/schedules/store'
import { ScheduleEventEngine } from '../../src/core/schedules/events/engine'
import { createEventClaimStore } from '../../src/core/schedules/events/claimStore'
import { ScheduleEventIntake } from '../../src/core/schedules/events/intake'
import { hostEventHub } from '../../src/core/schedules/events/hostHub'
import { ScheduleEventPrivacy } from '../../src/core/schedules/events/privacy'
import { ScheduleManualSource } from '../../src/core/schedules/events/signals'
import { localGitRefs, ScheduleGitSource } from '../../src/core/schedules/events/git'
import { scheduleStorageHash } from '../../src/core/schedules/store'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { scheduleFixture } from './helpers/scheduleFixtures'
import { fileRoots } from './helpers/tempDirs'

const roots = fileRoots()

// Each case creates schedules and claims events through the real store, a
// journal commit with an fsync apiece: slow disks need more than the
// repository's five-second default.
const DURABLE_COMMITS_TIMEOUT_MS = 30_000

interface IntakeHarness {
  readonly intake: ScheduleEventIntake
  readonly fired: { schedule: ScheduleV2; event: ScheduleEvent; occurrenceMs: number }[]
  readonly reported: unknown[]
  readonly advance: (ms: number) => void
  readonly hub: ReturnType<typeof hostEventHub>
}

function eventTrigger(
  source: string,
  event: ScheduleEvent['kind'],
): Extract<ScheduleV2['trigger'], { kind: 'event' }> {
  return { kind: 'event', source, event, conditions: [] }
}

function agentsJob(id: string): ScheduleV2 {
  return scheduleFixture({
    id,
    workspaceKey: 'workspace-1',
    trigger: eventTrigger('agents', 'turnFinished'),
  })
}

function openIntake(
  root: string,
  fs: ReturnType<typeof createNodeScheduleFs>,
  store: ReturnType<typeof createScheduleStore>,
  sources: readonly ScheduleEventSource[],
  fired: IntakeHarness['fired'],
  reported: unknown[],
  now: () => number,
): ScheduleEventIntake {
  return new ScheduleEventIntake({
    store,
    workspaceKey: 'workspace-1',
    sources,
    engine: new ScheduleEventEngine(
      now,
      createEventClaimStore(fs, 'workspace-1'),
      new ScheduleEventPrivacy(
        [root],
        { mark: (block) => block },
        UI_TEXT.scheduleV2.messages.eventUntrusted,
      ),
    ),
    fire: (schedule, event, occurrenceMs) => {
      fired.push({ schedule, event, occurrenceMs })
      return Promise.resolve()
    },
    now,
    report: (error: unknown) => {
      reported.push(error)
    },
  })
}

async function harness(root: string, schedules: readonly ScheduleV2[]): Promise<IntakeHarness> {
  const workspace = 'workspace-1'
  const fs = createNodeScheduleFs(root)
  const store = createScheduleStore(fs)
  for (const schedule of schedules) await store.create(schedule)
  let nowMs = 1_700_000_000_000
  const fired: IntakeHarness['fired'] = []
  const reported: unknown[] = []
  const hub = hostEventHub(workspace, 'agents', ['turnFinished'])
  const intake = openIntake(
    root,
    fs,
    store,
    [hub, new ScheduleManualSource(workspace, () => nowMs)],
    fired,
    reported,
    () => nowMs,
  )
  return {
    intake,
    fired,
    reported,
    advance: (ms: number) => {
      nowMs += ms
    },
    hub,
  }
}

function turnFinished(runId: string, scheduleId: string): ScheduleEvent {
  return scheduleEventSchema.parse({
    source: 'agents',
    eventKey: `turn:${runId}`,
    kind: 'turnFinished',
    fields: { scheduleId, status: 'ran' },
    observedAt: 1_700_000_000_000,
  })
}

// Subscribed listeners enqueue asynchronously; the claim file's appearance
// is the deterministic signal that the enqueue committed.
async function waitForClaim(root: string, scheduleId: string): Promise<void> {
  const file = path.join(root, 'workspace-1', 'events', `${scheduleStorageHash(scheduleId)}.json`)
  for (let attempt = 0; attempt < 200 && !existsSync(file); attempt += 1) {
    await delay(25)
  }
  if (!existsSync(file)) throw new Error(`no claim for ${scheduleId}`)
}

/** A real polling source over a real directory: a file the poll has not
seen before is a filesChanged event. It stands in for no production
module; it drives the intake's poll loop over real file state. */
class DirectoryPollSource implements SchedulePollingEventSource {
  private seen = new Set<string>()
  readonly id = 'testdir'
  readonly kinds = ['filesChanged'] as const
  constructor(
    private readonly folder: string,
    private readonly now: () => number,
  ) {}
  capability() {
    return { available: true as const }
  }
  history(_range: ScheduleHistoryRange) {
    return Promise.resolve({ available: false as const, reason: 'no history' })
  }
  async poll(_since: number): Promise<readonly ScheduleEvent[]> {
    const { readdirSync } = await import('node:fs')
    const events: ScheduleEvent[] = []
    for (const name of readdirSync(this.folder)) {
      if (this.seen.has(name)) continue
      this.seen.add(name)
      events.push(
        scheduleEventSchema.parse({
          source: this.id,
          eventKey: `file:${name}`,
          kind: 'filesChanged',
          fields: { path: name },
          observedAt: this.now(),
        }),
      )
    }
    return events
  }
}

describe('production event intake', { timeout: DURABLE_COMMITS_TIMEOUT_MS }, () => {
  it('polls a polling source and fires what it finds', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const watched = path.join(root, 'watched')
    await mkdir(watched, { recursive: true })
    const fs = createNodeScheduleFs(root)
    const store = createScheduleStore(fs)
    const job = scheduleFixture({
      id: 'schedule-p',
      workspaceKey: 'workspace-1',
      trigger: eventTrigger('testdir', 'filesChanged'),
    })
    await store.create(job)
    let nowMs = 1_700_000_000_000
    const fired: IntakeHarness['fired'] = []
    const reported: unknown[] = []
    const intake = openIntake(
      root,
      fs,
      store,
      [new DirectoryPollSource(watched, () => nowMs)],
      fired,
      reported,
      () => nowMs,
    )
    try {
      await intake.poll()
      expect(fired).toEqual([])
      await writeFile(path.join(watched, 'arrived.txt'), 'new')
      await intake.poll()
      expect(fired).toEqual([])
      nowMs += 120_000
      await intake.poll()
      expect(fired).toHaveLength(1)
      expect(fired[0]?.schedule.id).toBe('schedule-p')
      expect(fired[0]?.event.fields['path']).toBe('arrived.txt')
      expect(reported).toEqual([])
    } finally {
      intake.close()
    }
  })

  it('fires a subscribed event once after its burst matures', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const job = agentsJob('schedule-b')
    const { intake, fired, reported, advance, hub } = await harness(root, [job])
    try {
      await intake.poll()
      hub.publish(turnFinished('run-1', 'schedule-a'))
      await waitForClaim(root, 'schedule-b')
      // The burst is open but not mature, so this poll drains nothing.
      await intake.poll()
      expect(fired).toEqual([])
      advance(31_000)
      await intake.poll()
      expect(fired).toHaveLength(1)
      expect(fired[0]?.schedule.id).toBe('schedule-b')
      expect(fired[0]?.event.kind).toBe('turnFinished')
      expect(reported).toEqual([])
      // The claim is durable: a later poll never refires the same event.
      advance(120_000)
      await intake.poll()
      expect(fired).toHaveLength(1)
    } finally {
      intake.close()
    }
  })

  it('claims the same deterministic event once across two processes', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const job = agentsJob('schedule-b')
    const first = await harness(root, [job])
    const fs = createNodeScheduleFs(root)
    const store = createScheduleStore(fs)
    let nowMs = 1_700_000_000_000
    const fired: IntakeHarness['fired'] = []
    const secondReported: unknown[] = []
    const second = openIntake(
      root,
      fs,
      store,
      [hostEventHub('workspace-1', 'agents', ['turnFinished'])],
      fired,
      secondReported,
      () => nowMs,
    )
    try {
      await first.intake.poll()
      await second.poll()
      // Both processes observe the same settlement; the shared hub delivers
      // to both subscribers, but the durable claim admits only one.
      first.hub.publish(turnFinished('run-9', 'schedule-a'))
      await waitForClaim(root, 'schedule-b')
      await first.intake.poll()
      await second.poll()
      nowMs += 31_000
      first.advance(31_000)
      await first.intake.poll()
      await second.poll()
      expect(first.fired.length + fired.length).toBe(1)
      expect(secondReported).toEqual([])
    } finally {
      first.intake.close()
      second.close()
    }
  })

  it('clears open bursts on discard', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const job = agentsJob('schedule-b')
    const { intake, fired, advance, hub } = await harness(root, [job])
    try {
      await intake.poll()
      hub.publish(turnFinished('run-2', 'schedule-a'))
      await waitForClaim(root, 'schedule-b')
      await intake.poll()
      await intake.discard('schedule-b')
      advance(120_000)
      await intake.poll()
      expect(fired).toEqual([])
    } finally {
      intake.close()
    }
  })

  it('never fires a schedule on its own settlement', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const job = agentsJob('schedule-b')
    const { intake, fired, advance } = await harness(root, [job])
    try {
      await intake.poll()
      // Awaited directly: the skip-or-enqueue decision is complete before
      // the clock advances, so the assertion cannot pass vacuously.
      await intake.offerPublished(turnFinished('run-3', 'schedule-b'))
      await intake.poll()
      advance(120_000)
      await intake.poll()
      expect(fired).toEqual([])
    } finally {
      intake.close()
    }
  })

  it('never routes manual triggers through the intake', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const job = scheduleFixture({
      id: 'schedule-m',
      workspaceKey: 'workspace-1',
      trigger: eventTrigger('manual', 'manual'),
    })
    const { intake, fired, advance } = await harness(root, [job])
    try {
      await intake.poll()
      advance(120_000)
      await intake.poll()
      expect(fired).toEqual([])
      // No claim file: the manual source is listed, never subscribed or polled.
      await expect(
        readFile(
          path.join(root, 'workspace-1', 'events', `${scheduleStorageHash('schedule-m')}.json`),
          'utf8',
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      intake.close()
    }
  })

  it('reports a failing polling source and still enqueues the others', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    // A .git directory that is not a repository: capability reads
    // available, the read itself fails for real.
    const broken = path.join(root, 'repo')
    await mkdir(path.join(broken, '.git'), { recursive: true })
    const fs = createNodeScheduleFs(root)
    const store = createScheduleStore(fs)
    const job = agentsJob('schedule-b')
    await store.create(job)
    const reported: unknown[] = []
    const fired: IntakeHarness['fired'] = []
    const hub = hostEventHub('workspace-1', 'agents', ['turnFinished'])
    const git = new ScheduleGitSource(
      localGitRefs(broken, () => true),
      () => 1_700_000_000_000,
    )
    let nowMs = 1_700_000_000_000
    const intake = openIntake(root, fs, store, [git, hub], fired, reported, () => nowMs)
    try {
      await intake.poll()
      hub.publish(turnFinished('run-4', 'schedule-a'))
      await waitForClaim(root, 'schedule-b')
      await intake.poll()
      expect(reported.length).toBeGreaterThan(0)
      expect(fired).toEqual([])
      // The hub's event enqueued despite the git failure: it fires matured.
      nowMs += 120_000
      await intake.poll()
      expect(fired).toHaveLength(1)
      expect(fired[0]?.event.kind).toBe('turnFinished')
    } finally {
      intake.close()
    }
  })

  it('drops a drained burst when its schedule is gone', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const job = agentsJob('schedule-gone')
    const { intake, fired, advance, hub } = await harness(root, [job])
    try {
      await intake.poll()
      hub.publish(turnFinished('run-5', 'schedule-a'))
      await waitForClaim(root, 'schedule-gone')
      await intake.poll()
      const fs = createNodeScheduleFs(root)
      await createScheduleStore(fs).remove('workspace-1', 'schedule-gone')
      advance(120_000)
      await intake.poll()
      expect(fired).toEqual([])
    } finally {
      intake.close()
    }
  })
})

describe('durable event claims', () => {
  it('persists receipts across instances and lists claimed schedules', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const first = createEventClaimStore(createNodeScheduleFs(root), 'workspace-1')
    const isAdmitted = await first.transact('schedule-1', (state) => {
      state.receipts.add(scheduleEventRunId('schedule-1', { source: 'git', eventKey: 'abc' }))
      return true
    })
    expect(isAdmitted).toBe(true)
    await first.transact('schedule-2', () => 'ok')
    const second = createEventClaimStore(createNodeScheduleFs(root), 'workspace-1')
    expect(await second.schedules()).toEqual(expect.arrayContaining(['schedule-1', 'schedule-2']))
    const isSeen = await second.transact('schedule-1', (state) =>
      state.receipts.has(scheduleEventRunId('schedule-1', { source: 'git', eventKey: 'abc' })),
    )
    expect(isSeen).toBe(true)
  })

  it('refuses a corrupt claim file instead of firing from it', async () => {
    const root = await roots.fresh('schedule-event-intake-')
    const claims = createEventClaimStore(createNodeScheduleFs(root), 'workspace-1')
    await claims.transact('schedule-1', () => 'ok')
    await mkdir(path.join(root, 'workspace-1', 'events'), { recursive: true })
    await writeFile(
      path.join(root, 'workspace-1', 'events', `${scheduleStorageHash('schedule-1')}.json`),
      '{not json',
    )
    await expect(claims.transact('schedule-1', () => 'ok')).rejects.toThrow(
      'scheduleStoredJsonInvalid',
    )
  })
})
