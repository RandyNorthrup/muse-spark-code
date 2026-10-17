import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminShare } from './helpers/secWinShare'

const state: { folder: string; win32: string[] } = { folder: '', win32: [] }

beforeAll(() => {
  state.folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-win-native-')))
  writeFileSync(path.join(state.folder, 'AGENTS.md'), 'oracle')
  mkdirSync(path.join(state.folder, '.claude'))
  writeFileSync(path.join(state.folder, '.claude', 'settings.json'), '{}')
  if (process.platform !== 'win32') return
  const source = readFileSync(path.resolve('test/unit/helpers/secWinPathOracle.ps1'), 'utf8')
  const command = `& {\n${source}\n} '${state.folder.replaceAll("'", "''")}'`
  state.win32 = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', windowsHide: true },
  )
    .trim()
    .split(/\r?\n/u)
})
afterAll(() => {
  rmSync(state.folder, { recursive: true, force: true })
})

function identity(file: string): string {
  const stats = statSync(file, { bigint: true })
  return `${stats.dev.toString()}:${stats.ino.toString()}`
}

describe('SECWINPATH native Win32 oracle', () => {
  it('opens the default data stream and DOS trailing-dot/space aliases as the same native file', () => {
    const file = path.join(state.folder, 'AGENTS.md')
    expect(readFileSync(file, 'utf8')).toBe('oracle')
    if (process.platform !== 'win32') return
    expect(state.win32.slice(0, 4)).toEqual(Array.from({ length: 4 }, () => identity(file)))
    expect(identity(`${file}::$DATA`)).toBe(identity(file))
    expect(readFileSync(`${file}::$DATA`, 'utf8')).toBe('oracle')
    const settings = identity(path.join(state.folder, '.claude', 'settings.json'))
    expect(state.win32.slice(4)).toEqual([settings, settings, 'error=3'])
  })

  it('measures both loopback administrative shares without changing their permissions', (ctx) => {
    const file = path.join(state.folder, 'AGENTS.md')
    expect(statSync(file).isFile()).toBe(true)
    if (process.platform === 'win32') {
      for (const host of ['localhost', '127.0.0.1']) {
        const unc = adminShare(file, host)
        if (unc === undefined) {
          ctx.skip('administrative share unavailable; reason printed')
          return
        }
        expect(identity(unc), host).toBe(identity(file))
        expect(readFileSync(unc, 'utf8')).toBe('oracle')
        expect(realpathSync.native(unc).startsWith(`\\\\${host}\\`)).toBe(true)
      }
    }
  })
})
