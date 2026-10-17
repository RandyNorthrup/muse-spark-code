// The permission policy (M78, PLAN.md D49): profiles bind the file tools,
// a repository can only tighten, and every mistake fails closed and is
// said once.

import { describe, expect, it } from 'vitest'
import {
  compilePolicy,
  describePolicyProblem,
  type PolicyProblem,
  PolicyCache,
} from '../../src/core/backends/modelapi/permissionPolicy'
import type { PermissionSettings } from '../../src/core/permissionSettings'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'
import { PERMISSION_PROFILE_NAME_MAX_CHARS } from '../../src/shared/constants'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'

const NONE: PermissionSettings = {
  commandRules: [],
  profiles: {},
  profile: '',
  repositoryRules: {},
}

function settings(overrides: Partial<PermissionSettings>): PermissionSettings {
  return { ...NONE, ...overrides }
}

describe('compilePolicy: profiles (M78)', () => {
  it('has no profile and denies nothing when none is chosen', () => {
    const policy = compilePolicy(
      settings({ profiles: { locked: { denyRead: ['**/.env'] } } }),
      'linux',
    )
    expect(policy.profileName).toBeUndefined()
    expect(policy.files.isDenied(['.env'])).toBe(false)
    expect(policy.problems).toEqual([])
  })

  it('binds the chosen profile’s deny-read globs, a folder by what is under it, case ignored', () => {
    const policy = compilePolicy(
      settings({
        profiles: { locked: { denyRead: ['**/.env', 'secrets', '*.PEM'] } },
        profile: 'locked',
      }),
      'linux',
    )
    expect(policy.profileName).toBe('locked')
    expect(policy.files.isDenied(['.env'])).toBe(true)
    expect(policy.files.isDenied(['app/.ENV'])).toBe(true)
    expect(policy.files.isDenied(['secrets/key.txt'])).toBe(true)
    expect(policy.files.isDenied(['deep/secrets/key.txt'])).toBe(true)
    expect(policy.files.isDenied(['certs/server.pem'])).toBe(true)
    expect(policy.files.isDenied(['src/index.ts'])).toBe(false)
    // A link's canonical form is checked beside its name.
    expect(policy.files.isDenied(['harmless.txt', '.env'])).toBe(true)
    expect(policy.files.denyGlobs).toEqual(['**/.env', 'secrets', '*.pem'])
  })

  it('keeps absolute extra roots, normalized, and leaves out a relative one', () => {
    const policy = compilePolicy(
      settings({
        profiles: { wide: { extraRoots: ['/opt/docs/', 'docs', '/srv/../srv/data'] } },
        profile: 'wide',
      }),
      'linux',
    )
    expect(policy.files.extraRoots).toEqual(['/opt/docs', '/srv/data'])
    expect(policy.problems).toEqual([{ kind: 'rootInvalid', root: 'docs' }])
  })

  it('fails closed on a profile named but not defined: the shell asks, and it is said', () => {
    const policy = compilePolicy(settings({ profile: 'typo' }), 'linux')
    expect(policy.profileName).toBe('typo')
    expect(policy.files.isDenyAll).toBe(true)
    expect(policy.problems).toEqual([{ kind: 'profileUnknown', name: 'typo' }])
    expect(policy.files.isDenied(['private.txt'])).toBe(true)
  })

  it('fails closed on a profile that is not valid: every file is denied', () => {
    const policy = compilePolicy(
      settings({ profiles: { bad: { denyRead: 'not a list' } }, profile: 'bad' }),
      'linux',
    )
    expect(policy.profileName).toBe('bad')
    expect(policy.files.isDenyAll).toBe(true)
    expect(policy.files.isDenied(['anything.txt'])).toBe(true)
    expect(policy.problems[0]).toMatchObject({ kind: 'profileInvalid', name: 'bad' })
  })

  it('does not silently drop misspelled or unsupported profile restrictions', () => {
    const policy = compilePolicy(
      settings({ profiles: { locked: { denyread: ['private.txt'] } }, profile: 'locked' }),
      'linux',
    )
    expect(policy.files.isDenied(['private.txt'])).toBe(true)
    expect(policy.problems[0]).toMatchObject({ kind: 'profileInvalid', name: 'locked' })
  })

  it('reports unsupported profile data without echoing credential-like field names', () => {
    const field = CURRENT_SHAPE_KEYS[0]
    const policy = compilePolicy(
      settings({ profiles: { locked: { [field]: true } }, profile: 'locked' }),
      'linux',
    )
    const problem = policy.problems[0]
    if (problem === undefined) throw new Error('Expected an unsupported profile problem')
    expect(describePolicyProblem(problem)).not.toContain(field)
    expect(describePolicyProblem(problem)).toContain(EN.permissionProfileInvalidData)
    expect(policy.files.isDenied(['private.txt'])).toBe(true)
  })

  it.each([false, { invalid: true }, 'x'.repeat(PERMISSION_PROFILE_NAME_MAX_CHARS + 1)])(
    'denies files for malformed profile selection %j',
    (profile) => {
      const policy = compilePolicy(settings({ profile }), 'linux')
      expect(policy.profileName).toBeDefined()
      expect(policy.files.isDenied(['private.txt'])).toBe(true)
      expect(policy.problems[0]).toMatchObject({ kind: 'profileInvalid' })
    },
  )

  it('fails closed on a glob that cannot be read: every file is denied', () => {
    const policy = compilePolicy(
      settings({ profiles: { p: { denyRead: ['x'.repeat(10_000)] } }, profile: 'p' }),
      'linux',
    )
    expect(policy.files.isDenyAll).toBe(true)
    expect(policy.problems[0]).toMatchObject({ kind: 'globInvalid' })
  })
})

