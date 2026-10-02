// The import flow (M83, PLAN.md D49): the preview opens before anything is
// written and the user's Import is the only way on; Muse Code's settings
// file and the project's hooks file are never written; an entry that may
// hold a credential is refused whole and nothing of it is shown, copied,
// published or logged; every dismissal writes nothing.

import { describe, expect, it, vi } from 'vitest'
import {
  type AgentImportDeps,
  type AgentImportPickItem,
  type AgentImportSourceChoice,
  createImportGate,
  type ImportGate,
  importFromAgents,
} from '../../src/host/commands/agentImportCommands'
import {
  AGENT_IMPORT_ROOT_CHANGED_CODE,
  HOOK_CONFIG_MAX_BYTES,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { CREDENTIAL_LEAKS, leakSecret, ORDINARY_LINES } from './helpers/credentialLeaks'
import { FakeLogOutputChannel } from './helpers/fakes'
import { type MemoryImportIo, memoryImportIo } from './helpers/memoryImportIo'
import { SYNTHETIC } from './helpers/syntheticTokens'
import { readContextText } from '../../src/core/context/contextFiles'
import type { ImportWriteNotice } from '../../src/core/import/agentImport'

const HOME = '/home/u'
const WS = '/ws'
const SETTINGS = `${HOME}/.config/muse/settings.json`
const SECRET = SYNTHETIC.githubToken

const FILES: Record<string, string> = {
  [`${HOME}/.claude.json`]: JSON.stringify({
    mcpServers: { github: { command: 'gh-mcp', env: { GH_HOST: 'github.example.com' } } },
  }),
  [`${HOME}/.claude/settings.json`]: JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }] },
  }),
  [`${HOME}/.claude/commands/review.md`]: '---\ndescription: Reviews\n---\n\nUse the checklist.\n',
  [`${HOME}/.claude/CLAUDE.md`]: 'My rules.\n',
  [`${WS}/.mcp.json`]: JSON.stringify({ mcpServers: { shared: { command: 'shared' } } }),
  [`${WS}/.claude/settings.json`]: JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'setup' }] }] },
  }),
  [`${WS}/.claude/commands/ship.md`]: 'Ship it.\n',
  [`${WS}/CLAUDE.md`]: 'Project rules.\n',
}

// The same entries, each holding a secret: every one of them is refused whole.
const SECRET_FILES: Record<string, string> = {
  ...FILES,
  [`${HOME}/.claude.json`]: JSON.stringify({
    mcpServers: { github: { command: 'gh-mcp', env: { GITHUB_TOKEN: SECRET } } },
  }),
  [`${HOME}/.claude/settings.json`]: JSON.stringify({
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: `curl -H "Authorization: Bearer ${SECRET}"` }] },
      ],
    },
  }),
  [`${HOME}/.claude/commands/review.md`]: `---\ndescription: Reviews\n---\n\nUse ${SECRET}.\n`,
}

interface Options {
  readonly files?: Record<string, string>
  readonly isTrusted?: boolean
  readonly trust?: () => boolean
  readonly isActive?: () => boolean
  readonly source?: AgentImportSourceChoice | undefined
  /** The ids to leave checked; the default keeps what the list checks. */
  readonly pick?: (items: readonly AgentImportPickItem[]) => readonly string[] | undefined
  readonly isConfirmed?: boolean
  readonly confirmation?: Promise<boolean>
  readonly copyChoice?: 'copy' | 'open' | undefined
  readonly copyAnswer?: Promise<'copy' | 'open' | undefined>
  readonly beforeWriting?: (path: string) => Promise<void>
  readonly beginProjectEdit?: ImportWriteNotice
  /** The window's first folder as the host names it now; the plan's folder by default. */
  readonly currentRoot?: () => string | undefined
  /** Replaces the checkpoint lease the project writes run under. */
  readonly editProject?: AgentImportDeps['editProject']
  /** Replaces the checkpoint copy taken before each project write. */
  readonly beforeProjectWrite?: AgentImportDeps['beforeProjectWrite']
  /** Runs when the editor is about to show a file, after it loaded. */
  readonly whileOpening?: (io: MemoryImportIo, path: string) => void
  /** Runs while the user reads the preview, before they answer. */
  readonly whilePreviewed?: (io: MemoryImportIo) => void
  /** Runs after scanning, while the candidate picker is open. */
  readonly whilePicking?: (io: MemoryImportIo) => void
  /** Runs after the preview editor opens, before the next prompt. */
  readonly whilePreviewOpened?: () => void
  /** Runs when the user answers the copy prompt, before the file opens. */
  readonly whileCopying?: (io: MemoryImportIo) => void
  /** Runs during clipboard access, after the copy path's first check. */
  readonly whileClipboardWritten?: (io: MemoryImportIo, text: string) => void
  /** Shared by two runs in one window; each run gets its own by default. */
  readonly io?: MemoryImportIo
  readonly gate?: ImportGate
  /** Replaces the target existence read, including its awaited continuation. */
  readonly presence?: AgentImportDeps['isPresent']
  /** Replaces the tool picker, which is the first thing an import asks. */
  readonly pickSource?: () => Promise<AgentImportSourceChoice | undefined>
}

function run(options: Options = {}) {
  const io = options.io ?? memoryImportIo({ files: options.files ?? FILES })
  const events: string[] = []
  const previews: string[] = []
  const questions: string[] = []
  const clipboard: string[] = []
  const opened: [string, boolean][] = []
  const information: string[] = []
  const warnings: string[] = []
  const items: AgentImportPickItem[] = []
  const log = new FakeLogOutputChannel()
  const done = importFromAgents({
    platform: 'linux',
    homeDir: HOME,
    claudeConfigDir: undefined,
    codexHome: undefined,
    workspaceRoot: WS,
    isWorkspaceTrusted: () => options.trust?.() ?? options.isTrusted ?? true,
    isActive: () => options.isActive?.() ?? true,
    museSettingsFile: SETTINGS,
    currentRoot: options.currentRoot ?? (() => WS),
    editProject:
      options.editProject ??
      (async (work) => {
        events.push('lease')
        const result = await work(() => undefined)
        events.push('release')
        return result
      }),
    beforeProjectWrite:
      options.beforeProjectWrite ??
      (async (path) => {
        events.push(`copy ${path}`)
        await Promise.resolve()
      }),
    noteUserWrite: (path) => {
      events.push(`user ${path}`)
    },
    io,
    writer: {
      ...io,
      createFile: async (...args: Parameters<typeof io.createFile>) => {
        const [path] = args
        events.push(`write ${path}`)
        await options.beforeWriting?.(path)
        return await io.createFile(...args)
      },
      appendText: (...args: Parameters<typeof io.appendText>) => {
        const [path] = args
        events.push(`append ${path}`)
        return io.appendText(...args)
      },
    },
    ...(options.beginProjectEdit !== undefined && { beginProjectEdit: options.beginProjectEdit }),
    isPresent: options.presence ?? io.isPresent,
    gate: options.gate ?? createImportGate(),
    pickSource:
      options.pickSource ??
      (() => Promise.resolve('source' in options ? options.source : 'claudeCode')),
    pickCandidates: (list) => {
      items.push(...list)
      options.whilePicking?.(io)
      const picked =
        options.pick === undefined
          ? list.filter((item) => item.picked).map((item) => item.id)
          : options.pick(list)
      return Promise.resolve(picked)
    },
    openPreview: (title, markdown) => {
      events.push(`preview ${title}`)
      previews.push(markdown)
      options.whilePreviewOpened?.()
      return Promise.resolve()
    },
    confirmImport: (message) => {
      events.push('confirm')
      options.whilePreviewed?.(io)
      questions.push(message)
      return options.confirmation ?? Promise.resolve(options.isConfirmed ?? true)
    },
    offerCopy: (message) => {
      events.push(`offer ${message}`)
      options.whileCopying?.(io)
      return (
        options.copyAnswer ?? Promise.resolve('copyChoice' in options ? options.copyChoice : 'copy')
      )
    },
    copyText: (text) => {
      clipboard.push(text)
      options.whileClipboardWritten?.(io, text)
      return Promise.resolve()
    },
    openTarget: async (path, isExisting, isStillSafe) => {
      options.whileOpening?.(io, path)
      if (await isStillSafe()) {
        opened.push([path, isExisting])
      }
    },
    showInformation: (message) => {
      information.push(message)
    },
    showWarning: (message) => {
      warnings.push(message)
    },
    log,
  })
  const logged = (): string =>
    [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].flat().join('\n')
  return {
    done,
    io,
    events,
    previews,
    questions,
    clipboard,
    opened,
    information,
    warnings,
    items,
    logged,
  }
}

