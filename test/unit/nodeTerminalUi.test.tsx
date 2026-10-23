/** @vitest-environment jsdom */
import { fireEvent, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NodePageError } from '../../src/webview/bridges/nodePort'
import { UI_TEXT } from '../../src/shared/constants'
import type { NodeMethodName } from '../../src/shared/hostApi/nodeMethods'
import { cleanupNodeUi, mountNodeUi } from './helpers/nodeUi'

// jsdom mounts no xterm emulator (it needs canvas measurement), so these
// tests prove the shell around it: the lazy chunk loads on first visit,
// the empty surface offers a new shell and an attach, and tabs keep their
// sessions while the person looks at another page. The live terminal runs
// in the harness scenarios on a real browser.
function respond(method: NodeMethodName): Promise<unknown> {
  return method === 'node/files/list'
    ? Promise.resolve({ entries: [], nextCursor: null })
    : Promise.reject(new NodePageError('unavailable'))
}

async function fixture() {
  return await mountNodeUi(respond)
}

afterEach(cleanupNodeUi)

async function openTerminal() {
  const { ui } = await fixture()
  fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.terminal }))
  const section = await ui.findByRole('region', { name: UI_TEXT.nodeLabels.terminal })
  return { ui, section, view: within(section) }
}

describe('node terminal shell', () => {
  it('loads on first visit with a new shell and an attach, and no emulator yet', async () => {
    const { view, section } = await openTerminal()
    expect(view.getByRole('button', { name: UI_TEXT.nodeLabels.newTerminal })).not.toBeNull()
    expect(view.getByRole('button', { name: UI_TEXT.nodeLabels.attachTerminal })).not.toBeNull()
    expect(view.getByLabelText(UI_TEXT.nodeLabels.terminalId)).not.toBeNull()
    expect(section.querySelector('.xterm')).toBeNull()
  })

  it('keeps its shells while the person looks at another page', async () => {
    const { ui, section, view } = await openTerminal()
    await view.findByRole('button', { name: UI_TEXT.nodeLabels.newTerminal })
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.dashboard }))
    ui.getByRole('region', { name: UI_TEXT.nodeLabels.dashboard })
    // The terminal stays mounted, only hidden: its sessions survive.
    expect(section.isConnected).toBe(true)
    expect(section.closest('div[hidden]')).not.toBeNull()
  })
})
