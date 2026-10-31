// M124 (D106): the connector serving for real: runConnector composed as
// the runtime composes it (real store, real prompt library, real stdio
// pipes, the real loopback approval page), a temporary data folder, and
// plain HTTP for the person's clicks. The browser opener is the runtime's
// own dependency: here it hands the launch URL to the test's HTTP client
// instead of an OS browser, and the page's own login, event stream and
// decision post do the rest. (RVMSM124: the earlier cases that staged the
// registry ports and the approval page without the real ones are deleted
// under the owner's testing rules; schedules and reports are not called by
// these cases and their ports stay unbound here — their wiring is proven
// by test/e2e/connectorStdio.e2e.test.ts on the built product.)
import { request } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { PROMPT_SCHEMA_VERSION } from '../../src/shared/constants'
import { EN, type UiText } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { SavedPrompt } from '../../src/shared/prompts'
import { PromptStore } from '../../src/core/prompts/promptStore'
import { CONNECTOR_DEFAULT_CONNECTION, CONNECTOR_FOLDER } from '../../src/shared/constants'
import { connectorStorageGuard } from '../../src/runtime/connector/storageGuard'
import { startApprovalPage } from '../../src/runtime/connector/approvalPage'
import { parseConnectorCommand, runConnectorCommand } from '../../src/runtime/connector/command'
import { runConnector, type ConnectorRuntimeDeps } from '../../src/runtime/connector/entry'
import { ConnectorStore } from '../../src/runtime/connector/store'
import { usingPrivateDir } from './helpers/temporaryFolders'
import { connectorCall, connectorHeaders, connectorLogin } from './helpers/connectorLoopback'
import { OWNER_COMMAND_IO } from './helpers/connectorRemote'

const CANARY = 'sk-connector-canary-1234567890'
const frame = (message: unknown) => `${JSON.stringify(message)}\n`
const unbound = () => Promise.reject(new Error('not bound in this suite'))

/** The owner's own grant command, confirmed as the person in their terminal. */
async function granted(data: string, scopes: readonly string[]): Promise<void> {
  const command = parseConnectorCommand([
    'grant',
    '--user-library',
    ...scopes.flatMap((scope) => ['--scope', scope]),
  ])
  if (command?.kind !== 'grant') throw new Error('grant parse')
  const code = await runConnectorCommand(
    new ConnectorStore(data, connectorStorageGuard(path.join(data, CONNECTOR_FOLDER))),
    command,
    OWNER_COMMAND_IO,
  )
  expect(code).toBe(0)
}

interface Serving {
  readonly stdin: PassThrough
  readonly running: Promise<number>
  readonly reply: (id: number) => Promise<Record<string, unknown>>
  readonly output: () => string
  readonly close: () => Promise<void>
}

/** The real connector on pipes; every reply line is kept until the client leaves. */
function serve(data: string, openBrowser: (url: string) => Promise<void>): Serving {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let text = ''
  stdout.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8')
  })
  const deps: ConnectorRuntimeDeps = {
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
    registered: () => [CANARY],
    openBrowser,
    schedules: { list: unbound, pause: unbound },
    reports: { generate: unbound },
    storageGuard: connectorStorageGuard(path.join(data, CONNECTOR_FOLDER)),
  }
  const running = runConnector(deps)
  stdin.write(
    frame({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'serve-suite' } },
    }),
  )
  const reply = async (id: number) => {
    const deadline = Date.now() + 4000
    for (;;) {
      for (const line of text.split('\n')) {
        if (line === '') continue
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (parsed['id'] === id) return parsed
      }
      if (Date.now() > deadline) throw new Error(`no reply ${String(id)} in: ${text}`)
      await sleep(25)
    }
  }
  return {
    stdin,
    running,
    reply,
    output: () => text,
    close: async () => {
      stdin.end()
      expect(await running).toBe(0)
    },
  }
}

function call(server: Serving, id: number, name: string, args: unknown): void {
  server.stdin.write(
    frame({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  )
}

function structured(reply: Record<string, unknown>): Record<string, unknown> {
  return (reply['result'] as { structuredContent: Record<string, unknown> }).structuredContent
}

const SAVE = {
  requestId: 'r1',
  expectedGeneration: 0,
  scope: 'user',
  title: 'From another agent',
  body: 'Summarize the change',
}

/** The page's first streamed intent, read off its real event stream. */
function firstIntent(
  panel: { url: string },
  token: string,
): Promise<{ intentId: string; digest: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      new URL('/events', panel.url),
      { method: 'POST', headers: connectorHeaders(panel, token), setHost: false },
      (response) => {
        let pending = ''
        response.on('data', (chunk: Buffer) => {
          pending += chunk.toString('utf8')
          // The stream opens with a ': connected' comment frame; take the first data frame.
          const data = pending.split('\n\n').find((part) => part.startsWith('data: '))
          if (data === undefined) return
          response.destroy()
          const parsed = JSON.parse(data.slice('data: '.length)) as {
            intents: { intentId: string; digest: string }[]
          }
          const [intent] = parsed.intents
          if (intent === undefined) reject(new Error('no intent streamed'))
          else resolve(intent)
        })
        response.on('error', reject)
      },
    )
    outgoing.on('error', reject)
    outgoing.end('{}')
  })
}

