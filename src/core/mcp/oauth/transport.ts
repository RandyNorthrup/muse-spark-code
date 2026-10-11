import { type McpOAuthBinding, type McpOAuthClient } from './client'
import { oauthDenied } from './discovery'

/** Bind by trusted registry name, then by exact resource, before any token is read. */
export function mcpOAuthTransport(
  client: McpOAuthClient,
  bindingOf: (server: string) => McpOAuthBinding | undefined,
): (server: string, url: string) => typeof fetch | undefined {
  return (server, url) => {
    const input = bindingOf(server)
    if (input === undefined) return
    const binding = structuredClone(input)
    if (binding.resource !== url) oauthDenied()
    return async (target, init) => {
      if (typeof target !== 'string' || target !== url || init === undefined) oauthDenied()
      return await client.fetch(binding, target, init)
    }
  }
}
