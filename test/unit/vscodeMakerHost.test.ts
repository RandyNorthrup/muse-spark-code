import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type * as vscode from 'vscode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MakerApproval } from '../../src/core/maker/ports'
import { MakerApprovalReceipt } from '../../src/host/maker/makerApprovalReceipt'
import { MakerPreviewPanel } from '../../src/host/maker/makerPreviewPanel'
import { createVscodeMakerHost, type VscodeMakerDeps } from '../../src/host/maker/vscodeMakerHost'
import { MAKER_COMMANDS, MAKER_MODAL_MAX_CHARS, UI_TEXT } from '../../src/shared/constants'
import type { ApprovalRequest, MakerMachineSummary } from '../../src/shared/makerProtocol'
import { FakeLogOutputChannel, FakeWebviewPanel, fakeHostContext } from './helpers/fakes'
import { memento } from './helpers/memento'
import { EventEmitter, FakeStatusBarItem, Uri, window, workspace } from './mocks/vscode'

const modal: (
  message: string,
  options: vscode.MessageOptions,
  ...items: vscode.MessageItem[]
) => Thenable<vscode.MessageItem | undefined> = window.showWarningMessage
const directories: string[] = []
const hosts: { dispose(): void }[] = []

function request(): ApprovalRequest {
  const payload = 'flash exact bytes'
  return {
    kind: 'command',
    id: randomUUID(),
    digest: createHash('sha256').update(payload).digest('hex'),
    target: {
      kind: 'serial',
      port: '/dev/ttyACM0',
      vid: '303a',
      pid: '1001',
      serialNumber: 'board-one',
      stablePath: '/dev/serial/by-id/board-one',
    },
    expiresAt: Date.now() + 10_000,
    action: 'program',
    payload,
  }
}
function longRequest(): Extract<ApprovalRequest, { kind: 'command' }> {
  const payload = 'G1 X1\n'.repeat(34)
  return {
    ...request(),
    kind: 'command',
    payload,
    digest: createHash('sha256').update(payload).digest('hex'),
  }
}
async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm103v-'))
  directories.push(root)
  const workspaceValues = new Map<string, unknown>()
  const machineValues = new Map<string, unknown>()
  const getSecret = vi
    .fn<(name: string) => Promise<string | undefined>>()
    .mockResolvedValue(undefined)
  const storeSecret = vi
    .fn<(name: string, value: string) => Promise<void>>()
    .mockResolvedValue(undefined)
  const deleteSecret = vi.fn<(name: string) => Promise<void>>().mockResolvedValue(undefined)
  const state = { hardware: true, interactive: true }
  const deps: VscodeMakerDeps = {
    context: {
      storageUri: Uri.file(path.join(root, 'workspace')),
      globalStorageUri: Uri.file(path.join(root, 'global')),
      workspaceState: {
        ...memento(workspaceValues),
        keys: () => Array.from(workspaceValues, ([key]) => key),
      },
      globalState: {
        ...memento(machineValues),
        keys: () => Array.from(machineValues, ([key]) => key),
        setKeysForSync: vi.fn(),
      },
      secrets: {
        get: getSecret,
        store: storeSecret,
        delete: deleteSecret,
        onDidChange: new EventEmitter<vscode.SecretStorageChangeEvent>().event,
      },
    },
    log: new FakeLogOutputChannel(),
    hardwareEnabled: () => state.hardware,
    isInteractive: () => state.interactive,
    stop: vi.fn<(id?: string) => Promise<void>>().mockResolvedValue(undefined),
    openPreview: vi.fn<VscodeMakerDeps['openPreview']>().mockResolvedValue(undefined),
    openApprovalPreview: vi
      .fn<VscodeMakerDeps['openApprovalPreview']>()
      .mockImplementation((input) => {
        const receipt = new MakerApprovalReceipt(input.id, input.digest, vi.fn())
        receipt.rendered(input.id, input.digest)
        return Promise.resolve(receipt)
      }),
  }
  const host = await createVscodeMakerHost(deps)
  hosts.push(host)
  return { host, deps, state, workspaceValues, machineValues, getSecret, storeSecret, deleteSecret }
}
async function previewHarness() {
  const fixture = await harness()
  const port = new MakerPreviewPanel({ ...fakeHostContext(), stop: fixture.deps.stop })
  hosts.push(port)
  vi.mocked(fixture.deps.openPreview).mockImplementation(async (input) => {
    await port.open(input)
  })
  vi.mocked(fixture.deps.openApprovalPreview).mockImplementation(
    async (input, signal) => await port.openApproval(input, signal),
  )
  return fixture
}
beforeEach(() => {
  workspace.isTrusted = true
  workspace.workspaceFolders = undefined
  vi.mocked(modal).mockReset()
  window.showInformationMessage.mockReset()
  window.showErrorMessage.mockReset()
  window.createStatusBarItem.mockReset()
  window.createWebviewPanel.mockReset()
  window.createWebviewPanel.mockImplementation((type, title) => new FakeWebviewPanel(type, title))
})
afterEach(async () => {
  for (const host of hosts.splice(0)) host.dispose()
  vi.useRealTimers()
  await Promise.all(
    directories.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  )
})

