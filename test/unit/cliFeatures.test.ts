import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type * as vscode from 'vscode'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { env, Uri, window, workspace } from 'vscode'
import type { ProcessResult } from '../../src/host/backend/sandboxSetup'
import { createCliFeatures } from '../../src/host/cliFeatures'
import { FakeLogOutputChannel } from './helpers/fakes'
import { inform, pickMany, pickOne } from './helpers/vscodeViews'
import { removeFolder } from './helpers/temporaryFolders'

const CATALOG = JSON.stringify({
  skills: [
    { id: 'bundled:grill', name: 'grill', description: 'd', scope: 'bundled', activation: 'on' },
  ],
})
const REPORT = JSON.stringify({
  source: { type: 'codex', path: '/c' },
  dry_run: true,
  candidates: [{ id: 'a' }],
  installed: [{ id: 'a' }],
  quarantined: [],
  skipped: [],
  failed: [],
})

/** A URI on a file system the CLI cannot write to. */
const REMOTE_URI: vscode.Uri = {
  scheme: 'vscode-remote',
  authority: 'ssh-remote+box',
  path: '/home/u/log.json',
  query: '',
  fragment: '',
  fsPath: '/home/u/log.json',
  with: () => REMOTE_URI,
  toString: () => 'vscode-remote://ssh-remote+box/home/u/log.json',
  toJSON: () => ({}),
}

function setup(
  cli?: (args: readonly string[], timeoutMs: number) => ProcessResult,
  config: { readonly settingsPath?: string; readonly workspaceRoot?: string } = {},
) {
  const runs: [readonly string[], number][] = []
  const terminals: [readonly string[], string][] = []
  let restarts = 0
  const features = createCliFeatures({
    runCli: (args, timeoutMs) => {
      if (cli === undefined) {
        return undefined
      }
      runs.push([args, timeoutMs])
      return Promise.resolve(cli(args, timeoutMs))
    },
    runCliInTerminal: (args, terminalName) => {
      terminals.push([args, terminalName])
      return cli !== undefined
    },
    museSettingsPath: () => config.settingsPath ?? '/nowhere/settings.json',
    workspaceRoot: config.workspaceRoot ?? '/ws',
    restartBackend: () => {
      restarts += 1
      return Promise.resolve()
    },
    log: new FakeLogOutputChannel(),
  })
  return { features, runs, terminals, restarts: () => restarts }
}

const folder = mkdtempSync(path.join(tmpdir(), 'muse-cli-features-'))

afterAll(async () => {
  await removeFolder(folder)
})

beforeEach(() => {
  vi.mocked(window.showQuickPick).mockReset()
  vi.mocked(window.showInformationMessage).mockReset()
  vi.mocked(window.showErrorMessage).mockReset()
  vi.mocked(window.showSaveDialog).mockReset()
  vi.mocked(window.showTextDocument).mockReset()
  vi.mocked(window.showWarningMessage).mockReset()
  vi.mocked(workspace.fs.writeFile).mockReset()
  vi.mocked(env.openExternal).mockReset()
})

describe('createCliFeatures: MCP servers and hooks (M31)', () => {
  it('reads the settings file, signs in through the CLI’s terminal and opens the docs', async () => {
    const settingsPath = path.join(folder, 'settings.json')
    await writeFile(
      settingsPath,
      JSON.stringify({
        mcpServers: { docs: { type: 'streamable-http', url: 'https://d.example' } },
      }),
    )
    const t = setup(() => ({ exitCode: 0, stdout: '', stderr: '' }), { settingsPath })
    vi.mocked(pickOne).mockImplementation((items) =>
      Promise.resolve(items.find((item) => item.label === 'docs' || item.label === 'Sign in')),
    )
    await t.features.showMcpServers()
    const [items, options] = vi.mocked(pickOne).mock.calls[0]!
    expect(items[0]).toMatchObject({
      label: 'docs',
      description: 'streamable-http · https://d.example',
    })
    expect(options).toMatchObject({ title: 'Muse Code MCP servers' })
    expect(t.terminals).toEqual([[['mcp', 'login', 'docs'], 'Muse Code MCP sign-in']])
    vi.mocked(pickOne).mockImplementation((choices) =>
      Promise.resolve(choices.find((item) => item.label.includes('documentation'))),
    )
    await t.features.showMcpServers()
    expect(env.openExternal).toHaveBeenCalledWith(
      Uri.parse('https://dev.meta.ai/docs/muse-code/extending'),
    )
  })

  it('treats a missing file as no servers and a directory as unreadable', async () => {
    vi.mocked(pickOne).mockResolvedValue(undefined)
    await setup(undefined, {
      settingsPath: path.join(folder, 'absent.json'),
    }).features.showMcpServers()
    expect(vi.mocked(pickOne).mock.calls[0]?.[1]?.placeHolder).toMatch(
      /^Muse Code has no settings file yet/,
    )
    await setup(undefined, { settingsPath: folder }).features.showMcpServers()
    expect(vi.mocked(pickOne).mock.calls[1]?.[1]?.placeHolder).toMatch(
      /^Muse Code’s settings file could not be read: /,
    )
  })

  it('opens the project’s hooks file from the hooks view', async () => {
    const workspaceRoot = path.join(folder, 'ws')
    await mkdir(path.join(workspaceRoot, '.muse'), { recursive: true })
    await writeFile(path.join(workspaceRoot, '.muse', 'hooks.json'), '{"hooks":[]}')
    const t = setup(undefined, { workspaceRoot, settingsPath: path.join(folder, 'absent.json') })
    vi.mocked(pickOne).mockImplementation((items) => Promise.resolve(items[0]))
    await t.features.showHooks()
    expect(window.showTextDocument).toHaveBeenCalledWith(
      Uri.file(path.join(workspaceRoot, '.muse', 'hooks.json')),
      { preview: false },
    )
  })
})

