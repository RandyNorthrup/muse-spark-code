// dist/playbook.js as the production build makes it (M116, C-M116-6; PLAN.md
// D6): the activation side's loader, which refuses a missing or malformed
// module, and the bundle itself in both of its roles. It is built the way
// scripts/build.mjs builds it and required the way the extension requires
// it; the window it makes starts the same file again as a real worker
// thread, and the panel's channel and the composer's `/playbook` read and
// change a real journal file through that thread.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import type { Logger } from '../../src/host/logger'
import {
  PLAYBOOK_PANEL_TEAM,
  PLAYBOOK_RECORD_FOLDER,
  PLAYBOOK_WINDOW_BUNDLE_FILE,
  UI_TEXT,
} from '../../src/shared/constants'
import { answerPlaybookCommand } from '../../src/host/playbook/playbookAnswer'
import {
  hasWindowPlaybook,
  isPlaybookWindowBundle,
  playbookPanelChannel,
  playbookWindowLoader,
} from '../../src/host/playbook/playbookBundle'
import { playbookSnapshotSchema } from '../../src/runtime/playbook/command'
import {
  playbookHelloSchema,
  playbookResponseSchema,
  type PlaybookPanelResponse,
} from '../../src/runtime/playbook/panelWire'
import { createPlaybookSurface } from '../../src/runtime/playbook/surface'
import { OFFLOAD_REASON, offloadOffRequest, PANEL_BRIDGE } from './helpers/playbook/panelRequests'
import { FIXTURE_HOOK_TIMEOUT_MS } from './helpers/fixtureBudget'
import { removeFolder } from './helpers/temporaryFolders'

const BRIDGE = PANEL_BRIDGE
const built = { folder: '', file: '' }

/** The errors the loader logged, in order. */
function testLog(): { log: Logger; errors: string[] } {
  const errors: string[] = []
  return {
    errors,
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (message: string) => {
        errors.push(message)
      },
    },
  }
}

beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-playbook-window-bundle-'))
  built.file = path.join(built.folder, PLAYBOOK_WINDOW_BUNDLE_FILE)
  await build({
    entryPoints: [path.resolve('src/host/playbook/playbookEntry.ts')],
    outfile: built.file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
  })
}, FIXTURE_HOOK_TIMEOUT_MS)
afterAll(() => removeFolder(built.folder))

/** A window over the built bundle, a journal folder and a workspace of its own. */
function shipped() {
  const data = mkdtempSync(path.join(tmpdir(), 'muse-playbook-window-data-'))
  const workspace = mkdtempSync(path.join(tmpdir(), 'muse-playbook-window-work-'))
  const { log, errors } = testLog()
  const window = playbookWindowLoader(built.file, log)().createPlaybookWindow(
    {
      bundlePath: built.file,
      agentDataFolder: data,
      workspaceRoot: workspace,
      isWorkspaceTrusted: () => true,
      platform: process.platform,
      // Reading and changing the journal runs no git, so no job is prepared.
      systemRoot: undefined,
      shellJobAssembly: undefined,
      reviewCharter: () => 'charter',
      // No test here answers a finding: the pickers are dismissed.
      ui: {
        showQuickPick: () => Promise.resolve(undefined),
        showInputBox: () => Promise.resolve(undefined),
      },
      log,
    },
    UI_TEXT,
    'en',
  )
  const ask = async (message: unknown): Promise<PlaybookPanelResponse | undefined> => {
    const replies: PlaybookPanelResponse[] = []
    await window.panel(message, (reply) => {
      replies.push(reply)
    })
    return replies.at(-1)
  }
  return {
    data,
    workspace,
    log,
    errors,
    window,
    ask,
    remove: async () => {
      window.dispose()
      await removeFolder(data)
      await removeFolder(workspace)
    },
  }
}

describe('isPlaybookWindowBundle', () => {
  it('accepts a module that exports the window’s factory, and nothing else', () => {
    expect(isPlaybookWindowBundle({ createPlaybookWindow: () => undefined })).toBe(true)
    expect(isPlaybookWindowBundle({ createPlaybookWindow: 'a function' })).toBe(false)
    expect(isPlaybookWindowBundle({ createPlaybookSurface: () => undefined })).toBe(false)
    expect(isPlaybookWindowBundle({})).toBe(false)
    expect(isPlaybookWindowBundle(null)).toBe(false)
    expect(isPlaybookWindowBundle('createPlaybookWindow')).toBe(false)
  })
})

