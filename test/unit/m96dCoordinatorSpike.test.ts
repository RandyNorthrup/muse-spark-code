import { describe, expect, it } from 'vitest'
import {
  CoordinatorSpecification,
  chooseMode,
  signalTarget,
  type NativeReference,
} from './helpers/m96dCoordinatorSpecification'

// Written before the specification. These are design counterexamples, not
// conformance receipts for a production coordinator or another operating system.
const platforms = ['linux', 'darwin', 'win32'] as const
const resources = ['worker', 'processWorker', 'heavyCommand', 'singleton', 'landing'] as const
const owner = 'window-A'
const grant = 'grant-A'
const epoch = 'epoch-A'
const reference: NativeReference = {
  platform: 'linux',
  kind: 'pidfd',
  token: 'held-reference-A',
  boot: 'boot-A',
  start: '1000001',
  pid: 42,
  validated: true,
  exited: false,
}
const retiredReference: NativeReference = { ...reference, exited: true }

function referenceFor(platform: NativeReference['platform']): NativeReference {
  const kinds = { linux: 'pidfd', win32: 'processHandle', darwin: 'ownedChild' } as const
  return {
    ...reference,
    platform,
    kind: kinds[platform],
  }
}

function fixture() {
  const spec = new CoordinatorSpecification(epoch)
  expect(spec.reserve(grant, owner, resources)).toBe(true)
  return spec
}

describe('M96d RVM96C2 adversarial schedules', () => {
  for (const platform of platforms) {
    for (const error of ['ECONNREFUSED', 'ENOENT', 'ERROR_PIPE_BUSY', 'EOF']) {
      it(`F1 ${platform}: ${error} from a live owner cannot elect or release`, () => {
        const spec = fixture()
        spec.endpointFailed(error)
        spec.advanceClock()
        expect(spec.reachable).toBe(false)
        expect(spec.electSuccessor(false)).toBe(false)
        expect(spec.held(grant)).toEqual(resources)
        expect(spec.reserve('grant-B', 'window-B', resources)).toBe(false)
      })
    }

    for (const boundary of ['intent', 'spawn', 'registration', 'resume', 'detachedChild']) {
      it(`F2 ${platform}: crash after ${boundary} retains every launch liability`, () => {
        const spec = fixture()
        expect(spec.persistIntent(grant, true)).toBe(true)
        if (boundary !== 'intent') expect(spec.spawn(grant)).toBe(true)
        if (boundary !== 'intent' && boundary !== 'spawn')
          spec.register(grant, referenceFor(platform), 'complete')
        if (boundary === 'resume' || boundary === 'detachedChild') spec.resume(grant)
        spec.ownerExited(owner)
        expect(spec.held(grant)).toEqual(resources)
        expect(spec.reserve('grant-B', 'window-B', resources)).toBe(false)
        const recovered = spec.restart('epoch-B')
        expect(recovered.held(grant)).toEqual(resources)
        expect(recovered.reserve('grant-B', 'window-B', resources)).toBe(false)
      })
    }

    it(`F3 ${platform}: mistaken user confirmation cannot hand off a pending rename`, () => {
      const spec = fixture()
      spec.persistIntent(grant, true)
      spec.spawn(grant)
      spec.register(grant, referenceFor(platform), 'complete')
      spec.resume(grant)
      spec.freezeBeforeRename(grant)
      expect(spec.userConfirmedStopped(grant)).toBe(false)
      expect(
        spec.settle(
          {
            grant,
            epoch,
            reference: { ...referenceFor(platform), exited: true },
            treeEmpty: true,
            effectsDrained: true,
          },
          true,
        ),
      ).toBe(false)
      spec.advanceClock()
      expect(spec.reserve('grant-B', 'window-B', ['landing'])).toBe(false)
      expect(spec.completePendingRename(grant)).toBe(true)
      expect(spec.landed).toEqual([grant])
      expect(spec.held(grant)).toEqual(resources)
    })
  }

  it('F2: spawn is impossible before durable intent or after a failed sync', () => {
    const spec = fixture()
    expect(spec.spawn(grant)).toBe(false)
    expect(spec.persistIntent(grant, false)).toBe(false)
    expect(spec.spawn(grant)).toBe(false)
    expect(spec.held(grant)).toEqual(resources)
  })

  it('F4: microseconds distinguish macOS incarnations within one ps second', () => {
    const expected: NativeReference = { ...reference, platform: 'darwin', kind: 'ownedChild' }
    expect(signalTarget(expected, { ...expected, start: '1000002' })).toBeUndefined()
    expect(signalTarget(expected, { ...expected, kind: 'psSeconds' })).toBeUndefined()
    // Localised lstart text and a time-zone change provide no signal authority.
    expect(signalTarget(expected, { ...expected, start: 'Thu Oct 10 01:00:01' })).toBeUndefined()
  })

  for (const platform of ['linux', 'win32'] as const) {
    it(`F4 ${platform}: PID reuse between query and dispatch cannot retarget a signal`, () => {
      const expected: NativeReference = {
        ...reference,
        platform,
        kind: platform === 'linux' ? 'pidfd' : 'processHandle',
      }
      const nativeTargets = new Map([
        [expected.token, 'owned-old-process'],
        ['pid:42', 'unrelated-new-process'],
      ])
      const target = signalTarget(expected, expected)
      expect(target).toBe(expected.token)
      expect(target === undefined ? undefined : nativeTargets.get(target)).toBe('owned-old-process')
      expect(signalTarget(expected, { ...expected, token: 'new-reference' })).toBeUndefined()
      expect(signalTarget({ ...expected, validated: false }, expected)).toBeUndefined()
      expect(signalTarget(expected, { ...expected, validated: false })).toBeUndefined()
      expect(signalTarget(expected, { ...expected, boot: 'boot-B' })).toBeUndefined()
      expect(signalTarget(expected, { ...expected, exited: true })).toBeUndefined()
    })
  }

  it('F4 macOS: precise observation still cannot authorise a numeric-PID signal', () => {
    const child: NativeReference = { ...reference, platform: 'darwin', kind: 'ownedChild' }
    expect(signalTarget(child, child)).toBeUndefined()
  })
})

