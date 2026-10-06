import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimeTab } from '../../src/runtime/tabServe'
import { PaidFeatureGate, PaidUsage } from '../../src/core/paid/paidFeatures'
import { GitExitError } from '../../src/host/git'
import { FakeLogOutputChannel } from './helpers/fakes'
import { lspHarness } from './helpers/lspClient'
import { TAB_REPLY_OPEN_TAG, TAB_REPLY_CLOSE_TAG } from '../../src/shared/constants'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
async function setup(
  overrides: {
    enabled?: boolean
    trusted?: boolean
    consent?: boolean
    budget?: number
    file?: string
    text?: string
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'muse-runtime-tab-'))
  folders.push(root)
  const file = path.join(root, overrides.file ?? 'sample.ts')
  await writeFile(file, 'const a = ')
  const log = new FakeLogOutputChannel()
  const gate = new PaidFeatureGate({
    isSettingOn: () => overrides.enabled ?? true,
    readAccepted: () => new Set(['tab']),
    writeAccepted: () => Promise.resolve(),
    setSetting: () => Promise.resolve(),
    confirm: () => Promise.resolve(false),
    isWindowFocused: () => true,
    log,
  })
  const usage = new PaidUsage(log)
  const sent: CreateResponseBody[] = []
  const consent = vi.fn(() => Promise.resolve(overrides.consent ?? true))
  const runGit = vi.fn<(args: readonly string[], cwd: string) => Promise<string>>(() =>
    Promise.reject(new GitExitError(1, '', 'check-ignore')),
  )
  async function* stream(body: CreateResponseBody): AsyncGenerator<StreamEvent> {
    await Promise.resolve() // Exercise the asynchronous provider boundary.
    sent.push(body)
    yield {
      type: 'response.output_text.delta',
      item_id: 'item',
      delta: `${TAB_REPLY_OPEN_TAG}value${TAB_REPLY_CLOSE_TAG}`,
    }
    yield {
      type: 'response.completed',
      response: {
        id: 'response',
        status: 'completed',
        output: [],
        usage: { input_tokens: 120, output_tokens: 9, input_tokens_details: { cached_tokens: 64 } },
      },
    }
  }
  const tab = runtimeTab({
    workspace: root,
    ledgerDirectory: path.join(root, 'ledger'),
    instance: 'fixture',
    log,
    model: 'muse-spark-1.3',
    budgetUsd: overrides.budget ?? 1,
    trusted: overrides.trusted ?? true,
    gate,
    usage,
    stream,
    runGit,
    consent,
  })
  const document = {
    uri: pathToFileURL(file).href,
    path: file,
    version: 1,
    languageId: 'typescript',
    text: overrides.text ?? 'const a = ',
  }
  const harness = lspHarness(root, {
    trusted: true,
    supportsReview: false,
    complete: () => Promise.resolve(undefined),
    command: () => Promise.resolve(null),
  })
  const complete = (
    signal = new AbortController().signal,
    isInvoke = true,
    character = document.text.length,
  ) => tab.complete(document, { line: 0, character }, isInvoke, signal, harness.server)
  return { tab, document, complete, sent, consent, runGit, usage, root, close: harness.close }
}

describe('M104L real M94 runtime adapter', () => {
  it('uses the real engine, settles reported usage and reuses a typing-through cache', async () => {
    const run = await setup()
    try {
      expect(await run.complete()).toBe('value')
      expect(await run.complete()).toBe('value')
      expect(run.sent).toHaveLength(1)
      expect(run.usage.current).toMatchObject({
        tabRequests: 1,
        tabUnknownRequests: 0,
        tabTokens: 129,
        tabCachedTokens: 64,
      })
      expect(run.tab.usage()).toMatchObject({ paid: true, budgetUsd: 1 })
    } finally {
      run.close()
    }
  })
  it.each([
    { enabled: false },
    { trusted: false },
    { consent: false },
    { budget: 0.000000001 },
    { file: '.env' },
  ])('does not dispatch with refused admission %j', async (overrides) => {
    const run = await setup(overrides)
    try {
      expect(await run.complete()).toBeUndefined()
      expect(run.sent).toEqual([])
    } finally {
      run.close()
    }
  })
  it('blocks ignored files and a cancellation during consent before reserving/sending', async () => {
    const ignored = await setup()
    try {
      ignored.runGit.mockResolvedValue('')
      expect(await ignored.complete()).toBeUndefined()
      expect(ignored.consent).not.toHaveBeenCalled()
    } finally {
      ignored.close()
    }
    const cancelled = await setup()
    const controller = new AbortController()
    cancelled.consent.mockImplementation(() => {
      controller.abort()
      return Promise.resolve(true)
    })
    try {
      expect(await cancelled.complete(controller.signal)).toBeUndefined()
      expect(cancelled.sent).toEqual([])
    } finally {
      cancelled.close()
    }
  })
  it('redacts a complete secret before dispatch', async () => {
    const run = await setup({
      text: 'const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890"; const a = ',
    })
    try {
      expect(await run.complete()).toBe('value')
      expect(run.sent).toHaveLength(1)
      expect(JSON.stringify(run.sent)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890')
    } finally {
      run.close()
    }
  })
  it('keeps the onInvoke default and refuses a secret split by the cursor', async () => {
    const run = await setup({
      text: 'const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890"; const a = ',
    })
    try {
      expect(await run.complete(undefined, false)).toBeUndefined()
      expect(run.consent).not.toHaveBeenCalled()
      expect(await run.complete(undefined, true, 30)).toBeUndefined()
      expect(run.sent).toEqual([])
    } finally {
      run.close()
    }
  })
})