describe('playbookWindowLoader', () => {
  it('answers unavailable for a missing bundle, logging the cause', () => {
    const { log, errors } = testLog()
    const load = playbookWindowLoader(path.join(built.folder, 'no-such-bundle.js'), log)
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
    expect(errors).toHaveLength(1)
  })

  it('refuses a module with the wrong shape, and tries again on the next call', () => {
    const file = path.join(built.folder, 'wrong-shape.js')
    writeFileSync(file, 'module.exports = { createPlaybookWindow: 1 }\n')
    const { log } = testLog()
    const load = playbookWindowLoader(file, log)
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
  })

  it('loads the built bundle once and keeps it', () => {
    const { log } = testLog()
    const load = playbookWindowLoader(built.file, log)
    expect(load()).toBe(load())
  })
})

describe('playbookPanelChannel', () => {
  it('answers the panel that the playbook failed when its bundle cannot load, whatever was asked', () => {
    const { log, errors } = testLog()
    const load = playbookWindowLoader(path.join(built.folder, 'no-such-bundle.js'), log)
    let loads = 0
    const loaded = (): unknown => {
      loads += 1
      return load().createPlaybookWindow
    }
    // What production does: the loader is called for each message, and throws for each.
    const { log: channelLog, errors: channelErrors } = testLog()
    const channel = playbookPanelChannel(() => {
      loaded()
      throw new Error('The loader returned without a bundle')
    }, channelLog)
    const replies: unknown[] = []
    for (const message of [
      { type: 'playbookHello' },
      { type: 'playbookAgents', requestId: 1, children: [] },
      { type: 'playbookRead', bridgeId: BRIDGE, workspaceId: 'journal-1', requestId: 2 },
    ])
      channel(
        message,
        (reply) => {
          replies.push(reply)
        },
        () => undefined,
      )
    expect(replies).toEqual([
      { type: 'playbookFailed' },
      { type: 'playbookFailed' },
      { type: 'playbookFailed' },
    ])
    expect(loads).toBe(3)
    // The loader said why, in the log, and nothing of it reached the panel.
    expect(errors.length).toBeGreaterThan(0)
    // The channel named the failure's kind beside the loader's own report.
    expect(channelErrors).toHaveLength(3)
  })

  it('hands a message to the bundle that loaded, with the conversation’s own question', async () => {
    const setup = shipped()
    try {
      const replies: unknown[] = []
      let asks = 0
      playbookPanelChannel(() => setup.window, setup.log)(
        { type: 'playbookHello' },
        (reply) => {
          replies.push(reply)
        },
        () => {
          asks += 1
          return Promise.resolve(true)
        },
      )
      await vi.waitFor(() => {
        expect(replies).toHaveLength(1)
      })
      expect(playbookHelloSchema.parse(replies[0])).toMatchObject({ spawnGap: true })
      expect(asks).toBe(1)
    } finally {
      await setup.remove()
    }
  })
})

