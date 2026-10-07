// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultSection, tierWarning } from '../../../src/webview/models/sections/vault/VaultSection'
import { VaultSurface } from '../../../src/webview/models/sections/vault/VaultSurface'
import { VaultApprovalCard } from '../../../src/webview/components/VaultApprovalCard'
import { VaultGrantEditor } from '../../../src/webview/models/sections/vault/VaultGrantEditor'
import { type VaultUse, type VaultApprovalRequest } from '../../../src/shared/vault'
import { setUiText } from '../../../src/shared/l10n/text'
import { EN } from '../../../src/shared/l10n/en'
import { UI_TEXT } from '../../../src/shared/constants'
import { panel, approval, metadata, grant, audit, use } from '../helpers/vault/fixtures'
import { testSettings } from '../helpers/fakes'
import { App } from '../../../src/webview/App'

const fingerprint = 'SHA256:' + 'A'.repeat(43)
const command = use().command
const uses: VaultUse[] = [
  {
    kind: 'ssh',
    host: 'host.test',
    hostKeyFingerprint: fingerprint,
    remoteUser: 'deploy',
    sessionId: 'YQ==',
    forwarding: false,
  },
  { kind: 'sshSign', keyFingerprint: fingerprint, namespace: 'git', dataDigest: 'c'.repeat(64) },
  { kind: 'sudo', command, sudoPath: '/usr/bin/sudo' },
  { kind: 'askpass', command, sudoPath: '/usr/bin/sudo' },
  { kind: 'git', command, protocol: 'https', host: 'git.test', path: 'repo' },
  use(),
  { kind: 'stdin', command },
  { kind: 'totp', command },
  { kind: 'mcp', command, server: 'my-server', names: ['SERVICE_TOKEN'] },
  { kind: 'header', origin: 'https://api.test', headerName: 'Authorization' },
  {
    kind: 'oauth',
    origin: 'https://api.test',
    issuer: 'https://issuer.test/path/',
    resource: 'https://api.test/resource',
  },
  {
    kind: 'fill',
    origin: 'https://login.test',
    topOrigin: 'https://login.test',
    frameOrigin: 'https://login.test',
    frameId: 'frame',
    browserId: 'd'.repeat(32),
    certificateValid: true,
    field: 'password',
  },
  { kind: 'session', origin: 'https://login.test', browserId: 'd'.repeat(32) },
  { kind: 'disclosure', recipient: 'person' },
]
afterEach(() => {
  vi.useRealTimers()
  setUiText(EN, 'en')
})

