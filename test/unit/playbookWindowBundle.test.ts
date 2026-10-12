// dist/playbook.js as the production build makes it (M116, C-M116-6; PLAN.md
// D6): the activation side's loader, which refuses a missing or malformed
// module, and the bundle itself in both of its roles. It is built the way
// scripts/build.mjs builds it and required the way the extension requires
// it; the window it makes starts the same file again as a real worker
// thread, and the panel's channel and the composer's `/playbook` read and
// change a real journal file through that thread.

import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  PLAYBOOK_PANEL_TEAM,
  PLAYBOOK_RECORD_FOLDER,
  PLAYBOOK_WINDOW_BUNDLE_FILE,
  UI_TEXT,
} from '../../src/shared/constants'
import { answerPlaybookCommand } from '../../src/host/playbook/playbookAnswer'
import {
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
import { FakeLogOutputChannel } from './helpers/fakes'
import { buildHostBundles } from './helpers/modelApiBundle'
import { OFFLOAD_REASON, offloadOffRequest, PANEL_BRIDGE } from './helpers/playbook/panelRequests'
import { removeFolder } from './helpers/temporaryFolders'

const BRIDGE = PANEL_BRIDGE
const built = { folder: '', file: '' }

beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-playbook-window-bundle-'))
  built.file = path.join(built.folder, PLAYBOOK_WINDOW_BUNDLE_FILE)
  await buildHostBundles(built.folder, {
    [path.parse(PLAYBOOK_WINDOW_BUNDLE_FILE).name]: path.resolve(
      'src/host/playbook/playbookEntry.ts',
    ),
  })
})
afterAll(() => removeFolder(built.folder))

/** A window over the built bundle, a journal folder and a workspace of its own. */
function shipped() {
  const data = mkdtempSync(path.join(tmpdir(), 'muse-playbook-window-data-'))
  const workspace = mkdtempSync(path.join(tmpdir(), 'muse-playbook-window-work-'))
  const log = new FakeLogOutputChannel()
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
    const log = new FakeLogOutputChannel()
    const load = playbookWindowLoader(path.join(built.folder, 'no-such-bundle.js'), log)
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
    expect(log.error).toHaveBeenCalledOnce()
  })

  it('refuses a module with the wrong shape, and tries again on the next call', () => {
    const file = path.join(built.folder, 'wrong-shape.js')
    writeFileSync(file, 'module.exports = { createPlaybookWindow: 1 }\n')
    const load = playbookWindowLoader(file, new FakeLogOutputChannel())
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
  })

  it('loads the built bundle once and keeps it', () => {
    const load = playbookWindowLoader(built.file, new FakeLogOutputChannel())
    expect(load()).toBe(load())
  })
})

describe('playbookPanelChannel', () => {
  it('answers the panel that the playbook failed when its bundle cannot load, whatever was asked', () => {
    const log = new FakeLogOutputChannel()
    const load = playbookWindowLoader(path.join(built.folder, 'no-such-bundle.js'), log)
    const loaded = vi.fn(() => load().createPlaybookWindow)
    // What production does: the loader is called for each message, and throws for each.
    const channel = playbookPanelChannel(() => {
      loaded()
      throw new Error('The loader returned without a bundle')
    })
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
    expect(loaded).toHaveBeenCalledTimes(3)
    // The loader said why, in the log, and nothing of it reached the panel.
    expect(log.error).toHaveBeenCalled()
  })

  it('hands a message to the bundle that loaded, with the conversation’s own question', async () => {
    const setup = shipped()
    try {
      const replies: unknown[] = []
      const asked = vi.fn(() => Promise.resolve(true))
      playbookPanelChannel(() => setup.window)(
        { type: 'playbookHello' },
        (reply) => {
          replies.push(reply)
        },
        asked,
      )
      await vi.waitFor(() => {
        expect(replies).toHaveLength(1)
      })
      expect(playbookHelloSchema.parse(replies[0])).toMatchObject({ spawnGap: true })
      expect(asked).toHaveBeenCalledOnce()
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
      expect(setup.log.error).not.toHaveBeenCalled()
    } finally {
      await setup.remove()
    }
  })

  it('lets a Model API conversation’s child work through while it has nothing under review', async () => {
    const setup = shipped()
    try {
      const journals = path.join(setup.data, PLAYBOOK_RECORD_FOLDER)
      const start = vi.fn(() => Promise.resolve('started'))
      const isOver = vi.fn(() => true)
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
      expect(start).toHaveBeenCalledTimes(2)
      // Work that is not the playbook's has no round, so nobody asks when it is over.
      expect(isOver).not.toHaveBeenCalled()
      expect(setup.log.error).not.toHaveBeenCalled()
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
      ).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
    } finally {
      await setup.remove()
    }
  })
})
