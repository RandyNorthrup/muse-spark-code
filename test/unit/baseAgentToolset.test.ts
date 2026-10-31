import { describe, expect, it } from 'vitest'
import { createBaseAgentToolset } from '../../src/core/context/baseAgentToolset'
import type { RuntimePrepareRequest, RuntimePreparation } from '../../src/core/browser/runtimeTypes'
import { createLifetime } from '../../src/core/browser/workLifetime'
import { recordCalls, scripted } from './helpers/recordCalls'

function setup() {
  // The person's answer belongs to the preparation (proven against the
  // real one in runtimeStore.test.ts): the toolset under test only threads
  // the request through, so its consent double records and must stay empty.
  const consent = recordCalls<[string, number, AbortSignal]>()
  const request: RuntimePrepareRequest = {
    storageDir: '/node/tools/storage',
    lifetime: createLifetime(10_000, [], 100),
    admissionStillValid: () => true,
    consent: (...args): Promise<'decline' | 'download'> => {
      consent.fn(...args)
      throw new Error('the toolset must never ask consent itself')
    },
  }
  // An arranged preparation result, as input to the wiring: the toolset
  // passes results through and gates calls on the flags; the preparation
  // itself is the runtime store's, proven there.
  const prepareRuntime = scripted((): Promise<RuntimePreparation> =>
    Promise.resolve({ ok: false, reason: 'runtimeDeclined' }),
  )
  const deps = {
    packageRoot: '/package',
    platform: 'linux' as const,
    museSkills: undefined,
    browserRequest: request,
    prepareRuntime,
  }
  return { consent, request, prepareRuntime, deps }
}

describe('base agent first-boot preparation', () => {
  it('defaults bundled source and automation-runtime preparation on, without doing work at construction', async () => {
    const test = setup()
    const tools = createBaseAgentToolset(test.deps)
    expect(tools.bundledSkills.isEnabled()).toBe(true)
    expect(tools.bundledSkills.packageRoot).toBe('/package/vendor/high-quality-projects-skill')
    expect(tools.bundledSkills.firstPartyRoot).toBe('/package/first-party-skills')
    expect(test.prepareRuntime.calls).toEqual([])
    const result = await tools.prepare()
    expect(result).toEqual({
      skills: { kind: 'notRequested' },
      browser: { ok: false, reason: 'runtimeDeclined' },
    })
    expect(test.prepareRuntime.calls).toEqual([[test.request]])
    expect(test.consent.calls).toEqual([])
    test.request.lifetime.end()
  })

  it('honours explicit false settings and reads them again on each preparation', async () => {
    const test = setup()
    let isEnabled = false
    const tools = createBaseAgentToolset({
      ...test.deps,
      bundledSkillsEnabled: () => isEnabled,
      browserRuntimeEnabled: () => isEnabled,
    })
    expect(tools.bundledSkills.isEnabled()).toBe(false)
    expect(await tools.prepare()).toEqual({
      skills: { kind: 'disabled' },
      browser: { kind: 'disabled' },
    })
    expect(test.prepareRuntime.calls).toEqual([])
    expect(test.consent.calls).toEqual([])
    isEnabled = true
    expect(tools.bundledSkills.isEnabled()).toBe(true)
    expect(await tools.prepare()).toMatchObject({
      browser: { ok: false, reason: 'runtimeDeclined' },
    })
    test.request.lifetime.end()
  })

  it('uses the chosen platform for portable package roots', () => {
    const test = setup()
    const tools = createBaseAgentToolset({
      ...test.deps,
      packageRoot: String.raw`C:\agent`,
      platform: 'win32',
    })
    expect(tools.bundledSkills.packageRoot).toBe(
      String.raw`C:\agent\vendor\high-quality-projects-skill`,
    )
    expect(tools.bundledSkills.firstPartyRoot).toBe(String.raw`C:\agent\first-party-skills`)
    test.request.lifetime.end()
  })

  it('reports a missing Muse Code vendor explicitly rather than inventing an installed skill copy', async () => {
    const test = setup()
    const tools = createBaseAgentToolset({
      ...test.deps,
      museSkills: {
        log: { warn: () => undefined },
        vendorRoot: '/nonexistent-m110-b0-vendor',
        skillsRoot: '/nonexistent-m110-b0-skills',
        sourcesRoot: '/nonexistent-m110-b0-sources',
        platform: 'linux',
        now: () => 0,
        newId: () => 'id',
      },
    })
    expect(await tools.prepare()).toMatchObject({
      skills: { failure: { reason: { kind: 'error' } } },
    })
    test.request.lifetime.end()
  })
})
