// M96d RVM96C2 adversarial schedules against the production grant
// engine: the ledger's pure state machine, no clock, no I/O. The
// schedules predate the implementation (written 2026-10-10, before any
// production coordinator existed); the port keeps their names and
// intent. Durability and custody around this engine are proved in
// m96dCoordinatorStore.test.ts, with real stores and processes.
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COORDINATOR_LINUX_FS_EXFAT,
  COORDINATOR_LINUX_FS_FAT,
  COORDINATOR_LINUX_FS_LOCAL,
  COORDINATOR_LINUX_FS_NFS,
  COORDINATOR_LINUX_FS_SMB2,
  COORDINATOR_LINUX_FS_TMPFS,
} from '../../src/shared/constants'
import {
  CoordinatorGrants,
  isCoordinatorGrantError,
  type CoordinatorGrantRefusal,
} from '../../src/core/team/coordinator/grants'
import {
  chooseCoordinatorMode,
  coordinatorFilesystemKind,
  coordinatorStatfsReader,
  isBeneathSyncRoot,
} from '../../src/core/team/coordinator/mode'
import {
  coordinatorSignalTarget,
  type CoordinatorReference,
} from '../../src/core/team/coordinator/references'

const platforms = ['linux', 'darwin', 'win32'] as const
const resources = ['worker', 'processWorker', 'heavyCommand', 'singleton', 'landing'] as const
const owner = 'window-A'
const grant = 'grant-A'
const reference: CoordinatorReference = {
  platform: 'linux',
  kind: 'pidfd',
  token: 'held-reference-A',
  boot: 'boot-A',
  start: '1000001',
  pid: 42,
  validated: true,
  exited: false,
}
const retiredReference: CoordinatorReference = { ...reference, exited: true }

function referenceFor(platform: CoordinatorReference['platform']): CoordinatorReference {
  const kinds = { linux: 'pidfd', win32: 'processHandle', darwin: 'ownedChild' } as const
  return {
    ...reference,
    platform,
    kind: kinds[platform],
  }
}

function fixture(): CoordinatorGrants {
  const engine = new CoordinatorGrants(randomUUID())
  engine.reserve(grant, owner, [...resources])
  return engine
}

/** A fresh custody over retained grants: what the shell loads after a restart. */
function restarted(engine: CoordinatorGrants): CoordinatorGrants {
  const recovered = new CoordinatorGrants(randomUUID())
  recovered.retainLoaded(engine.snapshot())
  return recovered
}

/** The refusal code a rejected engine operation throws. */
function refusalOf(operation: () => unknown): CoordinatorGrantRefusal {
  try {
    operation()
  } catch (error: unknown) {
    if (isCoordinatorGrantError(error)) return error.code
    throw error
  }
  throw new Error('Expected the engine to refuse')
}

