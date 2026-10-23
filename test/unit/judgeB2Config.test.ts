// M125 lane F2: the B2 repository exclusions, configuration keys
// and manager resolution, over the real module with a controlled
// executable port.
import { describe, expect, it } from 'vitest'
import {
  checkB2ConfigKeys,
  npmrcKeys,
  pnpmFieldKeys,
  pnpmWorkspaceKeys,
  refusedByManagerFiles,
  resolveB2Manager,
} from '../../src/core/judge/fast/b2Config'

describe('B2 manager files', () => {
  it('excludes yarn and pnpmfile repositories', () => {
    const clean = { yarnLock: false, yarnrc: false, yarnrcYml: false, pnpmfile: false }
    expect(refusedByManagerFiles(clean)).toBeUndefined()
    expect(refusedByManagerFiles({ ...clean, yarnLock: true })).toBe('yarn')
    expect(refusedByManagerFiles({ ...clean, yarnrcYml: true })).toBe('yarn')
    expect(refusedByManagerFiles({ ...clean, pnpmfile: true })).toBe('pnpmfile')
  })
})

describe('B2 configuration keys', () => {
  it('admits only keys that name no program, file or code', () => {
    expect(
      checkB2ConfigKeys([{ source: '.npmrc', keys: ['save-exact', 'engine-strict'] }]),
    ).toEqual({
      ok: true,
    })
    expect(checkB2ConfigKeys([{ source: 'pnpm-workspace.yaml', keys: ['packages'] }])).toEqual({
      ok: true,
    })
    expect(checkB2ConfigKeys([{ source: '.npmrc', keys: ['node-options'] }])).toEqual({
      ok: false,
      source: '.npmrc',
      key: 'node-options',
    })
    expect(checkB2ConfigKeys([{ source: 'x', keys: ['Node-Options'] }])).toEqual({
      ok: false,
      source: 'x',
      key: 'Node-Options',
    })
  })

  it('reads npmrc keys and refuses anything else', () => {
    expect(npmrcKeys('save-exact=true\n# comment\n; other\n  engine-strict = true\n')).toEqual([
      'save-exact',
      'engine-strict',
    ])
    expect(npmrcKeys('bare word')).toBeUndefined()
    expect(npmrcKeys('[section]\nkey=value')).toBeUndefined()
    expect(npmrcKeys('=value')).toBeUndefined()
  })

  it('reads pnpm workspace and field keys', () => {
    expect(pnpmWorkspaceKeys('packages:\n  - apps/*\n')).toEqual(['packages'])
    expect(pnpmWorkspaceKeys('packages: [x]\nnodeOptions: --require ./y\n')).toEqual([
      'packages',
      'nodeOptions',
    ])
    expect(pnpmWorkspaceKeys('应的[')).toBeUndefined()
    expect(pnpmWorkspaceKeys('- just\n- a\n- list\n')).toBeUndefined()
    expect(pnpmFieldKeys(undefined)).toEqual([])
    expect(pnpmFieldKeys({ packages: ['x'] })).toEqual(['packages'])
    expect(pnpmFieldKeys(['x'])).toBeUndefined()
  })
})

function resolve(
  pathValue: string,
  executables: Readonly<Record<string, string>>,
  manager: 'npm' | 'pnpm' = 'npm',
): { readonly ok: boolean; readonly path?: string; readonly reason?: string } {
  const verdict = resolveB2Manager(
    pathValue,
    '/home/u/proj',
    manager,
    (candidate) => executables[candidate],
  )
  return verdict.ok ? { ok: true, path: verdict.path } : { ok: false, reason: verdict.reason }
}

describe('B2 manager resolution', () => {
  it('resolves outside the workspace and skips inside it', () => {
    expect(
      resolve('/usr/bin:/home/u/proj/node_modules/.bin', { '/usr/bin/npm': '/usr/bin/npm' }),
    ).toEqual({ ok: true, path: '/usr/bin/npm' })
    expect(
      resolve('/home/u/proj/node_modules/.bin:/usr/bin', {
        '/home/u/proj/node_modules/.bin/npm': '/home/u/proj/node_modules/.bin/npm',
        '/usr/bin/npm': '/usr/bin/npm',
      }),
    ).toEqual({ ok: true, path: '/usr/bin/npm' })
    expect(resolve('/usr/bin', {}, 'pnpm')).toEqual({ ok: false, reason: 'managerNotFound' })
    expect(resolve('relative/bin:/usr/bin', { '/usr/bin/npm': '/usr/bin/npm' })).toEqual({
      ok: true,
      path: '/usr/bin/npm',
    })
  })

  it('refuses a link that lands in the workspace', () => {
    expect(resolve('/usr/bin', { '/usr/bin/npm': '/home/u/proj/evil/npm' })).toEqual({
      ok: false,
      reason: 'workspaceTarget',
    })
  })
})
