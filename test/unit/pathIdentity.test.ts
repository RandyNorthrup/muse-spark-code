import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { windowsPathIdentity } from '../../src/core/pathIdentity'
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
    ['plans/q3.md', String.raw`pLaNs.\Q3.MD. `],
  ])('uses one identity in path and held-name comparison: %j / %j', (first, second) => {
    expect(isSamePath(`C:/repo/${first}`, `c:/REPO/${second}`, 'win32')).toBe(true)
    expect(foldName(first, 'win32')).toBe(foldName(second, 'win32'))
    expect(isSamePath(`/repo/${first}`, `/repo/${second}`, 'linux')).toBe(false)
    expect(isSamePath(`/repo/${first}`, `/repo/${second}`, 'darwin')).toBe(false)
  })
  it('keeps folder membership and Windows name refusals consistent', () => {
    expect(isWithinFolder(String.raw`C:\REPO. \Plans\q3.md`, 'c:/repo', 'win32')).toBe(false)
    expect(isWithinFolder(String.raw`C:\REPO.\Plans\q3.md`, 'c:/repo', 'win32')).toBe(true)
    expect(isWithinFolder('c:/repo-other/file', 'c:/repo', 'win32')).toBe(false)
    expect(isWithinFolder('c:/repo/file', 'd:/repo', 'win32')).toBe(false)
    for (const given of ['plans. /q3.md', 'q3.md. ', '.GiT. /config', 'AUX', 'NUL.txt']) {
      expect(resolveWorkspacePath('C:/repo', given, 'win32').ok).toBe(false)
      expect(resolveWorkspacePath('/repo', given, 'linux').ok).toBe(true)
    }
    expect(resolveWorkspacePath('C:/repo', '..cache/q3.md', 'win32').ok).toBe(true)
  })
  it.each(['foo..', 'foo. '])(
    'keeps intermediate %s distinct in every shared comparison',
    (name) => {
      const candidate = `C:/repo/${name}/b`
      expect(isSamePath(candidate, 'C:/repo/foo/b', 'win32')).toBe(false)
      expect(isWithinFolder(candidate, 'C:/repo/foo', 'win32')).toBe(false)
      expect(foldName(candidate, 'win32')).not.toBe(foldName('C:/repo/foo/b', 'win32'))
    },
  )
  it.each(['linux', 'darwin'] as const)(
    'keeps canonical POSIX backslashes literal on %s',
    (platform) => {
      const result = resolveWorkspacePath('/ws', String.raw`.Claude\settings.json`, platform)
      expect(result.ok && isProtectedPath(result.canonical)).toBe(false)
      expect(isProtectedPath('.Claude/settings.json')).toBe(true)
    },
  )
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
  it.runIf(process.platform === 'win32')(
    'agrees with native Win32 file indexes and directory containment',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'm100-win32-oracle-'))
      try {
        const rows = z
          .array(
            z
              .object({
                first: z.string(),
                second: z.string(),
                firstFolder: z.string(),
                secondFolder: z.string(),
                firstId: z.string(),
                secondId: z.string(),
                firstFolderId: z.string(),
                secondFolderId: z.string(),
                firstNormalized: z.string(),
                secondNormalized: z.string(),
                isDevice: z.boolean(),
                deviceDirectoryError: z.number().nullable(),
                deviceDirectoryOpenError: z.number().nullable(),
              })
              .strict(),
          )
          .parse(
            JSON.parse(
              execFileSync(
                'powershell.exe',
                [
                  '-NoProfile',
                  '-NonInteractive',
                  '-ExecutionPolicy',
                  'Bypass',
                  '-File',
                  path.resolve('test/unit/helpers/windowsFileIdentity.ps1'),
                  '--oracle',
                  root,
                ],
                { encoding: 'utf8', windowsHide: true },
              ),
            ),
          )
        expect(rows).toHaveLength(11)
        for (const row of rows) {
          const isSameFile = row.firstId === row.secondId
          expect(
            windowsPathIdentity(row.first) === windowsPathIdentity(row.second),
            row.first,
          ).toBe(isSameFile)
          expect(isSamePath(row.first, row.second, 'win32'), row.first).toBe(isSameFile)
          expect(isWithinFolder(row.first, row.secondFolder, 'win32'), row.first).toBe(
            !row.isDevice && row.firstFolderId === row.secondFolderId,
          )
          if (row.isDevice) {
            expect(row.firstId).toBe('character-device:2')
            // A success from CreateDirectoryW on NUL creates no disk directory:
            // the exact extended-path open reports ERROR_FILE_NOT_FOUND.
            expect(row.deviceDirectoryError).toBe(0)
            expect(row.deviceDirectoryOpenError).toBe(2)
            expect(resolveWorkspacePath(root, 'NUL', 'win32').ok).toBe(false)
            expect(resolveWorkspacePath(root, 'nul.txt', 'win32').ok).toBe(false)
          } else {
            expect(row.firstId).toMatch(/^[\dA-F]{8}:[\dA-F]{16}$/u)
            expect(row.secondId).toMatch(/^[\dA-F]{8}:[\dA-F]{16}$/u)
          }
          expect(windowsPathIdentity(row.first), row.first).toBe(
            windowsPathIdentity(row.firstNormalized),
          )
          expect(windowsPathIdentity(row.second), row.second).toBe(
            windowsPathIdentity(row.secondNormalized),
          )
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})