/** Logs in on the approval page and posts the person's decision for its first intent. */
async function decideOnPage(launchUrl: string, isApproved: boolean): Promise<void> {
  const panel = { url: `${new URL(launchUrl).origin}/`, launchUrl: () => launchUrl }
  const token = await connectorLogin(panel)
  const intent = await firstIntent(panel, token)
  const posted = await connectorCall(
    panel,
    '/post',
    'POST',
    JSON.stringify({
      type: 'decide',
      intentId: intent.intentId,
      digest: intent.digest,
      approve: isApproved,
    }),
    connectorHeaders(panel, token),
  )
  expect(posted.status).toBe(202)
}

/** Starts a save and answers its awaitingApproval reply; the page's URL was handed to `opened`. */
async function saveAwaiting(server: Serving): Promise<string> {
  call(server, 1, 'muse_prompt_save', SAVE)
  const answer = structured(await server.reply(1))
  expect(answer['status']).toBe('awaitingApproval')
  return (answer['data'] as { operationId: string }).operationId
}

/** One save through the page's decision; its operation state and the library afterwards. */
async function decidedSave(isApproved: boolean) {
  return await usingPrivateDir('m124-serve-', async (data) => {
    await granted(data, ['prompts:write'])
    let launch = ''
    const server = serve(data, (url) => {
      launch = url
      return Promise.resolve()
    })
    try {
      const operationId = await saveAwaiting(server)
      expect(await new PromptStore(data, undefined).list('user')).toEqual([])
      await decideOnPage(launch, isApproved)
      // The terminal receipt, not a fixed sleep (RLM106, RLF-HYGIENE): the
      // decision settles asynchronously, and 250 ms flaked under load while
      // the 2 s poll floor forbids re-reading the state. Every call ends in
      // exactly one terminal receipt, so the single read below observes it.
      await waitForTerminalReceipt(data, operationId)
      return {
        state: await operationState(server, 2, operationId),
        prompts: await new PromptStore(data, undefined).list('user'),
      }
    } finally {
      await server.close()
    }
  })
}

/** The receipt events that end an operation, whatever ended it. */
const TERMINAL_RECEIPT_EVENTS: ReadonlySet<string> = new Set([
  'settled',
  'refused',
  'cancelled',
  'failed',
])
const RECEIPT_WAIT_MS = 4000
const RECEIPT_POLL_MS = 25

// The operation's terminal receipt in the connection's audit journal. The
// settled receipt is durable before the state moves; a best-effort end is
// noted after it — either way the read that follows sees the end.
async function waitForTerminalReceipt(data: string, operationId: string): Promise<void> {
  const journal = path.join(
    data,
    CONNECTOR_FOLDER,
    'audit',
    `${CONNECTOR_DEFAULT_CONNECTION}.jsonl`,
  )
  const deadline = Date.now() + RECEIPT_WAIT_MS
  for (;;) {
    let text: string
    try {
      text = await readFile(journal, 'utf8')
    } catch {
      text = ''
    }
    for (const line of text.split('\n')) {
      if (line === '') continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue // A torn line amid appends: skipped like the journal skips it.
      }
      if (
        parsed['operationId'] === operationId &&
        typeof parsed['event'] === 'string' &&
        TERMINAL_RECEIPT_EVENTS.has(parsed['event'])
      )
        return
    }
    if (Date.now() > deadline)
      throw new Error(`no terminal receipt for ${operationId} in: ${text.slice(-500)}`)
    await sleep(RECEIPT_POLL_MS)
  }
}

