// AUDITCLI (0.19.0): every terminal misuse exits 2 with words that name the
// flag or argument, and every flag the parser takes is on the help
// reference. Real parser and real help renderer only: no stand-ins, and no
// build: the unit shards run `vitest` without `dist/`, so the built binary
// itself is proven in test/hosts/exec.sh (hosts.yml `agent` job, after the
// production package is built and installed).
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

// The built binary itself (`node dist/acp.js`, same parser and renderer) is
// proven in test/hosts/exec.sh: the unit shards run without `dist/`, and
// that script runs in CI only after the production package is built and
// installed (hosts.yml `agent` job).
