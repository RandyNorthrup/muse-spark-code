import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { CLI_OPTION_REGISTRY, formatCommandHelp } from '../../src/runtime/cliOptions'
import { cliCommands } from '../../src/shared/cliCommands'
import { EN } from '../../src/shared/l10n/en'

describe('EXECPROV command-local help', () => {
  it.each(Object.keys(CLI_OPTION_REGISTRY))('prints %s without editor command IDs', (route) => {
    const help = formatCommandHelp(EN, 'muse-spark-code-acp', route)
    expect(help).not.toContain('museSpark.')
    expect(help).toContain('muse-spark-code-acp')
    expect(help).toContain('--help')
  })
  // Bare `report --help` is not here: it reaches the reports command,
  // which prints its usage with the working kinds (RVMSM113 F34,
  // pinned in cx1r4Truth), instead of the help topic.
  it.each([
    'exec',
    'scan-secrets',
    'usage',
    'legal',
    'resources',
    'schedule',
    'estimate',
    'developer',
    'playbook',
    'fonts install',
    'providers add',
    'providers test',
    'providers remove',
    'providers list',
    'providers accounts',
    'auth set',
    'auth clear',
    'auth status',
    'share',
    'prompts',
  ])('routes %s --help locally', (words) => {
    const command = parseCommandLine([...words.split(' '), '--help'])
    expect(command).toMatchObject({ command: 'help' })
    expect(command.command === 'help' && command.all).not.toBe(true)
    expect(command.command === 'help' && command.route).toBeTruthy()
  })
  it('keeps the full catalogue explicit and a prompt after -- literal', () => {
    expect(parseCommandLine(['help', 'reference'])).toEqual({ command: 'help', all: true })
    expect(parseCommandLine(['exec', '--', '--help'])).not.toMatchObject({ command: 'help' })
  })
})

describe('deep command help', () => {
  it.each([
    'providers accounts thresholds',
    'schedule background status',
    'report usage',
    'providers status chatgpt',
    'developer reset',
    'prompts share',
    'playbook settings',
  ])('describes %s locally', (words) => {
    const command = parseCommandLine([...words.split(' '), '--help'])
    if (command.command !== 'help') throw new Error('not command help')
    const help = formatCommandHelp(EN, 'muse-spark-code-acp', command.route ?? '')
    expect(help).toContain('--help')
    expect(help).not.toContain('museSpark.')
    expect(help.split('\n').length).toBeGreaterThan(2)
  })
  it('walks every public command and deep invocation in the command table', () => {
    let count = 0
    for (const entry of cliCommands()) {
      for (const argv of entry.invocations) {
        // Bare `report --help` is the reports command's own help (F34 above),
        // not the help topic, so the walk below does not apply to it.
        if (argv.length === 1 && argv[0] === 'report') continue
        count += 1
        const command = parseCommandLine([...argv, '--help'])
        expect(['help', 'vaultHelp']).toContain(command.command)
        if (command.command !== 'help') continue
        const help = formatCommandHelp(EN, 'muse-spark-code-acp', command.route ?? '')
        expect(help, argv.join(' ')).toContain('--help')
        expect(help, argv.join(' ')).not.toContain('museSpark.')
        expect(help.split('\n').length, argv.join(' ')).toBeGreaterThan(2)
      }
    }
    expect(count).toBeGreaterThan(70)
  })
})
