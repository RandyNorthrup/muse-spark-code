// M91b: import of Amp and OpenCode plugins. Plugin files are found in their
// folders (amp_customize_plugins.md:49-52, 100-102; oc_plugins.mdx:20-23),
// their hooks read from the literal names they use, and each mapped hook
// becomes a spark-hooks.json record with the plugin's path; lane I's rules
// apply as for Cline's scripts. Every record parses back through the
// session's own parser.

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseForeignHooks } from '../../src/core/backends/modelapi/hooks'
import {
  type ImportCandidate,
  type ImportIo,
  type ImportScanInput,
  scanAgentImports,
} from '../../src/core/import/agentImport'
import { pluginRecord, pluginSourceHooks } from '../../src/core/import/pluginImport'
import type { AgentImportSource } from '../../src/shared/constants'
import { fileImportIo } from '../../src/host/importIo'

// The scan runs over real files in temporary folders through the real host
// file access (`fileImportIo`): listings, reads, link checks and ignore
// classification are the product's own, not a model of them. A recording
// wrapper notes the files read, so a case can prove what the scan touched.

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface Planted {
  readonly homeDir: string
  readonly workspaceRoot: string
  readonly xdgConfigHome: string | undefined
  readonly reads: string[]
  readonly io: ImportIo
}

function plant(
  homeFiles: Record<string, string>,
  workspaceFiles: Record<string, string>,
  xdgFiles: Record<string, string> = {},
): Planted {
  const root = mkdtempSync(path.join(tmpdir(), 'plugin-import-'))
  roots.push(root)
  const homeDir = path.join(root, 'home')
  const workspaceRoot = path.join(root, 'ws')
  const writeTree = (base: string, files: Record<string, string>) => {
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(base, relative)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
  }
  writeTree(homeDir, homeFiles)
  writeTree(workspaceRoot, workspaceFiles)
  let xdgConfigHome: string | undefined
  if (Object.keys(xdgFiles).length > 0) {
    xdgConfigHome = path.join(root, 'xdg')
    writeTree(xdgConfigHome, xdgFiles)
  }
  const reads: string[] = []
  const io: ImportIo = {
    ...fileImportIo,
    readFile: async (absolutePath, maxBytes, projectRoot) => {
      reads.push(absolutePath)
      return await fileImportIo.readFile(absolutePath, maxBytes, projectRoot)
    },
  }
  return { homeDir, workspaceRoot, xdgConfigHome, reads, io }
}

function input(
  planted: Planted,
  overrides: Partial<ImportScanInput> = {},
  sources: readonly AgentImportSource[] = ['amp', 'opencode'],
): ImportScanInput & { readonly reads: string[] } {
  return {
    platform: 'linux',
    homeDir: planted.homeDir,
    claudeConfigDir: undefined,
    codexHome: undefined,
    workspaceRoot: planted.workspaceRoot,
    ...(planted.xdgConfigHome !== undefined && { xdgConfigHome: planted.xdgConfigHome }),
    isWorkspaceTrusted: () => true,
    isActive: () => true,
    sources,
    ...overrides,
    io: planted.io,
    reads: planted.reads,
  }
}

/** Whether a read touched the workspace tree. */
function readUnder(reads: readonly string[], workspaceRoot: string): readonly string[] {
  return reads.filter(
    (read) => read === workspaceRoot || read.startsWith(`${workspaceRoot}${path.sep}`),
  )
}

function summary(candidates: readonly ImportCandidate[]): readonly string[] {
  return candidates.map((candidate) => {
    const { target } = candidate
    const where = target.kind === 'none' ? `none:${target.reason}` : target.kind
    return `${candidate.source} ${candidate.origin} ${candidate.label} -> ${where}`
  })
}

const AMP_GUARD = [
  `export default function (amp) {`,
  `  amp.on('tool.call', (event) => ({ action: 'allow' }))`,
  `  amp.on("agent.end", () => undefined)`,
  `  amp.on('changes.prompt', () => undefined)`,
  `}`,
].join('\n')

const OC_GUARD = [
  `export const EnvProtection = async () => ({`,
  `  "tool.execute.before": async (input, output) => {},`,
  `  "shell.env": async () => {},`,
  `  event: async ({ event }) => { if (event.type === "session.created") {} },`,
  `})`,
].join('\n')

