import { describe, expect, it } from 'vitest'
import {
  type McpAction,
  type MuseConfigDeps,
  showHooks,
  showMcpServers,
} from '../../src/host/commands/museConfigCommands'
import type { PickItem } from '../../src/host/commands/pickItem'
import type { McpPoolSnapshot } from '../../src/core/backends/modelapi/mcp/pool'

const SETTINGS = '/home/u/.config/muse/settings.json'
const HOOKS = '/ws/.muse/hooks.json'
const SPARK_PROJECT = '/ws/.muse/spark-hooks.json'
const SPARK_USER = '/home/u/.config/muse/spark-hooks.json'
// Who runs each file (M91, PLAN.md D70), under its row.
const BOTH = 'Run by Muse Code, and by this window on the Model API backend'
const SPARK =
  'Run by this window: on the Model API backend, and on both backends for the events the extension itself handles'

interface HarnessOptions {
  /** The settings text; undefined for no file; an Error to throw. */
  readonly settings?: string | Error | undefined
  /** Each pick's answer, in order. */
  readonly answers?: readonly (string | undefined)[]
  readonly existing?: readonly string[]
  readonly isTrusted?: boolean
  readonly hasCli?: boolean
  readonly projectHooksPath?: string | undefined
  /** The window runs the Model API backend (M50): its servers' snapshot, undefined before they start. */
  readonly modelApi?: { readonly snapshot: McpPoolSnapshot | undefined }
  readonly modelApiHooks?: boolean | undefined
  /** The hook files' texts by path, read for the spark-hooks.json rows (M91). */
  readonly files?: Readonly<Record<string, string>>
}

function harness(options: HarnessOptions = {}) {
  const picks: { items: readonly PickItem[]; title: string; placeholder: string }[] = []
  const opened: string[] = []
  const terminal: [McpAction, string][] = []
  const information: string[] = []
  const warnings: string[] = []
  let docs = 0
  let restarts = 0
  let logs = 0
  let modelApiSettingsOpened = 0
  const answers = [...(options.answers ?? [])]
  const existing = new Set(options.existing ?? [SETTINGS])
  const deps: MuseConfigDeps = {
    settingsPath: SETTINGS,
    readSettings: () => {
      const value = 'settings' in options ? options.settings : '{}'
      if (value instanceof Error) {
        throw value
      }
      return value
    },
    projectHooksPath: 'projectHooksPath' in options ? options.projectHooksPath : HOOKS,
    ...(options.files !== undefined && {
      sparkProjectPath: SPARK_PROJECT,
      sparkUserPath: SPARK_USER,
      readTextFile: (fsPath: string) => options.files?.[fsPath],
    }),
    fileExists: (fsPath) => existing.has(fsPath),
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    pick: (items, title, placeholder) => {
      picks.push({ items, title, placeholder })
      return Promise.resolve(answers.shift())
    },
    openFile: (fsPath) => {
      opened.push(fsPath)
      return Promise.resolve()
    },
    openDocs: () => {
      docs += 1
    },
    runMcpCommand: (action, server) => {
      terminal.push([action, server])
      return options.hasCli ?? true
    },
    restart: () => {
      restarts += 1
      return Promise.resolve()
    },
    showInformation: (message) => {
      information.push(message)
    },
    showWarning: (message) => {
      warnings.push(message)
    },
    ...(options.modelApi !== undefined && {
      modelApiServers: () => options.modelApi?.snapshot,
      openLog: () => {
        logs += 1
      },
    }),
    ...(options.modelApiHooks !== undefined && {
      modelApiHooks: () => options.modelApiHooks,
      openModelApiHooksSetting: () => {
        modelApiSettingsOpened += 1
        return Promise.resolve()
      },
    }),
  }
  return {
    deps,
    picks,
    opened,
    terminal,
    information,
    warnings,
    docs: () => docs,
    restarts: () => restarts,
    logs: () => logs,
    modelApiSettingsOpened: () => modelApiSettingsOpened,
  }
}

