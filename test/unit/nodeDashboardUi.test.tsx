/** @vitest-environment jsdom */
import { fireEvent, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NodePageError } from '../../src/webview/bridges/nodePort'
import { NODE_PROTOCOL_VERSION, UI_TEXT } from '../../src/shared/constants'
import { formatBytes, formatDateTime, formatPercent, formatUnit } from '../../src/shared/l10n/text'
import type { NodeMethodName } from '../../src/shared/hostApi/nodeMethods'
import { cleanupNodeUi, mountNodeUi } from './helpers/nodeUi'

const digest = (char: string) => char.repeat(64)

async function fixture() {
  const state = {
    version: '0.19.0',
    sessions: true,
    workspaces: true,
  }
  const respond = (method: NodeMethodName): Promise<unknown> => {
    if (method === 'node/files/list') return Promise.resolve({ entries: [], nextCursor: null })
    if (method === 'node/dashboard/read')
      return Promise.resolve({
        nodeId: digest('a'),
        version: state.version,
        uptimeMs: 3_600_000,
        sandbox: 'shared',
        locked: false,
        keyStoreSealed: true,
        attendance: state.sessions ? 'attended' : 'unattended',
        sessions: state.sessions
          ? [
              {
                v: NODE_PROTOCOL_VERSION,
                id: 'session',
                ownerId: 'owner',
                surface: 'web',
                createdAt: 1000,
                lastSeenAt: 2000,
                idleExpiresAt: 62_000,
                absoluteExpiresAt: 3_602_000,
              },
            ]
          : [],
        pendingChallenges: 2,
        cpuPercent: 12.5,
        memory: { usedBytes: 1500, totalBytes: 8000 },
        disk: { freeBytes: 2500, totalBytes: 9000 },
        workspaces: state.workspaces
          ? [
              {
                id: 'repo',
                label: 'home',
                path: 'workspace',
                trusted: true,
                lastUsedAt: 3000,
              },
            ]
          : [],
      })
    return Promise.reject(new NodePageError('unavailable'))
  }
  const { ui, request } = await mountNodeUi(respond)
  return { ui, request, state }
}

afterEach(cleanupNodeUi)

type DashboardUi = Awaited<ReturnType<typeof fixture>>['ui']

function openDashboard(ui: DashboardUi) {
  fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.dashboard }))
  const section = ui.getByRole('region', { name: UI_TEXT.nodeLabels.dashboard })
  return { section, view: within(section) }
}

describe('node dashboard page', () => {
  it('reads the node and renders its readings, sessions and workspaces', async () => {
    const { ui, request } = await fixture()
    const { section, view } = openDashboard(ui)
    expect(await view.findByText('0.19.0')).not.toBeNull()
    const text = () => section.textContent
    for (const expected of [
      formatPercent(12.5),
      'a'.repeat(64),
      formatUnit(1, 'hour'),
      formatBytes(1500),
      formatBytes(8000),
      formatBytes(2500),
      formatBytes(9000),
      UI_TEXT.nodeLabels.sealed,
      UI_TEXT.nodeDashboard.sessionWeb,
      formatDateTime(2000),
      'home',
      'workspace',
      UI_TEXT.nodeDashboard.trusted,
      UI_TEXT.nodeMessages.sharedSandbox,
    ]) {
      expect(text()).toContain(expected)
    }
    expect(request.calls.some(([method]) => method === 'node/dashboard/read')).toBe(true)
  })

  it('refreshes from the node instead of its first answer', async () => {
    const { ui, state } = await fixture()
    const { view } = openDashboard(ui)
    expect(await view.findByText('0.19.0')).not.toBeNull()
    state.version = '0.19.1'
    fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeWorkspace.refresh }))
    expect(await view.findByText('0.19.1')).not.toBeNull()
  })

  it('names the empty node honestly', async () => {
    const { ui, state } = await fixture()
    state.sessions = false
    state.workspaces = false
    const { section, view } = openDashboard(ui)
    expect(await view.findByText(UI_TEXT.nodeDashboard.noSessions)).not.toBeNull()
    expect(section.textContent).toContain(UI_TEXT.nodeDashboard.noWorkspaces)
    expect(section.textContent).toContain(UI_TEXT.nodeLabels.unattended)
  })
})

describe('node whats-new page', () => {
  it('heads the entries with the running version', async () => {
    const { ui, state } = await fixture()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWhatsNew.title }))
    const section = ui.getByRole('region', { name: UI_TEXT.nodeWhatsNew.title })
    const view = within(section)
    expect(view.getAllByRole('listitem')).toHaveLength(4)
    await waitFor(() => {
      expect(section.textContent).toContain('0.19.0')
    })
    state.version = '0.19.1'
    fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeWorkspace.refresh }))
    await waitFor(() => {
      expect(section.textContent).toContain('0.19.1')
    })
  })
})

describe('node help page', () => {
  it('covers every workspace content page', async () => {
    const { ui } = await fixture()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeHelp.title }))
    const section = ui.getByRole('region', { name: UI_TEXT.nodeHelp.title })
    const view = within(section)
    for (const page of [
      UI_TEXT.nodeLabels.files,
      UI_TEXT.nodeLabels.terminal,
      UI_TEXT.nodeLabels.dashboard,
      UI_TEXT.nodeLabels.audit,
      UI_TEXT.nodeLabels.git,
    ]) {
      expect(view.getByRole('heading', { name: page })).not.toBeNull()
    }
    expect(view.getByText(UI_TEXT.nodeHelp.sandbox)).not.toBeNull()
  })
})
