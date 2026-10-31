// The team's native process lifetime on POSIX (RLF-TEAMWORKERS): real child
// processes launched through `startNativeTeamLifetime`, a real journal in a
// temporary folder, the real `/bin/ps` identity probes. Nothing stands in for
// the driver, the journal or the processes: a launch is confirmed by the OS
// identity of the child it started, recorded before the command runs,
// retired on request and on dispose, and a second window finds the first
// window's live child as an orphan it will not touch without the person.
// The Windows leg of the same contract is the hosted CI's (a job object needs
// the C# helper the Windows runner compiles).
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { afterAll, describe, expect, it } from 'vitest'
import { startNativeTeamLifetime } from '../../src/host/team/processLifetime'
import { createTeamJournal } from '../../src/host/team/teamJournal'
import { createWindowAuthority, createWindowIdentity } from '../../src/host/team/windowIdentity'
import { HOOK_CONFIG_MAX_BYTES } from '../../src/shared/constants'
import { isProcessAlive } from './helpers/teamRealRig'

// A genuinely long operation: the first launch runs the OS identity probes
// (`ps`, and on Linux the scope probes) before and after each child starts.
const LAUNCH_TEST_TIMEOUT_MS = 30_000

const roots: string[] = []
const lifetimes: { dispose: () => Promise<unknown> }[] = []

