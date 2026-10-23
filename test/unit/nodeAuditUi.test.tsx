/** @vitest-environment jsdom */
import { fireEvent, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NodePageError } from '../../src/webview/bridges/nodePort'
import { NODE_PROTOCOL_VERSION, UI_TEXT } from '../../src/shared/constants'
import type { NodeMethodName } from '../../src/shared/hostApi/nodeMethods'
import { cleanupNodeUi, mountNodeUi } from './helpers/nodeUi'

function base(seq: number, outcome: string) {
  return {
    v: NODE_PROTOCOL_VERSION,
    seq,
    time: 1000 + seq,
    nodeId: 'a'.repeat(64),
    sessionId: null,
    previousHash: 'b'.repeat(64),
    hash: 'c'.repeat(64),
    outcome,
  }
}

const PAGES: Record<string, { entries: unknown[]; nextCursor: string | null }> = {
  null: {
    entries: [
      {
        ...base(9, 'allowed'),
        kind: 'git',
        workspaceId: 'repo',
        action: 'push',
        actionDigest: 'd'.repeat(64),
      },
      { ...base(8, 'denied'), kind: 'node', action: 'wipe' },
      {
        ...base(7, 'allowed'),
        kind: 'approval',
        requestId: 'request',
        actionDigest: 'e'.repeat(64),
        paid: true,
      },
    ],
    nextCursor: '7',
  },
  '7': {
    entries: [
      {
        ...base(6, 'allowed'),
        kind: 'terminal',
        terminalId: 'term',
        workspaceId: 'repo',
        phase: 'end',
        inputBytes: 100,
        outputBytes: 200,
        source: 'model',
      },
      { ...base(5, 'verified'), kind: 'stepUp', actionDigest: 'f'.repeat(64) },
      {
        ...base(4, 'allowed'),
        kind: 'key',
        action: 'seal',
        keyKind: 'deploy',
      },
    ],
    nextCursor: '4',
  },
  '4': {
    entries: [
      {
        ...base(3, 'allowed'),
        kind: 'signin',
        action: 'signin',
        credentialIdHash: 'a'.repeat(64),
      },
      {
        ...base(2, 'allowed'),
        kind: 'signin',
        action: 'enroll',
        credentialIdHash: 'b'.repeat(64),
      },
      {
        ...base(1, 'denied'),
        kind: 'signin',
        action: 'lockout',
        credentialIdHash: 'c'.repeat(64),
      },
    ],
    nextCursor: null,
  },
}

function respond(method: NodeMethodName, input: unknown): Promise<unknown> {
  switch (method) {
    case 'node/files/list': {
      return Promise.resolve({ entries: [], nextCursor: null })
    }
    case 'node/audit/list': {
      const cursor = (input as { cursor: string | null }).cursor
      const page = PAGES[String(cursor)]
      return page === undefined
        ? Promise.reject(new NodePageError('invalidRequest'))
        : Promise.resolve(page)
    }
    default: {
      return Promise.reject(new NodePageError('unavailable'))
    }
  }
}

async function fixture() {
  const { ui, request } = await mountNodeUi(respond)
  fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeLabels.audit }))
  const section = ui.getByRole('region', { name: UI_TEXT.nodeLabels.audit })
  const view = within(section)
  await waitFor(() => {
    expect(view.getAllByRole('listitem')).toHaveLength(3)
  })
  return { ui, view, section, request }
}

afterEach(cleanupNodeUi)

type AuditView = Awaited<ReturnType<typeof fixture>>['view']

async function pageTwice(view: AuditView): Promise<void> {
  fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeAudit.more }))
  await waitFor(() => {
    expect(view.getAllByRole('listitem')).toHaveLength(6)
  })
  fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeAudit.more }))
  await waitFor(() => {
    expect(view.getAllByRole('listitem')).toHaveLength(9)
  })
}

describe('node audit page', () => {
  it('lists newest first with the action, outcome and paid flag', async () => {
    const { view, section } = await fixture()
    const items = view.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    const text = section.textContent
    expect(text.indexOf(UI_TEXT.nodeAudit.gitPush)).toBeLessThan(
      text.indexOf(UI_TEXT.nodeLabels.wipe),
    )
    expect(items[1]?.textContent).toContain(UI_TEXT.nodeAudit.refused)
    expect(items[2]?.textContent).toContain(UI_TEXT.nodeAudit.approvalPaid)
    expect(items[2]?.textContent).toContain(UI_TEXT.nodeAudit.allowed)
  })

  it('pages older entries with the returned cursor', async () => {
    const { view, request } = await fixture()
    await pageTwice(view)
    expect(view.queryByRole('button', { name: UI_TEXT.nodeAudit.more })).toBeNull()
    expect(
      request.calls.filter(([method]) => method === 'node/audit/list').map(([, input]) => input),
    ).toEqual([{ cursor: null }, { cursor: '7' }, { cursor: '4' }])
  })

  it('filters to one stream without re-reading', async () => {
    const { view, request } = await fixture()
    await pageTwice(view)
    const reads = request.calls.filter(([method]) => method === 'node/audit/list').length

    fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeAudit.filterTerminal }))
    expect(view.getAllByRole('listitem')).toHaveLength(1)
    expect(view.getByRole('listitem').textContent).toContain(UI_TEXT.nodeLabels.terminalModel)

    fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeAudit.filterSignup }))
    expect(view.getAllByRole('listitem')).toHaveLength(1)
    expect(view.getByRole('listitem').textContent).toContain(UI_TEXT.nodeAudit.signinEnroll)

    // Sign-ins carry the verifications; only enrollments split out.
    fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeAudit.filterSignin }))
    expect(view.getAllByRole('listitem')).toHaveLength(3)
    const text = view.getByRole('list').textContent
    expect(text).toContain(UI_TEXT.nodeAudit.signinSignin)
    expect(text).toContain(UI_TEXT.nodeAudit.kindStepUp)
    expect(text).toContain(UI_TEXT.nodeAudit.signinLockout)
    expect(text).not.toContain(UI_TEXT.nodeAudit.signinEnroll)

    fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeAudit.filterAll }))
    expect(view.getAllByRole('listitem')).toHaveLength(9)
    expect(request.calls.filter(([method]) => method === 'node/audit/list')).toHaveLength(reads)
  })

  it('reads a verified step-up as allowed and never duplicates on refresh', async () => {
    const { view } = await fixture()
    fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeAudit.more }))
    await waitFor(() => {
      expect(view.getAllByRole('listitem')).toHaveLength(6)
    })
    const items = view.getAllByRole('listitem')
    const stepUp = items.find((item) => item.textContent.includes(UI_TEXT.nodeAudit.kindStepUp))
    expect(stepUp?.textContent).toContain(UI_TEXT.nodeAudit.allowed)
    fireEvent.click(view.getByRole('button', { name: UI_TEXT.nodeWorkspace.refresh }))
    await waitFor(() => {
      expect(view.getAllByRole('listitem')).toHaveLength(6)
    })
  })
})
