// D120: one table drives parsing and help for the terminal agent. Each
// command's `--help` and `help <command>` print that command's own usage,
// options with defaults and bounds, two real examples and its exit codes; a
// wrong option exits 2 naming the option, the accepted values and the
// nearest match.
import { describe, expect, it } from 'vitest'
import { HELP_ONE_SCREEN_LINES } from '../../src/shared/constants'
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
import {
  parseSharingArgs,
  PROMPT_CHATS,
  PROMPT_SCOPES,
  SHARE_DESTINATIONS,
  SHARE_FORMATS,
  SHARE_MODES,
  SHARING_DEFAULTS,
} from '../../src/runtime/sharing/args'
import { EN } from '../../src/shared/l10n/en'

const COMMAND = 'muse-spark-code-acp'

describe('per-command help', () => {
  it('routes every command --help to its own route and help <command> to its topic', () => {
    expect(parseCommandLine(['exec', '--help'])).toEqual({ command: 'help', route: 'exec' })
    expect(parseCommandLine(['auth', '--help'])).toEqual({ command: 'help', route: 'authStatus' })
    expect(parseCommandLine(['providers', '--help'])).toEqual({
      command: 'help',
      route: 'providersList',
    })
    expect(parseCommandLine(['auth', 'set', '--help'])).toEqual({
      command: 'help',
      route: 'authSet',
    })
    expect(parseCommandLine(['login', '--help'])).toEqual({ command: 'help', route: 'login' })
    expect(parseCommandLine(['playbook', '--help'])).toEqual({
      command: 'help',
      route: 'playbook',
    })
    expect(parseCommandLine(['playbook', '-h'])).toEqual({
      command: 'help',
      route: 'playbook',
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

  it('says auth set reads the key from standard input and status never prints it', () => {
    const topic = helpTopicNamed('auth')
    if (topic === undefined) throw new Error('auth topic is missing')
    const text = renderTopicHelp(EN, COMMAND, topic)
    expect(text).toContain('auth set reads the key from standard input')
    expect(text).toContain('never the key itself')
  })

  it('shows defaults and bounds on the exec options that carry them', () => {
    const topic = helpTopicNamed('exec')
    if (topic === undefined) throw new Error('exec topic is missing')
    const text = renderTopicHelp(EN, COMMAND, topic)
    expect(text).toContain('--permission-mode plan|acceptEdits')
    expect(text).toContain('default plan')
    expect(text).toContain('--max-budget-usd <amount>')
    // D208: the person's budget has no ceiling of ours, so the row names
    // no invented maximum.
    expect(text).not.toContain('at most 20 USD')
    expect(text).toContain('--timeout <seconds>')
    // No deadline of ours: without --timeout a run has no deadline, so the
    // row names neither the old 1800 default nor the old 21600 maximum.
    expect(text).not.toContain('default 1800')
    expect(text).not.toContain('21600')
    expect(text).toContain('--model <model>')
    expect(text).toContain('--untrusted-file <file>')
    expect(text).toContain('repeatable')
  })

  it('preserves required argument shapes even when translations repeat the flag', () => {
    const topic = helpTopicNamed('providers')
    if (topic === undefined) throw new Error('providers topic is missing')
    const text = renderTopicHelp(EN, COMMAND, topic)
    for (const shape of ['--preset <preset>', '--as <id>', '--address <url>', '--privacy <policy>'])
      expect(text).toContain(shape)
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
    const reason = refusalFor(['exec', '--max-budgut', '1', 'hi'])
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
      expect(refusalFor(argv), argv.join(' ')).toContain('--bogus')
    }
  })

  it('names accepted enum values without echoing an untrusted value', () => {
    for (const [argv, option, accepted] of [
      [['--backend', 'auto'], '--backend', 'museCode|modelApi'],
      [['--shell-sandbox', 'on'], '--shell-sandbox', 'auto|muse|off'],
      [['--usage-history', 'maybe'], '--usage-history', 'on|off'],
      [['exec', '--output', 'xml', 'hi'], '--output', 'text|json|jsonl'],
      [['exec', '--permission-mode', 'bypass', 'hi'], '--permission-mode', 'plan|acceptEdits'],
      [
        ['providers', 'add', '--preset', 'custom', '--format', 'xml'],
        '--format',
        'chat|responses|anthropic',
      ],
      [
        ['providers', 'add', '--preset', 'openrouter', '--privacy', 'none'],
        '--privacy',
        'zdr|no-training|any',
      ],
      [['usage', '--range', 'yesterday'], '--range', 'today|7d|30d|90d|custom'],
      [['usage', '--by', 'date'], '--by', 'provider|model|kind|client'],
    ] as const) {
      const reason = refusalFor(argv)
      expect(reason).toContain(option)
      expect(reason).toContain(accepted)
    }
    expect(refusalFor(['--backend', 'secret-canary'])).not.toContain('secret-canary')
  })

  it('names the exec option a wrong value belongs to, never the budget sentence', () => {
    for (const [argv, fragment] of [
      [['exec', '--backend', 'auto', 'hi'], 'Invalid value for --backend'],
      [['exec', '--output', 'xml', 'hi'], 'Invalid value for --output'],
      [['exec', '--effort', 'turbo', 'hi'], 'Invalid value for --effort'],
      [['exec', '--timeout', '0', 'hi'], 'Invalid number or limit for --timeout'],
      [['exec', '--max-requests', '0', 'hi'], 'Invalid number or limit for --max-requests'],
    ] as const) {
      const reason = refusalFor([...argv])
      expect(reason, argv.join(' ')).toContain(fragment)
      expect(reason, argv.join(' ')).not.toContain('six decimal')
    }
    expect(refusalFor(['exec', '--max-budget-usd', 'abc', 'hi'])).toContain('six decimal')
  })

  it('takes --effort none past the enum gate for Thinking off (lane REASONSHAPESR2)', () => {
    const parsed = parseCommandLine(['exec', '--effort', 'none', 'hi'])
    expect(parsed).toMatchObject({ command: 'exec', options: { effort: 'none' } })
    expect(refusalFor(['exec', '--effort', 'turbo', 'hi'])).toContain(
      'minimal|low|medium|high|xhigh|max|ultra|none',
    )
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
      [['--passphrase', 'x'], 'passphrase'],
      [['--session-key', 'x'], 'session-key'],
      [['--auth-key', 'x'], 'auth-key'],
      [['exec', '--bearer', 'x', 'hi'], 'bearer'],
    ] as const) {
      expect(refusalFor([...argv]), argv.join(' ')).not.toContain(hidden)
    }
  })

  it('names serve accepted options for a wrong serve option', () => {
    const reason = refusalFor(['--max-budgut', '1'])
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

  it('mirrors the owner sharing parser: every registered share/prompts flag parses and lands', () => {
    // The strict table never sees these routes (parseCommandLine hands them
    // to the owner before its own parse), so probeArgv skips them; this test
    // binds the registry to the owner directly instead. A registered flag the
    // owner rejects, or one it accepts but drops, fails here.
    for (const mode of SHARE_MODES) {
      expect(share(['--mode', mode])).toMatchObject({ command: 'share', request: { mode } })
    }
    for (const format of SHARE_FORMATS) {
      expect(share(['--format', format])).toMatchObject({
        command: 'share',
        request: { format },
      })
    }
    for (const destination of SHARE_DESTINATIONS) {
      expect(share(['--destination', destination])).toMatchObject({
        command: 'share',
        request: { destination },
      })
    }
    expect(share(['--out', 'chat.md'])).toMatchObject({
      command: 'share',
      out: 'chat.md',
      request: { destination: 'file' },
    })
    expect(share(['--from', 'm1', '--to', 'm2'])).toMatchObject({
      command: 'share',
      request: { range: { from: 'm1', to: 'm2' } },
    })
    expect(share(['--no-code-blocks'])).toMatchObject({
      command: 'share',
      request: { options: { codeBlocks: false } },
    })
    expect(share(['--no-attachment-names'])).toMatchObject({
      command: 'share',
      request: { options: { attachmentNames: false } },
    })
    expect(share(['--diffs'])).toMatchObject({
      command: 'share',
      request: { options: { diffs: true } },
    })
    expect(share(['--attachment-content', 'all'])).toMatchObject({
      command: 'share',
      request: { options: { attachmentContents: ['all'] } },
    })
    expect(share(['--exported-at', 't'])).toMatchObject({ command: 'share', exportedAt: 't' })
    expect(share(['--confirm', 'p1'])).toMatchObject({ command: 'share', confirmation: 'p1' })
    expect(share(['--json'])).toMatchObject({ command: 'share', json: true })
    expect(share(['--cwd', '/x'])).toMatchObject({ command: 'share', cwd: '/x' })
    // The parser-effective defaults are the screen's defaults.
    expect(share([])).toMatchObject({
      command: 'share',
      request: {
        mode: SHARING_DEFAULTS.mode,
        format: SHARING_DEFAULTS.format,
        // The documented conditional default: copy without --out, file with it.
        destination: 'copy',
      },
    })
    expect(list(['--search', 'x'])).toMatchObject({
      command: 'prompts',
      action: 'list',
      search: 'x',
    })
    expect(list(['--tag', 't'])).toMatchObject({ command: 'prompts', action: 'list', tag: 't' })
    expect(list(['--json'])).toMatchObject({ command: 'prompts', action: 'list', json: true })
    expect(save(['--title', 'T'])).toMatchObject({
      command: 'prompts',
      action: 'save',
      title: 'T',
      scope: SHARING_DEFAULTS.scope,
    })
    for (const scope of PROMPT_SCOPES) {
      expect(save(['--title', 'T', '--scope', scope])).toMatchObject({
        command: 'prompts',
        action: 'save',
        scope,
      })
    }
    expect(save(['--title', 'T', '--tag', 't'])).toMatchObject({
      command: 'prompts',
      action: 'save',
      tags: ['t'],
    })
    for (const chat of PROMPT_CHATS) {
      expect(use(['--chat', chat])).toMatchObject({ command: 'prompts', action: 'use', chat })
    }
    const used = use(['--var', 'a=b', '--confirm'])
    if (used.command !== 'prompts' || used.action !== 'use') throw new Error('use probe misparsed')
    expect(used.vars.get('a')).toBe('b')
    expect(used.confirmed).toBe(true)
    expect(use([])).toMatchObject({
      command: 'prompts',
      action: 'use',
      scope: SHARING_DEFAULTS.scope,
      chat: SHARING_DEFAULTS.chat,
      confirmed: false,
    })
    // The owner stays strict: a bogus flag, value or half range throws.
    expect(() => share(['--bogus'])).toThrow()
    expect(() => list(['--bogus'])).toThrow()
    expect(() => share(['--mode', 'nope'])).toThrow()
    expect(() => share(['--from', 'm1'])).toThrow()
    // The screens show the same values and defaults the parser uses.
    const shareTopic = helpTopicNamed('share')
    const promptsTopic = helpTopicNamed('prompts')
    if (shareTopic === undefined || promptsTopic === undefined)
      throw new Error('sharing topics are missing')
    const shareText = renderTopicHelp(EN, COMMAND, shareTopic)
    expect(shareText).toContain(`--mode ${SHARE_MODES.join('|')}`)
    expect(shareText).toContain(`default ${SHARING_DEFAULTS.mode}`)
    expect(shareText).toContain(`--destination ${SHARE_DESTINATIONS.join('|')}`)
    expect(shareText).not.toContain('default copy')
    expect(shareText).toContain('First message to include')
    expect(shareText).toContain('machine-readable result')
    const promptsText = renderTopicHelp(EN, COMMAND, promptsTopic)
    expect(promptsText).toContain(`--chat ${PROMPT_CHATS.join('|')}`)
    expect(promptsText).toContain(`default ${SHARING_DEFAULTS.chat}`)
    expect(promptsText).toContain('--confirm  Confirm without asking')
  })
})

/** The exit-2 refusal one argv earns: asserts the refusal, returns its reason. */
function refusalFor(argv: readonly string[]): string {
  const parsed = parseCommandLine([...argv])
  expect(parsed, argv.join(' ')).toMatchObject({ command: 'invalid', exitCode: 2 })
  return parsed.command === 'invalid' ? parsed.reason : ''
}

/** Probes behind the sharing commands' owner grammar (parseSharingArgs). */
const share = (argv: string[]) => parseSharingArgs(['share', 'chat', ...argv], 's1')
const list = (argv: string[]) => parseSharingArgs(['prompts', 'list', ...argv])
const save = (argv: string[]) => parseSharingArgs(['prompts', 'save', ...argv])
const use = (argv: string[]) => parseSharingArgs(['prompts', 'use', 'pid', ...argv])

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
    case 'lsp': {
      return ['lsp', ...flag]
    }
    case 'panel': {
      return ['panel', ...flag]
    }
    default: {
      return undefined
    }
  }
}

describe('every topic is its own screen', () => {
  const root = renderTopHelp(EN, COMMAND)
  const texts = new Map<string, string>()
  it.each(CLI_HELP_TOPICS.map((topic) => topic.name))(
    'help %s is one screen with its own exit codes',
    (name) => {
      const topic = helpTopicNamed(name)
      if (topic === undefined) throw new Error(`missing help topic ${name}`)
      const text = renderTopicHelp(EN, COMMAND, topic)
      // Never the compact root usage, never longer than one screen.
      expect(text).not.toEqual(root)
      expect(text.split('\n').length).toBeLessThanOrEqual(HELP_ONE_SCREEN_LINES)
      // The sentence names exactly the command's own exit table: no code
      // typed by hand, none missing, none the table does not hold.
      const named = (topic.exits(EN).match(/\d+/g) ?? []).map(Number)
      expect([...new Set(named)].toSorted((a, b) => a - b)).toEqual(
        [...topic.exitCodes].toSorted((a, b) => a - b),
      )
      texts.set(name, text)
    },
  )
  it('no two topics share a screen', () => {
    expect(new Set(texts.values()).size).toBe(CLI_HELP_TOPICS.length)
  })
})
