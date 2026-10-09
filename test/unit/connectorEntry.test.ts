// M124 (RVM124R4 finding 3): the runtime's shutdown owns the approval page.
// The page's start-up is held (the module is mocked); the client leaves
// while it starts: the runtime must not finish before that start-up has
// settled, must close the page, and must never open a browser afterwards.
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { startApprovalPage, type ApprovalPage } from '../../src/runtime/connector/approvalPage'
import { parseConnectorCommand, runConnectorCommand } from '../../src/runtime/connector/command'
import { runConnector } from '../../src/runtime/connector/entry'
import { ConnectorStore } from '../../src/runtime/connector/store'

vi.mock('../../src/runtime/connector/approvalPage', () => ({ startApprovalPage: vi.fn() }))

const frame = (message: unknown) => `${JSON.stringify(message)}\n`

/** A user-library grant that may ask to save prompts, made by the owner's own command. */
async function granted(data: string): Promise<void> {
  const command = parseConnectorCommand(['grant', '--user-library', '--scope', 'prompts:write'])
  if (command?.kind !== 'grant') throw new Error('grant parse')
  const code = await runConnectorCommand(new ConnectorStore(data), command, {
    isInteractive: true,
    now: Date.now,
    print: vi.fn(),
    printError: vi.fn(),
    confirm: () => Promise.resolve(true),
  })
  expect(code).toBe(0)
}

async function shutDownWhilePageStarts(data: string): Promise<void> {
  await granted(data)
  const starting = Promise.withResolvers<ApprovalPage>()
  vi.mocked(startApprovalPage).mockReturnValue(starting.promise)
  const openBrowser = vi.fn(() => Promise.resolve())
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  stdout.resume()
  let isDone = false
  const run = async () => {
    const code = await runConnector({
      argv: [],
      table: EN,
      locale: 'en',
      dataFolder: data,
      homeDir: data,
      version: '0.0.0-test',
      stdin,
      stdout,
      stderr: new PassThrough(),
      isInteractive: false,
      registered: () => [],
      openBrowser,
      schedules: {
        list: () => Promise.resolve({ kind: 'refused', reason: 'test' }),
        pause: () => Promise.resolve({ kind: 'refused', reason: 'test' }),
      },
      reports: { generate: () => Promise.resolve('') },
    })
    isDone = true
    return code
  }
  const running = run()
  stdin.write(
    frame({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test' } },
    }),
  )
  stdin.write(
    frame({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'muse_prompt_save',
        arguments: {
          requestId: 'r1',
          expectedGeneration: 0,
          scope: 'user',
          title: 'Saved',
          body: 'Body',
        },
      },
    }),
  )
  await vi.waitFor(
    () => {
      expect(startApprovalPage).toHaveBeenCalled()
    },
    { timeout: 5000 },
  )
  // The client leaves while the page is still starting.
  stdin.end()
  await sleep(300)
  expect(isDone).toBe(false)
  const page: ApprovalPage = {
    launchUrl: () => 'http://127.0.0.1:9/',
    isWatched: () => false,
    changed: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
  }
  starting.resolve(page)
  expect(await running).toBe(0)
  expect(page.close).toHaveBeenCalled()
  expect(openBrowser).not.toHaveBeenCalled()
}

describe('M124 runtime shutdown (RVM124R4 P2-3)', () => {
  it('finishes only after the approval page’s start-up settled, closes it and opens no browser late', async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), 'm124-entry-'))
    try {
      await shutDownWhilePageStarts(data)
    } finally {
      await rm(data, { recursive: true, force: true })
    }
  })
})