describe('U approval cards', () => {
  it.each(uses.map((value) => [value.kind, value] as const))(
    'shows the exact %s use and returns only the bound answer',
    (_kind, value) => {
      const request = { ...approval(), use: value }
      const answer = vi.fn()
      render(
        <VaultApprovalCard
          request={request}
          now={() => 1000}
          onAnswer={answer}
          onManage={vi.fn()}
        />,
      )
      for (const [key, field] of Object.entries(value)) {
        if (typeof field === 'string') expect(screen.getByRole('article')).toHaveTextContent(field)
        if (key !== 'command') continue
        expect(screen.getByRole('article')).toHaveTextContent(command.executable)
        expect(screen.getByRole('article')).toHaveTextContent(command.cwd)
      }
      expect(screen.queryByRole('button', { name: UI_TEXT.vault.alwaysAllow })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.allowOnce }))
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        requestId: request.id,
        digest: request.digest,
        decision: 'allowOnce',
      })
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.allowOnce }))
      expect(answer).toHaveBeenCalledOnce()
      if ('command' in value)
        expect(screen.getByText(UI_TEXT.vault.processWarning)).toBeInTheDocument()
      if (value.kind === 'disclosure')
        expect(screen.getByText(UI_TEXT.vault.disclosureWarning)).toBeInTheDocument()
    },
  )
  it('V1 V11 only offers session consent for an eligible broker snapshot', () => {
    const request = approval()
    request.item.policy.mode = 'askOncePerSession'
    const f = render(
      <VaultApprovalCard request={request} now={() => 0} onAnswer={vi.fn()} onManage={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: UI_TEXT.vault.allowSession })).toBeInTheDocument()
    const blocked: VaultApprovalRequest[] = [
      { ...request, taint: { tainted: true, reasons: [{ source: 'web', label: 'page' }] } },
      { ...request, use: { kind: 'disclosure', recipient: 'person' } },
      { ...request, requester: { ...request.requester, sessionId: null } },
      {
        ...request,
        item: { ...request.item, policy: { ...request.item.policy, mode: 'alwaysAllow' } },
      },
    ]
    for (const changed of blocked) {
      f.rerender(
        <VaultApprovalCard request={changed} now={() => 0} onAnswer={vi.fn()} onManage={vi.fn()} />,
      )
      expect(screen.queryByRole('button', { name: UI_TEXT.vault.allowSession })).toBeNull()
    }
  })
  it('V11 deadline disables the card and a late click never answers', () => {
    vi.useFakeTimers()
    let time = 0
    const answer = vi.fn()
    const now = () => time
    render(
      <VaultApprovalCard request={approval()} now={now} onAnswer={answer} onManage={vi.fn()} />,
    )
    time = 120_000
    // Dispatch checks actual time even between timer ticks.
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.allowOnce }))
    expect(answer).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('button', { name: UI_TEXT.allowOnce })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.vault.approvalExpired)
  })
  it('V4 presence, unproven SSH destination and taint are shown; Manage never grants', () => {
    const request = approval()
    request.item.requirePresence = true
    request.use = {
      kind: 'ssh',
      host: 'host.test',
      remoteUser: 'deploy',
      hostKeyFingerprint: null,
      sessionId: null,
      forwarding: true,
    }
    request.taint = { tainted: true, reasons: [{ source: 'web', label: 'Outside page' }] }
    const answer = vi.fn()
    const manage = vi.fn()
    render(
      <VaultApprovalCard request={request} now={() => 0} onAnswer={answer} onManage={manage} />,
    )
    expect(screen.getByText(UI_TEXT.vault.presenceWarning)).toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.vault.noDestination)).toBeInTheDocument()
    expect(screen.getByText(/Outside page/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.vault.manage }))
    expect(manage).toHaveBeenCalledOnce()
    expect(answer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.paidDeny }))
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ decision: 'deny' }))
  })
})