afterAll(async () => {
  for (const lifetime of lifetimes.splice(0)) await lifetime.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function scratch(): Promise<{ storage: string; workspace: string }> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-team-lifetime-')))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  return { storage: path.join(root, 'storage'), workspace }
}

function journalFor(storage: string, startedAt: number) {
  const identity = createWindowIdentity(startedAt)
  const authority = createWindowAuthority(identity, () => Promise.resolve())
  return createTeamJournal({
    storageDirectory: storage,
    authority,
    owner: identity,
    maxRecordBytes: HOOK_CONFIG_MAX_BYTES,
    platform: process.platform,
  })
}

/** A child that says it is ready, then waits on its input until it is stopped. */
const READY_CHILD = [String.raw`process.stdout.write('ready\n')`, 'process.stdin.resume()'].join(
  ';',
)

async function untilGone(pid: number): Promise<void> {
  await expect.poll(() => isProcessAlive(pid), { timeout: 4000 }).toBe(false)
}

async function firstLine(stream: NodeJS.ReadableStream): Promise<string> {
  for await (const chunk of stream) return String(chunk)
  return ''
}

const launchRecord = z.looseObject({
  id: z.string(),
  command: z.string(),
  cwd: z.string(),
  taskId: z.string(),
  confirmation: z.optional(z.looseObject({ pid: z.number(), container: z.string() })),
  end: z.optional(z.looseObject({ childExited: z.boolean(), descendants: z.string() })),
})

describe.skipIf(process.platform === 'win32')(
  'the team process lifetime over real processes (POSIX)',
  () => {
    it(
      'records the launch before it runs, confirms the OS identity, and retires the child on request',
      async () => {
        const { storage, workspace } = await scratch()
        const journal = journalFor(storage, Date.now())
        const started = await startNativeTeamLifetime({
          journal,
          isHostBusy: () => false,
          killGraceMs: 1000,
        })
        lifetimes.push(started.lifetime)
        const contained = await started.lifetime.launch({
          command: process.execPath,
          args: ['-e', READY_CHILD],
          cwd: workspace,
          taskId: 'task-a',
          env: { PATH: process.env['PATH'] },
          priority: 'belowNormal',
        })
        expect(await firstLine(contained.child.stdout)).toBe('ready\n')
        const confirmation = await contained.confirmation
        expect(confirmation.pid).toBe(contained.child.pid)
        expect(confirmation.startTime).not.toBe('')
        // No container of a POSIX window ever claims proved descendants through a bare group.
        expect(['linuxScope', 'processGroup']).toContain(confirmation.container)

        const saved = await journal.read(`launch-${contained.launchId}`, launchRecord)
        expect(saved.kind).toBe('record')
        if (saved.kind === 'record') {
          expect(saved.value.taskId).toBe('task-a')
          expect(saved.value.confirmation?.pid).toBe(confirmation.pid)
          expect(saved.value.end).toBeUndefined()
        }

        const end = await contained.retire()
        expect(end.childExited).toBe(true)
        await untilGone(confirmation.pid)
        const retired = await journal.read(`launch-${contained.launchId}`, launchRecord)
        expect(retired.kind === 'record' && retired.value.end?.childExited).toBe(true)
      },
      LAUNCH_TEST_TIMEOUT_MS,
    )

    it('refuses a launch while the host is busy, and writes no launch record', async () => {
      const { storage, workspace } = await scratch()
      const journal = journalFor(storage, Date.now())
      const started = await startNativeTeamLifetime({
        journal,
        isHostBusy: () => true,
        killGraceMs: 1000,
      })
      lifetimes.push(started.lifetime)
      await expect(
        started.lifetime.launch({
          command: process.execPath,
          args: ['-e', READY_CHILD],
          cwd: workspace,
          taskId: 'task-busy',
          env: { PATH: process.env['PATH'] },
          priority: 'normal',
        }),
      ).rejects.toThrow('TEAM_HOST_BUSY')
      expect(await journal.names()).toEqual([])
    })

    it(
      'stops every live child on dispose and launches nothing after it',
      async () => {
        const { storage, workspace } = await scratch()
        const started = await startNativeTeamLifetime({
          journal: journalFor(storage, Date.now()),
          isHostBusy: () => false,
          killGraceMs: 1000,
        })
        const request = {
          command: process.execPath,
          args: ['-e', READY_CHILD],
          cwd: workspace,
          env: { PATH: process.env['PATH'] },
          priority: 'belowNormal' as const,
        }
        const first = await started.lifetime.launch({ ...request, taskId: 'task-1' })
        const second = await started.lifetime.launch({ ...request, taskId: 'task-2' })
        const pids = [first, second].map((child) => child.child.pid ?? 0)
        expect(pids.every((pid) => isProcessAlive(pid))).toBe(true)

        await started.lifetime.dispose()
        for (const pid of pids) await untilGone(pid)
        await expect(started.lifetime.launch({ ...request, taskId: 'task-3' })).rejects.toThrow(
          'TEAM_PROCESS_LIFETIME_DISPOSED',
        )
      },
      LAUNCH_TEST_TIMEOUT_MS,
    )

    it(
      'shows a second window the first window’s live child as an orphan it keeps',
      async () => {
        const { storage, workspace } = await scratch()
        const crashed = await startNativeTeamLifetime({
          journal: journalFor(storage, Date.now() - 1000),
          isHostBusy: () => false,
          killGraceMs: 1000,
        })
        const contained = await crashed.lifetime.launch({
          command: process.execPath,
          args: ['-e', READY_CHILD],
          cwd: workspace,
          taskId: 'task-orphan',
          env: { PATH: process.env['PATH'] },
          priority: 'belowNormal',
        })
        const confirmation = await contained.confirmation
        // The first window dies without retiring its child: no dispose, no end record.

        const next = await startNativeTeamLifetime({
          journal: journalFor(storage, Date.now()),
          isHostBusy: () => false,
          killGraceMs: 1000,
        })
        lifetimes.push(next.lifetime)
        expect(next.records.map((record) => record.taskId)).toContain('task-orphan')
        const orphan = next.orphans.find((found) => found.pid === confirmation.pid)
        expect(orphan?.launchId).toBe(contained.launchId)
        // Without the person's confirmation the orphan is kept.
        expect(orphan === undefined ? 'missing' : await next.recovery.stop(orphan, false)).toBe(
          'kept',
        )
        expect(isProcessAlive(confirmation.pid)).toBe(true)
        // With it, the recorded identity is checked again and the child stops.
        if (orphan !== undefined) expect(await next.recovery.stop(orphan, true)).toBe('stopped')
        await untilGone(confirmation.pid)
        await contained.retire()
      },
      LAUNCH_TEST_TIMEOUT_MS,
    )
  },
)
