// What's New's editor tab (M99, PLAN.md D79): one panel per window, opened in
// the background after an update and with the keyboard from the command;
// its page's messages checked, links opened through openExternal from the
// host's own list, Try its re-checked before they run, the toggle written
// to the setting.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WhatsNewContent } from '../../src/core/whatsNew/whatsNewContent'
import { createWhatsNewPagesFor } from '../../src/host/whatsNew/whatsNewPanel'
import {
  UI_TEXT,
  WHATS_NEW_CHANGELOG_URL,
  WHATS_NEW_REPOSITORY_URL,
} from '../../src/shared/constants'
import { FakeLogOutputChannel, FakeWebviewPanel } from './helpers/fakes'
import { logLines } from './helpers/logText'
import { commands as fakeCommands, env as fakeEnv, Uri, window as fakeWindow } from './mocks/vscode'

const CONTENT: WhatsNewContent = {
  schema: 1,
  releases: [
    {
      version: '0.13.1',
      date: '2026-10-06',
      highlights: [],
      sections: [{ heading: 'Fixed', blocks: [{ t: 'p', c: [{ t: 'text', v: 'A fix.' }] }] }],
    },
    {
      version: '0.13.0',
      date: '2026-10-05',
      highlights: [
        {
          c: [{ t: 'p', c: [{ t: 'text', v: 'Try the page.' }] }],
          tries: [
            { kind: 'command', id: 'museSpark.showWhatsNew' },
            { kind: 'setting', id: 'museSpark.showWhatsNewOnUpdate' },
          ],
        },
      ],
      sections: [],
    },
    { version: '0.12.0', date: '2026-10-01', highlights: [], sections: [] },
  ],
}

function setUp(text = JSON.stringify(CONTENT)) {
  const panels: FakeWebviewPanel[] = []
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation((viewType, title) => {
    const panel = new FakeWebviewPanel(viewType, title)
    panels.push(panel)
    return panel
  })
  const log = new FakeLogOutputChannel()
  const setShownOnUpdate = vi.fn(() => Promise.resolve())
  const readContent = vi.fn(() => text)
  const pages = createWhatsNewPagesFor({
    extensionUri: Uri.file('/ext'),
    contentPath: '/ext/dist/whatsNew.json',
    current: '0.13.1',
    isShownOnUpdate: () => true,
    setShownOnUpdate,
    log,
    readContent,
  })
  return { pages, panels, log, setShownOnUpdate, readContent }
}