/** The entries the preview lists as possibly holding a credential, one line each. */
function credentialLines(preview: string | undefined): readonly string[] {
  const [, section = ''] = (preview ?? '').split(`## ${UI_TEXT.agentImportPreviewCredentials}\n\n`)
  return section.split('\n').filter((line) => line.startsWith('- '))
}

/** Everything the user is shown or given, and the log. */
function everythingShown(flow: ReturnType<typeof run>): string {
  return [
    ...flow.previews,
    ...flow.clipboard,
    ...flow.information,
    ...flow.warnings,
    ...flow.items.flatMap((item) => [item.label, item.description, item.detail]),
    flow.logged(),
  ].join('\n')
}

/** Only the project's command is checked: its writes are what the folder checks guard. */
function projectOnly(items: readonly AgentImportPickItem[]): readonly string[] {
  return items.filter((item) => item.label === 'ship').map((item) => item.id)
}

/** The project's `.muse` folder becomes a link to the user's own Muse folder. */
function linkHooksFolderOut(io: MemoryImportIo): void {
  io.links.set(`${WS}/.muse`, `${HOME}/.config/muse`)
}

/** Only the project's hooks are checked: what is copied into its hooks file. */
function projectHooksOnly(items: readonly AgentImportPickItem[]): readonly string[] {
  return items
    .filter(
      (item) =>
        item.description.includes(UI_TEXT.agentImportKindHook) &&
        item.description.includes(UI_TEXT.agentImportProjectFiles),
    )
    .map((item) => item.id)
}