describe('the shipped bundle, as the window and as its worker thread', () => {
  it('reads and changes the journal on a real thread, for the panel and for the composer', async () => {
    const setup = shipped()
    try {
      const hello = playbookHelloSchema.parse(await setup.ask({ type: 'playbookHello' }))
      const scope = { bridgeId: BRIDGE, workspaceId: hello.workspaceId }
      const read = playbookResponseSchema.parse(
        await setup.ask({ type: 'playbookRead', ...scope, requestId: 1 }),
      )
      if (read.type !== 'playbookState') throw new Error('The journal was not read')
      expect(read.snapshot.settings.teamId).toBe(PLAYBOOK_PANEL_TEAM)
      expect(Object.values(read.snapshot.settings.rules).every((rule) => rule.enabled)).toBe(true)

      const changed = await setup.ask(offloadOffRequest(hello.workspaceId, 2))
      expect(changed?.type).toBe('playbookState')
      // Rule nine has no switch on this surface either: the request is not even read.
      expect(
        await setup.ask({
          type: 'playbookChange',
          ...scope,
          requestId: 3,
          change: { rule: 'neverAround', enabled: false, reason: 'because' },
        }),
      ).toBeUndefined()

      // `/playbook` in the composer answers from the same journal, through the same thread.
      const source = {
        loadBundle: () => setup.window.answerBundle(),
        agentDataFolder: setup.data,
        workspaceRoot: setup.workspace,
        table: UI_TEXT,
        locale: 'en',
        log: setup.log,
      }
      const settings = await answerPlaybookCommand(source, '/playbook settings')
      expect(settings?.ok).toBe(true)
      expect(settings?.text).toContain(OFFLOAD_REASON)
      const status = await answerPlaybookCommand(source, '/playbook')
      expect(status).toMatchObject({ ok: true })
      expect(status?.text).toContain(UI_TEXT.playbookTitle)

      // One journal file, and it is the one the CLI and the ACP agent read in-process.
      expect(readdirSync(path.join(setup.data, PLAYBOOK_RECORD_FOLDER))).toHaveLength(1)
      const cli = createPlaybookSurface({
        agentDataFolder: setup.data,
        workspaceFolder: setup.workspace,
        teamId: PLAYBOOK_PANEL_TEAM,
        laneId: 'cli',
      })
      expect(playbookSnapshotSchema.parse(await cli.read()).settings.rules.offload).toMatchObject({
        enabled: false,
        reason: OFFLOAD_REASON,
      })
      expect(setup.errors).toHaveLength(0)
    } finally {
      await setup.remove()
    }
  })

  it('lets a Model API conversation’s child work through while it has nothing under review', async () => {
    const setup = shipped()
    try {
      const journals = path.join(setup.data, PLAYBOOK_RECORD_FOLDER)
      let starts = 0
      let overs = 0
      const start = (): Promise<string> => {
        starts += 1
        return Promise.resolve('started')
      }
      const isOver = (): boolean => {
        overs += 1
        return true
      }
      const refused = (reason: string): string => reason
      await expect(
        setup.window.admit('subagent', 'session-1', undefined, start, isOver, refused),
      ).resolves.toBe('started')
      // No journal on this machine: nothing was asked, and nothing was written.
      expect(existsSync(journals)).toBe(false)

      // Once a journal is there the thread is asked, and says the work is not the playbook's.
      const hello = playbookHelloSchema.parse(await setup.ask({ type: 'playbookHello' }))
      const scope = { bridgeId: BRIDGE, workspaceId: hello.workspaceId }
      await setup.ask({ type: 'playbookRead', ...scope, requestId: 1 })
      await setup.ask(offloadOffRequest(hello.workspaceId, 2))
      expect(readdirSync(journals)).toHaveLength(1)
      await expect(
        setup.window.admit('delegate', 'session-1', 'subagent-1', start, isOver, refused),
      ).resolves.toBe('started')
      expect(starts).toBe(2)
      // Work that is not the playbook's has no round, so nobody asks when it is over.
      expect(overs).toBe(0)
      expect(setup.errors).toHaveLength(0)
    } finally {
      await setup.remove()
    }
  })

  it('answers unavailable once the window is gone, and starts no new thread for it', async () => {
    const setup = shipped()
    try {
      const hello = playbookHelloSchema.parse(await setup.ask({ type: 'playbookHello' }))
      const scope = { bridgeId: BRIDGE, workspaceId: hello.workspaceId, requestId: 1 }
      expect(await setup.ask({ type: 'playbookRead', ...scope })).toMatchObject({
        type: 'playbookState',
      })
      setup.window.dispose()
      expect(await setup.ask({ type: 'playbookRead', ...scope })).toEqual({
        type: 'playbookUnavailable',
        ...scope,
      })
      // The window is gone but its surface is not missing: the command was
      // loaded and failed, so it says so (runPlaybookCommand's contract).
      expect(
        await answerPlaybookCommand(
          {
            loadBundle: () => setup.window.answerBundle(),
            agentDataFolder: setup.data,
            workspaceRoot: setup.workspace,
            table: UI_TEXT,
            locale: 'en',
            log: setup.log,
          },
          '/playbook status',
        ),
      ).toEqual({ ok: false, text: UI_TEXT.playbookCommandFailed })
    } finally {
      await setup.remove()
    }
  })
})

describe('presence without loading policy', () => {
  it('starts child work with a missing bundle when this window has no playbook', async () => {
    const { log } = testLog()
    const inner = playbookWindowLoader(path.join(built.folder, 'absent.js'), log)
    let loads = 0
    const load = (): unknown => {
      loads += 1
      return inner()
    }
    let effects = 0
    const effect = (): Promise<string> => {
      effects += 1
      return Promise.resolve('started')
    }
    const { log: presenceLog } = testLog()
    const admit = () => (hasWindowPlaybook(built.folder, presenceLog) ? load() : undefined)
    expect(admit()).toBeUndefined()
    expect(await effect()).toBe('started')
    expect(loads).toBe(0)
    expect(effects).toBe(1)
  })

  it.runIf(
    process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0,
  )('treats an unreadable folder as present so the bundle can report the failure', async () => {
    // A folder whose own listing is refused: statSync names EACCES, for real.
    const parent = mkdtempSync(path.join(tmpdir(), 'muse-playbook-unreadable-'))
    const folder = path.join(parent, 'data')
    mkdirSync(folder)
    chmodSync(folder, 0o000)
    const { log: unreadableLog, errors: unreadableErrors } = testLog()
    try {
      expect(hasWindowPlaybook(folder, unreadableLog)).toBe(true)
      expect(unreadableErrors).toHaveLength(1)
    } finally {
      chmodSync(folder, 0o755)
      await removeFolder(parent)
    }
  })
})