async function expectSettled(pending: Promise<unknown>): Promise<void> {
  const state = { isSettled: false }
  void pending.then(() => {
    state.isSettled = true
  })
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
  expect(state.isSettled).toBe(true)
  expect(await pending).toBeUndefined()
}

describe('VS Code maker port', () => {
  it('waits for exact rendered payload delivery before offering native Send once', async () => {
    const { host, deps } = await previewHarness()
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    const input = longRequest()
    const approval = new MakerApproval(input, () => true)
    const pending = host.confirm(approval.request, (raw) => approval.review(raw))
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(modal).not.toHaveBeenCalled()
    const view = window.createWebviewPanel.mock.results.at(-1)?.value
    if (!(view instanceof FakeWebviewPanel)) throw new Error('missing approval preview')
    expect(view.webview.postMessage).not.toHaveBeenCalled()
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(modal).not.toHaveBeenCalled()
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      v: 1,
      type: 'makerApprovalPreview',
      request: input,
    })
    view.webview.messages.fire({
      v: 1,
      type: 'makerPreviewRendered',
      id: input.id,
      digest: input.digest,
    })
    const answer = await pending
    expect(answer).toMatchObject({ digest: input.digest, decision: 'allow_once' })
    expect(approval.answer(answer)).toBeDefined()
    const receipt: unknown = await vi.mocked(deps.openApprovalPreview).mock.results[0]?.value
    if (!(receipt instanceof MakerApprovalReceipt)) throw new Error('missing decided receipt')
    expect(receipt.state).toBe('decided')
    expect(receipt.decide(input.id, input.digest)).toBe(false)
  })
  it('withdraws A after rendering B and denies late Send once and engine consumption', async () => {
    const { host } = await previewHarness()
    const choice = Promise.withResolvers<vscode.MessageItem | undefined>()
    vi.mocked(modal).mockReturnValue(choice.promise)
    const input = longRequest()
    const approval = new MakerApproval(input, () => true)
    const pending = host.confirm(approval.request, (raw) => approval.review(raw))
    const view = window.createWebviewPanel.mock.results.at(-1)?.value
    if (!(view instanceof FakeWebviewPanel)) throw new Error('missing approval preview')
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    view.webview.messages.fire({
      v: 1,
      type: 'makerPreviewRendered',
      id: input.id,
      digest: input.digest,
    })
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(modal).toHaveBeenCalledOnce()
    view.webview.messages.fire({
      v: 1,
      type: 'makerPreviewRendered',
      id: input.id,
      digest: createHash('sha256').update('G1 X200\n'.repeat(34)).digest('hex'),
    })
    choice.resolve(vi.mocked(modal).mock.calls[0]?.[2])
    const answer = await pending
    const binding = approval.answer(answer)
    expect(
      approval.consume(
        binding ?? {
          requestId: input.id,
          digest: input.digest,
          target: input.target,
          expiresAt: input.expiresAt,
        },
        input.target,
      ),
    ).toBe(false)
    expect(answer).toBeUndefined()
  })
  it.each(['close', 'reload'])(
    'keeps each pending approval preview immutable and cancels on %s before a late Send once',
    async (event) => {
      const { host } = await previewHarness()
      const answers = [
        Promise.withResolvers<vscode.MessageItem | undefined>(),
        Promise.withResolvers<vscode.MessageItem | undefined>(),
      ]
      vi.mocked(modal).mockImplementation(
        () =>
          answers[vi.mocked(modal).mock.calls.length - 1]?.promise ?? Promise.resolve(undefined),
      )
      const requests = ['A', 'B'].map((name) => {
        const payload = `${name}\n`.repeat(34)
        return {
          ...request(),
          kind: 'command',
          payload,
          digest: createHash('sha256').update(payload).digest('hex'),
        } as const
      })
      const inputA = requests[0]
      const inputB = requests[1]
      if (inputA === undefined || inputB === undefined) throw new Error('missing requests')
      const pendingA = host.confirm(inputA)
      const first = window.createWebviewPanel.mock.results.at(-1)?.value
      if (!(first instanceof FakeWebviewPanel)) throw new Error('missing first preview')
      first.webview.messages.fire({ v: 1, type: 'makerReady' })
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
      first.webview.messages.fire({
        v: 1,
        type: 'makerPreviewRendered',
        id: inputA.id,
        digest: inputA.digest,
      })
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
      const approvalB = new MakerApproval(inputB, () => true)
      const pendingB = host.confirm(approvalB.request, (raw) => approvalB.review(raw))
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(2)
      const second = window.createWebviewPanel.mock.results.at(-1)?.value
      if (!(second instanceof FakeWebviewPanel)) throw new Error('missing second preview')
      second.webview.messages.fire({ v: 1, type: 'makerReady' })
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
      second.webview.messages.fire({
        v: 1,
        type: 'makerPreviewRendered',
        id: inputB.id,
        digest: inputB.digest,
      })
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
      expect(first.webview.postMessage).toHaveBeenCalledOnce()
      expect(first.webview.postMessage).toHaveBeenLastCalledWith({
        v: 1,
        type: 'makerApprovalPreview',
        request: inputA,
      })
      if (event === 'close') first.dispose()
      else first.webview.messages.fire({ v: 1, type: 'makerReady' })
      await expectSettled(pendingA)
      answers[0]?.resolve(vi.mocked(modal).mock.calls[0]?.[2])
      answers[1]?.resolve(vi.mocked(modal).mock.calls[1]?.[2])
      expect(await pendingB).toMatchObject({
        id: inputB.id,
        digest: inputB.digest,
        decision: 'allow_once',
      })
    },
  )
  it('expires an undelivered approval preview and ignores late Ready and acknowledgement', async () => {
    const { host } = await previewHarness()
    vi.useFakeTimers()
    const input = longRequest()
    const pending = host.confirm(input)
    const view = window.createWebviewPanel.mock.results.at(-1)?.value
    if (!(view instanceof FakeWebviewPanel)) throw new Error('missing approval preview')
    await vi.advanceTimersByTimeAsync(10_000)
    await expectSettled(pending)
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    view.webview.messages.fire({
      v: 1,
      type: 'makerPreviewRendered',
      id: input.id,
      digest: input.digest,
    })
    await Promise.resolve()
    expect(view.webview.postMessage).not.toHaveBeenCalled()
    expect(modal).toHaveBeenCalledWith(UI_TEXT.makerPreviewWithdrawn)
  })
  it('refuses a trunk digest that differs from the displayed bytes', async () => {
    const { host } = await harness()
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    const input = { ...request(), digest: 'b'.repeat(64) }
    const approval = new MakerApproval(input, () => true)
    expect(approval.answer(await host.confirm(approval.request))).toBeUndefined()
    expect(modal).not.toHaveBeenCalled()
  })
  it.each(['id', 'digest', 'closed', 'changedDigest'])(
    'refuses a preview receipt with %s at native decision time',
    async (fault) => {
      const { host, deps } = await harness()
      const input = longRequest()
      const receipt = new MakerApprovalReceipt(
        fault === 'id' ? randomUUID() : input.id,
        fault === 'digest' ? 'b'.repeat(64) : input.digest,
        vi.fn(),
      )
      receipt.rendered(receipt.id, receipt.digest)
      if (fault === 'closed') receipt.revoke()
      const disposed = vi.spyOn(receipt, 'dispose')
      vi.mocked(deps.openApprovalPreview).mockResolvedValue(receipt)
      vi.mocked(modal).mockImplementation((_message, _options, ...items) => {
        if (fault === 'changedDigest') receipt.rendered(input.id, 'b'.repeat(64))
        return Promise.resolve(items[0])
      })
      expect(await host.confirm(input)).toBeUndefined()
      expect(disposed).toHaveBeenCalled()
      if (fault !== 'changedDigest') expect(modal).not.toHaveBeenCalled()
    },
  )
  it('delivers passive notices and failed Stop without waiting for dismissal', async () => {
    const { host, deps } = await harness()
    const toast = Promise.withResolvers<undefined>()
    vi.mocked(modal).mockReturnValue(toast.promise)
    window.showInformationMessage.mockReturnValue(toast.promise)
    window.showErrorMessage.mockReturnValue(toast.promise)
    try {
      await expectSettled(host.notify('sentOutcomeUnknown'))
      await expectSettled(host.notify({ type: 'makerNotice', level: 'info', message: 'info' }))
      await expectSettled(host.notify({ type: 'makerNotice', level: 'error', message: 'error' }))
      vi.mocked(deps.stop).mockRejectedValue(new Error('stop failed'))
      const failure = (async () => {
        try {
          await host.stop()
          return undefined
        } catch (error: unknown) {
          return error
        }
      })()
      const state = { settled: false }
      void failure.then(() => {
        state.settled = true
      })
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
      expect(state.settled).toBe(true)
      expect(await failure).toEqual(new Error(UI_TEXT.makerUnavailable))
    } finally {
      toast.resolve(undefined)
    }
  })

  it('shows the complete target and payload and offers only Send once and Reject', async () => {
    const { host } = await harness()
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    const approval = new MakerApproval(request(), () => true)
    const answer = await host.confirm(approval.request, (raw) => approval.review(raw))
    const call = vi.mocked(modal).mock.calls[0]
    expect(call?.[1].modal).toBe(true)
    expect(call?.[1].detail).toContain(
      approval.request.kind === 'command' ? approval.request.payload : '',
    )
    expect(call?.[1].detail).toContain('board-one')
    expect(call?.[1].detail).toContain('303a')
    expect(call?.slice(2)).toEqual([
      { title: UI_TEXT.makerSendOnce },
      { title: UI_TEXT.makerReject, isCloseAffordance: true },
    ])
    const binding = approval.answer(answer)
    expect(binding).toBeDefined()
    if (binding === undefined) throw new Error('test binding missing')
    expect(approval.consume(binding, approval.request.target)).toBe(true)
    expect(approval.consume(binding, approval.request.target)).toBe(false)
    expect(approval.answer(answer)).toBeUndefined()
  })
  it.each(['trust', 'hardware', 'interactive', 'expiry', 'disposed'])(
    'refuses %s before any UI',
    async (kind) => {
      const { host, state } = await harness()
      const input = request()
      switch (kind) {
        case 'trust': {
          workspace.isTrusted = false
          break
        }
        case 'hardware': {
          state.hardware = false
          break
        }
        case 'interactive': {
          state.interactive = false
          break
        }
        case 'expiry': {
          Reflect.set(input, 'expiresAt', Date.now())
          break
        }
        case 'disposed': {
          {
            host.dispose()
            // No default
          }
          break
        }
      }
      expect(await host.confirm(input)).toBeUndefined()
      expect(modal).not.toHaveBeenCalled()
    },
  )
  it('keeps the displayed approval detached from caller edits and rejects another request or a swapped device', async () => {
    const { host } = await harness()
    const input = request()
    const approval = new MakerApproval(input, () => true)
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => {
      Reflect.set(input, 'digest', 'b'.repeat(64))
      Reflect.set(input.target, 'port', '/dev/ttyACM1')
      return Promise.resolve(items[0])
    })
    const answer = await host.confirm(input, (raw) => approval.review(raw))
    expect(answer).toMatchObject({
      digest: approval.request.digest,
      target: approval.request.target,
    })
    const other = new MakerApproval(request(), () => true)
    expect(other.answer(answer)).toBeUndefined()
    const binding = approval.answer(answer)
    if (binding === undefined) throw new Error('test binding missing')
    expect(approval.consume(binding, { ...binding.target, port: '/dev/ttyACM1' })).toBe(false)
    expect(approval.consume(binding, binding.target)).toBe(false)
  })
  it('submits the exact shown review only on Send once and refuses without a matching review', async () => {
    const { host } = await harness()
    const approval = new MakerApproval(request(), () => true)
    const didReview = vi.fn((raw: unknown) => approval.review(raw))
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[1]))
    expect(await host.confirm(approval.request, didReview)).toMatchObject({
      decision: 'reject_once',
    })
    vi.mocked(modal).mockResolvedValue(undefined)
    expect(await host.confirm(approval.request, didReview)).toMatchObject({
      decision: 'reject_once',
    })
    expect(didReview).not.toHaveBeenCalled()
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    expect(await host.confirm(approval.request)).toBeUndefined()
    const other = new MakerApproval(request(), () => true)
    expect(await host.confirm(approval.request, (raw) => other.review(raw))).toBeUndefined()
    const answer = await host.confirm(approval.request, didReview)
    expect(didReview).toHaveBeenCalledExactlyOnceWith({
      v: 1,
      type: 'makerPayloadReviewed',
      id: approval.request.id,
      digest: approval.request.digest,
      isComplete: true,
    })
    expect(approval.answer(answer)).toBeDefined()
    const unreviewed = new MakerApproval(request(), () => true)
    expect(unreviewed.answer(await host.confirm(unreviewed.request))).toBeUndefined()
  })
  it('shows serial encoding/reset/flash identity and complete machine analysis', async () => {
    const { host } = await harness()
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    const serial: ApprovalRequest = {
      kind: 'serial',
      action: 'connect',
      id: randomUUID(),
      digest: createHash('sha256').update(Buffer.from('00ff', 'hex')).digest('hex'),
      expiresAt: Date.now() + 10_000,
      target: { kind: 'serial', port: '/dev/ttyACM0' },
      payload: { encoding: 'hex', value: '00ff' },
      baud: 115_200,
      durationMs: 1000,
      dtr: false,
      rts: true,
      warnsAboutReset: true,
      flashIdentity: { status: 'unknown' },
    }
    const reviewed = new MakerApproval(serial, () => true)
    expect(await host.confirm(serial, (raw) => reviewed.review(raw))).toMatchObject({
      digest: serial.digest,
      decision: 'allow_once',
    })
    const approval = new MakerApproval(
      { ...serial, digest: createHash('sha256').update('00ff').digest('hex') },
      () => true,
    )
    expect(approval.answer(await host.confirm(approval.request))).toBeUndefined()
    expect(vi.mocked(modal).mock.calls.at(-1)?.[1].detail).toContain(UI_TEXT.makerResetWarning)
    expect(vi.mocked(modal).mock.calls.at(-1)?.[1].detail).toContain('"encoding":"hex"')
    expect(vi.mocked(modal).mock.calls.at(-1)?.[1].detail).toContain('00ff')
    const analysis = {
      classes: ['actuate'],
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 0, z: 0 } },
      maxFeedMmMin: 1200,
      temperatures: { extruder: 180 },
      unknown: [],
      refused: [],
      hasMotion: true,
    } as const
    const machine: ApprovalRequest = {
      kind: 'machine',
      action: 'actuate',
      id: randomUUID(),
      digest: createHash('sha256').update('G1 X10').digest('hex'),
      expiresAt: Date.now() + 10_000,
      target: {
        kind: 'machine',
        registrationId: randomUUID(),
        id: 'printer',
        name: 'Printer',
        endpoint: 'https://printer.lan',
        identity: 'printer-one',
      },
      payload: 'G1 X10',
      analysis,
    }
    await host.confirm(machine)
    expect(vi.mocked(modal).mock.calls.at(-1)?.[1].detail).toContain(
      JSON.stringify(analysis, null, 2),
    )
  })
  it.each(['trust', 'hardware', 'interactive', 'expiry'])(
    'rechecks %s after the user answers',
    async (kind) => {
      const { host, state } = await harness()
      vi.mocked(modal).mockImplementation((_message, _options, ...items) => {
        switch (kind) {
          case 'trust': {
            workspace.isTrusted = false
            break
          }
          case 'hardware': {
            state.hardware = false
            break
          }
          case 'interactive': {
            state.interactive = false
            break
          }
          case 'expiry': {
            vi.useFakeTimers()
            vi.setSystemTime(Date.now() + 10_000)

            break
          }
          // No default
        }
        return Promise.resolve(items[0])
      })
      expect(await host.confirm(request())).toBeUndefined()
    },
  )
  it('rejects close and Reject and refuses a malformed request', async () => {
    const { host } = await harness()
    vi.mocked(modal).mockResolvedValue(undefined)
    expect(await host.confirm(request())).toMatchObject({ decision: 'reject_once' })
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[1]))
    expect(await host.confirm(request())).toMatchObject({ decision: 'reject_once' })
    const input = request()
    Reflect.set(input, 'confirm', true)
    await expect(host.confirm(input)).rejects.toThrow()
  })
  it.each(['expiry', 'stop', 'dispose'])(
    'settles a pending modal on %s and ignores its late Send once',
    async (kind) => {
      const { host, deps, state } = await harness()
      vi.useFakeTimers()
      const result = Promise.withResolvers<vscode.MessageItem | undefined>()
      vi.mocked(modal).mockReturnValue(result.promise)
      const input = request()
      const pending = host.confirm(input)
      const send = vi.mocked(modal).mock.calls.at(-1)?.[2]
      switch (kind) {
        case 'expiry': {
          await vi.advanceTimersByTimeAsync(10_000)
          break
        }
        case 'stop': {
          workspace.isTrusted = false
          state.hardware = false
          state.interactive = false
          await host.stop()

          break
        }
        case 'dispose': {
          {
            host.dispose()
            // No default
          }
          break
        }
      }
      await expectSettled(pending)
      result.resolve(send)
      await Promise.resolve()
      if (kind === 'stop') expect(deps.stop).toHaveBeenCalledOnce()
    },
  )
  it('sends the complete oversized payload to the preview before asking, and cancels while opening', async () => {
    const { host, deps } = await harness()
    const input = {
      ...request(),
      kind: 'command',
      payload: 'x'.repeat(MAKER_MODAL_MAX_CHARS + 1),
      digest: createHash('sha256')
        .update('x'.repeat(MAKER_MODAL_MAX_CHARS + 1))
        .digest('hex'),
    } as const
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    await host.confirm(input)
    expect(deps.openApprovalPreview).toHaveBeenCalledWith(input, expect.any(AbortSignal))
    expect(vi.mocked(deps.openApprovalPreview).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(modal).mock.invocationCallOrder[0] ?? 0,
    )
    const wait = Promise.withResolvers<undefined>()
    vi.mocked(deps.openApprovalPreview).mockReturnValue(wait.promise)
    const pending = host.confirm(input)
    await host.stop()
    await expectSettled(pending)
    wait.resolve(undefined)
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(modal).toHaveBeenCalledOnce()
  })
  it('keeps Stop visible when admission is false and hides/removes it only with no machines or disposal', async () => {
    const { host, deps, state } = await harness()
    const item = new FakeStatusBarItem()
    window.createStatusBarItem.mockReturnValue(item)
    const machine: MakerMachineSummary = {
      registrationId: randomUUID(),
      id: 'printer',
      name: 'Printer',
      kind: 'moonraker',
      category: 'printer',
      endpoint: 'https://printer.lan',
      limits: {},
    }
    state.hardware = false
    state.interactive = false
    workspace.isTrusted = false
    host.stopControls([machine])
    expect(item.visible).toBe(true)
    expect(item.command).toBe(MAKER_COMMANDS.stopMachine)
    await host.stop('printer')
    expect(deps.stop).toHaveBeenCalledWith('printer')
    host.stopControls([])
    expect(item.visible).toBe(false)
    host.stopControls([machine])
    host.dispose()
    expect(item.visible).toBe(false)
  })
  it('namespaces mementos, uses canonical outside-repository directories, and delegates secrets only', async () => {
    const { host, deps, workspaceValues, machineValues, getSecret, storeSecret, deleteSecret } =
      await harness()
    expect(host.storage.workspace.directory).toBe(await realpath(host.storage.workspace.directory))
    await host.storage.workspace.update('hardware', { enabled: true, reason: 'bench test' })
    expect(workspaceValues.get('maker.hardware')).toEqual({ enabled: true, reason: 'bench test' })
    expect(await host.storage.workspace.get('hardware')).toEqual({
      enabled: true,
      reason: 'bench test',
    })
    await host.storage.workspace.delete('hardware')
    expect(await host.storage.workspace.get('hardware')).toBeUndefined()
    await host.storage.machine.update('selected', ['printer'])
    expect(machineValues.get('maker.selected')).toEqual(['printer'])
    const value = randomUUID()
    await host.secrets.store('maker.machine.test', value)
    await host.secrets.get('maker.machine.test')
    await host.secrets.delete('maker.machine.test')
    expect(storeSecret).toHaveBeenCalledWith('maker.machine.test', value)
    expect(getSecret).toHaveBeenCalledWith('maker.machine.test')
    expect(deleteSecret).toHaveBeenCalledWith('maker.machine.test')
    await expect(
      createVscodeMakerHost({ ...deps, context: { ...deps.context, storageUri: undefined } }),
    ).rejects.toThrow(UI_TEXT.makerUnavailable)
    workspace.workspaceFolders = [
      { uri: Uri.file(path.dirname(host.storage.workspace.directory)), name: 'inside', index: 0 },
    ]
    await expect(createVscodeMakerHost(deps)).rejects.toThrow(UI_TEXT.makerUnavailable)
  })
  it('shows the physical-switch warning when an independent Stop fails', async () => {
    const { host, deps } = await harness()
    vi.mocked(deps.stop).mockRejectedValue(new Error(randomUUID()))
    await expect(host.stop()).rejects.toThrow(UI_TEXT.makerUnavailable)
    expect(window.showWarningMessage).toHaveBeenCalledWith(UI_TEXT.makerPhysicalStopRequired)
  })
  it('localizes each safety warning and validates notices and previews', async () => {
    const { host, deps } = await harness()
    for (const warning of [
      'physicalStopRequired',
      'startupMotion',
      'limitsUnavailable',
      'auditUnrecorded',
      'sentOutcomeUnknown',
    ] as const)
      await host.notify(warning)
    expect(window.showWarningMessage).toHaveBeenCalledWith(UI_TEXT.makerSentOutcomeUnknown)
    await host.notify({ type: 'makerNotice', level: 'error', message: 'safe translated text' })
    expect(window.showErrorMessage).toHaveBeenCalledWith('safe translated text')
    await host.notify({ type: 'makerNotice', level: 'info', message: 'safe info' })
    await host.notify({ type: 'makerNotice', level: 'warning', message: 'safe warning' })
    await host.notify({
      type: 'presetsOffered',
      title: 'offered',
      kinds: [],
      skillIds: [],
      presets: [],
      notices: ['notice'],
      isCircuitPyRoot: false,
      hasMachineConfig: false,
    })
    expect(window.showInformationMessage).toHaveBeenCalledWith('offered\nnotice')
    await host.openPreview({ kind: 'payload', title: 'exact', content: 'G1 X1' })
    expect(deps.openPreview).toHaveBeenCalledWith({
      kind: 'payload',
      title: 'exact',
      content: 'G1 X1',
    })
    await expect(host.openPreview({ kind: 'payload', title: '', content: '' })).rejects.toThrow()
  })
})