describe('compilePolicy: what a repository adds can only tighten (M78)', () => {
  it('adds its deny-read globs and its ask and forbid rules, without a profile', () => {
    const policy = compilePolicy(
      settings({
        repositoryRules: {
          denyRead: ['fixtures/private/**'],
          commandRules: [
            { pattern: ['git', 'push'], decision: 'ask', match: ['git push'] },
            { pattern: ['ls'], decision: 'allow', match: ['ls'] },
          ],
        },
      }),
      'linux',
    )
    expect(policy.profileName).toBeUndefined()
    expect(policy.files.isDenied(['fixtures/private/a.json'])).toBe(true)
    expect(policy.commandRules.map((rule) => rule.decision)).toEqual(['ask'])
    expect(policy.problems).toEqual([
      {
        kind: 'rule',
        source: 'repository',
        problem: { kind: 'allowInRepository', index: 2, pattern: 'ls', detail: '' },
      },
    ])
  })

  it('cannot add an extra root, a profile, or a choice of profile: they are not read', () => {
    // VS Code's settings editor flags the unknown keys (the manifest's
    // schema has no room for them); the backend never reads them.
    const policy = compilePolicy(
      settings({ repositoryRules: { extraRoots: ['/'], profile: 'open', denyRead: ['a'] } }),
      'linux',
    )
    expect(policy.files.extraRoots).toEqual([])
    expect(policy.profileName).toBeUndefined()
    expect(policy.files.isDenied(['a'])).toBe(true)
    expect(policy.problems).toEqual([])
  })

  it('says so when the repository’s setting is not rules at all, and applies nothing of it', () => {
    const policy = compilePolicy(settings({ repositoryRules: { denyRead: 'a' } }), 'linux')
    expect(policy.files.isDenied(['a'])).toBe(false)
    expect(policy.problems[0]).toMatchObject({ kind: 'repositoryInvalid' })
  })

  it('reads an absent repository setting as nothing', () => {
    expect(compilePolicy(settings({ repositoryRules: undefined }), 'linux').problems).toEqual([])
  })
})

describe('describePolicyProblem: each problem in the user’s words (M78)', () => {
  const cases: readonly (readonly [PolicyProblem, string])[] = [
    [
      {
        kind: 'rule',
        source: 'user',
        problem: { kind: 'exampleFailed', index: 2, pattern: 'git', detail: 'git push' },
      },
      fill(EN.commandRuleExampleFailed, {
        setting: 'museSpark.modelApiCommandRules',
        index: 2,
        pattern: 'git',
        detail: 'git push',
      }),
    ],
    [
      {
        kind: 'rule',
        source: 'repository',
        problem: { kind: 'allowInRepository', index: 1, pattern: 'ls', detail: '' },
      },
      fill(EN.commandRuleAllowInRepository, {
        setting: 'museSpark.modelApiRepositoryRules',
        index: 1,
        pattern: 'ls',
        detail: '',
      }),
    ],
    [
      { kind: 'profileUnknown', name: 'typo' },
      fill(EN.permissionProfileUnknown, {
        setting: 'museSpark.modelApiPermissionProfile',
        name: 'typo',
      }),
    ],
    [
      { kind: 'profileInvalid', name: 'bad', detail: 'oops' },
      fill(EN.permissionProfileInvalid, {
        setting: 'museSpark.modelApiPermissionProfiles',
        name: 'bad',
        detail: 'oops',
      }),
    ],
    [
      { kind: 'globInvalid', glob: '{', detail: 'too long' },
      fill(EN.permissionGlobInvalid, { glob: '{', detail: 'too long' }),
    ],
    [
      { kind: 'rootInvalid', root: 'docs' },
      fill(EN.permissionRootInvalid, {
        setting: 'museSpark.modelApiPermissionProfiles',
        root: 'docs',
      }),
    ],
    [
      { kind: 'repositoryInvalid', detail: 'x' },
      fill(EN.permissionRepositoryInvalid, {
        setting: 'museSpark.modelApiRepositoryRules',
        detail: 'x',
      }),
    ],
  ]
  it.each(cases)('%j', (problem, text) => {
    expect(describePolicyProblem(problem)).toBe(text)
  })

  it('says every kind of rule problem', () => {
    for (const kind of [
      'invalid',
      'invalidKept',
      'exampleFailedKept',
      'allowsEvaluator',
      'tooMany',
    ] as const) {
      const text = describePolicyProblem({
        kind: 'rule',
        source: 'user',
        problem: { kind, index: 3, pattern: 'p', detail: 'd' },
      })
      expect(text).toContain('museSpark.modelApiCommandRules')
    }
  })
})

describe('PolicyCache: compiled once for each value, its problems said once (M78)', () => {
  it('reports a value’s problems the first time only, and again after it changes', () => {
    let current = settings({ profile: 'typo' })
    const cache = new PolicyCache(() => current, 'linux')
    expect(cache.current().fresh).toHaveLength(1)
    expect(cache.current().fresh).toEqual([])
    current = settings({ profile: 'other' })
    expect(cache.current().fresh).toEqual([{ kind: 'profileUnknown', name: 'other' }])
    current = settings({})
    const { policy, fresh } = cache.current()
    expect(fresh).toEqual([])
    expect(policy.profileName).toBeUndefined()
  })
})