describe('importFromAgents', () => {
  it('counts a refused project copy separately from an offered personal copy', async () => {
    const flow = run({
      pick: (items) => [
        ...projectHooksOnly(items),
        ...items.filter((item) => item.label === 'github').map((item) => item.id),
      ],
      whileCopying: (io) => {
        io.links.set(WS, '/other')
      },
    })
    await flow.done
    expect(flow.opened).toEqual([[SETTINGS, false]])
    expect(flow.clipboard).toHaveLength(1)
    expect(flow.information.at(-1)).toBe(
      'Import finished. New files: 0 · Sections for AGENTS.md: 0 · Entries to copy by hand: 1 · Not imported: 1',
    )
    expect(flow.logged()).toContain('1 file(s) to paste into, 1 entr(ies) not imported')
  })

  it.each([
    { at: 1, change: 'root' },
    { at: 1, change: 'trust' },
    { at: 1, change: 'activation' },
    { at: 2, change: 'root' },
    { at: 2, change: 'trust' },
    { at: 2, change: 'activation' },
  ])(
    'refuses project copy actions after existence await $at loses $change',
    async ({ at, change }) => {
      const io = memoryImportIo({ files: FILES })
      let isCopying = false
      let isTrusted = true
      let isActive = true
      let reads = 0
      const opening = vi.fn()
      const flow = run({
        io,
        pick: projectHooksOnly,
        trust: () => isTrusted,
        isActive: () => isActive,
        whileCopying: () => {
          isCopying = true
        },
        whileOpening: opening,
        presence: async (file) => {
          const isPresent = await io.isPresent(file)
          if (isCopying && file === `${WS}/.muse/hooks.json` && ++reads === at) {
            if (change === 'root') io.links.set(WS, '/other')
            else if (change === 'trust') isTrusted = false
            else isActive = false
          }
          return isPresent
        },
      })
      await flow.done
      expect(reads).toBe(at)
      expect(flow.clipboard).toHaveLength(at === 1 ? 0 : 1)
      expect(opening).not.toHaveBeenCalled()
      expect(flow.opened).toEqual([])
      expect(flow.information.some((message) => message.includes(UI_TEXT.agentImportDone))).toBe(
        false,
      )
    },
  )

  it.each([
    { phase: 'preview', startsExisting: false },
    { phase: 'preview', startsExisting: true },
    { phase: 'copy prompt', startsExisting: false },
    { phase: 'copy prompt', startsExisting: true },
    { phase: 'clipboard', startsExisting: false },
    { phase: 'clipboard', startsExisting: true },
  ])(
    'uses current copy-target existence after $phase (initially $startsExisting)',
    async ({ phase, startsExisting }) => {
      const existingSettings = JSON.stringify({
        schema_version: 1,
        mcpServers: { existing: { command: 'keep' } },
      })
      const existingHooks = JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep' }] }] },
      })
      const targets = { [SETTINGS]: existingSettings, [`${WS}/.muse/hooks.json`]: existingHooks }
      const changeTargets = (io: MemoryImportIo) => {
        for (const [file, text] of Object.entries(targets)) {
          if (startsExisting) io.files.delete(file)
          else io.files.set(file, text)
        }
      }
      const flow = run({
        files: { ...FILES, ...(startsExisting && targets) },
        pick: (items) => [
          ...projectHooksOnly(items),
          ...items.filter((item) => item.label === 'github').map((item) => item.id),
        ],
        ...(phase === 'preview' && { whilePreviewed: changeTargets }),
        ...(phase === 'copy prompt' && { whileCopying: changeTargets }),
        ...(phase === 'clipboard' && { whileClipboardWritten: changeTargets }),
      })
      await flow.done
      expect(flow.opened).toEqual([
        [SETTINGS, !startsExisting],
        [`${WS}/.muse/hooks.json`, !startsExisting],
      ])
      expect(JSON.parse(flow.clipboard[0] ?? '')).toHaveProperty('mcpServers.github')
      const isCopyForNewFile = phase === 'clipboard' ? !startsExisting : startsExisting
      expect(flow.information[0]).toBe(
        `${UI_TEXT.agentImportCopied} ${isCopyForNewFile ? UI_TEXT.agentImportPreviewNewFile : UI_TEXT.agentImportPreviewMerge}`,
      )
      if (isCopyForNewFile)
        expect(JSON.parse(flow.clipboard[0] ?? '')).toHaveProperty('schema_version', 1)
      else expect(JSON.parse(flow.clipboard[0] ?? '')).not.toHaveProperty('schema_version')
      expect(JSON.parse(flow.clipboard[1] ?? '')).not.toHaveProperty('schema_version')
      expect(flow.io.files.get(SETTINGS)).toBe(startsExisting ? undefined : existingSettings)
      expect(flow.io.files.get(`${WS}/.muse/hooks.json`)).toBe(
        startsExisting ? undefined : existingHooks,
      )
    },
  )

  it.each([
    'personal read',
    'project read',
    'confinement',
    'directory confinement',
    'directory listing',
    'plan confinement',
    'hooks confinement',
  ])('stops reading project sources when trust is revoked during %s', async (phase) => {
    const io = memoryImportIo({ files: FILES })
    let isTrusted = true
    let didRevoke = false
    const afterRevocation: string[] = []
    const revoke = () => {
      isTrusted = false
      didRevoke = true
    }
    const readFile = io.readFile
    io.readFile = async (...args) => {
      const [file] = args
      if (!isTrusted && file.startsWith(`${WS}/`)) afterRevocation.push(file)
      const read = await readFile(...args)
      if (
        (phase === 'personal read' && file === `${HOME}/.claude.json`) ||
        (phase === 'project read' && file === `${WS}/.mcp.json`)
      )
        revoke()
      return read
    }
    const realPath = io.realPath
    io.realPath = async (file) => {
      if (!isTrusted && file.startsWith(`${WS}/`)) afterRevocation.push(file)
      const resolved = await realPath(file)
      if (phase === 'confinement' && file === `${WS}/.mcp.json`) revoke()
      if (phase === 'directory confinement' && file === `${WS}/.claude/commands`) revoke()
      return resolved
    }
    const listDirectory = io.listDirectory
    io.listDirectory = async (directory) => {
      if (!isTrusted && directory.startsWith(`${WS}/`)) afterRevocation.push(directory)
      const entries = await listDirectory(directory)
      if (phase === 'directory listing' && directory === `${WS}/.claude/commands`) revoke()
      return entries
    }
    const assertSafePath = io.assertSafePath
    io.assertSafePath = async (...args) => {
      await assertSafePath(...args)
      if (
        (phase === 'plan confinement' && args[0] === `${WS}/AGENTS.md`) ||
        (phase === 'hooks confinement' && args[0] === `${WS}/.muse/hooks.json`)
      )
        revoke()
    }
    const flow = run({
      io: {
        ...io,
        isPresent: async (file) => {
          if (!isTrusted && file.startsWith(`${WS}/`)) afterRevocation.push(file)
          return await io.isPresent(file)
        },
      },
      trust: () => isTrusted,
      pick: (items) =>
        items
          .filter((item) => item.description.includes(UI_TEXT.agentImportUserFiles))
          .map((item) => item.id),
    })
    await flow.done
    expect(didRevoke).toBe(true)
    expect(afterRevocation).toEqual([])
    expect(flow.clipboard.length).toBe(1)
  })

  it('stops scanning and opens no candidate picker after deactivation during a personal read', async () => {
    const io = memoryImportIo({ files: FILES })
    let isActive = true
    const readFile = io.readFile
    io.readFile = async (...args) => {
      const read = await readFile(...args)
      if (args[0] === `${HOME}/.claude.json`) isActive = false
      return read
    }
    const pick = vi.fn(() => [])
    const flow = run({ io, isActive: () => isActive, pick })
    await flow.done
    expect(io.reads).toEqual([`${HOME}/.claude.json`])
    expect(pick).not.toHaveBeenCalled()
    expect(flow.events).toEqual([])
    expect(flow.information).toEqual([])
  })

  it.each(['initial', 'root', 'candidate', 'preview'])(
    'opens no pending prompt after deactivation at %s',
    async (phase) => {
      const io = memoryImportIo({ files: FILES })
      let isActive = phase !== 'initial'
      const identifyRoot = io.identifyRoot
      const identify = vi.fn(async (root: string) => {
        const identity = await identifyRoot(root)
        if (phase === 'root') isActive = false
        return identity
      })
      io.identifyRoot = identify
      const presence = vi.fn(io.isPresent)
      const pickSource = vi.fn(() => Promise.resolve('claudeCode' as const))
      const flow = run({
        io: { ...io, isPresent: presence },
        isActive: () => isActive,
        pickSource,
        whilePicking: () => {
          if (phase === 'candidate') isActive = false
        },
        whilePreviewOpened: () => {
          if (phase === 'preview') isActive = false
        },
      })
      await flow.done
      if (phase === 'initial' || phase === 'root') {
        expect(pickSource).not.toHaveBeenCalled()
        if (phase === 'initial') expect(identify).not.toHaveBeenCalled()
      } else if (phase === 'candidate') {
        expect(io.reads).not.toContain(SETTINGS)
        expect(presence).not.toHaveBeenCalled()
      }
      expect(flow.questions).toEqual([])
      expect(flow.clipboard).toEqual([])
      expect(flow.information).toEqual([])
    },
  )

  it('refuses an MCP server and rules whose URL query holds a credential, copying and publishing none of it', async () => {
    const secret = 'opaque-demo-value'
    const url = `https://example.test/mcp?signature=${secret}&tenant=demo`
    const flow = run({
      files: {
        [`${HOME}/.claude.json`]: JSON.stringify({
          mcpServers: { remote: { command: 'npx', args: ['mcp-remote', url] } },
        }),
        [`${WS}/CLAUDE.md`]: `Read [service](${url}).\nThe next line stays.\n`,
      },
    })
    await flow.done
    const refusal = fill(UI_TEXT.agentImportSkippedCredential, {
      cue: UI_TEXT.agentImportCueUrl,
    })
    expect(flow.items.map((item) => [item.label, item.detail, item.picked])).toEqual([
      ['remote', `~/.claude.json · ${refusal}`, true],
      ['CLAUDE.md', `CLAUDE.md · ${refusal}`, true],
    ])
    expect(credentialLines(flow.previews[0])).toEqual([
      `- remote (${UI_TEXT.agentImportKindMcp} · ${UI_TEXT.importSourceClaude} · ${UI_TEXT.agentImportUserFiles}): ${UI_TEXT.agentImportCueUrl}`,
      `- CLAUDE.md (${UI_TEXT.agentImportKindRules} · ${UI_TEXT.importSourceClaude} · ${UI_TEXT.agentImportProjectFiles}): ${UI_TEXT.agentImportCueUrl}`,
    ])
    expect(everythingShown(flow)).not.toContain(secret)
    expect(flow.clipboard).toEqual([])
    expect(flow.io.files.has(`${WS}/AGENTS.md`)).toBe(false)
    expect(flow.information).toEqual([UI_TEXT.agentImportNoneImportable])
    expect(flow.logged()).toContain('2 entr(ies) may hold a credential and are not imported (url)')
  })

  it('refuses every reported credential leak in MCP arguments, hooks, commands and rules', async () => {
    const leaks = CREDENTIAL_LEAKS.map((leak, index) => ({
      name: leak.name,
      secret: leakSecret(index),
      text: leak.text(leakSecret(index)),
      file: `leak${String(index).padStart(2, '0')}`,
    }))
    const flow = run({
      source: 'all',
      files: {
        [`${HOME}/.claude.json`]: JSON.stringify({
          mcpServers: Object.fromEntries(
            leaks.map((leak) => [leak.file, { command: 'sh', args: ['-c', leak.text] }]),
          ),
        }),
        [`${HOME}/.claude/settings.json`]: JSON.stringify({
          hooks: {
            Stop: [{ hooks: leaks.map((leak) => ({ type: 'command', command: leak.text })) }],
          },
        }),
        ...Object.fromEntries(
          leaks.flatMap((leak) => [
            [`${HOME}/.claude/commands/${leak.file}.md`, `Run this.\n${leak.text}\n`],
            [`${WS}/.cursor/rules/${leak.file}.mdc`, `---\ndescription: d\n---\n\n${leak.text}\n`],
          ]),
        ),
        [`${WS}/CLAUDE.md`]: `${ORDINARY_LINES.join('\n')}\n`,
      },
    })
    await flow.done
    // A server, a hook, a command and a rules file for each leak, all refused.
    expect(credentialLines(flow.previews[0])).toHaveLength(4 * leaks.length)
    expect(flow.clipboard).toEqual([])
    expect(flow.io.pathsUnder(`${HOME}/.config`)).toEqual([])
    const published = flow.io.files.get(`${WS}/AGENTS.md`)
    // The ordinary rules file alone is published, whole.
    expect(published).toBe(
      `## Imported from Claude Code (CLAUDE.md)\n\n${ORDINARY_LINES.join('\n')}\n`,
    )
    const shown = everythingShown(flow)
    for (const leak of leaks) {
      expect(shown, leak.name).not.toContain(leak.secret)
    }
  })

  it('notifies only project skill publication and rules append through the production flow', async () => {
    const complete = vi.fn<(wasWritten: boolean) => void>()
    const beginProjectEdit = vi.fn<ImportWriteNotice>(() => complete)
    const flow = run({ beginProjectEdit })
    await flow.done
    expect(beginProjectEdit.mock.calls.map(([file]) => file)).toEqual([
      { relative: '.agents/skills/ship/SKILL.md', absolute: `${WS}/.agents/skills/ship/SKILL.md` },
      { relative: 'AGENTS.md', absolute: `${WS}/AGENTS.md` },
    ])
    expect(complete.mock.calls).toEqual([[true], [true]])
    expect(flow.io.files.has(`${HOME}/.config/muse/skills/review/SKILL.md`)).toBe(true)
  })

  it('opens the preview, asks, then writes; settings and hooks files are only copied into', async () => {
    const flow = run()
    await flow.done
    expect(flow.events).toEqual([
      `preview ${UI_TEXT.agentImportPreviewTitle}.md`,
      'confirm',
      // The project writes hold the checkpoint lease, each with its copy taken first (M72).
      'lease',
      `write ${HOME}/.config/muse/skills/review/SKILL.md`,
      // Each publication is the user's own write once it is done (M72).
      `user ${HOME}/.config/muse/skills/review/SKILL.md`,
      `copy ${WS}/.agents/skills/ship/SKILL.md`,
      `write ${WS}/.agents/skills/ship/SKILL.md`,
      `user ${WS}/.agents/skills/ship/SKILL.md`,
      `copy ${WS}/AGENTS.md`,
      `append ${WS}/AGENTS.md`,
      `user ${WS}/AGENTS.md`,
      'release',
      `offer Copy the converted entries for ~/.config/muse/settings.json? Masked values are filled in by hand.`,
      `offer Copy the converted entries for .muse/hooks.json? Masked values are filled in by hand.`,
    ])
    // The extension never writes Muse Code's settings or the hooks file (D17, D30).
    expect(flow.io.files.has(SETTINGS)).toBe(false)
    expect(flow.io.files.has(`${WS}/.muse/hooks.json`)).toBe(false)
    expect(flow.opened).toEqual([
      [SETTINGS, false],
      [`${WS}/.muse/hooks.json`, false],
    ])
    expect(flow.questions).toEqual([
      'Import what the preview shows? New files: 2 · Sections for AGENTS.md: 1 · Entries to copy by hand: 3 · Not imported: 0',
    ])
    expect(flow.information.at(-1)).toBe(
      'Import finished. New files: 2 · Sections for AGENTS.md: 1 · Entries to copy by hand: 3 · Not imported: 0',
    )
    expect(flow.io.files.get(`${WS}/AGENTS.md`)).toBe(
      '## Imported from Claude Code (CLAUDE.md)\n\nProject rules.\n',
    )
  })

  it('refuses every entry holding a secret, and shows, copies, publishes and logs none of it', async () => {
    const flow = run({ files: SECRET_FILES })
    await flow.done
    expect(everythingShown(flow)).not.toContain(SECRET)
    const where = [UI_TEXT.importSourceClaude, UI_TEXT.agentImportUserFiles].join(' · ')
    expect(credentialLines(flow.previews[0])).toEqual([
      `- github (${UI_TEXT.agentImportKindMcp} · ${where}): ${UI_TEXT.agentImportCueToken}`,
      `- Stop (${UI_TEXT.agentImportKindHook} · ${where}): ${UI_TEXT.agentImportCueToken}`,
      `- review (${UI_TEXT.agentImportKindCommand} · ${where}): ${UI_TEXT.agentImportCueToken}`,
    ])
    expect(flow.io.files.has(`${HOME}/.config/muse/skills/review/SKILL.md`)).toBe(false)
    // Only the project's own hook is left to copy; nothing of the refused entries is.
    expect(flow.clipboard.map((text): unknown => JSON.parse(text))).toEqual([
      { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'setup' }] }] } },
    ])
    expect(flow.logged()).toContain(
      '3 entr(ies) may hold a credential and are not imported (token)',
    )
    expect(flow.information.at(-1)).toBe(
      'Import finished. New files: 1 · Sections for AGENTS.md: 1 · Entries to copy by hand: 1 · Not imported: 3',
    )
    // The sources stay as they were.
    expect(flow.io.files.get(`${HOME}/.claude/commands/review.md`)).toContain(SECRET)
  })

  it('writes nothing when the preview is not accepted', async () => {
    const flow = run({ isConfirmed: false })
    await flow.done
    expect(flow.events).toEqual([`preview ${UI_TEXT.agentImportPreviewTitle}.md`, 'confirm'])
    expect(new Set(flow.io.files.keys())).toEqual(new Set(Object.keys(FILES)))
    expect(flow.clipboard).toEqual([])
    expect(flow.logged()).toContain('the preview was not accepted; nothing was written')
  })

  it.each([
    ['the source is dismissed', { source: undefined }],
    ['the list is dismissed', { pick: () => undefined }],
    ['nothing is left checked', { pick: () => [] }],
  ] satisfies [string, Options][])(
    'reads no further and writes nothing when %s',
    async (_name, options) => {
      const flow = run(options)
      await flow.done
      expect(flow.events).toEqual([])
      expect(flow.io.files.size).toBe(Object.keys(FILES).length)
    },
  )

  it('offers only the user’s own entries in an untrusted workspace, and says why', async () => {
    const flow = run({ isTrusted: false })
    await flow.done
    expect(flow.warnings).toEqual([UI_TEXT.agentImportUntrusted])
    expect(
      flow.items.every((item) => item.description.endsWith(UI_TEXT.agentImportUserFiles)),
    ).toBe(true)
    expect(flow.events.filter((event) => event.includes(WS))).toEqual([])
  })

  it('lists what cannot be imported unchecked, with its reason', async () => {
    const flow = run({ pick: () => [] })
    await flow.done
    const shared = flow.items.find((item) => item.label === 'shared')
    expect(shared?.picked).toBe(false)
    expect(shared?.detail).toBe(`.mcp.json · ${UI_TEXT.agentImportSkippedProjectServer}`)
    const rules = flow.items.find((item) => item.detail.startsWith('~/.claude/CLAUDE.md'))
    expect(rules?.picked).toBe(false)
    expect(flow.items.filter((item) => item.picked).map((item) => item.label)).toEqual([
      'github',
      'Stop',
      'review',
      'SessionStart',
      'ship',
      'CLAUDE.md',
    ])
  })

  it('shows why when nothing checked can be imported, and asks nothing', async () => {
    const flow = run({ pick: (list) => list.filter((item) => !item.picked).map((item) => item.id) })
    await flow.done
    expect(flow.events).toEqual([`preview ${UI_TEXT.agentImportPreviewTitle}.md`])
    expect(flow.information).toEqual([UI_TEXT.agentImportNoneImportable])
    expect(flow.previews[0]).toContain(`## ${UI_TEXT.agentImportPreviewNotImported}`)
  })

  it('says so when a tool has nothing to import', async () => {
    const flow = run({ files: {}, source: 'cursor' })
    await flow.done
    expect(flow.information).toEqual(['Nothing to import from Cursor.'])
    expect(flow.events).toEqual([])
  })

  it('opens the file without copying when the user only asks for the file', async () => {
    const flow = run({ copyChoice: 'open' })
    await flow.done
    expect(flow.clipboard).toEqual([])
    expect(flow.opened.map(([path]) => path)).toEqual([SETTINGS, `${WS}/.muse/hooks.json`])
  })

  it('tells the user which entries were refused at the moment of writing', async () => {
    const flow = run({
      whilePreviewed: ({ files }) => {
        files.set(`${WS}/.agents/skills/ship/SKILL.md`, 'appeared after the preview')
      },
    })
    await flow.done
    expect(flow.io.files.get(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(
      'appeared after the preview',
    )
    expect(flow.warnings).toEqual([`ship: ${UI_TEXT.agentImportSkippedExists}`])
  })
})

