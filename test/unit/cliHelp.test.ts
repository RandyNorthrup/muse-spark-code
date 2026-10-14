// D108: one table drives parsing and help for the terminal agent. Each
// command's `--help` and `help <command>` print that command's own usage,
// options with defaults and bounds, and two real examples; a wrong option
// exits 2 naming the option, the accepted values and the nearest match.
import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  CLI_HELP_TOPICS,
  CLI_NON_TOPIC_OPTIONS,
  helpTopicNamed,
  renderTopHelp,
  renderTopicHelp,
  topicOptionNames,
} from '../../src/runtime/cliHelp'
import { CLI_OPTION_REGISTRY } from '../../src/runtime/cliOptions'
import { EN } from '../../src/shared/l10n/en'

const COMMAND = 'muse-spark-code-acp'

describe('per-command help', () => {
  it('routes every command --help and help <command> to its own topic', () => {
    expect(parseCommandLine(['exec', '--help'])).toEqual({ command: 'helpTopic', topic: 'exec' })
    expect(parseCommandLine(['auth', '--help'])).toEqual({ command: 'helpTopic', topic: 'auth' })
    expect(parseCommandLine(['providers', '--help'])).toEqual({
      command: 'helpTopic',
      topic: 'providers',
    })
    expect(parseCommandLine(['auth', 'set', '--help'])).toEqual({
      command: 'helpTopic',
      topic: 'auth',
    })
    expect(parseCommandLine(['login', '--help'])).toEqual({
      command: 'helpTopic',
      topic: 'login',
    })
    expect(parseCommandLine(['playbook', '--help'])).toEqual({
      command: 'helpTopic',
      topic: 'playbook',
    })
    expect(parseCommandLine(['playbook', '-h'])).toEqual({
      command: 'helpTopic',
      topic: 'playbook',
    })
    for (const topic of CLI_HELP_TOPICS) {
      expect(parseCommandLine(['help', topic.name])).toEqual({
        command: 'helpTopic',
        topic: topic.name,
      })
    }
  })

  it('keeps the full reference behind help --all and help reference only', () => {
    expect(parseCommandLine(['help', '--all'])).toEqual({ command: 'help', all: true })
    expect(parseCommandLine(['help', 'reference'])).toEqual({ command: 'help', all: true })
    expect(parseCommandLine(['help', 'nope'])).toMatchObject({ command: 'invalid', exitCode: 2 })
    expect(parseCommandLine(['help', 'exec', 'extra'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
    const reason = parseCommandLine(['help', 'nope'])
    expect(reason.command === 'invalid' ? reason.reason : '').toContain('Unknown command')
  })

  it('renders usage, options and two real examples for every topic', () => {
    for (const topic of CLI_HELP_TOPICS) {
      expect(topic.examples, topic.name).toHaveLength(2)
      const text = renderTopicHelp(EN, COMMAND, topic)
      for (const usage of topic.usage) expect(text, topic.name).toContain(usage(COMMAND))
      if (topic.options.length > 0) expect(text).toContain(EN.cliHelp.options)
      expect(text).toContain(EN.cliHelp.examples)
      expect(text).toContain(topic.purpose(EN))
      for (const example of topic.examples) expect(text, topic.name).toContain(example(COMMAND))
      expect(text, topic.name).not.toContain(EN.helpReferenceTitle)
    }
  })

  it('shows defaults and bounds on the exec options that carry them', () => {
    const topic = helpTopicNamed('exec')
    if (topic === undefined) throw new Error('exec topic is missing')
    const text = renderTopicHelp(EN, COMMAND, topic)
    expect(text).toContain('--permission-mode plan|acceptEdits')
    expect(text).toContain('default plan')
    expect(text).toContain('--max-budget-usd <amount>')
    expect(text).toContain('at most 20 USD')
    expect(text).toContain('--timeout <seconds>')
    expect(text).toContain('default 1800')
    expect(text).toContain('--model <model>')
    expect(text).toContain('--untrusted-file <file>')
    expect(text).toContain('repeatable')
  })

  it('lists every command with its purpose on the top-level help', () => {
    const text = renderTopHelp(EN, COMMAND)
    for (const topic of CLI_HELP_TOPICS) {
      expect(text, topic.name).toContain(topic.name)
      expect(text, topic.name).toContain(topic.purpose(EN))
    }
    expect(text).toContain('help <command>')
    expect(text).toContain('help --all')
    expect(text).toContain('--max-budget-usd')
  })
})

describe('wrong options and values', () => {
  it('exits 2 naming the option, the accepted options and the nearest match', () => {
    const parsed = parseCommandLine(['exec', '--max-budgut', '1', 'hi'])
    expect(parsed).toMatchObject({ command: 'invalid', exitCode: 2 })
    const reason = parsed.command === 'invalid' ? parsed.reason : ''
    expect(reason).toContain('--max-budgut')
    expect(reason).toContain('--max-budget-usd')
    expect(reason).toContain('--max-requests')
    expect(reason).toContain('exec --help')
  })

  it('exits 2 for a wrong option on serve, auth, providers and scan-secrets', () => {
    for (const argv of [
      ['--bogus'],
      ['auth', 'status', '--bogus'],
      ['providers', 'list', '--bogus'],
      ['providers', 'models', 'entry', '--bogus'],
      ['scan-secrets', 'file', '--bogus'],
      ['usage', '--bogus'],
      ['legal', '--bogus'],
    ]) {
      const parsed = parseCommandLine(argv)
      expect(parsed, argv.join(' ')).toMatchObject({ command: 'invalid', exitCode: 2 })
      const reason = parsed.command === 'invalid' ? parsed.reason : ''
      expect(reason, argv.join(' ')).toContain('--bogus')
    }
  })

  it('exits 2 for a wrong value, naming what was typed', () => {
    const parsed = parseCommandLine(['--backend', 'auto'])
    expect(parsed).toMatchObject({ command: 'invalid', exitCode: 2 })
    expect(parsed.command === 'invalid' ? parsed.reason : '').toContain('--backend auto')
  })

  it('refuses a secret-looking option without repeating its name', () => {
    const parsed = parseCommandLine(['auth', 'set', '--account-secret-canary'])
    expect(parsed).toMatchObject({ command: 'invalid', exitCode: 2 })
    const reason = parsed.command === 'invalid' ? parsed.reason : ''
    expect(reason).not.toContain('account-secret-canary')
    expect(reason).toContain("Unknown option for 'auth'")
    expect(reason).toContain('--provider')
    expect(reason).toContain('auth --help')
  })

  it('refuses a secret-looking option on serve and in key spellings without repeating it', () => {
    for (const [argv, hidden] of [
      [['--account-secret-canary'], 'account-secret-canary'],
      [['--backend', 'modelApi', '--account-secret-canary'], 'account-secret-canary'],
      [['exec', '--api-key', 'x', 'hi'], 'api-key'],
      [['exec', '--api_key', 'x', 'hi'], 'api_key'],
      [['exec', '--SECRET-KEY', 'x', 'hi'], 'SECRET-KEY'],
    ] as const) {
      const parsed = parseCommandLine([...argv])
      expect(parsed, argv.join(' ')).toMatchObject({ command: 'invalid', exitCode: 2 })
      const reason = parsed.command === 'invalid' ? parsed.reason : ''
      expect(reason, argv.join(' ')).not.toContain(hidden)
    }
  })

  it('names serve accepted options for a wrong serve option', () => {
    const parsed = parseCommandLine(['--max-budgut', '1'])
    expect(parsed).toMatchObject({ command: 'invalid', exitCode: 2 })
    const reason = parsed.command === 'invalid' ? parsed.reason : ''
    expect(reason).toContain('--max-budgut')
    expect(reason).toContain('--max-budget-usd')
    expect(reason).toContain('--trust-workspace')
  })
})

describe('one table drives parsing and help', () => {
  it('covers every parser route except the in-progress estimate', () => {
    const covered = new Set<string>(CLI_HELP_TOPICS.flatMap((topic) => topic.routes))
    const routes = Object.keys(CLI_OPTION_REGISTRY)
    for (const route of routes) {
      if (route === 'estimate') continue
      expect(covered.has(route), route).toBe(true)
    }
    for (const route of covered) {
      expect(routes, route).toContain(route)
    }
  })

  it('shows or maps every parsed option, and shows nothing unparsed', () => {
    for (const topic of CLI_HELP_TOPICS) {
      for (const route of topic.routes) {
        const registry = new Set(Object.keys(CLI_OPTION_REGISTRY[route].options))
        const shown = new Set(
          topic.options.filter((option) => registry.has(option.name)).map((option) => option.name),
        )
        const mapped = new Set(CLI_NON_TOPIC_OPTIONS[route])
        for (const name of registry) {
          expect(shown.has(name) || mapped.has(name), `${route} --${name}`).toBe(true)
        }
        for (const name of mapped) {
          expect(registry.has(name), `${route} --${name}`).toBe(true)
        }
      }
      const names = topicOptionNames(topic)
      for (const option of topic.options) {
        expect(names, `${topic.name} --${option.name}`).toContain(option.name)
      }
    }
  })

  it('parses every shown option without an unknown-option refusal', () => {
    for (const topic of CLI_HELP_TOPICS) {
      for (const option of topic.options) {
        const argv = probeArgv(topic.name, option.name)
        if (argv === undefined) continue
        const parsed = parseCommandLine(argv)
        const reason = parsed.command === 'invalid' ? parsed.reason : ''
        expect(reason, `${topic.name} ${argv.join(' ')}`).not.toMatch(/Unknown option/)
      }
    }
  })

  it('refuses an option outside the table with exit 2', () => {
    const parsed = parseCommandLine(['exec', '--outside-the-table', 'hi'])
    expect(parsed).toMatchObject({ command: 'invalid', exitCode: 2 })
  })
})

/** One probe per shown option: a string option takes a dummy value. */
function probeArgv(topic: string, name: string): string[] | undefined {
  const owner = CLI_HELP_TOPICS.find((candidate) => candidate.name === topic)
  const route = owner?.routes.find((candidate) =>
    Object.keys(CLI_OPTION_REGISTRY[candidate].options).includes(name),
  )
  if (owner === undefined || route === undefined) return undefined
  const definition = Object.entries(CLI_OPTION_REGISTRY[route].options).find(
    ([option]) => option === name,
  )?.[1]
  const flag = [`--${name}`, ...(definition?.type === 'string' ? ['x'] : [])]
  switch (topic) {
    case 'serve': {
      return flag
    }
    case 'login': {
      return ['login', ...flag]
    }
    case 'auth': {
      return ['auth', 'status', ...flag]
    }
    case 'providers': {
      return Object.keys(CLI_OPTION_REGISTRY.providersAdd.options).includes(name)
        ? ['providers', 'add', ...flag]
        : ['providers', 'models', 'entry', ...flag]
    }
    case 'exec': {
      return ['exec', ...flag, 'prompt']
    }
    case 'scan-secrets': {
      return ['scan-secrets', 'file', ...flag]
    }
    case 'report': {
      return ['report', ...flag]
    }
    case 'legal': {
      return ['legal', ...flag]
    }
    case 'fonts': {
      return ['fonts', ...flag]
    }
    case 'setup': {
      return [...flag, 'setup']
    }
    case 'usage': {
      return ['usage', ...flag]
    }
    case 'resources': {
      return ['resources', ...flag]
    }
    default: {
      return undefined
    }
  }
}
