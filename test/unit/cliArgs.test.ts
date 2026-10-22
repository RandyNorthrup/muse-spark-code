// The command line's failure rules: an unknown option gets our sentence,
// auth failures point at the accounts help, and every other parse failure
// answers invalid with exit code 2, never a prompt.
import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { ACP_AGENT_NAME } from '../../src/shared/constants'

function invalid(
  command: unknown,
): asserts command is { command: 'invalid' } & Record<string, unknown> {
  expect(command).toMatchObject({ command: 'invalid' })
}

describe('parseCommandLine failure rules', () => {
  it('names the unknown option in our words, not the library', () => {
    const command = parseCommandLine(['--nope'])
    invalid(command)
    expect(command.reason).toContain('--nope')
    expect(command.reason).not.toContain('positional')
  })

  it('keeps a truly unknown argument as unknown', () => {
    const option = parseCommandLine(['--frobnicate'])
    invalid(option)
    expect(option.exitCode).toBe(2)
    expect(option.reason).toContain('Unknown option')
    expect(option.reason).toContain('--frobnicate')
    const positional = parseCommandLine(['frobnicate'])
    invalid(positional)
    expect(positional.exitCode).toBe(2)
    expect(positional.reason).toContain('Unknown argument')
  })

  it('names a bad value of a known option and never the parser', () => {
    // A mistyped value names the option and its help; a dash-led or
    // missing one answers in the same words, never the parser's English.
    for (const [argv, option, untrusted] of [
      [['--questions-defer-after', 'abc'], '--questions-defer-after', 'abc'],
      [['--questions-defer-after', '-5'], '--questions-defer-after', '-5'],
      [['--backend', 'foo'], '--backend', 'foo'],
      [['--shell-sandbox', 'foo'], '--shell-sandbox', 'foo'],
      [['--usage-history', 'foo'], '--usage-history', 'foo'],
      [['login', '--backend', 'foo'], '--backend', 'foo'],
      [['--trust-workspace=foo'], '--trust-workspace', 'foo'],
      [['--backend'], '--backend', ''],
      [['usage', '--range', 'foo'], '--range', 'foo'],
      [['usage', '--json=foo'], '--json', 'foo'],
      [['resources', '--json=foo'], '--json', 'foo'],
      [['scan-secrets', 'patch.diff', '--timeout'], '--timeout', ''],
      [['scan-secrets', 'patch.diff', '--key-stdin=foo'], '--key-stdin', 'foo'],
      [['exec', '--verbose=foo', 'hi'], '--verbose', 'foo'],
      [['legal', '--json=foo'], '--json', 'foo'],
    ] as const) {
      const command = parseCommandLine([...argv])
      invalid(command)
      expect(command.exitCode).toBe(2)
      expect(command.reason, argv.join(' ')).toContain(`Invalid value for ${option}`)
      // The help it points at is a command a person can run as typed.
      expect(command.reason, argv.join(' ')).toMatch(
        new RegExp(`run ${ACP_AGENT_NAME} [a-z-]+ --help for`),
      )
      expect(command.reason, argv.join(' ')).not.toContain('Unknown argument')
      expect(command.reason, argv.join(' ')).not.toContain('ambiguous')
      expect(command.reason, argv.join(' ')).not.toContain('Did you forget')
      expect(command.reason, argv.join(' ')).not.toContain('does not take an argument')
      expect(command.reason, argv.join(' ')).not.toContain('argument missing')
      if (untrusted !== '') expect(command.reason, argv.join(' ')).not.toContain(untrusted)
    }
  })

  it('points auth parse failures at the accounts help', () => {
    const command = parseCommandLine(['auth', '--nope'])
    invalid(command)
    expect(command.reason).toContain('--nope')
    expect(command.reason).toContain('auth --help')
  })

  it('answers usage, resources and report parse failures as invalid with exit 2', () => {
    for (const argv of [
      ['usage', '--nope'],
      ['resources', '--nope'],
      ['report', 'problem', '--nope'],
    ]) {
      const command = parseCommandLine(argv)
      invalid(command)
      expect(command.exitCode).toBe(2)
    }
  })

  it('answers an invalid option value on usage and resources as invalid with exit 2', () => {
    for (const argv of [
      ['usage', '--json=foo'],
      ['resources', '--json=foo'],
    ]) {
      const command = parseCommandLine(argv)
      invalid(command)
      expect(command.exitCode).toBe(2)
    }
  })

  it('hands an M93-option failure to the named reports engine', () => {
    expect(parseCommandLine(['report', 'history', '--nope'])).toMatchObject({ command: 'reports' })
  })

  it('fails a reserved command explicitly when its parser throws', () => {
    const command = parseCommandLine(['share'], () => {
      throw new Error('share-words')
    })
    invalid(command)
    expect(command.reason).toBe('share-words')
    expect(command.exitCode).toBe(2)
  })
})

describe('scan-secrets deadline', () => {
  it('runs until the scan finishes with no flag set', () => {
    const command = parseCommandLine(['scan-secrets', 'patch.diff'])
    expect(command).toMatchObject({
      command: 'scan-secrets',
      file: 'patch.diff',
      keyFromStdin: false,
    })
    if (command.command !== 'scan-secrets') throw new Error('expected scan-secrets')
    expect(command.timeoutMs).toBeUndefined()
  })

  it('takes a CI-set deadline in whole seconds', () => {
    expect(parseCommandLine(['scan-secrets', 'patch.diff', '--timeout', '30'])).toMatchObject({
      command: 'scan-secrets',
      file: 'patch.diff',
      timeoutMs: 30_000,
    })
  })

  it('refuses a deadline it cannot hold, naming the flag', () => {
    for (const argv of [
      ['scan-secrets', 'patch.diff', '--timeout', '0'],
      ['scan-secrets', 'patch.diff', '--timeout', 'ten'],
      ['scan-secrets', 'patch.diff', '--timeout', '1.5'],
    ]) {
      const command = parseCommandLine(argv)
      invalid(command)
      expect(command.reason).toContain('--timeout')
      expect(command.exitCode).toBe(2)
    }
  })
})

describe('providers refresh parse (RLTESTDRIVE item 5)', () => {
  it('routes providers refresh <id> to the refresh command', () => {
    expect(parseCommandLine(['providers', 'refresh', 'anthropic-s2'])).toEqual({
      command: 'providersRefresh',
      provider: 'anthropic-s2',
    })
  })

  it('refuses providers refresh without an id, naming the verb', () => {
    const command = parseCommandLine(['providers', 'refresh'])
    invalid(command)
    expect(command.exitCode).toBe(2)
    expect(command.reason).toContain('providers refresh')
  })
})