describe('M96d release and fallback obligations', () => {
  for (const evidence of ['empty Job', 'same SID', 'same logon session', 'process-start trace']) {
    it(`RVCM96D1: ${evidence} cannot retire an unqualified Windows scope`, () => {
      const spec = fixture()
      const live = referenceFor('win32')
      spec.persistIntent(grant, true)
      spec.spawn(grant)
      spec.register(grant, live, 'unknown')
      spec.resume(grant)
      // Captured Win32_Process.Create counterexample: the Job is empty, but
      // its brokered writer can still land. A caller's drain claim cannot
      // upgrade a boundary that never covered service-mediated effects.
      expect(
        spec.settle(
          {
            grant,
            epoch,
            reference: { ...live, exited: true },
            treeEmpty: true,
            effectsDrained: true,
          },
          true,
        ),
      ).toBe(false)
      expect(spec.retirementState(grant)).toBe('unknown')
      expect(spec.held(grant)).toEqual(resources)
      expect(spec.reserve('grant-B', 'window-B', resources)).toBe(false)
      const recovered = spec.restart('epoch-B')
      expect(recovered.retirementState(grant)).toBe('unknown')
      expect(recovered.reserve('grant-B', 'window-B', resources)).toBe(false)
    })
  }

  it('RVCM96D1: unproved scope coverage selects fallback only before enrolment', () => {
    for (const platform of platforms) {
      const prerequisites = {
        platform,
        filesystem: 'local',
        nativeQualified: true,
        scopeQualified: false,
        storeValid: true,
      }
      expect(chooseMode(prerequisites, false)).toBe('windowScoped')
      expect(chooseMode(prerequisites, true)).toBe('blocked')
    }
  })

  it('rejects reordered launch transitions and duplicate grant/intent publication', () => {
    const spec = fixture()
    expect(spec.reserve(grant, owner, [])).toBe(false)
    expect(() => {
      spec.register(grant, reference, 'complete')
    }).toThrow('Not spawned')
    expect(() => {
      spec.resume(grant)
    }).toThrow('Not registered')
    expect(spec.persistIntent('missing', true)).toBe(false)
    expect(spec.spawn('missing')).toBe(false)
    expect(spec.held('missing')).toEqual([])
    expect(() => {
      spec.freezeBeforeRename(grant)
    }).toThrow('Not running')
    expect(spec.completePendingRename(grant)).toBe(false)
    expect(spec.completePendingRename('missing')).toBe(false)
    expect(spec.persistIntent(grant, true)).toBe(true)
    expect(spec.persistIntent(grant, true)).toBe(false)
    expect(spec.spawn(grant)).toBe(true)
    expect(spec.spawn(grant)).toBe(false)
    spec.register(grant, reference, 'complete')
    expect(() => {
      spec.register(grant, reference, 'complete')
    }).toThrow('Not spawned')
    spec.resume(grant)
    expect(() => {
      spec.resume(grant)
    }).toThrow('Not registered')
  })

  it('new authority never frees the old ledger and cannot bypass a frozen holder', () => {
    const spec = fixture()
    expect(spec.electSuccessor(true)).toBe(true)
    expect(spec.held(grant)).toEqual(resources)
    expect(spec.reserve('grant-B', 'window-B', resources)).toBe(false)
  })

  for (const platform of platforms) {
    it(`${platform}: hypothetical complete qualified retirement has a positive release path`, () => {
      const spec = fixture()
      const live = referenceFor(platform)
      spec.persistIntent(grant, true)
      spec.spawn(grant)
      spec.register(grant, live, 'complete')
      expect(spec.retirementState(grant)).toBe('active')
      expect(
        spec.settle(
          {
            grant,
            epoch,
            reference: { ...live, exited: true },
            treeEmpty: true,
            effectsDrained: true,
          },
          true,
        ),
      ).toBe(true)
      expect(spec.retirementState(grant)).toBe('finished')
      expect(spec.reserve('grant-B', 'window-B', resources)).toBe(true)
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
      const spec = fixture()
      spec.persistIntent(grant, true)
      spec.spawn(grant)
      spec.register(grant, reference, 'complete')
      expect(
        spec.settle(
          {
            grant,
            epoch,
            reference: { ...retiredReference, ...change },
            treeEmpty: true,
            effectsDrained: true,
          },
          true,
        ),
      ).toBe(false)
      expect(spec.held(grant)).toEqual(resources)
    })
  }

  it('a matching but unsafe process-group or coarse reference cannot release even with a claimed empty tree', () => {
    for (const kind of ['processGroup', 'psSeconds'] as const) {
      const spec = fixture()
      const unsafe = { ...reference, kind }
      spec.persistIntent(grant, true)
      spec.spawn(grant)
      spec.register(grant, unsafe, 'complete')
      expect(
        spec.settle(
          {
            grant,
            epoch,
            reference: { ...unsafe, exited: true },
            treeEmpty: true,
            effectsDrained: true,
          },
          true,
        ),
      ).toBe(false)
      expect(spec.held(grant)).toEqual(resources)
    }
  })

  it('only exact durable complete retirement releases once; lost acknowledgement cannot reopen it', () => {
    const spec = fixture()
    spec.persistIntent(grant, true)
    spec.spawn(grant)
    spec.register(grant, reference, 'complete')
    const proof = {
      grant,
      epoch,
      reference: retiredReference,
      treeEmpty: true,
      effectsDrained: true,
    }
    expect(spec.settle({ ...proof, treeEmpty: false }, true)).toBe(false)
    expect(spec.settle({ ...proof, effectsDrained: false }, true)).toBe(false)
    expect(spec.settle({ ...proof, grant: 'grant-B' }, true)).toBe(false)
    expect(spec.settle({ ...proof, epoch: 'epoch-B' }, true)).toBe(false)
    expect(
      spec.settle({ ...proof, reference: { ...retiredReference, token: 'other' } }, true),
    ).toBe(false)
    expect(spec.settle({ ...proof, reference: { ...reference, exited: false } }, true)).toBe(false)
    expect(spec.settle(proof, false)).toBe(false)
    expect(spec.held(grant)).toEqual(resources)
    expect(spec.settle(proof, true)).toBe(true)
    expect(spec.held(grant)).toEqual([])
    expect(spec.settle(proof, true)).toBe(false)
    const recovered = spec.restart('epoch-B')
    expect(recovered.held(grant)).toEqual([])
    expect(recovered.reserve(grant, owner, resources)).toBe(false)
    expect(recovered.reserve('grant-B', 'window-B', resources)).toBe(true)
  })

  it('leader exit, a process group and missing confirmation cannot prove descendant retirement', () => {
    for (const kind of ['pidfd', 'processGroup', 'psSeconds'] as const) {
      const spec = fixture()
      spec.persistIntent(grant, true)
      spec.spawn(grant)
      const observed = { ...retiredReference, kind }
      spec.register(grant, observed, 'complete')
      expect(
        spec.settle(
          { grant, epoch, reference: observed, treeEmpty: false, effectsDrained: true },
          true,
        ),
      ).toBe(false)
      expect(spec.held(grant)).toEqual(resources)
    }
    const spec = fixture()
    spec.persistIntent(grant, true)
    spec.spawn(grant)
    expect(
      spec.settle(
        { grant, epoch, reference: retiredReference, treeEmpty: true, effectsDrained: true },
        true,
      ),
    ).toBe(false)
  })

  it('restart invalidates old retirement authority while preserving unresolved grants', () => {
    const spec = fixture()
    spec.persistIntent(grant, true)
    spec.spawn(grant)
    spec.register(grant, reference, 'complete')
    const recovered = spec.restart('epoch-B')
    expect(recovered.retirementState(grant)).toBe('unknown')
    expect(
      recovered.settle(
        { grant, epoch, reference: retiredReference, treeEmpty: true, effectsDrained: true },
        true,
      ),
    ).toBe(false)
    expect(
      recovered.settle(
        {
          grant,
          epoch: 'epoch-B',
          reference: retiredReference,
          treeEmpty: true,
          effectsDrained: true,
        },
        true,
      ),
    ).toBe(false)
    expect(recovered.held(grant)).toEqual(resources)
  })

  for (const platform of platforms) {
    for (const filesystem of ['fat32', 'exfat', 'nfs', 'unknown']) {
      it(`${platform} ${filesystem}: fallback only before enrolment; unresolved work stays held`, () => {
        const prerequisites = {
          platform,
          filesystem,
          nativeQualified: true,
          scopeQualified: true,
          storeValid: true,
        }
        expect(chooseMode(prerequisites, false)).toBe('windowScoped')
        expect(chooseMode(prerequisites, true)).toBe('blocked')
      })
    }
    it(`${platform}: unqualified native helpers or damaged durable state cannot enrol`, () => {
      const prerequisites = {
        platform,
        filesystem: 'local',
        nativeQualified: true,
        scopeQualified: true,
        storeValid: true,
      }
      expect(chooseMode(prerequisites, false)).toBe('machine')
      expect(chooseMode({ ...prerequisites, nativeQualified: false }, false)).toBe('windowScoped')
      expect(chooseMode({ ...prerequisites, storeValid: false }, false)).toBe('blocked')
      expect(chooseMode({ ...prerequisites, nativeQualified: false }, true)).toBe('blocked')
    })
  }
})