describe('createCliFeatures', () => {
  it('manages skills through a multi-select pick and restarts on request', async () => {
    const t = setup(() => ({ exitCode: 0, stdout: CATALOG, stderr: '' }))
    // Everything unchecked: grill goes off.
    vi.mocked(pickMany).mockResolvedValue([])
    vi.mocked(inform).mockImplementation((message) =>
      Promise.resolve(
        message.startsWith('Muse Code loads skill changes') ? 'Restart now' : undefined,
      ),
    )
    await t.features.manageSkills()
    const [, options] = vi.mocked(window.showQuickPick).mock.calls[0]!
    expect(options).toMatchObject({ canPickMany: true, title: 'Muse Code skills' })
    expect(t.runs.map(([args, timeoutMs]) => [args[1], timeoutMs])).toEqual([
      ['list', 30_000],
      ['disable', 30_000],
    ])
    expect(t.restarts()).toBe(1)
  })

  it('treats a dismissed skills pick as no change and reports failures as errors', async () => {
    const t = setup(() => ({ exitCode: 0, stdout: CATALOG, stderr: '' }))
    vi.mocked(pickMany).mockResolvedValue(undefined)
    await t.features.manageSkills()
    expect(t.runs).toHaveLength(1)
    const missing = setup()
    await missing.features.manageSkills()
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Managing skills needs the Muse Code CLI, which is not installed.',
    )
  })

  it('imports from the picked source after a modal confirmation', async () => {
    const t = setup(() => ({ exitCode: 0, stdout: REPORT, stderr: '' }))
    vi.mocked(pickOne).mockImplementation((items) => Promise.resolve(items[1]))
    vi.mocked(inform).mockImplementation((message) =>
      Promise.resolve(message.startsWith('Import these') ? 'Import' : 'Later'),
    )
    await t.features.importSkills()
    expect(t.runs.map(([args]) => args.slice(0, 4))).toEqual([
      ['skills', 'import', '--from', 'codex'],
      ['skills', 'import', '--from', 'codex'],
    ])
    expect(vi.mocked(window.showInformationMessage).mock.calls[0]?.[1]).toEqual({
      modal: true,
      detail: 'a',
    })
    expect(t.restarts()).toBe(0)
  })

  it('saves Markdown where the user chose and opens it; a dismissed dialog writes nothing', async () => {
    const t = setup()
    const target = Uri.file('/ws/muse-x.md')
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(target)
    await t.features.exports.saveMarkdown('muse-x.md', '# X\n')
    expect(vi.mocked(window.showSaveDialog).mock.calls[0]?.[0]).toMatchObject({
      filters: { Markdown: ['md'] },
    })
    expect(vi.mocked(window.showSaveDialog).mock.calls[0]?.[0]?.defaultUri?.fsPath).toMatch(
      /muse-x\.md$/,
    )
    expect(workspace.fs.writeFile).toHaveBeenCalledWith(target, new TextEncoder().encode('# X\n'))
    expect(window.showTextDocument).toHaveBeenCalledWith(target, { preview: false })
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(undefined)
    await t.features.exports.saveMarkdown('muse-y.md', 'y')
    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(1)
  })

  it('has the CLI write the session log, and opens it on request', async () => {
    const t = setup(() => ({ exitCode: 0, stdout: '', stderr: '' }))
    const target = Uri.file('/ws/log.json')
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(target)
    vi.mocked(inform).mockResolvedValue('Open')
    await t.features.exports.saveSessionLog('s1', 'log.json')
    expect(t.runs).toEqual([[['export', '--session', 's1', '--out', '/ws/log.json'], 60_000]])
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Conversation exported to /ws/log.json',
      'Open',
    )
    expect(window.showTextDocument).toHaveBeenCalledWith(target, { preview: false })
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(undefined)
    await t.features.exports.saveSessionLog('s1', 'log.json')
    expect(t.runs).toHaveLength(1)
  })

  it('refuses a folder the CLI cannot reach, a missing CLI and a failed export', async () => {
    vi.mocked(window.showSaveDialog).mockResolvedValue(REMOTE_URI)
    await expect(setup().features.exports.saveSessionLog('s1', 'log.json')).rejects.toThrow(
      'pick a folder on this machine',
    )
    vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('/ws/log.json'))
    await expect(setup().features.exports.saveSessionLog('s1', 'log.json')).rejects.toThrow(
      'needs the Muse Code CLI',
    )
    const failing = setup(() => ({ exitCode: 2, stdout: '', stderr: 'no such session\nmore' }))
    await expect(failing.features.exports.saveSessionLog('s1', 'log.json')).rejects.toThrow(
      /^no such session$/,
    )
    const silent = setup(() => ({ exitCode: 2, stdout: '', stderr: '' }))
    await expect(silent.features.exports.saveSessionLog('s1', 'log.json')).rejects.toThrow(
      'muse export: exit code 2',
    )
    vi.mocked(inform).mockResolvedValue(undefined)
    const quiet = setup(() => ({ exitCode: 0, stdout: '', stderr: '' }))
    await quiet.features.exports.saveSessionLog('s1', 'log.json')
    expect(window.showTextDocument).not.toHaveBeenCalled()
  })
})
