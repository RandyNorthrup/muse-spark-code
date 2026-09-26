import { describe, expect, it } from 'vitest'
import {
  memoryDataRoot,
  personalMemoryRoot,
  projectMemoryFolder,
  projectMemoryKey,
  projectMemorySlug,
  projectsMemoryRoot,
} from '../../src/core/memory/memoryLocation'

// The two folders Muse Code 1.3.0 made (2026-09-25, docs/certification/m49.md).
const CAPTURED_M43 = {
  root: String.raw`C:\muse-live-m43`,
  folder: 'C--muse-live-m43-7bdb42d98a06c29b',
}
const CAPTURED_M49 = {
  root: String.raw`C:\muse-live-m49\My Proj.v2_x+é`,
  folder: 'C--muse-live-m49-My-Proj-v2-x-0175e6b82ee81b32',
}

describe('memoryDataRoot', () => {
  it('is XDG_DATA_HOME/muse/memory when set, else ~/.local/share/muse/memory', () => {
    expect(memoryDataRoot({ platform: 'linux', homeDir: '/home/u', xdgDataHome: undefined })).toBe(
      '/home/u/.local/share/muse/memory',
    )
    expect(memoryDataRoot({ platform: 'linux', homeDir: '/home/u', xdgDataHome: '/data' })).toBe(
      '/data/muse/memory',
    )
    expect(
      memoryDataRoot({ platform: 'win32', homeDir: String.raw`C:\Users\R`, xdgDataHome: '' }),
    ).toBe(String.raw`C:\Users\R\.local\share\muse\memory`)
    expect(
      memoryDataRoot({ platform: 'win32', homeDir: undefined, xdgDataHome: String.raw`D:\x` }),
    ).toBe(String.raw`D:\x\muse\memory`)
    expect(
      memoryDataRoot({ platform: 'darwin', homeDir: undefined, xdgDataHome: undefined }),
    ).toBeUndefined()
  })

  it('puts the personal and the per-project scopes beneath it', () => {
    expect(personalMemoryRoot('/d/muse/memory', 'linux')).toBe('/d/muse/memory/personal')
    expect(projectsMemoryRoot(String.raw`C:\d`, 'win32')).toBe(String.raw`C:\d\projects`)
  })
})

describe('the personal_project folder', () => {
  it('matches both folders Muse Code made: FNV-1a 64 of the verbatim path, and the slug', () => {
    for (const captured of [CAPTURED_M43, CAPTURED_M49]) {
      expect(projectMemoryFolder([], captured.root, 'win32')).toBe(captured.folder)
    }
  })

  it('hashes the path as Rust spells it: verbatim on Windows, UNC included; as is elsewhere', () => {
    const verbatim = projectMemoryKey(String.raw`\\?\C:\muse-live-m43`, 'win32')
    expect(verbatim).toBe('7bdb42d98a06c29b')
    expect(projectMemoryKey(String.raw`\\server\share\p`, 'win32')).toBe(
      projectMemoryKey(String.raw`\\?\UNC\server\share\p`, 'win32'),
    )
    expect(projectMemoryKey('/home/u/p', 'linux')).toMatch(/^[\da-f]{16}$/)
    expect(projectMemoryKey('/home/u/p', 'linux')).not.toBe(
      projectMemoryKey(String.raw`\home\u\p`, 'win32'),
    )
  })

  it('keeps ASCII letters, digits and hyphens in the slug, trimming its ends', () => {
    expect(projectMemorySlug('/home/u/my_app')).toBe('home-u-my-app')
    expect(projectMemorySlug(String.raw`C:\a b\ü`)).toBe('C--a-b')
  })

  it('reuses a folder that already ends in the key, whatever its slug', () => {
    const key = projectMemoryKey(CAPTURED_M43.root, 'win32')
    expect(
      projectMemoryFolder(['other-0000000000000000', `renamed-${key}`], CAPTURED_M43.root, 'win32'),
    ).toBe(`renamed-${key}`)
  })
})