const TWO_SERVERS = JSON.stringify({
  mcpServers: {
    docs: { type: 'streamable-http', url: 'https://docs.example/mcp', headers: { A: '1' } },
    local: { type: 'stdio', command: 'tool', env: { K: 'v' }, mode: 'optional', enabled: false },
  },
})

describe('showMcpServers', () => {
  it('lists each server with its transport, target, mode and secret names, then the actions', async () => {
    const t = harness({ settings: TWO_SERVERS })
    await showMcpServers(t.deps)
    expect(t.picks[0]?.title).toBe('Muse Code MCP servers')
    expect(t.picks[0]?.placeholder).toBe(`2 MCP servers in ${SETTINGS}`)
    expect(t.picks[0]?.items).toEqual([
      {
        id: 'server:docs',
        label: 'docs',
        description: 'streamable-http · https://docs.example',
        detail: 'required (Muse Code stops if it fails) · headers: A',
      },
      {
        id: 'server:local',
        label: 'local',
        description: 'stdio · tool',
        detail: 'optional · turned off · environment: K',
      },
      { id: 'action:openSettings', label: 'Open the settings file', detail: SETTINGS },
      {
        id: 'action:restart',
        label: 'Restart Muse Code to load changes',
        detail: 'A reply that is running stops; the conversation continues on your next message',
      },
      { id: 'action:docs', label: 'MCP servers in Muse Code (documentation)' },
    ])
    expect(t.warnings).toEqual([])
  })

  it('counts one server in the singular (M40: plural forms, not a spliced count)', async () => {
    const t = harness({
      settings: JSON.stringify({ mcpServers: { local: { type: 'stdio', command: 'tool' } } }),
    })
    await showMcpServers(t.deps)
    expect(t.picks[0]?.placeholder).toBe(`1 MCP server in ${SETTINGS}`)
  })

  it('signs in to or out of a remote server in a terminal, and says when the CLI is missing', async () => {
    const t = harness({ settings: TWO_SERVERS, answers: ['server:docs', 'login'] })
    await showMcpServers(t.deps)
    expect(t.picks[1]?.items.map((item) => item.id)).toEqual([
      'login',
      'logout',
      'action:openSettings',
    ])
    expect(t.terminal).toEqual([['login', 'docs']])
    const missing = harness({
      settings: TWO_SERVERS,
      answers: ['server:docs', 'logout'],
      hasCli: false,
    })
    await showMcpServers(missing.deps)
    expect(missing.warnings).toEqual([
      'Signing in to an MCP server needs the Muse Code CLI, which is not installed.',
    ])
  })

  it('offers a local server only its settings entry', async () => {
    const t = harness({ settings: TWO_SERVERS, answers: ['server:local', 'action:openSettings'] })
    await showMcpServers(t.deps)
    expect(t.picks[1]?.items.map((item) => item.id)).toEqual(['action:openSettings'])
    expect(t.picks[1]?.placeholder).toBe(
      'A local server needs no sign-in; edit its entry in the settings file',
    )
    expect(t.opened).toEqual([SETTINGS])
    const dismissed = harness({ settings: TWO_SERVERS, answers: ['server:local', undefined] })
    await showMcpServers(dismissed.deps)
    expect(dismissed.opened).toEqual([])
    const vanished = harness({ settings: TWO_SERVERS, answers: ['server:gone'] })
    await showMcpServers(vanished.deps)
    expect(vanished.picks).toHaveLength(1)
  })

  it('runs the settings, restart and documentation actions', async () => {
    const open = harness({ answers: ['action:openSettings'] })
    await showMcpServers(open.deps)
    expect(open.opened).toEqual([SETTINGS])
    const noFile = harness({ settings: undefined, answers: ['action:openSettings'], existing: [] })
    await showMcpServers(noFile.deps)
    expect(noFile.picks[0]?.placeholder).toBe(
      `Muse Code has no settings file yet, so no MCP servers. It would be at ${SETTINGS}`,
    )
    expect(noFile.information).toEqual([
      `Muse Code has not written a settings file yet. It would be at ${SETTINGS}`,
    ])
    const restart = harness({ answers: ['action:restart'] })
    await showMcpServers(restart.deps)
    expect(restart.restarts()).toBe(1)
    expect(restart.information).toEqual([
      'Muse Code restarted; your next message loads the settings as they are now.',
    ])
    const docs = harness({ answers: ['action:docs'] })
    await showMcpServers(docs.deps)
    expect(docs.docs()).toBe(1)
    const dismissed = harness({ answers: [undefined] })
    await showMcpServers(dismissed.deps)
    expect(dismissed.docs() + dismissed.restarts() + dismissed.opened.length).toBe(0)
  })

  it('warns out loud about the faults that load no server, and an unreadable file', async () => {
    const conflicted = harness({
      settings: JSON.stringify({
        mcpServers: { a: { command: 'x', required: true, mode: 'optional' } },
        mcp_servers: {},
      }),
    })
    await showMcpServers(conflicted.deps)
    expect(conflicted.warnings).toEqual([
      'Muse Code’s settings hold both “mcpServers” and “mcp_servers”, so it loads no MCP server from either. Keep one key.',
      'Muse Code loads no MCP server while a server sets both “required” and “mode”. Keep only “mode” on: a',
    ])
    expect(conflicted.picks[0]?.items[0]?.detail).toContain('“required” and “mode” are both set')
    const empty = harness({ settings: '{"schema_version":1}' })
    await showMcpServers(empty.deps)
    expect(empty.picks[0]?.placeholder).toBe(`No MCP servers are configured in ${SETTINGS}`)
    const garbled = harness({ settings: '{ nope' })
    await showMcpServers(garbled.deps)
    expect(garbled.picks[0]?.placeholder).toMatch(/^Muse Code’s settings file could not be read: /)
    const denied = harness({ settings: new Error('EACCES: permission denied') })
    await showMcpServers(denied.deps)
    expect(denied.picks[0]?.placeholder).toBe(
      'Muse Code’s settings file could not be read: EACCES: permission denied',
    )
  })
})

