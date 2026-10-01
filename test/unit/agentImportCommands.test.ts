// The import flow (M83, PLAN.md D49): the preview opens before anything is
// written and the user's Import is the only way on; Muse Code's settings
// file and the project's hooks file are never written; what is shown,
// copied and logged is masked; every dismissal writes nothing.

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
  [`${HOME}/.claude/CLAUDE.md`]: 'My rules.\n',
  [`${WS}/.mcp.json`]: JSON.stringify({ mcpServers: { shared: { command: 'shared' } } }),
  [`${WS}/.claude/settings.json`]: JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'setup' }] }] },
  }),
  [`${WS}/.claude/commands/ship.md`]: 'Ship it.\n',
  [`${WS}/CLAUDE.md`]: 'Project rules.\n',
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
  /** Runs when the user answers the copy prompt, before the file opens. */
  readonly whileCopying?: (io: MemoryImportIo) => void
  /** Runs during clipboard access, after the copy path's first check. */
  readonly whileClipboardWritten?: (io: MemoryImportIo, text: string) => void
  /** Shared by two runs in one window; each run gets its own by default. */
  readonly io?: MemoryImportIo
  readonly gate?: ImportGate
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
    isPresent: io.isPresent,
    gate: options.gate ?? createImportGate(),
    pickSource:
      options.pickSource ??
      (() => Promise.resolve('source' in options ? options.source : 'claudeCode')),
    pickCandidates: (list) => {
      items.push(...list)
      const picked =
        options.pick === undefined
          ? list.filter((item) => item.picked).map((item) => item.id)
          : options.pick(list)
      return Promise.resolve(picked)
    },
    openPreview: (title, markdown) => {
      events.push(`preview ${title}`)
      previews.push(markdown)
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
      `copy ${WS}/.agents/skills/ship/SKILL.md`,
      `write ${WS}/.agents/skills/ship/SKILL.md`,
      `copy ${WS}/AGENTS.md`,
      `append ${WS}/AGENTS.md`,
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

  it('masks every secret in the preview, the clipboard and the log', async () => {
    const flow = run()
    await flow.done
    const shown = [...flow.previews, ...flow.clipboard, flow.logged(), ...flow.information]
    expect(shown.join('\n')).not.toContain(SECRET)
    expect(flow.previews[0]).toContain(UI_TEXT.agentImportMasked)
    const copiedSkill = flow.io.files.get(`${HOME}/.config/muse/skills/review/SKILL.md`)
    expect(copiedSkill).toContain(UI_TEXT.agentImportMasked)
    expect(copiedSkill).not.toContain(SECRET)
    expect(JSON.parse(flow.clipboard[0] ?? '')).toEqual({
      schema_version: 1,
      mcpServers: {
        github: {
          type: 'stdio',
          command: 'gh-mcp',
          env: { GITHUB_TOKEN: UI_TEXT.agentImportMasked },
          mode: 'optional',
        },
      },
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: `curl -H "Authorization: Bearer ${UI_TEXT.agentImportMasked}"`,
              },
            ],
          },
        ],
      },
    })
    // The original source remains unchanged; imported bytes match the masked preview.
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

  it('publishes the approved masked project rules and loads only those bytes into context', async () => {
    const cursorRules = `---\ndescription: Bearer ${SECRET}\nglobs: ${SECRET}\n---\n\nUse ${SECRET}.\n`
    const flow = run({
      source: 'all',
      files: {
        ...FILES,
        [`${WS}/CLAUDE.md`]: `Token ${SECRET}.\n`,
        [`${WS}/.cursor/rules/private.mdc`]: cursorRules,
      },
    })
    await flow.done
    const published = flow.io.files.get(`${WS}/AGENTS.md`)
    expect(published).toContain(UI_TEXT.agentImportMasked)
    expect(published).not.toContain(SECRET)
    expect(flow.previews.join('\n')).not.toContain(SECRET)
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
    expect(flow.logged()).not.toContain(SECRET)
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
  it('does not publish into a folder the workspace path was retargeted to while the preview waited', async () => {
    const flow = run({
      pick: projectOnly,
      whilePreviewed: (io) => {
        io.links.set(WS, '/other')
      },
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