// The review round (Grok, 2026-09-28): links out of the workspace, and two imports at once.
describe('importFromAgents confinement and order', () => {
  it.each(['trust', 'shutdown'])(
    'refuses a held project creation after %s changes',
    async (change) => {
      const held = Promise.withResolvers<undefined>()
      const started = Promise.withResolvers<undefined>()
      let isTrusted = true
      let isActive = true
      const flow = run({
        trust: () => isTrusted,
        isActive: () => isActive,
        pick: projectOnly,
        beforeWriting: async () => {
          started.resolve(undefined)
          await held.promise
        },
      })
      try {
        await started.promise
        if (change === 'trust') isTrusted = false
        else isActive = false
        held.resolve(undefined)
        await flow.done
        expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(false)
        expect(flow.clipboard).toEqual([])
        expect(flow.opened).toEqual([])
      } finally {
        held.resolve(undefined)
        await flow.done
      }
    },
  )

  it.each(['trust', 'shutdown'])(
    'refuses a held project copy popup after %s changes',
    async (change) => {
      const answer = Promise.withResolvers<'copy' | 'open' | undefined>()
      const started = Promise.withResolvers<undefined>()
      let isTrusted = true
      let isActive = true
      const flow = run({
        trust: () => isTrusted,
        isActive: () => isActive,
        pick: projectHooksOnly,
        copyAnswer: answer.promise,
        whileCopying: () => {
          started.resolve(undefined)
        },
      })
      try {
        await started.promise
        if (change === 'trust') isTrusted = false
        else isActive = false
        answer.resolve('copy')
        await flow.done
        expect(flow.clipboard).toEqual([])
        expect(flow.opened).toEqual([])
      } finally {
        answer.resolve(undefined)
        await flow.done
      }
    },
  )

  it('does not open project hooks after trust changes during clipboard access', async () => {
    let isTrusted = true
    const flow = run({
      trust: () => isTrusted,
      whileClipboardWritten: (_io, text) => {
        if (text.includes('"SessionStart"')) isTrusted = false
      },
    })
    await flow.done
    expect(flow.clipboard).toHaveLength(2)
    expect(flow.opened.map(([path]) => path)).toEqual([SETTINGS])
    expect(flow.warnings).toContain(UI_TEXT.agentImportUntrusted)
  })

  it('rechecks project trust in the clipboard continuation after the awaited path check', async () => {
    let isTrusted = true
    let isCopying = false
    let copyTrustChecks = 0
    const flow = run({
      trust: () => {
        if (isCopying && ++copyTrustChecks === 2) {
          queueMicrotask(() => {
            isTrusted = false
          })
        }
        return isTrusted
      },
      pick: projectHooksOnly,
      whileCopying: () => {
        isCopying = true
      },
    })
    await flow.done
    expect(flow.clipboard).toEqual([])
    expect(flow.opened).toEqual([])
    expect(flow.warnings).toContain(UI_TEXT.agentImportUntrusted)
  })

  it('refuses project rules holding a credential and loads only the published rules into context', async () => {
    const cursorRules = `---\ndescription: Bearer ${SECRET}\nglobs: ${SECRET}\n---\n\nUse ${SECRET}.\n`
    const flow = run({
      source: 'all',
      files: { ...FILES, [`${WS}/.cursor/rules/private.mdc`]: cursorRules },
    })
    await flow.done
    const published = flow.io.files.get(`${WS}/AGENTS.md`)
    expect(published).toBe('## Imported from Claude Code (CLAUDE.md)\n\nProject rules.\n')
    expect(credentialLines(flow.previews[0])).toEqual([
      `- .cursor/rules/private.mdc (${UI_TEXT.agentImportKindRules} · ${UI_TEXT.agentImportSourceCursor} · ${UI_TEXT.agentImportProjectFiles}): ${UI_TEXT.agentImportCueToken}`,
    ])
    expect(everythingShown(flow)).not.toContain(SECRET)
    expect(flow.io.files.get(`${WS}/.cursor/rules/private.mdc`)).toBe(cursorRules)
    const context = await readContextText(
      {
        platform: 'linux',
        io: {
          realPath: flow.io.realPath,
          listDirectory: () => Promise.resolve([]),
          readFile: (path) => Promise.resolve(Buffer.from(flow.io.files.get(path) ?? '', 'utf8')),
        },
      },
      `${WS}/AGENTS.md`,
      WS,
    )
    expect(context).toEqual({ ok: true, text: published })
    expect(JSON.stringify(context)).not.toContain(SECRET)
  })

  it('aborts project actions if trust was revoked while the preview waited', async () => {
    let isTrusted = true
    const flow = run({
      trust: () => isTrusted,
      whilePreviewed: () => {
        isTrusted = false
      },
    })
    await flow.done
    expect(flow.io.files.has(`${WS}/AGENTS.md`)).toBe(false)
    expect(flow.io.files.has(`${HOME}/.config/muse/skills/review/SKILL.md`)).toBe(false)
    expect(flow.clipboard).toEqual([])
    expect(flow.opened).toEqual([])
    expect(flow.warnings).toEqual([UI_TEXT.agentImportUntrusted])
    expect(flow.logged()).toContain('workspace trust changed')
  })

  it('tells a second import that one is open, starts nothing, and opens again once the first ends', async () => {
    const answer = Promise.withResolvers<boolean>()
    const gate = createImportGate()
    const io = memoryImportIo({ files: FILES })
    const first = run({ io, gate, confirmation: answer.promise })
    try {
      await vi.waitFor(() => {
        expect(first.events).toContain('confirm')
      })
      const second = run({ io, gate })
      await second.done
      // No picker, no preview, nothing written: only the word that one is open.
      expect(second.events).toEqual([])
      expect(second.previews).toEqual([])
      expect(second.information).toEqual([UI_TEXT.agentImportBusy])
      expect(io.files.has(`${WS}/AGENTS.md`)).toBe(false)
      answer.resolve(true)
      await first.done
      expect(io.files.get(`${WS}/AGENTS.md`)?.split('## Imported from Claude Code')).toHaveLength(2)
      const third = run({ io, gate })
      await third.done
      expect(third.previews).toHaveLength(1)
      expect(third.information.at(-1)).not.toBe(UI_TEXT.agentImportBusy)
      expect(io.files.get(`${WS}/AGENTS.md`)?.split('## Imported from Claude Code')).toHaveLength(2)
    } finally {
      answer.resolve(false)
      await first.done
    }
  })

  it('stops on an unforeseen error with its code only, and lets the next import open', async () => {
    const gate = createImportGate()
    const failed = run({
      gate,
      pickSource: () =>
        Promise.reject(
          Object.assign(new Error(`failed reading ${HOME}/.claude.json`), { code: 'EIO' }),
        ),
    })
    await failed.done
    expect(failed.warnings).toEqual([UI_TEXT.agentImportFailed])
    expect(failed.logged()).toContain('stopped on an unexpected error (EIO)')
    expect(failed.logged()).not.toContain('.claude.json')
    const next = run({ gate })
    await next.done
    expect(next.previews).toHaveLength(1)
  })

  it.each(['bad JSON', '[]'])(
    'offers no settings copies for malformed settings: %s',
    async (settings) => {
      const flow = run({ files: { ...FILES, [SETTINGS]: settings } })
      await flow.done
      expect(flow.previews[0]).toContain(UI_TEXT.agentImportSkippedUnreadable)
      expect(flow.opened.map(([path]) => path)).toEqual([`${WS}/.muse/hooks.json`])
      expect(flow.clipboard).toHaveLength(1)
    },
  )

  it('never reads or appends to an AGENTS.md that leads outside, even a broken link', async () => {
    const io = memoryImportIo({
      files: { ...FILES, [`${HOME}/.ssh/key`]: 'PRIVATE' },
      links: { [`${WS}/AGENTS.md`]: `${HOME}/.ssh/key` },
    })
    const flow = run({ io })
    await flow.done
    expect(io.reads).not.toContain(`${WS}/AGENTS.md`)
    expect(io.files.get(`${HOME}/.ssh/key`)).toBe('PRIVATE')
    expect(flow.previews[0]).toContain(UI_TEXT.agentImportSkippedOutside)
    const broken = memoryImportIo({
      files: FILES,
      links: { [`${WS}/AGENTS.md`]: `${HOME}/.bashrc` },
    })
    await run({ io: broken }).done
    expect(broken.files.has(`${HOME}/.bashrc`)).toBe(false)
  })

  it('offers nothing for a settings file it cannot read, and says why', async () => {
    const flow = run({ files: { ...FILES, [SETTINGS]: 'x'.repeat(HOOK_CONFIG_MAX_BYTES + 1) } })
    await flow.done
    expect(flow.previews[0]).toContain(`github (${UI_TEXT.agentImportKindMcp}`)
    expect(flow.previews[0]).toContain(UI_TEXT.agentImportSkippedUnreadable)
    expect(flow.opened.map(([path]) => path)).toEqual([`${WS}/.muse/hooks.json`])
    expect(flow.logged()).toContain('~/.config/muse/settings.json could not be read (tooLarge)')
  })

  it('reports undecodable settings instead of treating them as a missing file', async () => {
    const io = memoryImportIo({ files: FILES })
    const readFile = io.readFile
    io.readFile = async (...args) =>
      args[0] === SETTINGS
        ? { status: 'read', bytes: Buffer.from('invalid\0text') }
        : await readFile(...args)
    const flow = run({ io })
    await flow.done
    expect(flow.previews[0]).toContain(UI_TEXT.agentImportSkippedUnreadable)
    expect(flow.opened.map(([file]) => file)).toEqual([`${WS}/.muse/hooks.json`])
    expect(flow.logged()).toContain('~/.config/muse/settings.json could not be read (read)')
  })

  it.each(['while the copy prompt is open', 'during the clipboard write'])(
    'does not open a hooks file whose folder was linked out %s',
    async (moment) => {
      const flow = run(
        moment === 'during the clipboard write'
          ? {
              whileClipboardWritten: (io, text) => {
                if (text.includes('"SessionStart"')) linkHooksFolderOut(io)
              },
            }
          : { whileCopying: linkHooksFolderOut },
      )
      await flow.done
      expect(flow.opened.map(([path]) => path)).toEqual([SETTINGS])
      expect(flow.warnings).toContain(`.muse/hooks.json: ${UI_TEXT.agentImportSkippedOutside}`)
    },
  )
})