const FIVE_SERVERS = JSON.stringify({
  mcpServers: {
    docs: { type: 'streamable-http', url: 'https://docs.example/mcp' },
    local: { type: 'stdio', command: 'tool', mode: 'optional' },
    broken: { type: 'stdio', command: 'bad' },
    off: { type: 'stdio', command: 'x', enabled: false },
    waiting: { type: 'stdio', command: 'slow' },
    later: { type: 'stdio', command: 'new' },
    locked: { type: 'stdio', command: 'y' },
  },
})

const LIVE: McpPoolSnapshot = {
  isStarted: true,
  fault: undefined,
  servers: [
    {
      name: 'docs',
      isRequired: true,
      state: { status: 'connected', toolCount: 1, unofferedCount: 0 },
    },
    {
      name: 'local',
      isRequired: false,
      state: { status: 'connected', toolCount: 3, unofferedCount: 2 },
    },
    {
      name: 'broken',
      isRequired: true,
      state: { status: 'failed', reason: 'it exited with code 1' },
    },
    { name: 'off', isRequired: true, state: { status: 'disabled' } },
    { name: 'waiting', isRequired: true, state: { status: 'starting' } },
    { name: 'locked', isRequired: true, state: { status: 'restricted' } },
  ],
}

describe('showMcpServers on the Model API backend (M50)', () => {
  it('shows each server as this window runs it, and the built-in diagnostics server', async () => {
    const t = harness({ settings: FIVE_SERVERS, modelApi: { snapshot: LIVE } })
    await showMcpServers(t.deps)
    expect(t.picks[0]?.title).toBe('MCP servers on the Model API backend')
    expect(t.picks[0]?.items.map((item) => [item.id, item.detail])).toEqual([
      ['server:docs', 'Connected: 1 tool · required (a message stops if it is not running)'],
      ['server:local', 'Connected: 3 tools · 2 more not offered · optional'],
      [
        'server:broken',
        'Not running: it exited with code 1 · required (a message stops if it is not running)',
      ],
      ['server:off', 'turned off · required (a message stops if it is not running)'],
      ['server:waiting', 'Starting… · required (a message stops if it is not running)'],
      [
        'server:later',
        'Starts with your next message · required (a message stops if it is not running)',
      ],
      [
        'server:locked',
        'Not started: this workspace is in Restricted Mode · required (a message stops if it is not running)',
      ],
      [
        'builtin:ide',
        'The extension’s own getDiagnostics: the errors and warnings in VS Code’s Problems panel',
      ],
      ['action:openSettings', SETTINGS],
      [
        'action:restart',
        'A reply that is running stops; the servers start again with your next message, from the settings as they are then',
      ],
      ['action:docs', undefined],
    ])
    expect(t.picks[0]?.items.find((item) => item.id === 'builtin:ide')).toMatchObject({
      label: 'ide',
      description: 'built in',
    })
  })

  it('says a server starts with the next message before any has, and that none load after a fault', async () => {
    const before = harness({ settings: FIVE_SERVERS, modelApi: { snapshot: undefined } })
    await showMcpServers(before.deps)
    expect(before.picks[0]?.items[0]?.detail).toMatch(/^Starts with your next message/)
    const faulted = harness({
      settings: FIVE_SERVERS,
      modelApi: { snapshot: { isStarted: true, fault: { kind: 'keys' }, servers: [] } },
    })
    await showMcpServers(faulted.deps)
    expect(faulted.picks[0]?.items[0]?.detail).toMatch(/^Not loaded: see the warning/)
  })

  it('opens the log or the entry for a server, never a Muse Code sign-in', async () => {
    const log = harness({
      settings: FIVE_SERVERS,
      modelApi: { snapshot: LIVE },
      answers: ['server:docs', 'action:log'],
    })
    await showMcpServers(log.deps)
    expect(log.picks[1]?.items.map((item) => item.id)).toEqual([
      'action:log',
      'action:openSettings',
    ])
    expect(log.picks[1]?.placeholder).toBe(
      'This window runs the server itself; a sign-in with muse mcp login is for Muse Code only',
    )
    expect(log.logs()).toBe(1)
    expect(log.terminal).toEqual([])
    const entry = harness({
      settings: FIVE_SERVERS,
      modelApi: { snapshot: LIVE },
      answers: ['server:local', 'action:openSettings'],
    })
    await showMcpServers(entry.deps)
    expect(entry.opened).toEqual([SETTINGS])
    const dismissed = harness({
      settings: FIVE_SERVERS,
      modelApi: { snapshot: LIVE },
      answers: ['server:local', undefined],
    })
    await showMcpServers(dismissed.deps)
    expect(dismissed.opened.length + dismissed.logs()).toBe(0)
  })

  it('does nothing for the built-in server, and restarts the servers', async () => {
    const builtIn = harness({ modelApi: { snapshot: LIVE }, answers: ['builtin:ide'] })
    await showMcpServers(builtIn.deps)
    expect(builtIn.picks).toHaveLength(1)
    expect(builtIn.docs()).toBe(0)
    const restart = harness({ modelApi: { snapshot: LIVE }, answers: ['action:restart'] })
    await showMcpServers(restart.deps)
    expect(restart.restarts()).toBe(1)
    expect(restart.information).toEqual([
      'The MCP servers stopped; your next message starts them from the settings as they are now.',
    ])
  })
})

