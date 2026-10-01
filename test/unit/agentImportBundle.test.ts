// The import's own bundle (M83, PLAN.md D6): the loader that refuses a
// missing or malformed module with the reason, and the shipped CommonJS
// bundle itself, built and required as the extension requires it, run over a
// real home and a Codex configuration (the bundle carries `smol-toml`).

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  agentImportLoader,
  isAgentImportBundle,
  type AgentImportBundle,
} from '../../src/host/agentImportBundle'
import type { AgentImportHost } from '../../src/host/commands/agentImportCommands'
import { AGENT_IMPORT_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'
import { SYNTHETIC } from './helpers/syntheticTokens'

const built = { folder: '', file: '' }

// Built as scripts/build.mjs builds it.
beforeAll(async () => {
  built.folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-import-bundle-')))
  built.file = path.join(built.folder, AGENT_IMPORT_BUNDLE_FILE)
  const vscodeDirectory = path.join(built.folder, 'node_modules', 'vscode')
  mkdirSync(vscodeDirectory, { recursive: true })
  writeFileSync(
    path.join(vscodeDirectory, 'index.js'),
    `module.exports = { workspace: { isTrusted: true }, window: { showQuickPick: async (_items, options) => { require('node:fs').writeFileSync(${JSON.stringify(path.join(built.folder, 'picker.json'))}, JSON.stringify(options)); } } }\n`,
  )
  await build({
    entryPoints: [path.resolve('src/host/agentImportEntry.ts')],
    outfile: built.file,
    bundle: true,
    platform: 'node',
    external: ['vscode'],
    format: 'cjs',
    target: 'node20.18',
    logLevel: 'silent',
  })
})
afterAll(() => removeFolder(built.folder))

describe('isAgentImportBundle', () => {
  it('accepts a module that exports the import, and nothing else', () => {
    expect(
      isAgentImportBundle({
        importFromAgents: () => Promise.resolve(),
        runAgentImport: () => Promise.resolve(),
      }),
    ).toBe(true)
    expect(isAgentImportBundle({ importFromAgents: () => Promise.resolve() })).toBe(false)
    expect(
      isAgentImportBundle({ importFromAgents: () => Promise.resolve(), runAgentImport: 1 }),
    ).toBe(false)
    expect(isAgentImportBundle({ importFromAgents: 1 })).toBe(false)
    expect(isAgentImportBundle({})).toBe(false)
    expect(isAgentImportBundle(null)).toBe(false)
    expect(isAgentImportBundle('importFromAgents')).toBe(false)
  })
})

describe('agentImportLoader', () => {
  const bundle: AgentImportBundle = {
    importFromAgents: () => Promise.resolve(),
    runAgentImport: () => Promise.resolve(),
  }

  it('loads the bundle once and keeps it', () => {
    const loadBundle = vi.fn(() => bundle)
    const load = agentImportLoader({
      bundlePath: '/dist/agentImport.js',
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(load()).toBe(bundle)
    expect(load()).toBe(bundle)
    expect(loadBundle).toHaveBeenCalledOnce()
    expect(loadBundle).toHaveBeenCalledWith('/dist/agentImport.js')
  })

  it('says why a module that cannot be loaded is refused, and tries again on the next call', () => {
    const log = new FakeLogOutputChannel()
    let isBroken = true
    const load = agentImportLoader({
      bundlePath: '/dist/agentImport.js',
      log,
      loadBundle: () => {
        if (isBroken) throw new Error('Cannot find module')
        return bundle
      },
    })
    expect(() => load()).toThrow(UI_TEXT.agentImportUnavailable)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('could not be loaded'))
    isBroken = false
    expect(load()).toBe(bundle)
  })

  it('refuses a module that does not export the import', () => {
    const log = new FakeLogOutputChannel()
    const load = agentImportLoader({
      bundlePath: '/dist/agentImport.js',
      log,
      loadBundle: () => ({ somethingElse: true }),
    })
    expect(() => load()).toThrow(UI_TEXT.agentImportUnavailable)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('does not export the import'))
  })

  it('refuses a file that does not exist with the same reason', () => {
    const load = agentImportLoader({
      bundlePath: path.join(built.folder, 'missing', AGENT_IMPORT_BUNDLE_FILE),
      log: new FakeLogOutputChannel(),
    })
    expect(() => load()).toThrow(UI_TEXT.agentImportUnavailable)
  })
})

describe('the shipped import bundle', () => {
  it('is the module the loader accepts', () => {
    const loaded = agentImportLoader({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
    })()
    expect(typeof loaded.importFromAgents).toBe('function')
    expect(typeof loaded.runAgentImport).toBe('function')
  })

  it('runs its shipped UI entry with the handed table and captures its owner before the picker', async () => {
    const bundled = agentImportLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })()
    const captureOwner = vi.fn(() => undefined)
    const done = bundled.runAgentImport(
      {
        workspaceRoot: undefined,
        currentRoot: () => undefined,
        isActive: () => true,
        captureOwner,
        editProject: async (work) => await work(() => undefined),
        beforeProjectWrite: () => Promise.resolve(),
        museSettingsPath: () => path.join(built.folder, 'settings.json'),
        openDocument: () => Promise.resolve(),
        bundle: () => bundled,
        log: new FakeLogOutputChannel(),
      },
      { ...UI_TEXT, agentImportSourceTitle: 'Marker choose.' },
      uiLocale(),
    )
    expect(captureOwner).toHaveBeenCalledOnce()
    await done
    expect(JSON.parse(readFileSync(path.join(built.folder, 'picker.json'), 'utf8'))).toMatchObject({
      title: 'Marker choose.',
    })
  })

  it('imports Codex’s MCP servers with smol-toml inside the bundle, masked, and writes nothing to the settings', async () => {
    const home = path.join(built.folder, 'home')
    const codex = path.join(home, '.codex')
    mkdirSync(codex, { recursive: true })
    writeFileSync(
      path.join(codex, 'config.toml'),
      [
        '[mcp_servers.docs]',
        'command = "docs-mcp"',
        'args = ["--token", "' + SYNTHETIC.githubToken + '"]',
        '[mcp_servers.docs.env]',
        'API_KEY = "hunter2"',
        '',
      ].join('\n'),
    )
    const settings = path.join(home, '.config', 'muse', 'settings.json')
    const copied: string[] = []
    const opened: string[] = []
    const previews: string[] = []
    const informed: string[] = []
    const host: AgentImportHost = {
      platform: process.platform,
      homeDir: home,
      environment: { CODEX_HOME: codex },
      workspaceRoot: undefined,
      currentRoot: () => undefined,
      isWorkspaceTrusted: () => true,
      isActive: () => true,
      museSettingsFile: settings,
      editProject: async (work) => await work(() => undefined),
      beforeProjectWrite: () => Promise.resolve(),
      pickSource: () => Promise.resolve('codex'),
      pickCandidates: (items) => Promise.resolve(items.map((item) => item.id)),
      openPreview: (_title, markdown) => {
        previews.push(markdown)
        return Promise.resolve()
      },
      confirmImport: () => Promise.resolve(true),
      offerCopy: () => Promise.resolve('copy'),
      copyText: (text) => {
        copied.push(text)
        return Promise.resolve()
      },
      openTarget: async (absolutePath, _isExisting, isStillSafe) => {
        if (await isStillSafe()) opened.push(absolutePath)
      },
      showInformation: (message) => {
        informed.push(message)
      },
      showWarning: () => undefined,
      log: new FakeLogOutputChannel(),
    }
    const bundled = agentImportLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })()
    // The bundle reads the table it is handed, not one of its own.
    await bundled.importFromAgents(
      host,
      { ...UI_TEXT, agentImportDone: 'Marker done.' },
      uiLocale(),
    )
    expect(informed.at(-1)).toContain('Marker done.')
    expect(JSON.parse(copied[0] ?? '')).toEqual({
      schema_version: 1,
      mcpServers: {
        docs: {
          type: 'stdio',
          command: 'docs-mcp',
          args: ['--token', UI_TEXT.agentImportMasked],
          env: { API_KEY: UI_TEXT.agentImportMasked },
          mode: 'optional',
        },
      },
    })
    expect(previews.join('\n')).not.toContain(SYNTHETIC.githubToken)
    expect(opened).toEqual([settings])
    // The extension never writes Muse Code's settings file (D17, D30).
    expect(() => realpathSync(settings)).toThrow()
  })
})
