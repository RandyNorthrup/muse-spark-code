// AUDITCLI (0.19.0): every terminal misuse exits 2 with words that name the
// flag or argument, and every flag the parser takes is on the help
// reference. Real parser and real help renderer only: no stand-ins. The last
// block spawns the built dist/acp.js binary itself, so the same parser and
// renderer are proven through the shipped command (it needs a build first;
// CI unit shards run without dist).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseDeveloperCommand } from '../../src/runtime/developer/developerCommand'
import { EN } from '../../src/shared/l10n/en'
import { UI_TEXT } from '../../src/shared/constants'
import { createReference } from '../../src/shared/reference/referenceEntry'
import { referenceModel } from '../../src/shared/reference/reference.generated'

// Each row refused before the fix: serve-family misuses exited 1, and the
// refusal named the positionals or a bare usage line instead of the flag.
const misuse: readonly (readonly [argv: string[], token: string])[] = [
  [['frobnicate'], 'frobnicate'],
  [['--bogus-flag'], '--bogus-flag'],
  [['help', 'foo'], 'help foo'],
  [['providers', 'accounts', 'bogus'], 'providers accounts'],
  [['providers', 'list', 'extra'], 'providers list'],
  [['providers', 'test'], 'providers test'],
  [['providers', 'add'], '--preset'],
  [['providers', 'bogus', 'chatgpt'], 'chatgpt'],
  [['providers', 'add', 'chatgpt', 'extra'], 'chatgpt'],
  // Auth positionals are never echoed (a mistyped token may be the key
  // itself): these refuse with the credential guidance and exit 2.
  [['auth'], 'standard input'],
  [['auth', 'bogus'], 'standard input'],
  [['auth', 'set', '--preset', 'foo'], '--preset'],
  [['auth', 'set', 'extra'], 'standard input'],
  [['auth', 'clear', '--bogus'], 'standard input'],
  [['login', '--provider', 'foo'], '--provider'],
  [['login', 'extra'], 'login extra'],
  [['exec', '--effort', 'none', 'hi'], '--effort none'],
  [['exec', '--effort', 'bogus', 'hi'], '--effort'],
  [['exec', '--timeout', 'abc', 'hi'], '--timeout'],
  [['exec', '--max-requests', '0', 'hi'], '--max-requests'],
  [['exec', '--bogus', 'hi'], '--bogus'],
  [['exec'], 'Provide one nonempty prompt.'],
  [['usage', 'bogus'], 'bogus'],
  [['usage', 'summary', 'extra'], 'extra'],
  [['usage', '--range', 'bogus'], '--range'],
  [['usage', '--by', 'bogus'], '--by'],
  [['usage', '--from', 'bogus'], '--from'],
  [['usage', '--json', '--csv'], '--json'],
  [['resources', 'bogus'], 'resources bogus'],
  [['legal', '--bogus'], '--bogus'],
  [['fonts', 'bogus'], 'fonts install'],
  [['scan-secrets'], 'scan-secrets'],
  [['vault', 'bogus'], 'Vault'],
  [['schedule', 'bogus'], 'schedule'],
]

describe('terminal misuse names its flag and exits 2', () => {
  it.each(misuse)('%j refuses with %s', (argv, token) => {
    const command = parseCommandLine(argv)
    expect(command.command).toBe('invalid')
    if (command.command !== 'invalid') throw new Error(`parsed as ${command.command}`)
    expect(command.exitCode).toBe(2)
    expect(command.reason).toContain(token)
  })

  it('developer misuse throws the usage before any store is touched', () => {
    expect(() => parseDeveloperCommand(['developer', '--help'])).toThrow(
      UI_TEXT.developer.commandUsage,
    )
  })
})

describe('every accepted flag is on the help reference', () => {
  it('lists the gated exec and serve flags the parser takes', () => {
    const text = createReference(EN, 'en').all({})
    for (const row of ['exec: --vault', 'exec: --account-pool', 'serve: --scheduled-prompts'])
      expect(text).toContain(row)
  })

  it('keeps the compaction opt-out in the generated model', () => {
    // The entry hides compaction rows until evaluation passes; the model
    // itself still carries them, so `help --all` shows them when evaluated.
    const names = referenceModel().cli.map((entry) => entry.name)
    for (const row of ['exec: --no-auto-compaction', 'serve: --no-auto-compaction'])
      expect(names).toContain(row)
  })
})

const root = path.resolve(import.meta.dirname, '../..')
const acpBinary = path.join(root, 'dist', 'acp.js')

function runBinary(argv: readonly string[]): { exit: number | null; output: string } {
  if (!existsSync(acpBinary)) throw new Error(`built binary is missing: ${acpBinary}`)
  const run = spawnSync(process.execPath, [acpBinary, ...argv], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (run.error !== undefined) throw run.error
  return { exit: run.status, output: `${run.stdout}\n${run.stderr}` }
}

// Parse-only paths: no store, no network, no model. Each row failed before
// the fix (exit 1, or a refusal that did not name the flag).
const binaryMisuse: readonly (readonly [argv: string[], token: string])[] = [
  [['frobnicate'], 'frobnicate'],
  [['providers', 'accounts', 'bogus'], 'providers accounts'],
  [['login', '--provider', 'foo'], '--provider'],
  [['exec', '--effort', 'none', 'hi'], '--effort none'],
  [['exec', '--timeout', 'abc', 'hi'], '--timeout'],
  [['usage', '--range', 'bogus'], '--range'],
  [['developer', '--help'], 'developer'],
]

describe('built binary refuses misuse through dist', () => {
  it.each(binaryMisuse)('%j exits 2 naming %s', (argv, token) => {
    const { exit, output } = runBinary(argv)
    expect(exit).toBe(2)
    expect(output).toContain(token)
  })

  it.each([[['--help']], [['exec', '--help']], [['help', '--all']]])(
    '%j prints help and exits 0',
    (argv: string[]) => {
      const { exit, output } = runBinary(argv)
      expect(exit).toBe(0)
      expect(output.length).toBeGreaterThan(0)
    },
  )
})
