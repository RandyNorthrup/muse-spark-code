import * as z from 'zod/mini'
import {
  nodeAuditSchema,
  nodeConfigSchema,
  nodeEventSchema,
  nodeStateSchema,
  nodeTerminalHostEventSchema,
  nodeToolRequestSchema,
  nodeGitDestinationSchema,
  nodeGitRepositoryConfigSchema,
} from '../../../../src/shared/node'
import { nodeSessionSchema } from '../../../../src/shared/nodeAuth'

/** JSON Schema describes structure; the canonical parser also checks invariants. */
export function nodeSchemaDocuments(): Record<string, z.core.JSONSchema.JSONSchema> {
  const documents: Record<string, z.core.JSONSchema.JSONSchema> = {}
  const schemas = {
    config: nodeConfigSchema,
    state: nodeStateSchema,
    session: nodeSessionSchema,
    audit: nodeAuditSchema,
    event: nodeEventSchema,
    'terminal-host-event': nodeTerminalHostEventSchema,
    'tool-request': nodeToolRequestSchema,
    'git-destination': nodeGitDestinationSchema,
    'git-repository-config': nodeGitRepositoryConfigSchema,
  }
  for (const [name, schema] of Object.entries(schemas)) {
    documents[name] = {
      ...z.toJSONSchema(schema, { unrepresentable: 'any' }),
      $id: `https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/docs/schemas/node-${name}-v1.schema.json`,
      'x-node-runtime-validation':
        'Parse with the canonical src/shared/node.ts or nodeAuth.ts schema: private addresses, ownership, time ordering, unique IDs, attendance, UTF8 byte caps, nonempty executable and NUL-free arguments require runtime checks. Digest, hash-chain, session expiry and cryptographic proof verification require their runtime bindings.',
    }
  }
  return documents
}
