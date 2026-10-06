// M91 lane X: Cline v1 discovery follows the source platform rules
// (test/fixtures/hookFormats/docs/cline-hooks-901d1b5c97.md:164-174,497-506):
// Windows runs <HookName>.ps1 only; Unix runs the extensionless <HookName>
// only, and it must be executable. Anything else is ignored, never
// converted. Fake filesystem throughout.
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clineFileName,
  discoverClineHooks,
  isClineScript,
} from '../../src/core/backends/modelapi/hookFormats/clineDiscover'

function fakeFs(
  files: Readonly<Record<string, readonly string[]>>,
  executable: ReadonlySet<string> = new Set(),
) {
  return {
    readdir: (dir: string): readonly string[] => {
      const entries = files[dir]
      if (entries === undefined) throw new Error(`ENOENT ${dir}`)
      return entries
    },
    isExecutable: (file: string): boolean => executable.has(file),
  }
}

const GLOBAL = '/home/u/Documents/Cline/Hooks'
const PROJECT = '/ws/.clinerules/hooks'
const posixJoin = path.posix.join
const windowsJoin = path.win32.join

beforeEach(() => {
  vi.spyOn(path, 'join').mockImplementation(posixJoin)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('expected filenames per platform', () => {
  it.each([
    ['linux', 'PreToolUse'],
    ['darwin', 'TaskStart'],
  ] as const)('%s expects the extensionless name', (platform, name) => {
    expect(clineFileName(platform, name)).toBe(name)
  })

  it('win32 expects HookName.ps1', () => {
    expect(clineFileName('win32', 'PreToolUse')).toBe('PreToolUse.ps1')
  })
})

function unixFs() {
  return fakeFs(
    {
      [GLOBAL]: ['PreToolUse', 'PreToolUse.ps1', 'PreToolUse.sh', 'TaskStart', 'notes.md'],
      [PROJECT]: ['PostToolUse'],
    },
    new Set([`${GLOBAL}/PreToolUse`, `${GLOBAL}/TaskStart`, `${PROJECT}/PostToolUse`]),
  )
}

describe('unix discovery', () => {
  it('takes the extensionless executable only', () => {
    const refs = discoverClineHooks({
      platform: 'linux',
      homeDir: '/home/u',
      workspaceRoot: '/ws',
      ...unixFs(),
    })
    expect(refs.map((ref) => ref.path)).toEqual([
      `${GLOBAL}/TaskStart`,
      `${GLOBAL}/PreToolUse`,
      `${PROJECT}/PostToolUse`,
    ])
  })

  it('a non-executable extensionless file is ignored', () => {
    const refs = discoverClineHooks({
      platform: 'linux',
      homeDir: '/home/u',
      ...fakeFs({ [GLOBAL]: ['PreToolUse'] }, new Set()),
    })
    expect(refs).toEqual([])
  })

  it('global scripts come before project scripts', () => {
    const refs = discoverClineHooks({
      platform: 'darwin',
      homeDir: '/home/u',
      workspaceRoot: '/ws',
      ...unixFs(),
    })
    expect(refs[0]?.scope).toBe('user')
    expect(refs.at(-1)?.scope).toBe('project')
  })

  it('maps each script to its Muse event', () => {
    const refs = discoverClineHooks({
      platform: 'linux',
      homeDir: '/home/u',
      workspaceRoot: '/ws',
      ...unixFs(),
    })
    expect(refs.map((ref) => `${ref.sourceEvent}->${ref.museEvent}`)).toEqual([
      'TaskStart->SessionStart',
      'PreToolUse->PreToolUse',
      'PostToolUse->PostToolUse',
    ])
  })
})

describe('windows discovery', () => {
  it('takes HookName.ps1 only', () => {
    vi.mocked(path.join).mockImplementation(windowsJoin)
    const dir = path.join(String.raw`C:\Users\u`, 'Documents', 'Cline', 'Hooks')
    const refs = discoverClineHooks({
      platform: 'win32',
      homeDir: String.raw`C:\Users\u`,
      ...fakeFs({ [dir]: ['PreToolUse', 'PreToolUse.ps1'] }, new Set()),
    })
    expect(refs.map((ref) => ref.sourceEvent)).toEqual(['PreToolUse'])
    expect(refs.map((ref) => ref.path)).toEqual([windowsJoin(dir, 'PreToolUse.ps1')])
  })
})

describe('isClineScript', () => {
  it('unix needs the exact name plus the executable bit', () => {
    expect(isClineScript('linux', 'PreToolUse', 'PreToolUse', true)).toBe(true)
    expect(isClineScript('linux', 'PreToolUse', 'PreToolUse', false)).toBe(false)
    expect(isClineScript('linux', 'PreToolUse', 'PreToolUse.sh', true)).toBe(false)
    expect(isClineScript('linux', 'PreToolUse', 'PreToolUse.ps1', true)).toBe(false)
  })

  it('win32 needs the .ps1 name; the bit is irrelevant', () => {
    expect(isClineScript('win32', 'PreToolUse', 'PreToolUse.ps1', false)).toBe(true)
    expect(isClineScript('win32', 'PreToolUse', 'PreToolUse', true)).toBe(false)
  })
})

describe('missing directories contribute nothing', () => {
  it('returns no scripts when neither scope exists', () => {
    expect(discoverClineHooks({ platform: 'linux', homeDir: '/nope', ...fakeFs({}) })).toEqual([])
  })
})