describe('M96d RVM96C2 adversarial schedules', () => {
  for (const platform of platforms) {
    for (const error of ['ECONNREFUSED', 'ENOENT', 'ERROR_PIPE_BUSY', 'EOF']) {
      it(`F1 ${platform}: ${error} from a live owner cannot elect or release`, () => {
        const engine = fixture()
        engine.endpointFailed(error)
        expect(engine.reachable).toBe(false)
        expect(engine.electSuccessor(false)).toBe(false)
        expect(engine.held(grant)).toEqual([...resources])
        expect(() => {
          engine.reserve('grant-B', 'window-B', [...resources])
        }).toThrow(expect.objectContaining({ name: 'CoordinatorGrantError' }))
        expect(
          refusalOf(() => {
            engine.reserve('grant-B', 'window-B', [...resources])
          }),
        ).toBe('resourcesHeld')
      })
    }

    for (const boundary of ['intent', 'spawn', 'registration', 'resume', 'detachedChild']) {
      it(`F2 ${platform}: crash after ${boundary} retains every launch liability`, () => {
        const engine = fixture()
        engine.persistIntent(grant)
        if (boundary !== 'intent') engine.spawn(grant)
        if (boundary !== 'intent' && boundary !== 'spawn')
          engine.register(grant, referenceFor(platform), 'complete')
        if (boundary === 'resume' || boundary === 'detachedChild') engine.resume(grant)
        engine.ownerExited(owner)
        expect(engine.held(grant)).toEqual([...resources])
        expect(
          refusalOf(() => {
            engine.reserve('grant-B', 'window-B', [...resources])
          }),
        ).toBe('resourcesHeld')
        const recovered = restarted(engine)
        expect(recovered.held(grant)).toEqual([...resources])
        expect(
          refusalOf(() => {
            recovered.reserve('grant-B', 'window-B', [...resources])
          }),
        ).toBe('resourcesHeld')
        // A fresh custody drops reference authority: nothing retained can release.
        expect(recovered.retirementState(grant)).toBe('unknown')
      })
    }

    it(`F3 ${platform}: mistaken user confirmation cannot hand off a pending rename`, () => {
      const engine = fixture()
      engine.persistIntent(grant)
      engine.spawn(grant)
      engine.register(grant, referenceFor(platform), 'complete')
      engine.resume(grant)
      engine.freezeBeforeRename(grant)
      expect(engine.userConfirmedStopped(grant)).toBe(false)
      expect(
        engine.settle({
          grant,
          epoch: engine.epoch,
          reference: { ...referenceFor(platform), exited: true },
          treeEmpty: true,
          effectsDrained: true,
        }),
      ).toBe('refused')
      expect(
        refusalOf(() => {
          engine.reserve('grant-B', 'window-B', ['landing'])
        }),
      ).toBe('resourcesHeld')
      expect(engine.completePendingRename(grant)).toBe(true)
      expect(engine.held(grant)).toEqual([...resources])
    })
  }

  it('F2: spawn is impossible before durable intent', () => {
    const engine = fixture()
    expect(
      refusalOf(() => {
        engine.spawn(grant)
      }),
    ).toBe('badPhase')
    engine.persistIntent(grant)
    engine.spawn(grant)
    expect(
      refusalOf(() => {
        engine.persistIntent(grant)
      }),
    ).toBe('badPhase')
  })

  it('F4: microseconds distinguish macOS incarnations within one ps second', () => {
    const expected: CoordinatorReference = {
      ...reference,
      platform: 'darwin',
      kind: 'ownedChild',
    }
    expect(coordinatorSignalTarget(expected, { ...expected, start: '1000002' })).toBeUndefined()
    expect(coordinatorSignalTarget(expected, { ...expected, kind: 'psSeconds' })).toBeUndefined()
    // Localised lstart text and a time-zone change provide no signal authority.
    expect(
      coordinatorSignalTarget(expected, { ...expected, start: 'Thu Oct 10 01:00:01' }),
    ).toBeUndefined()
  })

  for (const platform of ['linux', 'win32'] as const) {
    it(`F4 ${platform}: PID reuse between query and dispatch cannot retarget a signal`, () => {
      const expected: CoordinatorReference = {
        ...reference,
        platform,
        kind: platform === 'linux' ? 'pidfd' : 'processHandle',
      }
      const nativeTargets = new Map([
        [expected.token, 'owned-old-process'],
        ['pid:42', 'unrelated-new-process'],
      ])
      const target = coordinatorSignalTarget(expected, expected)
      expect(target).toBe(expected.token)
      expect(target === undefined ? undefined : nativeTargets.get(target)).toBe('owned-old-process')
      expect(
        coordinatorSignalTarget(expected, { ...expected, token: 'new-reference' }),
      ).toBeUndefined()
      expect(coordinatorSignalTarget({ ...expected, validated: false }, expected)).toBeUndefined()
      expect(coordinatorSignalTarget(expected, { ...expected, validated: false })).toBeUndefined()
      expect(coordinatorSignalTarget(expected, { ...expected, boot: 'boot-B' })).toBeUndefined()
      expect(coordinatorSignalTarget(expected, { ...expected, exited: true })).toBeUndefined()
    })
  }

  it('F4 macOS: precise observation still cannot authorise a numeric-PID signal', () => {
    const child: CoordinatorReference = { ...reference, platform: 'darwin', kind: 'ownedChild' }
    expect(coordinatorSignalTarget(child, child)).toBeUndefined()
  })
})

