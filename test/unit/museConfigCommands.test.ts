import { describe, expect, it } from 'vitest'
import {
  type McpAction,
  type MuseConfigDeps,
  showHooks,
  showMcpServers,
} from '../../src/host/commands/museConfigCommands'
import type { PickItem } from '../../src/host/commands/pickItem'

const SETTINGS = '/home/u/.config/muse/settings.json'
const HOOKS = '/ws/.muse/hooks.json'

interface HarnessOptions {
  /** The settings text; undefined for no file; an Error to throw. */
  readonly settings?: string | Error | undefined
  /** Each pick's answer, in order. */
  readonly answers?: readonly (string | undefined)[]
  readonly existing?: readonly string[]
  readonly isTrusted?: boolean
  readonly hasCli?: boolean
  readonly projectHooksPath?: string | undefined
}

function harness(options: HarnessOptions = {}) {
  const picks: { items: readonly PickItem[]; title: string; placeholder: string }[] = []
  const opened: string[] = []
  const terminal: [McpAction, string][] = []
  const information: string[] = []
  const warnings: string[] = []
  let docs = 0
  let restarts = 0
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

describe('showHooks', () => {
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
      ['hooks:project', '.muse/hooks.json', 'Runs in this workspace'],
      ['hooks:user', 'settings.json › hooks', '1 in your settings'],
      [
        'hooks:managed',
        '/etc/muse/hooks.json',
        'Set by your settings; whoever controls this file controls what runs',
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
      'Runs only once you trust this workspace',
      'None in your settings',
      'Your settings name this file, but it does not exist.',
      undefined,
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

  it('warns when the settings file cannot be read and still lists the project file', async () => {
    const t = harness({ settings: new Error('EISDIR: illegal operation on a directory') })
    await showHooks(t.deps)
    expect(t.warnings).toEqual([
      'Muse Code’s settings file could not be read: EISDIR: illegal operation on a directory',
    ])
    expect(t.picks[0]?.items).toHaveLength(4)
  })
})
