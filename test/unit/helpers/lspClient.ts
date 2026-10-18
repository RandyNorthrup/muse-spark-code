import { PassThrough } from 'node:stream'
import { lspTransport, type LspTransport } from '../../../src/runtime/lsp/transport'
import type { RpcMessage } from '../../../src/runtime/lsp/protocol'
import { serveLsp, type LspServices } from '../../../src/runtime/lsp/server'

function ignoreRequest(_message: RpcMessage, _client: LspTransport): void {
  // No server-initiated request is expected until `answer` installs one.
}

export function lspHarness(workspace: string, services: LspServices) {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  const messages: RpcMessage[] = []
  const server = serveLsp(toServer, toClient, workspace, services)
  let onRequest: (message: RpcMessage, client: LspTransport) => void = ignoreRequest
  const client = lspTransport(toClient, toServer, (message) => {
    messages.push(message)
    onRequest(message, client)
  })
  return {
    client,
    server,
    messages,
    toServer,
    toClient,
    answer: (handler: typeof onRequest) => {
      onRequest = handler
    },
    close: () => {
      client.close()
      server.close()
      toServer.destroy()
      toClient.destroy()
    },
  }
}
export async function initialize(
  client: LspTransport,
  isInline = false,
  canApply = true,
): Promise<unknown> {
  const result = await client.request('initialize', {
    capabilities: {
      workspace: { applyEdit: canApply, workspaceEdit: { documentChanges: canApply } },
      textDocument: {
        ...(isInline && { inlineCompletion: {} }),
        codeAction: { codeActionLiteralSupport: {} },
      },
    },
  })
  client.notify('initialized', {})
  return result
}
