// Pre-merge M86 regressions: real Git/files and deterministic publication barriers.
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import * as canonical from '../../src/host/canonicalPath'
import { resolvedPath } from '../../src/host/checkpoints/checkpointFiles'
import {
  prepareCheckpointTurn,
  finishCheckpointTurn,
} from '../../src/host/checkpoints/checkpointHost'
import { unitRef } from '../../src/host/checkpoints/recordRefs'
import { processGitProcess } from '../../src/host/git'
import { gitBlobOid } from '../../src/core/checkpoints/gitListings'
import {
  harness,
  checkpointPort,
  isPresent,
  owner,
  read,
  recordingOf,
  redoOutcome,
  restoreOutcome,
  restoreTurn,
  shadowGit,
  shadowRefs,
  storedUnit,
  storedUnits,
  toolWrite,
  turn,
  turnRecorder,
  write,
  removeCheckpointFolders,
  REAL_GIT_TIMEOUT_MS,
} from './helpers/checkpointHarness'
import { journalFsWith } from './helpers/journalFs'
import * as atomic from '../../src/host/fsAtomic'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeCheckpointFolders()
})
const GONE_PID = 424_242
const realGit = processGitProcess()

/** Resolver contract of a normalization-insensitive volume; native volumes get a separate test. */
function normalizationAliases(root: string, nfd: string, nfc: string): void {
  const real = canonical.canonicalPath
  const aliases = new Set([path.join(root, nfd), path.join(root, nfc)])
  vi.spyOn(canonical, 'canonicalPath').mockImplementation(async (file) =>
    aliases.has(file) ? path.join(root, nfc) : await real(file),
  )
}

