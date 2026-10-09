// M124 (RVM124R4 finding 3): the runtime's shutdown owns the approval page
// and its pending operations. The page's start-up is held (the module is
// mocked); the client leaves while it starts: the runtime must not finish
// before that start-up has settled, must close the page, and must never open
// a browser afterwards. With operations still draining it must stop them
// first and finish only once they have (registry.drained, held here).
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { startApprovalPage, type ApprovalPage } from '../../src/runtime/connector/approvalPage'
import { parseConnectorCommand, runConnectorCommand } from '../../src/runtime/connector/command'
import { runConnector, type ConnectorRuntimeDeps } from '../../src/runtime/connector/entry'
import { ConnectorStore } from '../../src/runtime/connector/store'
import { ConnectorRegistry } from '../../src/core/connector/registry'

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

/** The runtime serving `stdin` over a data folder; its replies are read and dropped. */
function runtimeDeps(
  data: string,
  stdin: PassThrough,
  openBrowser: (url: string) => Promise<void>,
): ConnectorRuntimeDeps {
  const stdout = new PassThrough()
  stdout.resume()
  return {
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
  }
}

async function shutDownWhilePageStarts(data: string): Promise<void> {
  await granted(data)
  const starting = Promise.withResolvers<ApprovalPage>()
  vi.mocked(startApprovalPage).mockReturnValue(starting.promise)
  const openBrowser = vi.fn(() => Promise.resolve())
  const stdin = new PassThrough()
  let isDone = false
  const running = (async () => {
    const code = await runConnector(runtimeDeps(data, stdin, openBrowser))
    isDone = true
    return code
  })()
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

/** Disconnects with operations still draining (held), then lets them settle. */
async function shutDownWhileDraining(data: string): Promise<void> {
  await granted(data)
  const draining = Promise.withResolvers<undefined>()
  const drained = vi.spyOn(ConnectorRegistry.prototype, 'drained').mockReturnValue(draining.promise)
  const disconnect = vi.spyOn(ConnectorRegistry.prototype, 'disconnect')
  try {
    const stdin = new PassThrough()
    let isDone = false
    const running = (async () => {
      const code = await runConnector(runtimeDeps(data, stdin, vi.fn()))
      isDone = true
      return code
    })()
    stdin.end()
    await vi.waitFor(() => {
      expect(drained).toHaveBeenCalled()
    })
    await sleep(300)
    expect(isDone).toBe(false)
    draining.resolve(undefined)
    expect(await running).toBe(0)
    // The client's calls were stopped first; the runtime then waited for them.
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      drained.mock.invocationCallOrder[0] ?? 0,
    )
  } finally {
    drained.mockRestore()
    disconnect.mockRestore()
  }
}

describe('M124 runtime shutdown (RVM124R4 P2-3)', () => {
  for (const [label, scenario] of [
    [
      'finishes only after the approval page’s start-up settled, closes it and opens no browser late',
      shutDownWhilePageStarts,
    ],
    ['finishes only after its pending operations have drained', shutDownWhileDraining],
  ] as const)
    it(label, async () => {
      const data = await mkdtemp(path.join(os.tmpdir(), 'm124-entry-'))
      try {
        await scenario(data)
      } finally {
        await rm(data, { recursive: true, force: true })
      }
    })
})