describe('which hooks a plugin registers', () => {
  it('takes Amp’s literal event names, and lists its refused ones', () => {
    expect(pluginSourceHooks('amp', AMP_GUARD)).toEqual({
      mapped: ['tool.call', 'agent.end'],
      refused: ['changes.prompt'],
    })
  })

  it('registers every mapped Amp event for a name that is not a literal, or none found', () => {
    const every = ['session.start', 'tool.call', 'tool.result', 'agent.start', 'agent.end']
    expect(
      pluginSourceHooks(
        'amp',
        `export default (amp) => { amp.on('tool.call', g); for (const e of list) amp.on(e, f) }`,
      ).mapped,
    ).toEqual(every)
    expect(pluginSourceHooks('amp', `export default () => {}`).mapped).toEqual(every)
  })

  it('takes OpenCode’s hook keys and bus types, and lists its refused ones', () => {
    expect(pluginSourceHooks('opencode', OC_GUARD)).toEqual({
      mapped: ['tool.execute.before', 'event:session.created'],
      refused: ['shell.env'],
    })
  })

  it('registers every mapped OpenCode hook for a computed key or a bus handler naming no type', () => {
    const computed = pluginSourceHooks(
      'opencode',
      `export const P = async () => ({ [name]: async () => {} })`,
    )
    expect(computed.mapped).toContain('tool.execute.before')
    expect(computed.mapped).toContain('event:session.error')
    const anyBus = pluginSourceHooks(
      'opencode',
      `export const P = async () => ({ event: async ({ event }) => log(event) })`,
    )
    expect(anyBus.mapped).toContain('event:file.edited')
  })

  it('writes records the session’s parser accepts', () => {
    const record = pluginRecord('opencode', 'event:file.edited', '/ws/.opencode/plugins/p.ts')
    expect(record.ok).toBe(true)
    if (!record.ok) return
    expect(record.value.event).toBe('PostToolUse')
    const parsed = parseForeignHooks(
      JSON.stringify({ hooks: { [record.value.event]: [record.value.group] } }),
      'project',
      'linux',
    )
    expect(parsed.warnings).toEqual([])
    expect(parsed.hooks[0]?.foreign).toMatchObject({
      format: 'opencode',
      sourceEvent: 'event:file.edited',
      plugin: '/ws/.opencode/plugins/p.ts',
    })
    expect(pluginRecord('amp', 'changes.prompt', '/p.ts')).toEqual({
      ok: false,
      reason: 'unmapped',
    })
  })
})

describe('scanAgentImports: Amp and OpenCode plugins', () => {
  it('finds plugin files in the documented folders, names only file and hook', async () => {
    const planted = plant(
      {
        '.config/amp/plugins/guard.ts': AMP_GUARD,
        '.config/amp/plugins/notes.md': 'not a plugin',
        '.config/opencode/plugins/env.mjs': OC_GUARD,
        '.config/opencode/opencode.json': JSON.stringify({
          plugin: ['opencode-wakatime'],
        }),
      },
      {
        '.amp/plugins/team.js': `export default function (amp) { amp.on('session.start', () => {}) }`,
        '.amp/plugins/kit/index.ts': AMP_GUARD,
        '.opencode/plugins/p.mts': OC_GUARD,
        'opencode.json': JSON.stringify({ plugin: ['@acme/plugin'] }),
      },
    )
    const setup = input(planted)
    const scan = await scanAgentImports(setup)
    expect(summary(scan.candidates)).toEqual([
      'amp user guard.ts: tool.call -> hook',
      'amp user guard.ts: agent.end -> hook',
      'amp user guard.ts: changes.prompt -> none:unmapped',
      'amp project kit -> none:unsupported',
      'amp project team.js: session.start -> hook',
      'opencode user env.mjs: tool.execute.before -> hook',
      'opencode user env.mjs: event:session.created -> hook',
      'opencode user env.mjs: shell.env -> none:unsupported',
      'opencode user opencode-wakatime -> none:unsupported',
      'opencode project p.mts: tool.execute.before -> hook',
      'opencode project p.mts: event:session.created -> hook',
      'opencode project p.mts: shell.env -> none:unsupported',
      'opencode project @acme/plugin -> none:unsupported',
    ])
    const record = scan.candidates.find((candidate) => candidate.label === 'guard.ts: tool.call')
    expect(record?.target).toMatchObject({
      kind: 'hook',
      file: 'sparkUser',
      hook: {
        event: 'PreToolUse',
        group: {
          format: 'amp',
          sourceEvent: 'tool.call',
          plugin: path.join(planted.homeDir, '.config/amp/plugins/guard.ts'),
          hooks: [{ type: 'plugin' }],
        },
      },
    })
    // The preview never carries code.
    expect(JSON.stringify(scan.candidates.map((candidate) => candidate.label))).not.toContain(
      'amp.on',
    )
  })

  it('reads Amp’s system plugins under XDG_CONFIG_HOME when it is set', async () => {
    const planted = plant(
      { '.config/amp/plugins/old.js': AMP_GUARD },
      {},
      { 'amp/plugins/g.js': AMP_GUARD },
    )
    const scan = await scanAgentImports(input(planted, {}, ['amp']))
    const lines = summary(scan.candidates)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((line) => line.includes('g.js'))).toBe(true)
  })

  // A file link needs a privilege Windows CI does not grant; the POSIX
  // suites prove the escape over a real link.
  it.skipIf(process.platform === 'win32')(
    'refuses a personal plugin that leads into the open project, and reads no project plugin untrusted',
    async () => {
      const planted = plant(
        { '.config/opencode/plugins/README.md': 'notes' },
        {
          'tools/p.js': OC_GUARD,
          '.opencode/plugins/p.js': OC_GUARD,
        },
      )
      const user = path.join(planted.homeDir, '.config/opencode/plugins/linked.js')
      mkdirSync(path.dirname(user), { recursive: true })
      symlinkSync(path.join(planted.workspaceRoot, 'tools/p.js'), user)
      const trusted = await scanAgentImports(input(planted, {}, ['opencode']))
      expect(summary(trusted.candidates)).toContain('opencode user linked.js -> none:outside')
      const fresh = plant(
        { '.config/opencode/plugins/README.md': 'notes' },
        {
          'tools/p.js': OC_GUARD,
          '.opencode/plugins/p.js': OC_GUARD,
        },
      )
      const untrusted = input(fresh, { isWorkspaceTrusted: () => false }, ['opencode'])
      const scan = await scanAgentImports(untrusted)
      expect(scan.candidates).toEqual([])
      expect(readUnder(fresh.reads, fresh.workspaceRoot)).toEqual([])
    },
  )
})
