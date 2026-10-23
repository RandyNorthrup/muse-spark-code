import { startCompanionServer } from '../../../src/runtime/companion/server'
import * as z from 'zod/mini'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../../src/shared/protocol'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMhpCall, parseMhpResult } from '../../../src/shared/hostApi/protocol'
import { MHP } from '../../../src/shared/constants'

const unsubscribe = () => undefined

// UI fixture uses the real companion boundary. It never starts a backend or makes a model call.
export async function startXcodeFakeRuntime() {
  return await startCompanionServer({
    handler: {
      inputSchema: z.custom((value) => parseWebviewToHostMessage(value).ok),
      outputSchema: z.custom((value) => parseHostToWebviewMessage(value).ok),
      async post() {
        await Promise.resolve()
      },
      subscribe() {
        return unsubscribe
      },
    },
    limits: {
      maxBodyBytes: 1_048_576,
      maxEventBytes: 1_048_576,
      requestTimeoutMs: 10_000,
      idleTimeoutMs: 180_000,
      launchCodeTtlMs: 15_000,
      sessionTtlMs: 180_000,
      maxSessions: 8,
    },
    assets: new Map(),
    renderPage: (nonce) =>
      `<!doctype html><html><head><title>Muse Spark fake companion panel</title></head><body><h1>Muse Spark fake companion panel</h1><p id="authenticated"></p><script nonce="${nonce}">window.musePanel = {postMessage(message) { return window.fetch('/panel/message', { method: 'POST', headers: {'Content-Type': 'application/json', 'X-Muse-Panel': '1'}, body: JSON.stringify(message) }); }}; window.musePanel.postMessage({type:'ready'}).then(response => { if (response.ok) document.getElementById('authenticated').textContent = 'Authenticated panel ready'; });</script></body></html>`,
  })
}

// The app owns a real MHP parent. Only this test fixture supplies the backend-free page.
async function runXcodeFakeHostRuntime() {
  const lines = createInterface({ input: process.stdin })
  let server: Awaited<ReturnType<typeof startXcodeFakeRuntime>> | undefined
  const close = () => {
    void server?.close()
    lines.close()
  }
  process.once('SIGTERM', close).once('SIGINT', close)
  try {
    for await (const line of lines) {
      const value: unknown = JSON.parse(line)
      if (server === undefined) {
        const call = parseMhpCall(value)
        if (call.method !== 'initialize' || !('id' in call)) throw new Error('MHP_INVALID_REQUEST')
        const result = parseMhpResult('initialize', {
          jsonrpc: MHP.jsonRpcVersion,
          id: call.id,
          result: {
            protocolVersion: MHP.version,
            capabilities: ['lifecycle', 'settings', 'storage'],
          },
        })
        server = await startXcodeFakeRuntime()
        process.stdout.write(`${JSON.stringify(result)}\n`)
        process.stdout.write(
          `${JSON.stringify(
            parseMhpCall({
              jsonrpc: MHP.jsonRpcVersion,
              id: 'launch-panel',
              method: 'ui/openExternal',
              params: { uri: server.launchUrl() },
            }),
          )}\n`,
        )
      } else {
        parseMhpResult('ui/openExternal', value)
      }
    }
  } finally {
    process.off('SIGTERM', close).off('SIGINT', close)
    await server?.close()
    lines.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runXcodeFakeHostRuntime()
}