// M83 on top of M72 and the approval wait: the folder the preview was made
// for must still be the folder written to, and the project writes run under
// the checkpoint lease with a copy taken before each.
describe('importFromAgents: a folder that changes during the approval wait', () => {
  it.each([
    {
      title:
        'does not publish into a folder the workspace path was retargeted to while the preview waited',
      phase: 'preview',
    },
    {
      title: 'keeps the request root when it is retargeted while candidates are picked',
      phase: 'picker',
    },
  ])('$title', async ({ phase }) => {
    const retarget = (io: MemoryImportIo): void => {
      io.links.set(WS, '/other')
    }
    const flow = run({
      pick: projectOnly,
      ...(phase === 'preview' ? { whilePreviewed: retarget } : { whilePicking: retarget }),
    })
    await flow.done
    expect(flow.io.pathsUnder('/other')).toEqual([])
    expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(false)
    expect(flow.events.filter((event) => event.startsWith('write '))).toEqual([])
    expect(flow.warnings.join('\n')).toContain(`ship: ${UI_TEXT.agentImportSkippedChanged}`)
  })

  it('does not publish when the window’s first folder is not the planned one any more', async () => {
    let live: string | undefined = WS
    const flow = run({
      pick: projectOnly,
      currentRoot: () => live,
      whilePreviewed: () => {
        live = '/elsewhere'
      },
    })
    await flow.done
    expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(false)
    expect(flow.warnings.join('\n')).toContain(`ship: ${UI_TEXT.agentImportSkippedChanged}`)
    // The window has no folder at all: nothing is planned for it either.
    live = undefined
    const closed = run({ pick: projectOnly, currentRoot: () => live })
    await closed.done
    expect(closed.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(false)
  })

  it('refuses a root retargeted between the check and the publication, by the writer', async () => {
    const flow = run({
      pick: projectOnly,
      beforeWriting: (path) => {
        // The plan's identity was taken before this; the folder is swapped as the file is created.
        flow.io.links.set(WS, '/other')
        expect(path).toBe(`${WS}/.agents/skills/ship/SKILL.md`)
        return Promise.resolve()
      },
    })
    await flow.done
    expect(flow.io.pathsUnder('/other')).toEqual([])
    expect(flow.logged()).toContain(
      `.agents/skills/ship/SKILL.md could not be written (${AGENT_IMPORT_ROOT_CHANGED_CODE})`,
    )
    expect(flow.warnings.join('\n')).toContain(`ship: ${UI_TEXT.agentImportSkippedChanged}`)
  })

  it('does not open the hooks file for a folder that changed while the preview waited', async () => {
    const flow = run({
      pick: projectHooksOnly,
      whilePreviewed: (io) => {
        io.links.set(WS, '/other')
      },
    })
    await flow.done
    expect(flow.clipboard).toEqual([])
    expect(flow.opened).toEqual([])
    expect(flow.warnings).toContain(`.muse/hooks.json: ${UI_TEXT.agentImportSkippedChanged}`)
    expect(flow.information).toEqual([])
    expect(flow.warnings.at(-1)).toBe(
      'New files: 0 · Sections for AGENTS.md: 0 · Entries to copy by hand: 0 · Not imported: 1',
    )
    expect(flow.logged()).toContain('0 file(s) to paste into, 1 entr(ies) not imported')
  })

  it('does not show a hooks file whose folder changed while the editor loaded it', async () => {
    const flow = run({
      pick: projectHooksOnly,
      copyChoice: 'open',
      whileOpening: (io) => {
        io.links.set(`${WS}/.muse`, `${HOME}/.config/muse`)
      },
    })
    await flow.done
    expect(flow.opened).toEqual([])
    expect(flow.information).toEqual([])
    expect(flow.warnings.at(-1)).toContain('Not imported: 1')
  })
})

describe('importFromAgents: the checkpoint lease and copies (M72)', () => {
  it('takes no lease when nothing is written into the project', async () => {
    const flow = run({
      pick: (items) => items.filter((item) => item.label === 'review').map((item) => item.id),
    })
    await flow.done
    expect(flow.events).not.toContain('lease')
    expect(flow.events.some((event) => event.startsWith('copy '))).toBe(false)
    expect(flow.io.files.has(`${HOME}/.config/muse/skills/review/SKILL.md`)).toBe(true)
  })

  it('writes nothing, and says so, when the lease cannot be taken', async () => {
    const flow = run({
      editProject: () => Promise.reject(new Error(UI_TEXT.checkpointFailed)),
    })
    await flow.done
    expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(false)
    expect(flow.io.files.has(`${HOME}/.config/muse/skills/review/SKILL.md`)).toBe(false)
    expect(flow.warnings).toEqual([UI_TEXT.agentImportNotApplied])
    expect(flow.opened).toEqual([])
    expect(flow.clipboard).toEqual([])
    expect(flow.logged()).toContain('the checkpoint lease failed')
  })

  it('reports what was written when only the lease’s release fails', async () => {
    const flow = run({
      pick: projectOnly,
      editProject: async (work) => {
        await work(() => undefined)
        throw new Error(UI_TEXT.checkpointFailed)
      },
    })
    await flow.done
    expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(true)
    expect(flow.warnings).not.toContain(UI_TEXT.agentImportNotApplied)
    expect(flow.information.at(-1)).toContain(UI_TEXT.agentImportDone)
    expect(flow.logged()).toContain('the checkpoint lease failed')
  })

  it('fails the write whose checkpoint copy could not be kept, and only that one', async () => {
    const flow = run({
      beforeProjectWrite: (path) =>
        path.endsWith('AGENTS.md')
          ? Promise.reject(new Error(UI_TEXT.checkpointFailed))
          : Promise.resolve(),
    })
    await flow.done
    expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(true)
    expect(flow.io.files.get(`${WS}/AGENTS.md`)).toBeUndefined()
    expect(flow.logged()).toContain('AGENTS.md could not be written')
    expect(flow.warnings.join('\n')).toContain(UI_TEXT.agentImportSkippedFailed)
  })

  it('says why, and not that it finished, when nothing could be written', async () => {
    const flow = run({
      pick: projectOnly,
      beforeProjectWrite: () => Promise.reject(new Error(UI_TEXT.checkpointFailed)),
    })
    await flow.done
    expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(false)
    expect(flow.information.some((message) => message.startsWith(UI_TEXT.agentImportDone))).toBe(
      false,
    )
    expect(flow.warnings).toEqual([`ship: ${UI_TEXT.agentImportSkippedFailed}`])
  })

  it('stops every later project write once the window’s guard throws', async () => {
    let checks = 0
    const flow = run({
      editProject: async (work) =>
        await work(() => {
          checks += 1
          if (checks > 1) {
            throw new Error(UI_TEXT.questionCancelled)
          }
        }),
    })
    await flow.done
    expect(checks).toBeGreaterThan(1)
    expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(false)
    expect(flow.io.files.has(`${WS}/AGENTS.md`)).toBe(false)
  })
})

/**
 * The window shows another folder from the `at`-th identity lookup on,
 * while that lookup still identifies the old one.
 */
function folderChangedAtLookup(at: number) {
  const io = memoryImportIo({ files: FILES })
  const state = { live: WS, lookups: 0 }
  const identifyRoot = io.identifyRoot
  io.identifyRoot = async (root) => {
    const identity = await identifyRoot(root)
    if (++state.lookups === at) state.live = '/other'
    return identity
  }
  return { io, state, currentRoot: () => state.live }
}

// RV83d #6: the window's folder can change while the folder's identity is
// awaited; what was identified is then only the folder it showed before.
describe('importFromAgents: a folder that changes during the last root check', () => {
  it('copies no project hooks when the folder changes during the final identity lookup', async () => {
    // The request's own lookup, then one per copy check: the third is the last before the clipboard.
    const { io, state, currentRoot } = folderChangedAtLookup(3)
    const flow = run({ io, pick: projectHooksOnly, currentRoot })
    await flow.done
    expect(state.lookups).toBe(3)
    expect(flow.clipboard).toEqual([])
    expect(flow.opened).toEqual([])
    expect(flow.warnings).toContain(`.muse/hooks.json: ${UI_TEXT.agentImportSkippedChanged}`)
  })

  it('copies no project hooks when the folder changes during the final path check', async () => {
    const io = memoryImportIo({ files: FILES })
    let live = WS
    let checks = 0
    const assertSafePath = io.assertSafePath
    io.assertSafePath = async (...args) => {
      await assertSafePath(...args)
      // The plan's check, then one before and one after the existence read:
      // the third returns straight to the clipboard's synchronous guard.
      if (args[0] === `${WS}/.muse/hooks.json` && ++checks === 3) live = '/other'
    }
    const flow = run({ io, pick: projectHooksOnly, currentRoot: () => live })
    await flow.done
    expect(checks).toBe(3)
    expect(flow.clipboard).toEqual([])
    expect(flow.opened).toEqual([])
  })

  it('writes no project file when the folder changes during the identity lookup before it', async () => {
    // The first lookup binds the request; the second is the write's own.
    const { io, currentRoot } = folderChangedAtLookup(2)
    const flow = run({ io, pick: projectOnly, currentRoot })
    await flow.done
    expect(flow.io.files.has(`${WS}/.agents/skills/ship/SKILL.md`)).toBe(false)
    expect(flow.events.some((event) => event.startsWith('user '))).toBe(false)
    expect(flow.warnings.join('\n')).toContain(`ship: ${UI_TEXT.agentImportSkippedChanged}`)
  })
})

describe('importFromAgents: what the preview and the log say', () => {
  // RV83d #8: the fence was found by spreading every backtick run into Math.max.
  it('previews an admitted MCP argument of 128,000 backtick runs', async () => {
    const argument = '`a'.repeat(128_000)
    const flow = run({
      files: {
        [`${HOME}/.claude.json`]: JSON.stringify({
          mcpServers: { fence: { command: 'node', args: [argument] } },
        }),
      },
    })
    await flow.done
    expect(flow.previews).toHaveLength(1)
    expect(flow.previews[0]).toContain('```json\n')
    expect(flow.warnings).not.toContain(UI_TEXT.agentImportFailed)
    expect(JSON.parse(flow.clipboard[0] ?? '')).toHaveProperty('mcpServers.fence.args.0', argument)
  })

  // mr83 P3: a source file that could not be read is mentioned, its reason logged.
  it('says that source files were skipped, in the preview and when nothing was found', async () => {
    const skipped = run({
      files: { [`${HOME}/.claude.json`]: '{ not json', [`${WS}/CLAUDE.md`]: 'Project rules.\n' },
    })
    await skipped.done
    expect(skipped.previews[0]).toContain(
      `${UI_TEXT.agentImportPreviewIntro}\n\n${UI_TEXT.agentImportSkippedFiles}`,
    )
    expect(skipped.logged()).toContain('~/.claude.json is not a readable Claude Code state file')
    const nothing = run({ files: { [`${HOME}/.claude.json`]: '{ not json' } })
    await nothing.done
    expect(nothing.information).toEqual([
      `Nothing to import from Claude Code. ${UI_TEXT.agentImportSkippedFiles}`,
    ])
    const clean = run({ files: { [`${WS}/CLAUDE.md`]: 'Project rules.\n' } })
    await clean.done
    expect(clean.previews[0]).not.toContain(UI_TEXT.agentImportSkippedFiles)
  })

  it('hides a name that may itself hold a credential', async () => {
    const flow = run({
      files: {
        [`${HOME}/.claude.json`]: JSON.stringify({ mcpServers: { [SECRET]: { command: 'x' } } }),
      },
    })
    await flow.done
    expect(flow.items.map((item) => item.label)).toEqual([UI_TEXT.agentImportHiddenName])
    expect(credentialLines(flow.previews[0])).toEqual([
      `- ${UI_TEXT.agentImportHiddenName} (${UI_TEXT.agentImportKindMcp} · ${UI_TEXT.importSourceClaude} · ${UI_TEXT.agentImportUserFiles}): ${UI_TEXT.agentImportCueToken}`,
    ])
    expect(everythingShown(flow)).not.toContain(SECRET)
  })

  it('notes only a file the import actually wrote as the user’s', async () => {
    const flow = run({
      whilePreviewed: ({ files }) => {
        files.set(`${WS}/.agents/skills/ship/SKILL.md`, 'appeared after the preview')
      },
    })
    await flow.done
    expect(flow.events.filter((event) => event.startsWith('user '))).toEqual([
      `user ${HOME}/.config/muse/skills/review/SKILL.md`,
      `user ${WS}/AGENTS.md`,
    ])
  })
})

describe('createImportGate', () => {
  it('admits one task at a time, says so when busy, and opens again after a failure', async () => {
    const gate = createImportGate()
    const release = Promise.withResolvers<undefined>()
    const order: string[] = []
    const first = gate(async () => {
      order.push('first starts')
      await release.promise
      order.push('first ends')
    })
    expect(
      await gate(() => {
        order.push('second')
        return Promise.resolve()
      }),
    ).toBe(false)
    release.resolve(undefined)
    expect(await first).toBe(true)
    await expect(gate(() => Promise.reject(new Error('failed')))).rejects.toThrow('failed')
    expect(await gate(() => Promise.resolve())).toBe(true)
    expect(order).toEqual(['first starts', 'first ends'])
  })
})
