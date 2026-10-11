import { FakeScheduleEventClaims } from './helpers/schedules/events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fixtureRuntimeAdmission } from './helpers/runtimeAdmission'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ScheduleFilesSource,
  type ScheduleWorkspaceWatchPort,
} from '../../src/core/schedules/events/files'
import { ScheduleGitSource, localGitRefs } from '../../src/core/schedules/events/git'
import { ScheduleEventPrivacy } from '../../src/core/schedules/events/privacy'
import { ScheduleEventEngine } from '../../src/core/schedules/events/engine'
import { SCHEDULE_EVENT_DEBOUNCE_MS } from '../../src/shared/constants'
import type { ScheduleSourceCapability } from '../../src/shared/scheduleEvents'
import { withoutCredentials } from '../../src/core/credentialEnvironment'

const exec = promisify(execFile)
const admissionState: { dispose?: () => Promise<void> } = {}
beforeAll(async () => {
  admissionState.dispose = await fixtureRuntimeAdmission()
}, 60_000) // Compile the real Windows containment helpers once, before timed Git reads.
afterAll(async () => {
  await admissionState.dispose?.()
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>()
  return { ...original, stat: vi.fn(original.stat) }
})

async function observeGitTransition(repository: string, previous: string) {
  let objectId = previous
  const source = new ScheduleGitSource(
    {
      capability: () => ({ available: true }),
      read: () =>
        Promise.resolve([{ repository, name: 'refs/heads/main', objectId, revision: 'one' }]),
    },
    () => 0,
  )
  await source.poll(0)
  objectId = 'bbb'
  const [changed] = await source.poll(0)
  if (!changed) throw new Error('Missing branch update')
  return changed.eventKey
}