describe('showHooks', () => {
  it('shows Model API hook opt-in state before source files', async () => {
    const off = harness({ modelApiHooks: false, existing: [SETTINGS, HOOKS] })
    await showHooks(off.deps)
    expect(off.picks[0]?.title).toBe('Model API hooks')
    expect(off.picks[0]?.items[0]).toMatchObject({
      id: 'hooks:modelApiSetting',
      label: 'museSpark.modelApiHooks',
      detail: 'off',
    })
    expect(off.picks[0]?.items[1]?.detail).toBe(`off · ${BOTH}`)
    const on = harness({ modelApiHooks: true, existing: [SETTINGS, HOOKS] })
    await showHooks(on.deps)
    expect(on.picks[0]?.items[0]?.detail).toBe('on')
    expect(on.picks[0]?.items[1]?.detail).toBe(`Runs in this workspace · ${BOTH}`)
    const chosen = harness({ modelApiHooks: false, answers: ['hooks:modelApiSetting'] })
    await showHooks(chosen.deps)
    expect(chosen.modelApiSettingsOpened()).toBe(1)
  })

  it('lists the three sources with the sandbox warning', async () => {
    const t = harness({
      settings: JSON.stringify({ hooks: [{}], managed_hooks_path: '/etc/muse/hooks.json' }),
      existing: [SETTINGS, HOOKS, '/etc/muse/hooks.json'],
    })
    await showHooks(t.deps)
    expect(t.picks[0]?.placeholder).toBe(
      'Hooks run through your shell, outside Muse Code’s sandbox and approvals',
    )
    expect(t.picks[0]?.items.map((item) => [item.id, item.description, item.detail])).toEqual([
      ['hooks:project', '.muse/hooks.json', `Runs in this workspace · ${BOTH}`],
      ['hooks:user', 'settings.json › hooks', `1 hook in your settings · ${BOTH}`],
      [
        'hooks:managed',
        '/etc/muse/hooks.json',
        `Set by your settings; whoever controls this file controls what runs · ${BOTH}`,
      ],
      ['action:docs', undefined, undefined],
    ])
  })

  it('says what is missing and whether trust is needed', async () => {
    const t = harness({
      settings: JSON.stringify({ managed_hooks_path: '/gone.json' }),
      existing: [SETTINGS, HOOKS],
      isTrusted: false,
    })
    await showHooks(t.deps)
    expect(t.picks[0]?.items.map((item) => item.detail)).toEqual([
      `Runs only once you trust this workspace · ${BOTH}`,
      'None in your settings',
      'Your settings name this file, but it does not exist.',
      undefined,
    ])
    // On the Model API backend every configured source waits for trust; on
    // Muse Code only the project's says so, since Muse Code applies its rules.
    const configured = {
      settings: JSON.stringify({ hooks: [{}], managed_hooks_path: '/etc/muse/hooks.json' }),
      existing: [SETTINGS, HOOKS, '/etc/muse/hooks.json'],
      isTrusted: false,
    }
    const modelApi = harness({ ...configured, modelApiHooks: true })
    await showHooks(modelApi.deps)
    expect(modelApi.picks[0]?.items.slice(1, 4).map((item) => item.detail)).toEqual([
      `Runs only once you trust this workspace · ${BOTH}`,
      `1 hook in your settings · Runs only once you trust this workspace · ${BOTH}`,
      `Set by your settings; whoever controls this file controls what runs · Runs only once you trust this workspace · ${BOTH}`,
    ])
    const museCode = harness(configured)
    await showHooks(museCode.deps)
    expect(museCode.picks[0]?.items.slice(1, 3).map((item) => item.detail)).toEqual([
      `1 hook in your settings · ${BOTH}`,
      `Set by your settings; whoever controls this file controls what runs · ${BOTH}`,
    ])
    const bare = harness({ settings: undefined, existing: [], projectHooksPath: undefined })
    await showHooks(bare.deps)
    expect(bare.picks[0]?.items.map((item) => item.detail)).toEqual([
      'This workspace has no .muse/hooks.json.',
      'None in your settings',
      'Not set: no administrator hooks',
      undefined,
    ])
  })

  it('opens the chosen source, or says it is not there', async () => {
    const managed = '/etc/muse/hooks.json'
    const present = [SETTINGS, HOOKS, managed]
    const withManaged = JSON.stringify({ managed_hooks_path: managed })
    for (const [answer, expected] of [
      ['hooks:project', HOOKS],
      ['hooks:user', SETTINGS],
      ['hooks:managed', managed],
    ] as const) {
      const t = harness({ settings: withManaged, existing: present, answers: [answer] })
      await showHooks(t.deps)
      expect(t.opened, answer).toEqual([expected])
    }
    const absent = harness({ settings: '{}', existing: [SETTINGS], answers: ['hooks:project'] })
    await showHooks(absent.deps)
    expect(absent.information).toEqual(['This workspace has no .muse/hooks.json.'])
    const notSet = harness({ settings: '{}', answers: ['hooks:managed'] })
    await showHooks(notSet.deps)
    expect(notSet.information).toEqual(['Not set: no administrator hooks'])
    const docs = harness({ answers: ['action:docs'] })
    await showHooks(docs.deps)
    expect(docs.docs()).toBe(1)
    const dismissed = harness({ answers: [undefined] })
    await showHooks(dismissed.deps)
    expect(dismissed.opened).toEqual([])
  })

  it('lists both files per scope and which backend runs each (M91 acceptance 8)', async () => {
    const t = harness({
      existing: [SETTINGS, HOOKS, SPARK_PROJECT],
      files: {
        [HOOKS]: JSON.stringify({
          hooks: {
            StopFailure: [{ hooks: [{ type: 'command', command: 'a' }] }],
            TaskCreated: [{ hooks: [{ type: 'command', command: 'b' }] }],
          },
        }),
        [SPARK_PROJECT]: JSON.stringify({
          hooks: {
            TaskCreated: [{ hooks: [{ type: 'command', command: 'c' }] }],
            PreToolUse: [
              {
                format: 'cursor',
                sourceEvent: 'preToolUse',
                hooks: [{ type: 'command', command: 'd' }],
              },
              {
                format: 'kiro',
                sourceEvent: 'PreToolUse',
                hooks: [{ type: 'command', command: 'e' }],
              },
            ],
            Stop: [{ hooks: [{ type: 'command', command: 'f' }] }],
          },
        }),
      },
    })
    await showHooks(t.deps)
    expect(t.picks[0]?.items.map((item) => [item.id, item.description, item.detail])).toEqual([
      [
        'hooks:project',
        '.muse/hooks.json',
        [
          'Runs in this workspace',
          BOTH,
          'Muse Code 1.4.2 does not run StopFailure hooks; this window runs them on the Model API backend.',
          'TaskCreated runs only from spark-hooks.json; Muse Code skips it in this file.',
        ].join(' · '),
      ],
      [
        'hooks:sparkProject',
        '.muse/spark-hooks.json',
        [
          '4 hooks in .muse/spark-hooks.json',
          SPARK,
          'Cursor format, Kiro format',
          'Hooks in another agent’s format run only on the Model API backend.',
          'Stop is a Muse Code event: configure it in .muse/hooks.json, so it runs once.',
        ].join(' · '),
      ],
      ['hooks:user', 'settings.json › hooks', 'None in your settings'],
      ['hooks:sparkUser', SPARK_USER, 'You have no spark-hooks.json.'],
      ['hooks:managed', 'managed_hooks_path', 'Not set: no administrator hooks'],
      ['action:docs', undefined, undefined],
    ])
    const opened = harness({
      existing: [SETTINGS, SPARK_PROJECT],
      files: {},
      answers: ['hooks:sparkProject'],
    })
    await showHooks(opened.deps)
    expect(opened.opened).toEqual([SPARK_PROJECT])
    const absent = harness({ files: {}, answers: ['hooks:sparkUser'] })
    await showHooks(absent.deps)
    expect(absent.information).toEqual([
      'You have no spark-hooks.json. Muse Code never reads this file. It holds the events only this extension runs, and hooks imported from other agents.',
    ])
  })

  it('warns when the settings file cannot be read and still lists the project file', async () => {
    const t = harness({ settings: new Error('EISDIR: illegal operation on a directory') })
    await showHooks(t.deps)
    expect(t.warnings).toEqual([
      'Muse Code’s settings file could not be read: EISDIR: illegal operation on a directory',
    ])
    expect(t.picks[0]?.items).toHaveLength(4)
  })
})