describe('M86 pre-merge fixes', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('keeps the stand-in writer faithful to the window’s path lock and publication order', async () => {
    const h = await harness()
    await write(h.root, 'shared.txt', 'zero')
    const first = owner(h.store, 'a')
    const second = owner(h.store, 'b', 's2')
    await h.store.startUnit(first)
    await h.store.startUnit(second)
    const { journal, lanes } = recordingOf(h.store)
    const held = Promise.withResolvers<undefined>()
    const reached = Promise.withResolvers<undefined>()
    const queued = Promise.withResolvers<undefined>()
    const numbered = Promise.withResolvers<undefined>()
    const append = journal.appendIntent.bind(journal)
    vi.spyOn(journal, 'appendIntent').mockImplementation(async (record) => {
      await append(record)
      if (record.owner.unitId !== 'a') {
        return
      }
      reached.resolve(undefined)
      await held.promise
    })
    const exclusive = lanes.exclusive.bind(lanes)
    let attempts = 0
    vi.spyOn(lanes, 'exclusive').mockImplementation(<T>(key: string, work: () => Promise<T>) => {
      const pending = exclusive(key, work)
      if (++attempts === 2) {
        queued.resolve(undefined)
      }
      return pending
    })
    const next = lanes.nextSeq.bind(lanes)
    let numbers = 0
    vi.spyOn(lanes, 'nextSeq').mockImplementation(() => {
      if (++numbers === 2) {
        numbered.resolve(undefined)
      }
      return next()
    })
    const writingA = toolWrite(h.store, first, h.root, 'shared.txt', 'one')
    await reached.promise
    const writingB = toolWrite(h.store, second, h.root, 'shared.txt', 'two')
    try {
      await Promise.race([queued.promise, numbered.promise])
      expect(numbers).toBe(1)
    } finally {
      held.resolve(undefined)
    }
    const [a, b] = await Promise.all([writingA, writingB])
    expect(b.before).toEqual(a.after)
    expect(await read(h.root, 'shared.txt')).toBe('two')
    await h.store.endUnit(first, { ranProcesses: false })
    await h.store.endUnit(second, { ranProcesses: false })
  })
  it('publishes the actual v2 word that keeps a v1 restore consumer fenced', async () => {
    const h = await harness()
    await h.store.turns('s1')
    const file = path.join(h.storage, 'windows', `${h.store.instance}.json`)
    const presence = z
      .object({ running: z.array(z.string()) })
      .parse(JSON.parse(await readFile(file, 'utf8')))
    expect(presence.running).toContain('fenced-window-v2')
    expect(presence.running).not.toContain('fenced-window-v1')
  })
  it('does not claim a folder another writer supplies before a recreating batch stages its file', async () => {
    const h = await harness()
    await write(h.root, 'user-folder/a.txt', 'before\n')
    await turn(h, 't1', (tool) => tool('user-folder/a.txt', null))
    await rm(path.join(h.root, 'user-folder'), { recursive: true })
    const original = atomic.writeFileIfUnchanged
    const spy = vi.spyOn(atomic, 'writeFileIfUnchanged').mockImplementation(async (...args) => {
      await mkdir(path.join(h.root, 'user-folder'), { recursive: true })
      return await original(...args)
    })
    const batch = await restoreTurn(h.store, 't1')
    spy.mockRestore()
    expect(storedUnit(h.storage, batch.restoreId ?? '').writes[0]?.createdFolders).toEqual([])
    expect(await redoOutcome(h.store, batch.restoreId)).toMatchObject({
      ok: true,
      changed: ['user-folder/a.txt'],
    })
    expect(await isPresent(h.root, 'user-folder')).toBe(true)
  })

  it('uses the native volume’s case identity for dirty editors without folding distinct files', async () => {
    const h = await harness()
    await turn(h, 't1', (tool) => tool('Foo.txt', 'after\n'))
    const isFoldingVolume = await isPresent(h.root, 'foo.txt')
    if (!isFoldingVolume) {
      await write(h.root, 'foo.txt', 'another file')
    }
    const outcome = await h.store.restore({
      backend: () => 'modelApi',
      sessionId: 's1',
      turnId: 't1',
      transcriptTurnIds: ['t1'],
      unsavedPaths: () => [path.join(h.root, 'foo.txt')],
    })
    expect(outcome).toMatchObject(
      isFoldingVolume
        ? { ok: true, refused: [{ path: 'Foo.txt', reason: 'unsaved' }] }
        : { ok: true, changed: ['Foo.txt'], refused: [] },
    )
  })
  it('seals a completed owner without sampling another owner’s live partial append', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let hasPaused = false
    const h = await harness({
      journalFs: journalFsWith((real) => ({
        write: async (bytes, offset, length, position) => {
          if (!hasPaused && Buffer.from(bytes).toString().includes('"unitId":"t2"')) {
            hasPaused = true
            const short = await real.write(bytes, offset, Math.floor(length / 2), position)
            entered.resolve(undefined)
            await release.promise
            return short
          }
          return await real.write(bytes, offset, length, position)
        },
      })),
    })
    const recorder = turnRecorder(h)
    const a = owner(h.store, 't1')
    const b = owner(h.store, 't2')
    await h.store.startUnit(a)
    await recorder.start(a).io.writeFile(path.join(h.root, 'a.txt'), 'a')
    await recorder.end(a)
    await h.store.startUnit(b)
    const writing = recorder.start(b).io.writeFile(path.join(h.root, 'b.txt'), 'b')
    await entered.promise
    const requested = Promise.withResolvers<undefined>()
    const journal = recordingOf(h.store).journal
    const snapshot = journal.snapshot.bind(journal)
    const sealRequested = Promise.withResolvers<undefined>()
    const seal = journal.appendSeal.bind(journal)
    vi.spyOn(journal, 'appendSeal').mockImplementation((...args) => {
      sealRequested.resolve(undefined)
      return seal(...args)
    })
    vi.spyOn(journal, 'snapshot').mockImplementation(() => {
      requested.resolve(undefined)
      return snapshot()
    })
    const ending = h.store.endUnit(a, { ranProcesses: false })
    // Safe implementation requests a queued snapshot; old implementation
    // finishes with a poisoned record. Both are observable milestones.
    await Promise.race([sealRequested.promise, requested.promise])
    release.resolve(undefined)
    await Promise.all([writing, ending])
    await recorder.end(b)
    await h.store.endUnit(b, { ranProcesses: false })
    expect(storedUnit(h.storage, 't1')).toMatchObject({
      status: 'complete',
      isMarkedIncomplete: false,
    })
  })

  it('reserves cleanup before retiring old source refs, excluding a peer restore', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let clock = 1_000_000
    let isArmed = false
    const h = await harness({
      now: () => clock,
      retentionDays: () => 1,
      gitProcess: async (args, options) => {
        if (
          isArmed &&
          args.includes('update-ref') &&
          args.some((arg) => arg.startsWith('refs/muse-spark/m86/unit/'))
        ) {
          isArmed = false
          entered.resolve(undefined)
          await release.promise
        }
        return await realGit(args, options)
      },
    })
    await turn(h, 'old', (tool) => tool('a.txt', 'after\n'))
    const peer = h.reopen()
    await peer.turns('s1')
    clock += 90 * 86_400_000
    isArmed = true
    const cleanup = h.store.maintain()
    await entered.promise
    try {
      expect(shadowRefs(h.storage)).toContain('refs/muse-spark/restore-active')
      expect(await restoreOutcome(peer, 'old')).toEqual({ ok: false, reason: 'turnElsewhere' })
      expect(storedUnit(h.storage, 'old').writes).toHaveLength(1)
    } finally {
      release.resolve(undefined)
      await cleanup
    }
    expect(await read(h.root, 'a.txt')).toBe('after\n')
  })
  it.each(['reopened window', 'same instance'])(
    'recovers a crashed first cleanup in the %s and admits an ordinary send',
    async (recovery) => {
      const ref = 'refs/muse-spark/restore-active'
      let isCrashing = true
      let isOwnerAlive = true
      let hasReserved = false
      let refusedReleases = 0
      const h = await harness({
        isProcessAlive: () => isOwnerAlive,
        gitProcess: async (args, options) => {
          if (isCrashing && hasReserved) {
            if (args.includes('update-ref') && args.includes('-d') && args.includes(ref)) {
              refusedReleases += 1
              throw new Error('cleanup release interrupted')
            }
            if (args.includes('for-each-ref') && args.includes('refs/muse-spark/')) {
              throw new Error('first cleanup interrupted')
            }
          }
          const result = await realGit(args, options)
          if (args.includes('update-ref') && !args.includes('-d') && args.includes(ref)) {
            hasReserved = true
          }
          return result
        },
      })
      await expect(h.store.turns('s1')).rejects.toThrow('first cleanup interrupted')
      expect(refusedReleases).toBe(2)
      expect(shadowRefs(h.storage)).toContain(ref)
      expect(storedUnits(h.storage)).toEqual([])
      isCrashing = false
      isOwnerAlive = recovery === 'same instance'
      const next = recovery === 'same instance' ? h.store : h.reopen()
      await next.maintain()
      expect(shadowRefs(h.storage)).not.toContain(ref)
      await turn({ store: next, root: h.root }, 'ordinary-send')
      expect(storedUnit(h.storage, 'ordinary-send').status).toBe('complete')
    },
  )

  it.each(['live', 'uncertain'])(
    'keeps a cleanup reservation belonging to the %s peer',
    async (ownerState) => {
      const ref = 'refs/muse-spark/restore-active'
      let isReleaseRefused = true
      const h = await harness({
        gitProcess: async (args, options) => {
          if (
            isReleaseRefused &&
            args.includes('update-ref') &&
            args.includes('-d') &&
            args.includes(ref)
          ) {
            throw new Error('cleanup release interrupted')
          }
          return await realGit(args, options)
        },
      })
      await h.store.turns('s1')
      const keep = shadowGit(h.storage, ['rev-parse', ref]).trim()
      isReleaseRefused = false
      if (ownerState === 'uncertain') {
        await writeFile(path.join(h.storage, 'windows', `${h.store.instance}.json`), '{')
      }
      const peer = h.reopen()
      await peer.maintain()
      expect(shadowGit(h.storage, ['rev-parse', ref]).trim()).toBe(keep)
      await expect(peer.markTurn('ordinary-send', true)).rejects.toThrow(/another VS Code window/u)
      await peer.markTurn('ordinary-send', false)
    },
  )

  it('keeps a reservation replaced after cleanup sampled its abandoned lease', async () => {
    const ref = 'refs/muse-spark/restore-active'
    let isReleaseRefused = true
    let previous = ''
    let replacement = ''
    let hasSwapped = false
    const h = await harness({
      gitProcess: async (args, options) => {
        if (args.includes('update-ref') && args.includes(ref)) {
          if (isReleaseRefused && args.includes('-d')) {
            throw new Error('cleanup release interrupted')
          }
          if (
            !isReleaseRefused &&
            !hasSwapped &&
            (args.at(-1) === previous || args.length === args.indexOf('update-ref') + 3)
          ) {
            shadowGit(h.storage, ['update-ref', ref, replacement, previous])
            hasSwapped = true
          }
        }
        return await realGit(args, options)
      },
    })
    await h.store.turns('s1')
    previous = shadowGit(h.storage, ['rev-parse', ref]).trim()
    replacement = shadowGit(h.storage, ['mktree'], '').trim()
    isReleaseRefused = false
    await h.store.maintain()
    expect(hasSwapped).toBe(true)
    expect(shadowRefs(h.storage)).toContain(ref)
    expect(shadowGit(h.storage, ['rev-parse', ref]).trim()).toBe(replacement)
  })
  it.each(['restore', 'redo'] as const)(
    'keeps outside bytes when the canonical root is replaced before %s',
    async (kind) => {
      const h = await harness()
      await write(h.root, 'a.txt', 'before\n')
      await turn(h, 't1', (tool) => tool('a.txt', 'after\n'))
      const batch = kind === 'redo' ? await restoreTurn(h.store, 't1') : undefined
      const outside = path.join(path.dirname(h.root), 'outside')
      await mkdir(outside)
      const current = kind === 'redo' ? 'before\n' : 'after\n'
      await write(outside, 'a.txt', current)
      await rename(h.root, `${h.root}-old`)
      await symlink(outside, h.root, 'junction')
      const outcome =
        kind === 'redo'
          ? await redoOutcome(h.store, batch?.restoreId)
          : await restoreOutcome(h.store, 't1')
      expect(outcome).toMatchObject({
        ok: true,
        changed: [],
        refused: [{ path: 'a.txt', reason: 'linked' }],
      })
      expect(await read(outside, 'a.txt')).toBe(current)
    },
  )

  it('refuses dirty editor aliases resolved through a directory junction', async () => {
    const h = await harness()
    await turn(h, 't1', (tool) => tool('sub/a.txt', 'after\n'))
    await symlink(path.join(h.root, 'sub'), path.join(h.root, 'alias'), 'junction')
    const outcome = await h.store.restore({
      backend: () => 'modelApi',
      sessionId: 's1',
      turnId: 't1',
      transcriptTurnIds: ['t1'],
      unsavedPaths: () => [path.join(h.root, 'alias', 'a.txt')],
    })
    expect(outcome).toMatchObject({
      ok: true,
      changed: [],
      refused: [{ path: 'sub/a.txt', reason: 'unsaved' }],
    })
    expect(await read(h.root, 'sub/a.txt')).toBe('after\n')
  })

  it.runIf(process.platform === 'win32')(
    'refuses a native Windows short-name dirty editor alias',
    async () => {
      const h = await harness()
      const filename = 'checkpoint-long-filename.txt'
      await turn(h, 't1', (tool) => tool(filename, 'after\n'))
      const file = path.join(h.root, filename)
      const command = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${file}") do @echo %~sI`], {
        encoding: 'utf8',
        windowsVerbatimArguments: true,
        windowsHide: true,
      })
      expect(command.error).toBeUndefined()
      expect(command.status).toBe(0)
      const short = command.stdout.trim()
      expect(short).not.toBe(file)
      expect(short).toMatch(/~\d/u)
      const longIdentity = await stat(file)
      const shortIdentity = await stat(short)
      expect(shortIdentity.dev).toBe(longIdentity.dev)
      expect(shortIdentity.ino).toBe(longIdentity.ino)
      expect(
        await h.store.restore({
          backend: () => 'modelApi',
          sessionId: 's1',
          turnId: 't1',
          transcriptTurnIds: ['t1'],
          unsavedPaths: () => [short],
        }),
      ).toMatchObject({ ok: true, changed: [], refused: [{ path: filename, reason: 'unsaved' }] })
      expect(await read(h.root, filename)).toBe('after\n')
    },
  )

  it('rekeys normalization-equivalent resolver spellings without inferring a link', async () => {
    const h = await harness()
    const nfd = 'cafe\u{0301}.txt'
    const nfc = 'caf\u{00E9}.txt'
    await write(h.root, nfc, 'bytes')
    normalizationAliases(h.root, nfd, nfc)
    expect(
      await resolvedPath({ workspaceRoot: h.root, platform: process.platform, log: h.log }, nfd),
    ).toBe(nfc)
  })

  it('keeps known foreign barriers when normalization spellings now resolve to one file', async () => {
    const h = await harness()
    const nfd = 'cafe\u{0301}.txt'
    const nfc = 'caf\u{00E9}.txt'
    await write(h.root, nfc, 'before')
    await turn(h, 't1', (tool) => tool(nfc, 'middle'))
    await write(h.root, nfd, 'middle')
    await turn(h, 'foreign', (tool) => tool(nfd, 'middle'), 's2')
    await turn(h, 't2', (tool) => tool(nfc, 'after'))
    await write(h.root, nfd, 'after')
    normalizationAliases(h.root, nfd, nfc)
    expect(await restoreOutcome(h.store, 't1', 's1', ['t1', 't2'])).toMatchObject({
      ok: true,
      changed: [],
      refused: [{ path: nfc, reason: 'changedBetween' }],
    })
    expect(await read(h.root, nfc)).toBe('after')
  })

  it('keeps distinct native normalization names distinct on sensitive volumes, and accepts aliases on folding volumes', async () => {
    const h = await harness()
    const nfd = 'cafe\u{0301}.txt'
    const nfc = 'caf\u{00E9}.txt'
    await write(h.root, nfd, 'first')
    const isFoldingVolume = await isPresent(h.root, nfc)
    if (!isFoldingVolume) {
      await write(h.root, nfc, 'second')
    }
    const target = { workspaceRoot: h.root, platform: process.platform, log: h.log }
    expect(await resolvedPath(target, nfd)).toBeDefined()
    expect(await resolvedPath(target, nfc)).toBeDefined()
    expect(await read(h.root, nfd)).toBe('first')
    expect(await read(h.root, nfc)).toBe(isFoldingVolume ? 'first' : 'second')
  })

  it('preserves a recent durable journal when its folded record cannot be read', async () => {
    const h = await harness({ isProcessAlive: (pid) => pid !== GONE_PID })
    await turn(h, 't0')
    const crashed = h.reopen(GONE_PID)
    await turn({ store: crashed, root: h.root }, 't1', (tool) => tool('a.txt', 'after\n'))
    await recordingOf(crashed).journal.close()
    crashed.dispose()
    const ref = shadowRefs(h.storage).find((candidate) => candidate.endsWith('/2'))
    expect(ref).toBeDefined()
    const blob = shadowGit(h.storage, ['hash-object', '-w', '--stdin'], '{broken').trim()
    const tree = shadowGit(h.storage, ['mktree'], `100644 blob ${blob}\trecord.json\n`).trim()
    shadowGit(h.storage, ['update-ref', ref ?? '', tree])
    await h.store.maintain()
    expect(shadowRefs(h.storage)).toContain(ref)
    expect(await isPresent(h.storage, `m86/${crashed.instance}/journal.jsonl`)).toBe(true)
    expect(await restoreOutcome(h.store, 't0', 's1', ['t0', 't1'])).toEqual({
      ok: false,
      reason: 'writesIncomplete',
    })
    expect(await read(h.root, 'a.txt')).toBe('after\n')
  })

  it('preserves an unparsed first line and recovers its unit as incomplete', async () => {
    const h = await harness({ isProcessAlive: (pid) => pid !== GONE_PID })
    const crashed = h.reopen(GONE_PID)
    await crashed.startUnit(owner(crashed, 't1'))
    const folder = path.join(h.storage, 'm86', crashed.instance)
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, 'journal.jsonl'), '{"kind":"intent","write":')
    crashed.dispose()
    await h.store.maintain()
    expect(await isPresent(folder, 'journal.jsonl')).toBe(true)
    expect(storedUnit(h.storage, 't1')).toMatchObject({
      status: 'incomplete',
      isMarkedIncomplete: true,
    })
    expect(await restoreOutcome(h.store, 't1')).toEqual({ ok: false, reason: 'writesIncomplete' })
  })

  it.each([false, true])(
    'restores a new turn after archive/unarchive, reload=%s',
    async (reload) => {
      const h = await harness()
      await turn(h, 'old', (tool) => tool('a.txt', 'old\n'))
      await turn(h, 'foreign', (tool) => tool('b.txt', 'retained\n'), 's2')
      await h.store.forgetSession('s1')
      await h.store.unforgetSession('s1')
      const store = reload ? h.reopen() : h.store
      if (reload) {
        h.store.dispose()
        await store.maintain()
      }
      await turn({ store, root: h.root }, 'new', (tool) => tool('a.txt', 'new\n'))
      const restored = await restoreOutcome(store, 'new')
      expect(restored).toMatchObject({ ok: true, changed: ['a.txt'], refused: [] })
      expect(await read(h.root, 'a.txt')).toBe('old\n')
    },
  )

  it.each(['off', 'failed', 'child'] as const)(
    'refuses Redo with a later unrecorded %s turn, even on another path',
    async (kind) => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'after\n'))
      const restored = await restoreTurn(h.store, 't1')
      const port = checkpointPort(h, true, () => kind === 'failed')
      if (kind === 'failed') {
        vi.spyOn(h.store, 'startUnit').mockRejectedValueOnce(new Error('record failed'))
      }
      const recorder = turnRecorder(h)
      const checkpoint = await prepareCheckpointTurn(
        port,
        recorder,
        's1',
        kind,
        h.log,
        kind === 'child' ? { checkpoint: { kind: 'off' } } : undefined,
      )
      await write(h.root, 'b.txt', 'unrecorded\n')
      await finishCheckpointTurn(port, recorder, 's1', kind, { checkpoint, ranProcesses: false })
      expect(storedUnits(h.storage).some((unit) => unit.owner.unitId === kind)).toBe(false)
      expect(await redoOutcome(h.store, restored.restoreId, 's1', ['t1', kind])).toEqual({
        ok: false,
        reason: 'writesIncomplete',
      })
      expect(await isPresent(h.root, 'a.txt')).toBe(false)
    },
  )

  it('excludes unrecorded turns before the batch anchor, and refuses batches with no provable anchor', async () => {
    const h = await harness()
    const port = checkpointPort(h)
    const recorder = turnRecorder(h)
    const off = await prepareCheckpointTurn(port, recorder, 's1', 'off-before', h.log)
    expect(off.kind).toBe('off')
    await write(h.root, 'other.txt', 'unrecorded before the selected turn')
    await finishCheckpointTurn(port, recorder, 's1', 'off-before', {
      checkpoint: off,
      ranProcesses: false,
    })
    await turn(h, 't1', (tool) => tool('a.txt', 'after\n'))
    const restored = await restoreTurn(h.store, 't1')
    expect(await redoOutcome(h.store, restored.restoreId, 's1', ['t1'])).toMatchObject({
      ok: true,
      changed: ['a.txt'],
    })
    const batch = storedUnit(h.storage, restored.restoreId ?? '')
    const ref = unitRef('s1', batch.sequence)
    // Remove only the host-local anchor, preserving this historical batch's blobs.
    const json = JSON.stringify({ ...batch, transcript: undefined })
    const oid = shadowGit(h.storage, ['hash-object', '-w', '--stdin'], json).trim()
    const entries = shadowGit(h.storage, ['cat-file', '-p', ref])
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => (line.endsWith('\trecord.json') ? `100644 blob ${oid}\trecord.json` : line))
    const tree = shadowGit(h.storage, ['mktree'], `${entries.join('\n')}\n`).trim()
    shadowGit(h.storage, ['update-ref', ref, tree])
    expect(await redoOutcome(h.store, restored.restoreId, 's1', ['t1'])).toEqual({
      ok: false,
      reason: 'writesIncomplete',
    })
  })

  it('drives a broken two-turn chain through the real recorder and store', async () => {
    const h = await harness()
    const recorder = turnRecorder(h)
    const record = async (turnId: string, bytes: string) => {
      const unit = owner(h.store, turnId)
      await h.store.startUnit(unit)
      await recorder.start(unit).io.writeFile(path.join(h.root, 'a.txt'), bytes)
      await recorder.end(unit)
      await h.store.endUnit(unit, { ranProcesses: false })
    }
    await record('t1', 'first\n')
    await write(h.root, 'a.txt', 'user\n')
    await record('t2', 'second\n')
    expect(await restoreOutcome(h.store, 't1', 's1', ['t1', 't2'])).toMatchObject({
      ok: true,
      changed: [],
      refused: [{ path: 'a.txt', reason: 'changedBetween' }],
    })
    expect(storedUnit(h.storage, 't2').writes[0]?.before.oid).toBe(
      gitBlobOid(Buffer.from('user\n')),
    )
    expect(await read(h.root, 'a.txt')).toBe('second\n')
  })

  it('holds batch sequence and intent inside the same path lane as tool writes', async () => {
    const h = await harness()
    await turn(h, 't1', (tool) => tool('a.txt', 'after\n'))
    const { lanes, journal } = recordingOf(h.store)
    const held = Promise.withResolvers<undefined>()
    const acquired = Promise.withResolvers<undefined>()
    const blocker = lanes.exclusive('a.txt', async () => {
      acquired.resolve(undefined)
      await held.promise
    })
    await acquired.promise
    const attempted = Promise.withResolvers<undefined>()
    let hasEntered = false
    const original = lanes.exclusive.bind(lanes)
    vi.spyOn(lanes, 'exclusive').mockImplementation(<T>(key: string, work: () => Promise<T>) => {
      const pending = original(key, async () => {
        hasEntered = true
        return await work()
      })
      attempted.resolve(undefined)
      return pending
    })
    const next = vi.spyOn(lanes, 'nextSeq')
    const restoring = restoreTurn(h.store, 't1')
    try {
      await attempted.promise
      expect(hasEntered).toBe(false)
      expect(next).not.toHaveBeenCalled()
      const current = await journal.snapshot()
      expect(current?.entries.filter((entry) => entry.kind === 'intent')).toHaveLength(1)
    } finally {
      held.resolve(undefined)
      await blocker
    }
    const restored = await restoring
    expect(restored.changed).toEqual(['a.txt'])
    expect(next).toHaveBeenCalledOnce()
  })

  it('hardens every shadow object/ref command independently of workspace config', async () => {
    const seen: string[][] = []
    const h = await harness({
      gitProcess: async (args, options) => {
        seen.push([...args])
        return await realGit(args, options)
      },
    })
    await turn(h, 't1', (tool) => tool('a.txt', 'after\n'))
    expect(seen.length).toBeGreaterThan(0)
    for (const args of seen) {
      expect(args).toEqual(
        expect.arrayContaining(['core.fsync=loose-object,reference', 'core.fsyncMethod=fsync']),
      )
    }
  })
})
