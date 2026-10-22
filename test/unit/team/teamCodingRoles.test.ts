import { describe, expect, it } from 'vitest'
import {
  areaScore,
  defaultAreaHints,
  defaultSecondaryRoles,
  isAreaMatch,
  routeTaskToRole,
  splitOrCrossReview,
  type RoutedTask,
} from '../../../src/core/team/codingRoles'
import {
  teamPreferenceListSchema,
  type TeamPreferenceList,
} from '../../../src/shared/teamPreference'

function list(role: string, areaHints?: TeamPreferenceList['areaHints']): TeamPreferenceList {
  return teamPreferenceListSchema.parse({
    role,
    pool: [],
    ...(areaHints !== undefined && { areaHints }),
  })
}

function lists(): TeamPreferenceList[] {
  return [list('frontend'), list('backend'), list('engineering')]
}

describe('M120 lane R routing', () => {
  it('routes a front-end task to the frontend list with the reason shown', () => {
    const task: RoutedTask = { files: ['src/webview/components/Panel.tsx'], kinds: ['ui'] }
    const route = routeTaskToRole(task, lists())
    expect(route).toMatchObject({ kind: 'routed', roleId: 'frontend' })
    if (route.kind !== 'routed') throw new Error('test:route')
    expect(route.reason).toContain('frontend')
  })

  it('routes a back-end task to the backend list with the reason shown', () => {
    const task: RoutedTask = { files: ['src/server/routes.ts'], kinds: ['api'] }
    const route = routeTaskToRole(task, lists())
    expect(route).toMatchObject({ kind: 'routed', roleId: 'backend' })
    if (route.kind !== 'routed') throw new Error('test:route')
    expect(route.reason).toContain('backend')
  })

  it('routes an unmatched task nowhere with the engineering fallback named', () => {
    const route = routeTaskToRole({ files: ['notes.txt'], kinds: ['prose'] }, lists())
    expect(route).toMatchObject({ kind: 'noMatch' })
    if (route.kind !== 'noMatch') throw new Error('test:route')
    expect(route.reason).toContain('engineering')
  })

  it('routes a user specialization by its own area hints', () => {
    const custom = list('docs-writer', {
      globs: ['docs/**'],
      kinds: ['docs'],
    })
    const route = routeTaskToRole({ files: ['docs/guide.md'], kinds: ['docs'] }, [
      ...lists(),
      custom,
    ])
    expect(route).toMatchObject({ kind: 'routed', roleId: 'docs-writer' })
  })

  it('splits a mixed task per area', () => {
    const plan = splitOrCrossReview(
      {
        files: ['src/webview/Panel.tsx', 'src/server/routes.ts'],
        kinds: ['ui', 'api'],
      },
      lists(),
    )
    expect(plan.kind).toBe('split')
    if (plan.kind !== 'split') throw new Error('test:split')
    expect(plan.parts).toEqual([
      { roleId: 'frontend', files: ['src/webview/Panel.tsx'] },
      { roleId: 'backend', files: ['src/server/routes.ts'] },
    ])
    expect(plan.reason).toContain('frontend')
  })

  it('cross-reviews a single-file mixed-kind task by the other specialist', () => {
    const plan = splitOrCrossReview({ files: ['shared.ts'], kinds: ['ui', 'api'] }, lists())
    expect(plan).toMatchObject({ kind: 'crossReview', roleId: 'backend' })
    if (plan.kind !== 'crossReview') throw new Error('test:cross')
    expect(plan.reason).toContain('frontend')
    expect(plan.reason).toContain('backend')
  })

  it('keeps a single-area task single', () => {
    const plan = splitOrCrossReview(
      { files: ['src/webview/Panel.tsx', 'src/webview/styles.css'], kinds: ['ui'] },
      lists(),
    )
    expect(plan).toEqual({ kind: 'single', roleId: 'frontend' })
  })

  it('matches Windows paths the same way', () => {
    expect(isAreaMatch('src/webview/**', String.raw`src\webview\Panel.tsx`)).toBe(true)
    expect(isAreaMatch('**/*.tsx', String.raw`src\webview\Panel.tsx`)).toBe(true)
    expect(isAreaMatch('**/*.tsx', String.raw`src\server\routes.ts`)).toBe(false)
    expect(isAreaMatch('exact/path.ts', String.raw`exact\path.ts`)).toBe(true)
  })

  it('scores globs and kinds per list', () => {
    const hints = defaultAreaHints('frontend')
    expect(areaScore(hints, { files: ['a.tsx'], kinds: [] })).toBe(1)
    expect(areaScore(hints, { files: [], kinds: ['UI'] })).toBe(1)
    expect(areaScore(hints, { files: [], kinds: ['server'] })).toBe(0)
  })

  it('sets D212 secondary roles out of the box', () => {
    expect(defaultSecondaryRoles('frontend')).toEqual(['backend', 'engineering'])
    expect(defaultSecondaryRoles('backend')).toEqual(['frontend', 'engineering'])
    expect(defaultSecondaryRoles('code-review')).toEqual(['engineering'])
    expect(defaultSecondaryRoles('engineering')).toEqual([])
  })
})