describe('M96d release and fallback obligations', () => {
  for (const evidence of ['empty Job', 'same SID', 'same logon session', 'process-start trace']) {
    it(`RVCM96D1: ${evidence} cannot retire an unqualified Windows scope`, () => {
      const engine = fixture()
      const live = referenceFor('win32')
      engine.persistIntent(grant)
      engine.spawn(grant)
      engine.register(grant, live, 'unknown')
      engine.resume(grant)
      // Captured Win32_Process.Create counterexample: the Job is empty, but
      // its brokered writer can still land. A caller's drain claim cannot
      // upgrade a boundary that never covered service-mediated effects.
      expect(
        engine.settle({
          grant,
          epoch: engine.epoch,
          reference: { ...live, exited: true },
          treeEmpty: true,
          effectsDrained: true,
        }),
      ).toBe('refused')
      expect(engine.retirementState(grant)).toBe('unknown')
      expect(engine.held(grant)).toEqual([...resources])
      expect(
        refusalOf(() => {
          engine.reserve('grant-B', 'window-B', [...resources])
        }),
      ).toBe('resourcesHeld')
      const recovered = restarted(engine)
      expect(recovered.retirementState(grant)).toBe('unknown')
      expect(
        refusalOf(() => {
          recovered.reserve('grant-B', 'window-B', [...resources])
        }),
      ).toBe('resourcesHeld')
    })
  }

  it('RVCM96D1: unproved scope coverage selects fallback only before enrolment', () => {
    const prerequisites = {
      filesystem: 'local',
      nativeQualified: true,
      scopeQualified: false,
      storeValid: true,
    } as const
    expect(chooseCoordinatorMode(prerequisites, false).mode).toBe('windowScoped')
    expect(chooseCoordinatorMode(prerequisites, true).mode).toBe('blocked')
    expect(chooseCoordinatorMode(prerequisites, false).reason).toBeTruthy()
  })

  it('rejects reordered launch transitions and duplicate grant publication', () => {
    const engine = fixture()
    expect(
      refusalOf(() => {
        engine.reserve(grant, owner, [...resources])
      }),
    ).toBe('grantReused')
    expect(
      refusalOf(() => {
        engine.register(grant, reference, 'complete')
      }),
    ).toBe('badPhase')
    expect(
      refusalOf(() => {
        engine.resume(grant)
      }),
    ).toBe('badPhase')
    expect(
      refusalOf(() => {
        engine.persistIntent('missing')
      }),
    ).toBe('unknownGrant')
    expect(
      refusalOf(() => {
        engine.spawn('missing')
      }),
    ).toBe('unknownGrant')
    expect(engine.held('missing')).toEqual([])
    expect(
      refusalOf(() => {
        engine.freezeBeforeRename(grant)
      }),
    ).toBe('badPhase')
    expect(engine.completePendingRename(grant)).toBe(false)
    expect(engine.completePendingRename('missing')).toBe(false)
    engine.persistIntent(grant)
    expect(
      refusalOf(() => {
        engine.persistIntent(grant)
      }),
    ).toBe('badPhase')
    engine.spawn(grant)
    expect(
      refusalOf(() => {
        engine.spawn(grant)
      }),
    ).toBe('badPhase')
    engine.register(grant, reference, 'complete')
    expect(
      refusalOf(() => {
        engine.register(grant, reference, 'complete')
      }),
    ).toBe('badPhase')
    engine.resume(grant)
    expect(
      refusalOf(() => {
        engine.resume(grant)
      }),
    ).toBe('badPhase')
  })

  it('new authority never frees the old ledger and cannot bypass a frozen holder', () => {
    const engine = fixture()
    expect(engine.electSuccessor(true)).toBe(true)
    expect(engine.held(grant)).toEqual([...resources])
    expect(
      refusalOf(() => {
        engine.reserve('grant-B', 'window-B', [...resources])
      }),
    ).toBe('resourcesHeld')
  })

  for (const platform of platforms) {
    it(`${platform}: hypothetical complete qualified retirement has a positive release path`, () => {
      const engine = fixture()
      const live = referenceFor(platform)
      engine.persistIntent(grant)
      engine.spawn(grant)
      engine.register(grant, live, 'complete')
      expect(engine.retirementState(grant)).toBe('active')
      expect(
        engine.settle({
          grant,
          epoch: engine.epoch,
          reference: { ...live, exited: true },
          treeEmpty: true,
          effectsDrained: true,
        }),
      ).toBe('released')
      expect(engine.retirementState(grant)).toBe('finished')
      engine.reserve('grant-B', 'window-B', [...resources])
    })
  }

  for (const change of [
    { validated: false },
    { platform: 'win32' },
    { kind: 'processGroup' },
    { boot: 'other-boot' },
    { start: '1000002' },
    { pid: 43 },
  ] as const) {
    it(`F4: retirement refuses a changed ${Object.keys(change).join(',')} on the same token`, () => {
      const engine = fixture()
      engine.persistIntent(grant)
      engine.spawn(grant)
      engine.register(grant, reference, 'complete')
      expect(
        engine.settle({
          grant,
          epoch: engine.epoch,
          reference: { ...retiredReference, ...change },
          treeEmpty: true,
          effectsDrained: true,
        }),
      ).toBe('refused')
      expect(engine.held(grant)).toEqual([...resources])
    })
  }

  it('a matching but unsafe process-group or coarse reference cannot release even with a claimed empty tree', () => {
    for (const kind of ['processGroup', 'psSeconds'] as const) {
      const engine = fixture()
      const unsafe = { ...reference, kind }
      engine.persistIntent(grant)
      engine.spawn(grant)
      engine.register(grant, unsafe, 'complete')
      expect(
        engine.settle({
          grant,
          epoch: engine.epoch,
          reference: { ...unsafe, exited: true },
          treeEmpty: true,
          effectsDrained: true,
        }),
      ).toBe('refused')
      expect(engine.held(grant)).toEqual([...resources])
    }
  })

  it('only exact complete retirement releases once; lost acknowledgement cannot reopen it', () => {
    const engine = fixture()
    engine.persistIntent(grant)
    engine.spawn(grant)
    engine.register(grant, reference, 'complete')
    const epoch = engine.epoch
    const proof = {
      grant,
      epoch,
      reference: retiredReference,
      treeEmpty: true,
      effectsDrained: true,
    }
    expect(engine.settle({ ...proof, treeEmpty: false })).toBe('refused')
    expect(engine.settle({ ...proof, effectsDrained: false })).toBe('refused')
    expect(engine.settle({ ...proof, grant: 'grant-B' })).toBe('refused')
    expect(engine.settle({ ...proof, epoch: 'epoch-B' })).toBe('refused')
    expect(
      engine.settle({
        ...proof,
        reference: { ...retiredReference, token: 'other' },
      }),
    ).toBe('refused')
    expect(
      engine.settle({
        ...proof,
        reference: { ...reference, exited: false },
      }),
    ).toBe('refused')
    expect(engine.held(grant)).toEqual([...resources])
    expect(engine.settle(proof)).toBe('released')
    expect(engine.held(grant)).toEqual([])
    // A lost acknowledgement retries the same grant: a duplicate, plus its recorded outcome.
    expect(engine.settle(proof)).toBe('duplicate')
    expect(engine.outcomeOf(grant)).toEqual({ epoch, token: retiredReference.token })
    expect(engine.outcomeOf('missing')).toBeUndefined()
    const recovered = restarted(engine)
    expect(recovered.held(grant)).toEqual([])
    expect(
      refusalOf(() => {
        recovered.reserve(grant, owner, [...resources])
      }),
    ).toBe('grantReused')
    recovered.reserve('grant-B', 'window-B', [...resources])
    expect(recovered.outcomeOf(grant)).toEqual({ epoch, token: retiredReference.token })
  })

  it('a settled tombstone stands until acknowledged, then collects exactly once', () => {
    const engine = fixture()
    engine.persistIntent(grant)
    engine.spawn(grant)
    engine.register(grant, reference, 'complete')
    expect(engine.acknowledgeSettled(grant)).toBe(false)
    expect(engine.collectAcknowledged()).toEqual([])
    expect(
      engine.settle({
        grant,
        epoch: engine.epoch,
        reference: retiredReference,
        treeEmpty: true,
        effectsDrained: true,
      }),
    ).toBe('released')
    // Unacknowledged, the tombstone stands: collection keeps it, and the
    // outcome stays readable for the lost acknowledgement's retry.
    expect(engine.collectAcknowledged()).toEqual([])
    expect(engine.outcomeOf(grant)).toEqual({ epoch: engine.epoch, token: retiredReference.token })
    expect(engine.acknowledgeSettled(grant)).toBe(true)
    expect(engine.acknowledgeSettled(grant)).toBe(false)
    expect(engine.collectAcknowledged()).toEqual([grant])
    expect(engine.collectAcknowledged()).toEqual([])
    expect(engine.outcomeOf(grant)).toBeUndefined()
    expect(engine.acknowledgeSettled('missing')).toBe(false)
  })

  it('leader exit, a process group and missing confirmation cannot prove descendant retirement', () => {
    for (const kind of ['pidfd', 'processGroup', 'psSeconds'] as const) {
      const engine = fixture()
      engine.persistIntent(grant)
      engine.spawn(grant)
      const observed = { ...retiredReference, kind }
      engine.register(grant, observed, 'complete')
      expect(
        engine.settle({
          grant,
          epoch: engine.epoch,
          reference: observed,
          treeEmpty: false,
          effectsDrained: true,
        }),
      ).toBe('refused')
      expect(engine.held(grant)).toEqual([...resources])
    }
    const engine = fixture()
    engine.persistIntent(grant)
    engine.spawn(grant)
    expect(
      engine.settle({
        grant,
        epoch: engine.epoch,
        reference: retiredReference,
        treeEmpty: true,
        effectsDrained: true,
      }),
    ).toBe('refused')
  })

  it('restart invalidates old retirement authority while preserving unresolved grants', () => {
    const engine = fixture()
    const epoch = engine.epoch
    engine.persistIntent(grant)
    engine.spawn(grant)
    engine.register(grant, reference, 'complete')
    const recovered = restarted(engine)
    expect(recovered.retirementState(grant)).toBe('unknown')
    expect(
      recovered.settle({
        grant,
        epoch,
        reference: retiredReference,
        treeEmpty: true,
        effectsDrained: true,
      }),
    ).toBe('refused')
    expect(
      recovered.settle({
        grant,
        epoch: recovered.epoch,
        reference: retiredReference,
        treeEmpty: true,
        effectsDrained: true,
      }),
    ).toBe('refused')
    expect(recovered.held(grant)).toEqual([...resources])
  })

  it('a restored snapshot rolls a mutation back exactly', () => {
    const engine = fixture()
    const before = engine.snapshot()
    engine.persistIntent(grant)
    engine.spawn(grant)
    engine.restore(before)
    expect(engine.held(grant)).toEqual([...resources])
    expect(
      refusalOf(() => {
        engine.spawn(grant)
      }),
    ).toBe('badPhase')
    engine.persistIntent(grant)
    engine.spawn(grant)
  })

  // The decision is platform-independent given its inputs: the
  // per-OS evidence (native qualification, scope proof) arrives
  // already read. The matrix runs over filesystems and qualification.
  for (const filesystem of [
    'fat32',
    'exfat',
    'nfs',
    'smb',
    'ephemeral',
    'syncBacked',
    'unknown',
  ] as const) {
    it(`${filesystem}: fallback only before enrolment; unresolved work stays held`, () => {
      const prerequisites = {
        filesystem,
        nativeQualified: true,
        scopeQualified: true,
        storeValid: true,
      } as const
      expect(chooseCoordinatorMode(prerequisites, false).mode).toBe('windowScoped')
      expect(chooseCoordinatorMode(prerequisites, false).reason).toBeTruthy()
      expect(chooseCoordinatorMode(prerequisites, true).mode).toBe('blocked')
    })
  }
  it('unqualified native helpers or damaged durable state cannot enrol', () => {
    const prerequisites = {
      filesystem: 'local',
      nativeQualified: true,
      scopeQualified: true,
      storeValid: true,
    } as const
    expect(chooseCoordinatorMode(prerequisites, false)).toEqual({
      mode: 'machine',
      reason: undefined,
    })
    expect(chooseCoordinatorMode({ ...prerequisites, nativeQualified: false }, false).mode).toBe(
      'windowScoped',
    )
    expect(chooseCoordinatorMode({ ...prerequisites, scopeQualified: false }, false).mode).toBe(
      'windowScoped',
    )
    expect(chooseCoordinatorMode({ ...prerequisites, storeValid: false }, false).mode).toBe(
      'blocked',
    )
    expect(chooseCoordinatorMode({ ...prerequisites, nativeQualified: false }, true).mode).toBe(
      'blocked',
    )
  })
})