/** Lets the panel's message handler finish its awaited action. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
}

beforeEach(() => {
  fakeCommands.executeCommand.mockReset()
  fakeCommands.executeCommand.mockResolvedValue(undefined)
  fakeEnv.openExternal.mockReset()
  fakeEnv.openExternal.mockResolvedValue(true)
})

describe('createWhatsNewPagesFor', () => {
  it('picks the releases an update brings, or the palette’s set, from the content read once', () => {
    const { pages, readContent } = setUp()
    expect(pages.releases('0.12.0').map((release) => release.version)).toEqual(['0.13.1', '0.13.0'])
    expect(pages.releases(undefined).map((release) => release.version)).toEqual([
      '0.13.1',
      '0.13.0',
    ])
    expect(readContent).toHaveBeenCalledExactlyOnceWith('/ext/dist/whatsNew.json')
  })

  it('opens in the background after an update and with the keyboard from the command, in one tab', () => {
    const { pages, panels } = setUp()
    pages.open('0.12.0', true)
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledExactlyOnceWith(
      'museSpark.whatsNew',
      UI_TEXT.whatsNewTitle,
      { viewColumn: -1, preserveFocus: true },
      {
        enableScripts: true,
        enableFindWidget: true,
        localResourceRoots: [Uri.file('/ext/dist/webview')],
      },
    )
    const panel = panels[0]
    expect(panel?.webview.html).toContain(`script-src 'nonce-`)
    expect(panel?.webview.html).toContain('Updated from 0.12.0 to 0.13.1.')
    expect(panel?.reveal).toHaveBeenLastCalledWith(undefined, true)
    pages.open(undefined, false)
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledOnce()
    expect(panel?.webview.html).toContain('You’re on version 0.13.1.')
    expect(panel?.reveal).toHaveBeenLastCalledWith(undefined, false)
    // Closed, the next open makes a new tab.
    panel?.dispose()
    pages.open(undefined, false)
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledTimes(2)
    pages.dispose()
  })

  it('opens a link from its own list through openExternal, never an address the page sends', async () => {
    const { pages, panels, log } = setUp()
    pages.open(undefined, false)
    const panel = panels[0]
    panel?.webview.messages.fire({ type: 'openLink', index: 0 })
    await settle()
    expect(fakeEnv.openExternal).toHaveBeenCalledExactlyOnceWith(Uri.parse(WHATS_NEW_CHANGELOG_URL))
    panel?.webview.messages.fire({ type: 'openLink', index: 9 })
    panel?.webview.messages.fire({ type: 'openLink', url: 'https://evil.example' })
    await settle()
    expect(fakeEnv.openExternal).toHaveBeenCalledOnce()
    expect(logLines(log)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no link 9 on the page'),
        expect.stringContaining('dropped a malformed message'),
      ]),
    )
  })

  it('runs a contributed command, opens a declared setting, and refuses anything else', async () => {
    const { pages, panels, log } = setUp()
    pages.open(undefined, false)
    const panel = panels[0]
    panel?.webview.messages.fire({ type: 'tryIt', index: 0 })
    panel?.webview.messages.fire({ type: 'tryIt', index: 1 })
    await settle()
    expect(fakeCommands.executeCommand.mock.calls).toEqual([
      ['museSpark.showWhatsNew'],
      ['workbench.action.openSettings', 'museSpark.showWhatsNewOnUpdate'],
    ])
    panel?.webview.messages.fire({ type: 'tryIt', index: 2 })
    panel?.webview.messages.fire({ type: 'tryIt', index: -1 })
    await settle()
    expect(fakeCommands.executeCommand).toHaveBeenCalledTimes(2)
    expect(logLines(log).some((line) => line.includes('no Try it 2 on the page'))).toBe(true)
  })

  it('opens the footer’s indexed star link through the host', async () => {
    const { pages, panels } = setUp()
    pages.open(undefined, false)
    const panel = panels[0]
    const link = panel?.webview.html.match(
      /<a href="https:\/\/github\.com\/RandyNorthrup\/muse-spark-code" data-link="(\d+)">/,
    )
    expect(link?.[1]).toBeDefined()
    panel?.webview.messages.fire({ type: 'openLink', index: Number(link?.[1]) })
    await settle()
    expect(fakeEnv.openExternal).toHaveBeenCalledExactlyOnceWith(
      Uri.parse(WHATS_NEW_REPOSITORY_URL),
    )
  })

  it('never renders or runs a Try it for an unknown command, even when the content names one', async () => {
    const tampered: WhatsNewContent = {
      schema: 1,
      releases: [
        {
          version: '0.13.1',
          date: '2026-10-06',
          highlights: [
            {
              c: [{ t: 'p', c: [{ t: 'text', v: 'Bad.' }] }],
              tries: [{ kind: 'command', id: 'workbench.action.terminal.sendSequence' }],
            },
          ],
          sections: [],
        },
      ],
    }
    const { pages, panels } = setUp(JSON.stringify(tampered))
    pages.open(undefined, false)
    expect(panels[0]?.webview.html).not.toContain('data-try')
    panels[0]?.webview.messages.fire({ type: 'tryIt', index: 0 })
    await settle()
    expect(fakeCommands.executeCommand).not.toHaveBeenCalled()
  })

  it('writes the toggle to the setting', async () => {
    const { pages, panels, setShownOnUpdate } = setUp()
    pages.open(undefined, false)
    panels[0]?.webview.messages.fire({ type: 'hideOnUpdate', isHidden: true })
    panels[0]?.webview.messages.fire({ type: 'hideOnUpdate', isHidden: false })
    await settle()
    expect(setShownOnUpdate.mock.calls).toEqual([[false], [true]])
  })

  it('logs an action that fails', async () => {
    const { pages, panels, log } = setUp()
    fakeEnv.openExternal.mockRejectedValue(new Error('no browser'))
    pages.open(undefined, false)
    panels[0]?.webview.messages.fire({ type: 'openLink', index: 1 })
    await settle()
    expect(logLines(log).some((line) => line.includes('openLink failed: no browser'))).toBe(true)
  })

  it('throws before opening a tab when the content cannot be read', () => {
    const { pages } = setUp('{"schema":2}')
    expect(() => {
      pages.open(undefined, false)
    }).toThrow()
    expect(fakeWindow.createWebviewPanel).not.toHaveBeenCalled()
  })
})
