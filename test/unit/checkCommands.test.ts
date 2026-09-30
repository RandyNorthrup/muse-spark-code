import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  checkCommandLine,
  checkCommandsSchema,
  checkListText,
  checkTimeoutMs,
  isSafeCheckPath,
  verifyGuidance,
} from '../../src/core/verify/checkCommands'
import {
  CHECK_COMMANDS_MAX,
  CHECK_DEFAULT_TIMEOUT_SECONDS,
  CHECK_MAX_TIMEOUT_SECONDS,
  MILLISECONDS_PER_SECOND,
  MODEL_TEXT,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const LINT = { name: 'lint', command: 'npm run lint', changedFiles: true }
// Names with spaces, both kinds of single quote, and characters PowerShell
// and cmd.exe pass through: they must reach a program as one argument each.
const SAFE_ON_WINDOWS = [
  'src/a b.ts',
  "src/O'Brien’s s.ts",
  'src/$HOME;x,y=(z) {w}.ts',
  'src/ünï cödé.ts',
]
// On bash everything a single quote holds is literal, `"` and `&` included.
const TRICKY_ON_POSIX = ['src/a b.ts', `src/O'Brien’s "q".ts`, 'src/$HOME;x|y&(z)%OS%!e^f.ts']
// What Windows PowerShell 5.1 or cmd.exe reads as syntax. Measured on
// Windows 11 with the quoting M68 first shipped (the M68 review): `a"` then
// `b --inject` reached node.exe as ["a b", "--inject"]; `x&echo.INJECTED`
// ran `echo` through a .cmd program; `%OS%` became Windows_NT; `^` vanished.
const HOSTILE_ON_WINDOWS = ['a"', 'x&echo.INJECTED', 'y|z', 'a<b', 'a>b', 'c^d', '%OS%', 'e!f']
const NODE_ARGV = `-e 'console.log(JSON.stringify(process.argv.slice(1)))' probe`

describe('checkCommandsSchema', () => {
  it('takes the documented shape and trims names and commands', () => {
    const parsed = checkCommandsSchema.parse([
      { name: ' lint ', command: ' npm run lint ', changedFiles: true, timeoutSeconds: 60 },
      { name: 'test', command: 'npm test' },
    ])
    expect(parsed).toEqual([
      { name: 'lint', command: 'npm run lint', changedFiles: true, timeoutSeconds: 60 },
      { name: 'test', command: 'npm test' },
    ])
  })

  it('refuses a blank command, a repeated name, a bad time cap and too many checks', () => {
    expect(checkCommandsSchema.safeParse([{ name: 'lint', command: '  ' }]).success).toBe(false)
    expect(
      checkCommandsSchema.safeParse([
        { name: 'lint', command: 'a' },
        { name: 'lint', command: 'b' },
      ]).success,
    ).toBe(false)
    expect(
      checkCommandsSchema.safeParse([
        { name: 'lint', command: 'a', timeoutSeconds: CHECK_MAX_TIMEOUT_SECONDS + 1 },
      ]).success,
    ).toBe(false)
    expect(
      checkCommandsSchema.safeParse([{ name: 'lint', command: 'a', timeoutSeconds: 0 }]).success,
    ).toBe(false)
    const many = Array.from({ length: CHECK_COMMANDS_MAX + 1 }, (_, index) => ({
      name: `c${String(index)}`,
      command: 'x',
    }))
    expect(checkCommandsSchema.safeParse(many).success).toBe(false)
  })
})

// Bash's way to put a single quote inside a single-quoted word: close, an
// escaped quote, reopen.
const BACKSLASH = String.fromCodePoint(92)

describe('checkCommandLine', () => {
  it('runs an unscoped check, or a scoped one with no files, as the user wrote it', () => {
    expect(checkCommandLine({ name: 'test', command: 'npm test' }, ['a.ts'], 'linux')).toEqual({
      ok: true,
      line: 'npm test',
    })
    expect(checkCommandLine(LINT, [], 'linux')).toEqual({ ok: true, line: 'npm run lint' })
  })

  it('puts each changed file after -- as one quoted argument for the platform shell', () => {
    expect(checkCommandLine(LINT, ['src/a.ts', "b'c.ts"], 'linux')).toEqual({
      ok: true,
      line: `npm run lint -- 'src/a.ts' 'b'${BACKSLASH}''c.ts'`,
    })
    expect(checkCommandLine(LINT, ['src/a.ts', "b'c.ts"], 'win32')).toEqual({
      ok: true,
      line: "npm run lint -- 'src/a.ts' 'b''c.ts'",
    })
  })

  it('refuses a path that starts like an option or a response file, or holds a control character', () => {
    for (const unsafe of ['-rf', '--help', '@args.rsp', 'a\nb.ts', 'a\tb.ts', 'a\u{1B}b.ts', '']) {
      for (const platform of ['linux', 'win32'] as const) {
        expect(isSafeCheckPath(unsafe, platform), JSON.stringify(unsafe)).toBe(false)
        expect(checkCommandLine(LINT, ['ok.ts', unsafe], platform)).toEqual({
          ok: false,
          reason: MODEL_TEXT.checkSkipUnsafePath,
        })
      }
    }
    // A dash or an at sign inside a name is an ordinary file.
    expect(isSafeCheckPath('src/-x.ts', 'win32')).toBe(true)
    expect(isSafeCheckPath('src/@x.ts', 'linux')).toBe(true)
  })

  it('refuses on Windows what PowerShell 5.1 or cmd.exe would read as syntax, and only there', () => {
    for (const hostile of HOSTILE_ON_WINDOWS) {
      expect(isSafeCheckPath(hostile, 'win32'), hostile).toBe(false)
      expect(checkCommandLine(LINT, ['ok.ts', hostile], 'win32').ok, hostile).toBe(false)
      // Bash reads nothing inside single quotes.
      expect(isSafeCheckPath(hostile, 'linux'), hostile).toBe(true)
    }
    for (const safe of SAFE_ON_WINDOWS) {
      expect(isSafeCheckPath(safe, 'win32'), safe).toBe(true)
    }
  })

  // The quoted paths reach the program as the exact arguments, through the
  // same interpreter the shell tool runs (M27): Windows PowerShell 5.1, to a
  // native program and to a .cmd one (cmd.exe re-reads its arguments).
  const systemRoot = process.env['SystemRoot']
  const isWindows = process.platform === 'win32' && systemRoot !== undefined
  const folder = mkdtempSync(path.join(tmpdir(), 'm68-check-'))
  afterAll(async () => {
    await removeFolder(folder)
  })
  const throughPowerShell = (command: string, paths: readonly string[]): unknown => {
    const built = checkCommandLine({ name: 'argv', command, changedFiles: true }, paths, 'win32')
    if (!built.ok) {
      throw new Error(built.reason)
    }
    const powershell = path.win32.join(systemRoot ?? '', WINDOWS_POWERSHELL_RELATIVE_PATH)
    const output = execFileSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', built.line],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return JSON.parse(output.trim())
  }

  it.skipIf(!isWindows)('hands a native program each path as one argument', () => {
    expect(throughPowerShell(`& '${process.execPath}' ${NODE_ARGV}`, SAFE_ON_WINDOWS)).toEqual([
      'probe',
      '--',
      ...SAFE_ON_WINDOWS,
    ])
  })

  it.skipIf(!isWindows)('hands a .cmd program each path as one argument, cmd.exe included', () => {
    const probe = path.join(folder, 'probe.cmd')
    writeFileSync(
      probe,
      `@"${process.execPath}" -e "console.log(JSON.stringify(process.argv.slice(1)))" probe %*\r\n`,
    )
    expect(throughPowerShell(`& '${probe}'`, SAFE_ON_WINDOWS)).toEqual([
      'probe',
      '--',
      ...SAFE_ON_WINDOWS,
    ])
  })

  it.skipIf(process.platform === 'win32')('hands bash each path as one argument', () => {
    const built = checkCommandLine(
      { name: 'argv', command: `'${process.execPath}' ${NODE_ARGV}`, changedFiles: true },
      TRICKY_ON_POSIX,
      'linux',
    )
    if (!built.ok) {
      throw new Error(built.reason)
    }
    const output = execFileSync('bash', ['-c', built.line], { encoding: 'utf8' })
    expect(JSON.parse(output.trim())).toEqual(['probe', '--', ...TRICKY_ON_POSIX])
  })
})

describe('checkTimeoutMs', () => {
  it('is the check’s own cap, else the default', () => {
    expect(checkTimeoutMs({ name: 'a', command: 'b', timeoutSeconds: 12 })).toBe(
      12 * MILLISECONDS_PER_SECOND,
    )
    expect(checkTimeoutMs({ name: 'a', command: 'b' })).toBe(
      CHECK_DEFAULT_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND,
    )
  })
})

describe('verifyGuidance (Muse Code)', () => {
  it('names the diagnostics tool and the checks inside a harness note', () => {
    const note = verifyGuidance(true, [LINT, { name: 'test', command: 'npm test' }])
    expect(note).toBe(
      `<harness_note>${MODEL_TEXT.verifyGuidanceDiagnostics} The user's check commands are: lint (\`npm run lint\`), test (\`npm test\`). Before you finish, run the ones your change affects.</harness_note>`,
    )
    expect(note).toContain('mcp__ide__getDiagnostics')
  })

  it('says only what is on, and nothing when neither is', () => {
    expect(verifyGuidance(true, [])).toBe(
      `<harness_note>${MODEL_TEXT.verifyGuidanceDiagnostics}</harness_note>`,
    )
    expect(verifyGuidance(false, [LINT])).toBe(
      `<harness_note>The user's check commands are: ${checkListText([LINT])}. Before you finish, run the ones your change affects.</harness_note>`,
    )
    expect(verifyGuidance(false, [])).toBeUndefined()
  })
})
