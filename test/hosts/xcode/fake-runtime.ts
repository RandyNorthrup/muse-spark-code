import { startCompanionServer } from '../../../src/runtime/companion/server'
import * as z from 'zod/mini'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../../src/shared/protocol'

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
      `<!doctype html><html><head><title>Muse Spark fake companion panel</title></head><body><h1>Muse Spark fake companion panel</h1><p id="authenticated"></p><script nonce="${nonce}">window.fetch('/post', { method: 'POST', headers: {'Content-Type': 'application/json', 'X-Muse-Panel': '1'}, body: JSON.stringify({type:'ready'}) }).then(response => { if (response.ok) document.getElementById('authenticated').textContent = 'Authenticated panel ready'; });</script></body></html>`,
  })
}
