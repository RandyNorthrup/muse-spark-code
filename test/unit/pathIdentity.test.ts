import { describe, expect, it } from 'vitest'
import { isSamePath, isWithinFolder } from '../../src/core/paths'
import { resolveWorkspacePath } from '../../src/core/workspacePath'
import { isProtectedFileAccess, isProtectedPath } from '../../src/core/protectedPaths'
import { foldName } from '../../src/core/git/heldTree'

describe('shared Windows path identity', () => {
  it.each([
    ['plans/q3.md', 'Plans/q3.md'],
    ['plans/q3.md', 'plans/q3.md.'],
    ['plans/q3.md', 'plans/q3.md '],
    ['aux', 'AUX'],
    ['.git/config', '.git./config'],
    ['plans/q3.md', String.raw`pLaNs. \Q3.MD. `],
  ])('uses one identity in path and held-name comparison: %j / %j', (first, second) => {
    expect(isSamePath(`C:/repo/${first}`, `c:/REPO/${second}`, 'win32')).toBe(true)
    expect(foldName(first, 'win32')).toBe(foldName(second, 'win32'))
    expect(isSamePath(`/repo/${first}`, `/repo/${second}`, 'linux')).toBe(false)
    expect(isSamePath(`/repo/${first}`, `/repo/${second}`, 'darwin')).toBe(false)
  })
  it('keeps folder membership and Windows name refusals consistent', () => {
    expect(isWithinFolder(String.raw`C:\REPO. \Plans\q3.md`, 'c:/repo', 'win32')).toBe(true)
    expect(isWithinFolder('c:/repo-other/file', 'c:/repo', 'win32')).toBe(false)
    expect(isWithinFolder('c:/repo/file', 'd:/repo', 'win32')).toBe(false)
    for (const given of ['plans. /q3.md', 'q3.md. ', '.GiT. /config', 'AUX', 'NUL.txt']) {
      expect(resolveWorkspacePath('C:/repo', given, 'win32').ok).toBe(false)
      expect(resolveWorkspacePath('/repo', given, 'linux').ok).toBe(true)
    }
    expect(resolveWorkspacePath('C:/repo', '..cache/q3.md', 'win32').ok).toBe(true)
  })
  it('protects aliases in both shared protection entrypoints', () => {
    const inputPath = String.raw`C:\repo\.GiT. \config`
    expect(isProtectedFileAccess({ kind: 'fileAccess', path: inputPath, access: 'write' })).toBe(
      true,
    )
    expect(isProtectedFileAccess({ kind: 'fileAccess', path: inputPath, access: 'read' })).toBe(
      false,
    )
    expect(isProtectedPath('plans/q3.md. ')).toBe(false)
    expect(isProtectedPath('.git/../plans.md')).toBe(true)
  })
})
