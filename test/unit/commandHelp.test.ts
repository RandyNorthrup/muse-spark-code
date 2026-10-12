import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { CLI_OPTION_REGISTRY, formatCommandHelp } from '../../src/runtime/cliOptions'
import { EN } from '../../src/shared/l10n/en'

describe('EXECPROV command-local help', () => {
  it.each(Object.keys(CLI_OPTION_REGISTRY))('prints %s without editor command IDs', (route) => {
    const help = formatCommandHelp(EN, 'muse-spark-code-acp', route)
    expect(help).not.toContain('museSpark.')
    expect(help).toContain('muse-spark-code-acp')
    expect(help).toContain('--help')
  })
  it.each([
    'exec',
    'scan-secrets',
    'report',
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
