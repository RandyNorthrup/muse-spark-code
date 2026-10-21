// AUDITCLI (0.19.0): every terminal misuse exits 2 with words that name the
// flag or argument, and every flag the parser takes is on the terminal
// help. Dormant flags stay out of the published reference (cx1r2Truth).
// Real parser and real help renderer only: no stand-ins, and no
// build: the unit shards run `vitest` without `dist/`, so the built binary
// itself is proven in test/hosts/exec.sh (hosts.yml `agent` job, after the
// production package is built and installed).
import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseDeveloperCommand } from '../../src/runtime/developer/developerCommand'
import { helpTopicNamed, renderTopicHelp } from '../../src/runtime/cliHelp'
import { EN } from '../../src/shared/l10n/en'
import { UI_TEXT } from '../../src/shared/constants'
import { referenceModel } from '../../src/shared/reference/reference.generated'

const COMMAND = 'muse-spark-code-acp'

// Each row refused before the fix: serve-family misuses exited 1, and the
// refusal named the positionals or a bare usage line instead of the flag.
const misuse: readonly (readonly [argv: string[], token: string])[] = [
  [['frobnicate'], 'frobnicate'],
  [['--bogus-flag'], '--bogus-flag'],
  // The unknown topic names its argument and suggests the nearest real one
  // (lane docself); the token pins the naming, not the suggestion.
  [['help', 'foo'], "Unknown command 'foo'"],
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
  // A refused global value on auth still exits 2 without echoing the argv.
  [['auth', '--backend', 'bogus', 'set'], 'standard input'],
  [['auth', '--shell-sandbox', 'bogus', 'set'], 'standard input'],
  [['login', '--provider', 'foo'], '--provider'],
  [['login', 'extra'], 'login extra'],
  // --effort none is accepted: Thinking-off (lane REASONSHAPESR2, pinned in
  // cliHelp.test.ts), so only an unknown level refuses here.
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

describe('every accepted flag is documented where it is published', () => {
  it('lists the gated exec and serve flags the parser takes', () => {
    // Dormant flags stay out of the published reference (cx1r2Truth) and
    // the uncertified schedule flag out of the terminal help (isDormantOption);
    // each one still parses, and the live gated exec flags name themselves
    // in their own topic help. Flipping the delivery certification restores
    // every surface at once.
    const serve = helpTopicNamed('serve')
    const exec = helpTopicNamed('exec')
    if (serve === undefined || exec === undefined) throw new Error('serve/exec topics are missing')
    const serveText = renderTopicHelp(EN, COMMAND, serve)
    const execText = renderTopicHelp(EN, COMMAND, exec)
    expect(parseCommandLine(['--scheduled-prompts']).command).toBe('serve')
    expect(serveText).not.toContain('--scheduled-prompts')
    expect(parseCommandLine(['exec', '--vault', 'hi']).command).toBe('exec')
    expect(execText).toContain('--vault')
    // Pooling is a Model API-only shape, refused on the default backend;
    // a Model API run names its budget.
    expect(
      parseCommandLine([
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '1',
        '--account-pool',
        'hi',
      ]).command,
    ).toBe('exec')
    expect(execText).toContain('--account-pool')
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
