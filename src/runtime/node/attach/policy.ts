// What a remote session may call (M110d lane G, D90.12): an ACP bridge
// session serves everything except the node's workspace files (`fs/*`
// stays home), and an exec session only runs headless work. TUI and LSP
// sessions are named here so the refusal is said, not silent: they wait
// on the TUI (lane T) and the LSP broker (M104e) respectively.
import * as z from 'zod/mini'

export const remoteSessionKinds = ['acp', 'exec', 'tui', 'lsp'] as const
export const remoteSessionKindSchema = z.enum(remoteSessionKinds)
export type RemoteSessionKind = z.infer<typeof remoteSessionKindSchema>

export type RemoteMethodVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

const NODE_FILE_PREFIX = 'fs/'

export function filterRemoteMethod(kind: RemoteSessionKind, method: string): RemoteMethodVerdict {
  if (method.length === 0) return { allowed: false, reason: 'a method names itself' }
  const parsed = remoteSessionKindSchema.parse(kind)
  if (parsed === 'tui') return { allowed: false, reason: 'remote TUI sessions wait on lane T' }
  if (parsed === 'lsp') return { allowed: false, reason: 'remote LSP sessions wait on M104e' }
  return parsed === 'acp' && method.startsWith(NODE_FILE_PREFIX)
    ? { allowed: false, reason: 'a remote ACP session never reads the node files' }
    : { allowed: true }
}
