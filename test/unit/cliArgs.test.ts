// The command line's failure rules: an unknown option gets our sentence,
// auth failures point at the accounts help, and every other parse failure
// answers invalid with exit code 2, never a prompt.
import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'

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

  it('names a bad value of a known serve option, never the value', () => {
    for (const [argv, option] of [
      [['--questions-defer-after', 'abc'], '--questions-defer-after'],
      [['--backend', 'foo'], '--backend'],
      [['--shell-sandbox', 'foo'], '--shell-sandbox'],
      [['--usage-history', 'foo'], '--usage-history'],
      [['login', '--backend', 'foo'], '--backend'],
    ] as const) {
      const command = parseCommandLine([...argv])
      invalid(command)
      expect(command.exitCode).toBe(2)
      expect(command.reason, argv.join(' ')).toContain(`Invalid value for ${option}`)
      expect(command.reason, argv.join(' ')).toContain('--help')
      expect(command.reason, argv.join(' ')).not.toContain('Unknown argument')
      expect(command.reason, argv.join(' ')).not.toContain('abc')
      expect(command.reason, argv.join(' ')).not.toContain('foo')
    }
  })

  it('answers a dash-led or missing value with the option sentence, never the parser', () => {
    for (const [argv, option] of [
      [['--questions-defer-after', '-5'], '--questions-defer-after'],
      [['--trust-workspace=foo'], '--trust-workspace'],
      [['--backend'], '--backend'],
      [['usage', '--range', 'foo'], '--range'],
      [['usage', '--json=foo'], '--json'],
      [['resources', '--json=foo'], '--json'],
      [['scan-secrets', 'patch.diff', '--timeout'], '--timeout'],
      [['scan-secrets', 'patch.diff', '--key-stdin=foo'], '--key-stdin'],
      [['exec', '--verbose=foo', 'hi'], '--verbose'],
      [['legal', '--json=foo'], '--json'],
    ] as const) {
      const command = parseCommandLine([...argv])
      invalid(command)
      expect(command.exitCode).toBe(2)
      expect(command.reason, argv.join(' ')).toContain(`Invalid value for ${option}`)
      expect(command.reason, argv.join(' ')).toContain('--help')
      expect(command.reason, argv.join(' ')).not.toContain('ambiguous')
      expect(command.reason, argv.join(' ')).not.toContain('Did you forget')
      expect(command.reason, argv.join(' ')).not.toContain('does not take an argument')
      expect(command.reason, argv.join(' ')).not.toContain('argument missing')
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
