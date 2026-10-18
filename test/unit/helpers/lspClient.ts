import type { LspTransport } from '../../../src/runtime/lsp/transport'

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