describe('M124 connector serving (real store, page and pipes)', () => {
  it('serves granted reads scrubbed and writes nothing of them to the audit', async () => {
    await usingPrivateDir('m124-serve-', async (data) => {
      await granted(data, ['prompts:read', 'content:read'])
      const seeded: SavedPrompt = {
        schemaVersion: PROMPT_SCHEMA_VERSION,
        id: 'seeded-1',
        title: 'Seeded',
        tags: [],
        variables: [],
        scope: 'user',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        untrusted: false,
        body: `Use ${CANARY} from ${path.join(data, 'private', 'notes.txt')}`,
      }
      await new PromptStore(data, undefined).write(seeded)
      const server = serve(data, () => Promise.resolve())
      try {
        call(server, 1, 'muse_prompt_get', { promptId: 'seeded-1' })
        const answer = structured(await server.reply(1))
        expect(answer['status']).toBe('ok')
        expect(server.output()).not.toContain(CANARY)
        expect(server.output()).not.toContain(data)
      } finally {
        await server.close()
      }
      const journal = await readFile(path.join(data, 'connector', 'audit', 'default.jsonl'), 'utf8')
      expect(journal).not.toContain(CANARY)
      expect(journal).not.toContain(data)
      expect(journal).toContain('"event":"settled"')
    })
  })

  it('writes a save only after the approval page approves it, once', async () => {
    const { state, prompts } = await decidedSave(true)
    expect(state['state']).toBe('completed')
    expect(prompts.map((prompt) => prompt.title)).toEqual(['From another agent'])
    expect(prompts[0]?.untrusted).toBe(true)
  })

  it('writes nothing when the approval page denies the save', async () => {
    const { state, prompts } = await decidedSave(false)
    expect(state['state']).toBe('cancelled')
    expect(prompts).toEqual([])
  })

  it('stops pending work when the kill switch lands, while Stop still answers', async () => {
    await usingPrivateDir('m124-serve-', async (data) => {
      await granted(data, ['prompts:write', 'prompts:read'])
      const server = serve(data, () => Promise.resolve())
      try {
        const operationId = await saveAwaiting(server)
        // The owner's `mcp kill` in another process: the same store file.
        await new ConnectorStore(data).setKilled(true, new Date().toISOString())
        call(server, 2, 'muse_prompt_list', { scope: 'user' })
        expect(structured(await server.reply(2))).toMatchObject({
          status: 'refused',
          reason: 'forbidden',
        })
        const state = await operationState(server, 3, operationId)
        expect(state['state']).toBe('cancelled')
        call(server, 4, 'muse_stop', { target: { kind: 'operation', id: operationId } })
        expect(structured(await server.reply(4))).toMatchObject({
          status: 'ok',
          data: { outcome: 'alreadyStopped' },
        })
        expect(await new PromptStore(data, undefined).list('user')).toEqual([])
      } finally {
        await server.close()
      }
    })
  })

  it('refuses the save and retires the real page listener when the browser opener fails', async () => {
    await usingPrivateDir('m124-serve-', async (data) => {
      await granted(data, ['prompts:write'])
      let origin = ''
      const server = serve(data, (url) => {
        origin = new URL(url).origin
        return Promise.reject(new Error('no browser here'))
      })
      try {
        call(server, 1, 'muse_prompt_save', SAVE)
        expect(structured(await server.reply(1))).toMatchObject({
          status: 'refused',
          reason: 'approval_unavailable',
        })
        const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(origin).port) })
        try {
          await expect(
            new Promise<void>((resolve, reject) => {
              socket.once('connect', resolve)
              socket.once('error', reject)
            }),
          ).rejects.toMatchObject({ code: 'ECONNREFUSED' })
        } finally {
          socket.destroy()
        }
      } finally {
        await server.close()
      }
    })
  })
})

describe('M124 approval page text', () => {
  it('escapes the embedded language table so no string can end its script block', async () => {
    const crafted: UiText = {
      ...EN,
      acpConnector: { ...EN.acpConnector, title: 'x</script><script>alert(1)' },
    }
    setUiText(crafted, 'en')
    const page = await startApprovalPage({
      pending: () => [],
      decide: () => false,
    })
    try {
      const panel = { url: `${new URL(page.launchUrl()).origin}/`, launchUrl: page.launchUrl }
      const token = await connectorLogin(panel)
      const html = await connectorCall(panel, '/', 'GET', undefined, connectorHeaders(panel, token))
      expect(html.body).not.toContain('</script><script>alert(1)')
      expect(html.body).toContain(String.raw`x\u003c/script>`)
    } finally {
      await page.close()
      setUiText(EN, 'en')
    }
  })
})

/** The operation's state once this poll is allowed (one poll per poll floor). */
async function operationState(
  server: Serving,
  id: number,
  operationId: string,
): Promise<Record<string, unknown>> {
  call(server, id, 'muse_operation_get', { operationId })
  const data = structured(await server.reply(id))['data'] as Record<string, unknown>
  return data
}