describe('local git and workspace file event sources', () => {
  it('uses one content identity and fire for loose-then-packed observations across editors', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'm115-e-git-'))
    const env = {
      ...withoutCredentials(process.env),
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    }
    const git = async (...args: string[]) => {
      const command = exec('git', ['-C', root, ...args], { env })
      command.child.stdin?.end()
      const result = await command
      return result.stdout.trim()
    }
    try {
      await git('init', '--quiet')
      const tree = await git('mktree')
      const a = await git('commit-tree', tree, '-m', 'first')
      const b = await git('commit-tree', tree, '-m', 'second')
      await git('update-ref', 'refs/heads/main', a)
      let now = 0
      const port = localGitRefs(root, () => true)
      const first = new ScheduleGitSource(port, () => now)
      const second = new ScheduleGitSource(
        localGitRefs(root, () => true),
        () => now + 1,
      )
      expect(await first.poll(0)).toEqual([])
      expect(await second.poll(0)).toEqual([])
      now = 1
      await git('update-ref', 'refs/heads/main', b)
      await git('update-ref', 'refs/tags/v1', a)
      const changed = await first.poll(1)
      await git('pack-refs', '--all')
      const otherEditor = await second.poll(1)
      expect(changed.map((event) => event.kind)).toEqual(['branchUpdated', 'tagCreated'])
      expect(otherEditor.map((event) => event.eventKey)).toEqual(
        changed.map((event) => event.eventKey),
      )
      expect(changed[0]?.fields).toEqual({ branch: 'main', commit: b })
      const disk = new FakeScheduleEventClaims()
      const receipts = disk.receipts
      const store = disk.client()
      const privacy = new ScheduleEventPrivacy([], { mark: vi.fn() }, 'Untrusted data')
      const firstEngine = new ScheduleEventEngine(() => now, store, privacy)
      const secondEngine = new ScheduleEventEngine(() => now, store, privacy)
      const [firstEvent] = changed
      const [secondEvent] = otherEditor
      if (!firstEvent || !secondEvent) throw new Error('Missing branch event')
      const trigger = { kind: 'event', source: 'git', event: 'branchUpdated', conditions: [] }
      expect(await firstEngine.enqueue('schedule', trigger, firstEvent)).toBe(true)
      expect(await secondEngine.enqueue('schedule', trigger, secondEvent)).toBe(false)
      now += SCHEDULE_EVENT_DEBOUNCE_MS
      expect([...(await firstEngine.drain()), ...(await secondEngine.drain())]).toHaveLength(1)
      expect(receipts.size).toBe(1)
      expect(await first.poll(1)).toEqual(changed)
      now = 2
      await git('update-ref', 'refs/heads/main', a)
      const returned = await first.poll(2)
      expect(returned).toHaveLength(1)
      expect(returned[0]?.eventKey).not.toEqual(changed[0]?.eventKey)
      now += 1
      await git('update-ref', 'refs/heads/main', b)
      const revisited = await first.poll(now)
      expect(revisited[0]?.eventKey).toEqual(changed[0]?.eventKey)
      expect(
        await new ScheduleGitSource(
          localGitRefs(root, () => true),
          () => now,
        ).poll(0),
      ).toEqual([])
      await git('pack-refs', '--all')
      expect(await first.poll(now + 1)).toEqual([])
      const packed = await stat(path.join(root, '.git', 'packed-refs'), { bigint: true })
      vi.mocked(stat)
        .mockRejectedValueOnce(new Error('fixture missing loose ref'))
        .mockResolvedValueOnce(Object.assign(packed, { mtimeNs: packed.mtimeNs + 1n }))
      await expect(port.read()).rejects.toThrow('gitRefs')
      const originalFs = await vi.importActual<typeof FsPromises>('node:fs/promises')
      vi.mocked(stat).mockImplementationOnce(async (file, options) => {
        await git('update-ref', 'refs/heads/main', a)
        return await originalFs.stat(file, options)
      })
      await expect(port.read()).rejects.toThrow('gitRefs')
      let trustReads = 0
      await expect(
        localGitRefs(root, () => {
          trustReads += 1
          return trustReads === 1
        }).read(),
      ).rejects.toThrow('gitRefs')
      await expect(first.history()).resolves.toMatchObject({ available: false })
      const untrusted = localGitRefs(root, () => false)
      expect(untrusted.capability()).toMatchObject({ available: false })
      await expect(untrusted.read()).rejects.toThrow('workspaceTrust')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('separates identical new OIDs by repository and previous OID', async () => {
    const first = await observeGitTransition('/fixture/one', 'aaa')
    expect(await observeGitTransition('/fixture/one', 'aaa')).toBe(first)
    expect(await observeGitTransition('/fixture/two', 'aaa')).not.toBe(first)
    expect(await observeGitTransition('/fixture/one', 'ccc')).not.toBe(first)
  })

  it('lists a missing local repository as unavailable before any git command', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'm115-e-no-git-'))
    try {
      const port = localGitRefs(root, () => true)
      expect(port.capability()).toMatchObject({
        available: false,
        reason: expect.stringContaining('gitRepository'),
      })
      await expect(port.read()).rejects.toThrow('gitRepository')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects corrupt ref projections and revoked git capability', async () => {
    const source = new ScheduleGitSource(
      {
        capability: () => ({ available: true }),
        read: () =>
          Promise.resolve([
            {
              repository: '/fixture',
              name: 'refs/heads/../../outside',
              objectId: 'abc',
              revision: 'one',
            },
          ]),
      },
      () => 0,
    )
    await expect(source.poll(0)).rejects.toThrow()
    const unavailable = new ScheduleGitSource(
      { capability: () => ({ available: false, reason: 'no git' }), read: vi.fn() },
      () => 0,
    )
    await expect(unavailable.poll(0)).rejects.toThrow('no git')
  })

  it('refuses a git snapshot whose capability was revoked during its read', async () => {
    let capability: ScheduleSourceCapability = { available: true }
    const pending = Promise.withResolvers<unknown>()
    const source = new ScheduleGitSource(
      { capability: () => capability, read: () => pending.promise },
      () => 0,
    )
    const poll = source.poll(0)
    capability = { available: false, reason: 'git disabled' }
    pending.resolve([])
    await expect(poll).rejects.toThrow('git disabled')
  })

  it('filters watched globs, refuses escapes and coalesces an actual watcher burst', async () => {
    let listener: ((input: unknown) => void) | undefined
    let capability: ScheduleSourceCapability = { available: true }
    const dispose = vi.fn()
    const watch = vi.fn((_globs: readonly string[], next: (input: unknown) => void) => {
      listener = next
      return { dispose }
    })
    const port: ScheduleWorkspaceWatchPort = { capability: () => capability, watch }
    const rejected = vi.fn()
    const source = new ScheduleFilesSource(['src/**/*.ts'], port, rejected)
    let now = 0
    const engine = new ScheduleEventEngine(
      () => now,
      new FakeScheduleEventClaims().client(),
      new ScheduleEventPrivacy([], { mark: vi.fn() }, 'Untrusted data'),
    )
    const pending: Promise<boolean>[] = []
    const eventKeys: string[] = []
    const subscription = source.subscribe((event) => {
      eventKeys.push(event.eventKey)
      pending.push(
        engine.enqueue(
          'schedule',
          { kind: 'event', source: 'files', event: 'filesChanged', conditions: [] },
          event,
        ),
      )
    })
    const notify = (relativePath: string, identity: string) => {
      listener?.({ relativePath, identity, observedAt: now })
    }
    notify('README.md', 'ignored')
    notify('src/one.ts', 'one')
    notify('src/one.ts', 'second-write')
    notify('src/nested/two.ts', 'two')
    for (const name of ['../outside.ts', '/external.ts', 'C:/external.ts', 'src/../external.ts'])
      notify(name, 'escape')
    expect(await Promise.all(pending)).toEqual([true, true, true])
    expect(new Set(eventKeys).size).toBe(3)
    expect(watch).toHaveBeenCalledWith(['src/**/*.ts'], expect.any(Function))
    expect(rejected).toHaveBeenCalledTimes(4)
    expect(pending).toHaveLength(3)
    expect(await engine.drain()).toEqual([])
    now += SCHEDULE_EVENT_DEBOUNCE_MS
    const fires = await engine.drain()
    expect(fires[0]?.coalescedCount).toBe(3)
    capability = { available: false, reason: 'disabled watcher' }
    notify('src/three.ts', 'three')
    expect(pending).toHaveLength(3)
    expect(() => source.subscribe(vi.fn())).toThrow('disabled watcher')
    capability = { available: true }
    subscription.dispose()
    notify('src/four.ts', 'four')
    expect(pending).toHaveLength(3)
    expect(dispose).toHaveBeenCalledTimes(1)
    await expect(source.history()).resolves.toMatchObject({ available: false })
  })

  it.each(['../*.ts', '/**', 'C:/src/**', 'src/{..,safe}/**', String.raw`src\**`, ''])(
    'rejects unsafe watcher glob %s before registering it',
    (glob) => {
      const watch = vi.fn()
      expect(
        () =>
          new ScheduleFilesSource(
            [glob],
            { capability: () => ({ available: true }), watch },
            vi.fn(),
          ),
      ).toThrow()
      expect(watch).not.toHaveBeenCalled()
    },
  )
})