describe('U Vault section', () => {
  it('V8 uses host password entry messages and offers clipboard only for public SSH keys', () => {
    const state = panel()
    state.items.push({
      ...metadata(),
      id: 'f'.repeat(32),
      name: 'ssh',
      handle: 'secret://ssh',
      kind: 'sshKey',
      publicKey: 'ssh-ed25519 public',
    })
    const post = vi.fn()
    render(<VaultSection state={state} post={post} />)
    expect(screen.queryByLabelText(UI_TEXT.vault.value)).toBeNull()
    expect(screen.queryByLabelText(UI_TEXT.vault.password)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.vault.add }))
    expect(post).toHaveBeenLastCalledWith({ type: 'vaultAdd' })
    const first = screen.getAllByText(UI_TEXT.vault.edit)[0]!
    fireEvent.click(first)
    expect(post).toHaveBeenLastCalledWith({ type: 'vaultEdit', itemId: metadata().id })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.vault.publicKey }))
    expect(post).toHaveBeenLastCalledWith({ type: 'vaultPublicKey', itemId: 'f'.repeat(32) })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.vault.lock }))
    expect(post).toHaveBeenLastCalledWith({ type: 'vaultLock' })
  })
  it('V6 banners name every tier, same-user silent unlock limits and failure reason', () => {
    const status = panel().status
    for (const tier of ['presence'] as const)
      expect(tierWarning({ ...status, tier })).toBe(UI_TEXT.vault.presenceTierWarning)
    expect(tierWarning({ ...status, tier: 'passphrase' })).toBe(UI_TEXT.vault.passphraseWarning)
    expect(tierWarning({ ...status, tier: 'recovery' })).toBe(UI_TEXT.vault.recoveryWarning)
    expect(tierWarning({ ...status, tier: 'hardware' })).toBe(UI_TEXT.vault.hardwareWarning)
    for (const tier of ['osStore', 'secretStorage'] as const)
      expect(tierWarning({ ...status, tier })).toBe(UI_TEXT.vault.osStoreWarning)
    for (const reason of [
      'brokerBlocked',
      'rollback',
      'basicText',
      'auditInvalid',
      'slotUnavailable',
    ] as const)
      expect(tierWarning({ ...status, reason })).toBe(UI_TEXT.vault[reason])
  })
  it('V16 locked state disables management, exposes Unlock and holds no cards', async () => {
    const state = panel()
    state.status.state = 'locked'
    state.pending = [approval()]
    const post = vi.fn()
    render(<VaultSurface raw={{ type: 'vaultState', state }} post={post} onManage={vi.fn()} />)
    await screen.findByRole('button', { name: UI_TEXT.vault.unlock })
    expect(screen.getByRole('button', { name: UI_TEXT.vault.add })).toBeDisabled()
    expect(screen.queryByRole('article')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.vault.unlock }))
    expect(post).toHaveBeenLastCalledWith({ type: 'vaultUnlock' })
  })
  it('V9 rejects a malformed snapshot before rendering any item or action', () => {
    const post = vi.fn()
    render(
      <VaultSurface
        raw={{ type: 'vaultState', state: { ...panel(), secret: 'planted' } }}
        post={post}
        onManage={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.vault.operationFailed)
    expect(screen.queryByText(metadata().label)).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
  it('shows every grant scope, audit field and filters item, requester, kind and outcome', () => {
    const state = panel()
    state.grants[0] = {
      ...grant(),
      window: { days: [1, 2], startHour: 9, endHour: 17 },
      sessionId: 'b'.repeat(32),
      taskId: 'task',
      expiresAt: 10_000,
    }
    state.audit.push({ ...audit(), id: 'e'.repeat(32), kind: 'ssh', outcome: 'succeeded' })
    render(<VaultSection state={state} post={vi.fn()} />)
    for (const field of [
      'orchestrator',
      'workspace',
      'SERVICE_TOKEN',
      'startHour',
      'task',
      'vaultPanel',
    ])
      expect(screen.getAllByText(new RegExp(field)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/startHour/).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText(UI_TEXT.vault.kind), { target: { value: 'ssh' } })
    expect(screen.getAllByText('redacted target')).toHaveLength(1)
    const records = screen.getAllByText('succeeded', { exact: false })
    expect(records.length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText(UI_TEXT.vault.outcome), { target: { value: 'pending' } })
    expect(screen.queryByText('redacted target')).toBeNull()
  })
  it('uses installed translations at render time and mounts cards in the chat transcript', () => {
    setUiText({ ...EN, vault: { ...EN.vault, title: 'Installed vault' } }, 'en')
    const cards = (
      <VaultApprovalCard request={approval()} now={() => 0} onAnswer={vi.fn()} onManage={vi.fn()} />
    )
    render(<App postMessage={vi.fn()} vaultApprovals={cards} />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'init',
            settings: testSettings,
            emptyStateHint: '',
            composerPlaceholder: '',
          },
        }),
      )
    })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'authState', status: 'signedIn' } }),
      )
    })
    expect(within(screen.getByRole('main')).getByRole('article')).toBeInTheDocument()
  })
  it('V12 validates complete grant scopes and cannot mint an open-ended sudo target', () => {
    const saved = vi.fn()
    const item = { ...metadata(), bindings: [grant().target] }
    render(
      <VaultGrantEditor
        items={[item]}
        onSave={saved}
        onClose={vi.fn()}
        now={() => 1000}
        newId={() => 'e'.repeat(32)}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Workspaces/), { target: { value: 'workspace' } })
    fireEvent.change(screen.getByLabelText(/Use count/), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/Days/), { target: { value: '1\n2' } })
    fireEvent.change(screen.getByLabelText(/endHour/), { target: { value: '17' } })
    fireEvent.submit(screen.getByRole('button', { name: UI_TEXT.vault.grant }).closest('form')!)
    expect(saved).toHaveBeenCalledOnce()
    expect(saved.mock.calls[0]![0]).toMatchObject({
      maxUses: 2,
      uses: 0,
      roles: [{ kind: 'orchestrator' }],
      workspaces: ['workspace'],
      window: { days: [1, 2], startHour: 0, endHour: 17 },
      createdBy: 'vaultPanel',
    })
    fireEvent.change(screen.getByLabelText(/Use count/), { target: { value: '0' } })
    fireEvent.submit(screen.getByRole('button', { name: UI_TEXT.vault.grant }).closest('form')!)
    expect(saved).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.vault.invalidFields)
  })
})