const fileStores: string[] = []
afterEach(async () => {
  for (const directory of fileStores.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

function magicReader(type: number | bigint | undefined): {
  statfsType: () => Promise<number | bigint | undefined>
} {
  return {
    statfsType: () => Promise.resolve(type),
  }
}

describe('M96d store qualification', () => {
  it('maps documented Linux filesystem magics and refuses sync-backed stores', async () => {
    const directory = path.join(tmpdir(), 'm96d-fs-kind')
    for (const magic of COORDINATOR_LINUX_FS_LOCAL) {
      expect(
        await coordinatorFilesystemKind(directory, tmpdir(), 'linux', magicReader(magic)),
      ).toBe('local')
    }
    expect(
      await coordinatorFilesystemKind(
        directory,
        tmpdir(),
        'linux',
        magicReader(COORDINATOR_LINUX_FS_FAT),
      ),
    ).toBe('fat32')
    expect(
      await coordinatorFilesystemKind(
        directory,
        tmpdir(),
        'linux',
        magicReader(COORDINATOR_LINUX_FS_EXFAT),
      ),
    ).toBe('exfat')
    expect(
      await coordinatorFilesystemKind(
        directory,
        tmpdir(),
        'linux',
        magicReader(COORDINATOR_LINUX_FS_NFS),
      ),
    ).toBe('nfs')
    expect(
      await coordinatorFilesystemKind(
        directory,
        tmpdir(),
        'linux',
        magicReader(COORDINATOR_LINUX_FS_SMB2),
      ),
    ).toBe('smb')
    expect(
      await coordinatorFilesystemKind(
        directory,
        tmpdir(),
        'linux',
        magicReader(COORDINATOR_LINUX_FS_TMPFS),
      ),
    ).toBe('ephemeral')
    expect(
      await coordinatorFilesystemKind(directory, tmpdir(), 'linux', magicReader(0x12_34)),
    ).toBe('unknown')
    expect(
      await coordinatorFilesystemKind(directory, tmpdir(), 'linux', magicReader(undefined)),
    ).toBe('unknown')
    // Node names no filesystem off Linux: honestly unknown, never local.
    expect(await coordinatorFilesystemKind(directory, tmpdir(), 'darwin')).toBe('unknown')
    expect(await coordinatorFilesystemKind(directory, tmpdir(), 'win32')).toBe('unknown')
    // A store beneath a sync root reads sync-backed on every platform.
    expect(isBeneathSyncRoot(path.join(homedir(), 'work', 'store'), homedir())).toBe(false)
    const home = await mkdtemp(path.join(tmpdir(), 'm96d-home-'))
    fileStores.push(home)
    const synced = path.join(home, 'Dropbox', 'store')
    expect(isBeneathSyncRoot(synced, home)).toBe(true)
    expect(await coordinatorFilesystemKind(synced, home)).toBe('syncBacked')
    expect(
      isBeneathSyncRoot(
        String.raw`C:\Users\someone\OneDrive - Tenant\store`,
        String.raw`C:\Users\someone`,
        'win32',
      ),
    ).toBe(true)
    expect(
      isBeneathSyncRoot(
        '/Users/someone/Library/Mobile Documents/store',
        '/Users/someone',
        'darwin',
      ),
    ).toBe(true)
    // The production reader answers the kernel: the magic number on
    // a live directory, unknown on a missing one.
    expect(typeof (await coordinatorStatfsReader.statfsType(tmpdir()))).toBe('number')
    expect(
      await coordinatorStatfsReader.statfsType(path.join(tmpdir(), `m96d-missing-${randomUUID()}`)),
    ).toBeUndefined()
  })
})
