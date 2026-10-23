/** @vitest-environment jsdom */
import { webcrypto } from 'node:crypto'
import { act, fireEvent, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { mountNodeWorkspace } from '../../src/webview/node/files/main'
import { NodePageError, validatedNodePort } from '../../src/webview/bridges/nodePort'
import { UI_TEXT } from '../../src/shared/constants'
import type { NodeMethodName } from '../../src/shared/hostApi/nodeMethods'
import type { NodePageAuthPort } from '../../src/webview/node/git/network'
import { scripted } from './helpers/recordCalls'

const disposers: (() => void)[] = []

// jsdom mounts no xterm emulator (it needs canvas measurement), so these
// tests prove the shell around it: the lazy chunk loads on first visit,
// the empty surface offers a new shell and an attach, and tabs keep their
// sessions while the person looks at another page. The live terminal runs
// in the harness scenarios on a real browser.
async function fixture() {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
  const container = document.createElement('div')
  document.body.append(container)
  const respond = (method: NodeMethodName): Promise<unknown> =>
    method === 'node/files/list'
      ? Promise.resolve({ entries: [], nextCursor: null })
      : Promise.reject(new NodePageError('unavailable'))
  const request = scripted<[NodeMethodName, unknown, AbortSignal], Promise<unknown>>(respond)
  const verify = scripted<
    Parameters<NodePageAuthPort['verify']>,
    ReturnType<NodePageAuthPort['verify']>
  >((action, actionDigest) =>
    Promise.resolve({
      id: 'proof',
      sessionId: 'session',
      action,
      actionDigest,
      verifiedAt: 1,
      expiresAt: 2,
    }),
  )
  await act(async () => {
    disposers.push(
      mountNodeWorkspace(container, {
        port: validatedNodePort({ request }),
        auth: { verify },
        workspaceId: 'repo',
        connectTerminal: () => Promise.reject(new NodePageError('unavailable')),
      }),
    )
    await Promise.resolve()
  })
  return { ui: within(container) }
}

afterEach(async () => {
  await act(async () => {
    for (const dispose of disposers.splice(0)) dispose()
    await Promise.resolve()
  })
  document.body.replaceChildren()
})

describe('node terminal shell', () => {
  it('loads on first visit with a new shell and an attach, and no emulator yet', async () => {
    const { ui } = await fixture()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.terminal }))
    const section = await ui.findByRole('region', { name: UI_TEXT.nodeLabels.terminal })
    const view = within(section)
    expect(view.getByRole('button', { name: UI_TEXT.nodeLabels.newTerminal })).not.toBeNull()
    expect(view.getByRole('button', { name: UI_TEXT.nodeLabels.attachTerminal })).not.toBeNull()
    expect(view.getByLabelText(UI_TEXT.nodeLabels.terminalId)).not.toBeNull()
    expect(section.querySelector('.xterm')).toBeNull()
  })

  it('keeps its shells while the person looks at another page', async () => {
    const { ui } = await fixture()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.terminal }))
    const section = await ui.findByRole('region', { name: UI_TEXT.nodeLabels.terminal })
    const view = within(section)
    await view.findByRole('button', { name: UI_TEXT.nodeLabels.newTerminal })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.dashboard }))
    ui.getByRole('region', { name: UI_TEXT.nodeLabels.dashboard })
    // The terminal stays mounted, only hidden: its sessions survive.
    expect(section.isConnected).toBe(true)
    expect(section.closest('div[hidden]')).not.toBeNull()
  })
})
