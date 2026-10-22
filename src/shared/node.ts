// Standalone home-node records and injected tool/clock ports (PLAN D90.23).
// No listener, provider, VS Code adapter or production fake lives here.
import * as z from 'zod/mini'
import {
  NODE_AUDIT_MAX_BYTES,
  NODE_AUDIT_RETENTION_DAYS,
  NODE_GIT_INERT_CONFIG_NAMES,
  NODE_MAX_ARGV_ITEMS,
  NODE_MAX_ARG_CHARS,
  NODE_MAX_CHALLENGES,
  NODE_MAX_FILE_BYTES,
  NODE_MAX_LABEL_CHARS,
  NODE_MAX_NAMES,
  NODE_MAX_PAGE_ITEMS,
  NODE_MAX_PASSKEYS,
  NODE_MAX_PATH_CHARS,
  NODE_MAX_PORT,
  NODE_MAX_SESSIONS,
  NODE_MAX_TERMINAL_DIMENSION,
  NODE_MAX_WORKSPACES,
  NODE_PATH_PATTERN,
  NODE_PROTOCOL_VERSION,
  NODE_SETUP_TTL_MS,
  NODE_TERMINAL_INPUT_BYTES,
  NODE_TERMINAL_OUTPUT_BYTES,
  NODE_TOOLS_USER,
} from './constants'
import {
  nodeDigestSchema,
  nodeDomainSchema,
  nodeIdentifierSchema,
  nodePasskeySchema,
  nodeSessionSchema,
  nodeTimeSchema,
  nodeTokenSchema,
} from './nodeAuth'

const labelSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(NODE_MAX_LABEL_CHARS), z.regex(/^[^\p{Cc}]+$/u))
export const nodeRelativePathSchema = z
  .string()
  .check(z.maxLength(NODE_MAX_PATH_CHARS), z.regex(new RegExp(NODE_PATH_PATTERN, 'u')))
const rootSchema = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(NODE_MAX_PATH_CHARS),
    z.regex(/^\/(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[^\p{Cc}\\]+$/u),
  )
export const nodeLanAddressSchema = z.union([z.ipv4(), z.ipv6()]).check(z.refine(isHomeAddress))

function isHomeAddress(ip: string): boolean {
  if (!ip.includes(':')) {
    return (
      /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/u.test(ip) &&
      !/^169\.254\.(?:169|170)\./u.test(ip)
    )
  }
  try {
    const canonical = new URL(`https://[${ip}]`).hostname
    return (
      canonical !== '[fd00:ec2::254]' &&
      canonical !== '[fd20:ce::254]' &&
      (canonical === '[::1]' || /^\[(?:f[cd][a-f0-9]{2}:|fe[89ab][a-f0-9]:)/iu.test(canonical))
    )
  } catch (error: unknown) {
    // WHATWG URLs only throw TypeError; anything else surfaces.
    if (!(error instanceof TypeError)) throw error
    return false
  }
}
export const nodeConfigSchema = z.strictObject({
  v: z.literal(NODE_PROTOCOL_VERSION),
  mode: z.literal('home'),
  label: labelSchema,
  browserNames: z.array(nodeDomainSchema).check(
    z.minLength(1),
    z.maxLength(NODE_MAX_NAMES),
    z.refine((names) => new Set(names).size === names.length),
  ),
  // null is required before node init explicitly chooses an interface.
  listener: z.nullable(
    z.strictObject({
      address: nodeLanAddressSchema,
      port: z.int().check(z.minimum(1), z.maximum(NODE_MAX_PORT)),
    }),
  ),
  workspaceRoot: rootSchema,
  audit: z.strictObject({
    maxBytes: z.int().check(z.positive(), z.maximum(NODE_AUDIT_MAX_BYTES)),
    retentionDays: z.int().check(z.positive(), z.maximum(NODE_AUDIT_RETENTION_DAYS)),
  }),
})
export type NodeConfig = z.infer<typeof nodeConfigSchema>

export const nodeWorkspaceSchema = z.strictObject({
  id: nodeIdentifierSchema,
  label: labelSchema,
  path: nodeRelativePathSchema,
  trusted: z.boolean(),
  lastUsedAt: nodeTimeSchema,
})
export const nodeStateSchema = z
  .strictObject({
    v: z.literal(NODE_PROTOCOL_VERSION),
    nodeId: nodeDigestSchema,
    ownerId: nodeIdentifierSchema,
    generation: z.int().check(z.positive()),
    config: nodeConfigSchema,
    setup: z.nullable(
      z
        .strictObject({
          codeHash: nodeDigestSchema,
          issuedAt: nodeTimeSchema,
          expiresAt: nodeTimeSchema,
        })
        .check(
          z.refine(
            (setup) =>
              setup.expiresAt > setup.issuedAt &&
              setup.expiresAt - setup.issuedAt <= NODE_SETUP_TTL_MS,
          ),
        ),
    ),
    passkeys: z.array(nodePasskeySchema).check(z.maxLength(NODE_MAX_PASSKEYS)),
    workspaces: z.array(nodeWorkspaceSchema).check(z.maxLength(NODE_MAX_WORKSPACES)),
    auditHead: z.strictObject({ seq: nodeTimeSchema, hash: nodeDigestSchema }),
  })
  .check(
    z.refine(
      (state) =>
        (state.setup === null || state.passkeys.length === 0) &&
        state.passkeys.every((key) => key.ownerId === state.ownerId) &&
        new Set(state.passkeys.map((key) => key.id)).size === state.passkeys.length &&
        new Set(state.workspaces.map((workspace) => workspace.id)).size === state.workspaces.length,
    ),
  )
export type NodeState = z.infer<typeof nodeStateSchema>

/** Public readings; M107's levels and per-workspace sandboxes arrive later. */
export const nodeDashboardSchema = z
  .strictObject({
    nodeId: nodeDigestSchema,
    version: labelSchema,
    uptimeMs: nodeTimeSchema,
    sandbox: z.literal('shared'),
    locked: z.boolean(),
    keyStoreSealed: z.boolean(),
    attendance: z.enum(['attended', 'unattended']),
    sessions: z.array(nodeSessionSchema).check(z.maxLength(NODE_MAX_SESSIONS)),
    pendingChallenges: z.int().check(z.nonnegative(), z.maximum(NODE_MAX_CHALLENGES)),
    cpuPercent: z.number().check(z.minimum(0), z.maximum(100)),
    memory: z.strictObject({ usedBytes: nodeTimeSchema, totalBytes: nodeTimeSchema }),
    disk: z.strictObject({ freeBytes: nodeTimeSchema, totalBytes: nodeTimeSchema }),
    workspaces: z.array(nodeWorkspaceSchema).check(z.maxLength(NODE_MAX_WORKSPACES)),
  })
  .check(
    z.refine(
      (d) =>
        d.memory.usedBytes <= d.memory.totalBytes &&
        d.disk.freeBytes <= d.disk.totalBytes &&
        (d.attendance === 'attended') === d.sessions.length > 0 &&
        (!d.locked || (d.keyStoreSealed && d.sessions.length === 0)),
    ),
  )
export type NodeDashboard = z.infer<typeof nodeDashboardSchema>

const auditFields = {
  v: z.literal(NODE_PROTOCOL_VERSION),
  seq: z.int().check(z.positive()),
  time: nodeTimeSchema,
  nodeId: nodeDigestSchema,
  sessionId: z.nullable(nodeIdentifierSchema),
  previousHash: nodeDigestSchema,
  hash: nodeDigestSchema,
  outcome: z.enum(['allowed', 'denied', 'expired', 'cancelled', 'failed']),
}
const authAuditFields = {
  ...auditFields,
  // A verified proof can still expire at the persistence barrier before access.
  outcome: z.enum(['allowed', 'denied', 'expired', 'cancelled', 'failed', 'verified']),
}
/** No free-text payloads, bearer, keys, proof bytes, terminal data or model text. */
export const nodeAuditSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...authAuditFields,
    kind: z.literal('signin'),
    action: z.enum(['enroll', 'signin', 'signout', 'lockout']),
    credentialIdHash: nodeDigestSchema,
  }),
  z.strictObject({ ...authAuditFields, kind: z.literal('stepUp'), actionDigest: nodeDigestSchema }),
  z.strictObject({
    ...auditFields,
    kind: z.literal('terminal'),
    terminalId: nodeIdentifierSchema,
    workspaceId: nodeIdentifierSchema,
    phase: z.enum(['start', 'end']),
    inputBytes: nodeTimeSchema,
    outputBytes: nodeTimeSchema,
    source: z.enum(['person', 'model']),
  }),
  z.strictObject({
    ...auditFields,
    kind: z.literal('key'),
    action: z.enum(['set', 'unlock', 'use', 'seal']),
    keyKind: z.enum(['provider', 'deploy']),
  }),
  z.strictObject({
    ...auditFields,
    kind: z.literal('node'),
    action: z.enum(['stop', 'lock', 'unlock', 'wipe']),
  }),
  z.strictObject({
    ...auditFields,
    kind: z.literal('git'),
    workspaceId: nodeIdentifierSchema,
    action: z.enum(['stage', 'commit', 'branch', 'fetch', 'pull', 'push']),
    actionDigest: nodeDigestSchema,
  }),
  z.strictObject({
    ...auditFields,
    kind: z.literal('approval'),
    requestId: nodeIdentifierSchema,
    actionDigest: nodeDigestSchema,
    paid: z.boolean(),
  }),
])
export type NodeAudit = z.infer<typeof nodeAuditSchema>

export const nodeTerminalSizeSchema = z.strictObject({
  cols: z.int().check(z.positive(), z.maximum(NODE_MAX_TERMINAL_DIMENSION)),
  rows: z.int().check(z.positive(), z.maximum(NODE_MAX_TERMINAL_DIMENSION)),
})
export const nodeTerminalInputSchema = z.string().check(
  z.maxLength(NODE_TERMINAL_INPUT_BYTES),
  z.refine((data) => new TextEncoder().encode(data).byteLength <= NODE_TERMINAL_INPUT_BYTES),
)
export const nodeTerminalClientFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('auth'),
    bearer: nodeTokenSchema,
    terminalId: nodeIdentifierSchema,
  }),
  z.strictObject({
    type: z.literal('input'),
    data: nodeTerminalInputSchema,
  }),
  z.strictObject({ type: z.literal('resize'), size: nodeTerminalSizeSchema }),
  z.strictObject({ type: z.literal('close') }),
])
const eventFields = {
  v: z.literal(NODE_PROTOCOL_VERSION),
  seq: z.int().check(z.positive()),
  time: nodeTimeSchema,
  nodeId: nodeDigestSchema,
}
const terminalOutputFields = {
  type: z.literal('terminalOutput'),
  terminalId: nodeIdentifierSchema,
  data: z.string().check(
    z.maxLength(NODE_TERMINAL_OUTPUT_BYTES),
    z.refine((data) => new TextEncoder().encode(data).byteLength <= NODE_TERMINAL_OUTPUT_BYTES),
  ),
}
const terminalEndedFields = {
  type: z.literal('terminalEnded'),
  terminalId: nodeIdentifierSchema,
  exitCode: z.nullable(z.int()),
  reason: z.enum(['exit', 'closed', 'stopped', 'locked', 'lost']),
}
/** Tool-host stream payloads; N adds the authenticated event envelope. */
export const nodeTerminalHostEventSchema = z.discriminatedUnion('type', [
  z.strictObject(terminalOutputFields),
  z.strictObject(terminalEndedFields),
])
export type NodeTerminalHostEvent = z.infer<typeof nodeTerminalHostEventSchema>
export const nodeEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...eventFields, type: z.literal('dashboard'), dashboard: nodeDashboardSchema }),
  z.strictObject({
    ...eventFields,
    type: z.literal('workspaceChanged'),
    workspace: nodeWorkspaceSchema,
  }),
  z.strictObject({ ...eventFields, ...terminalOutputFields }),
  z.strictObject({ ...eventFields, ...terminalEndedFields }),
  z.strictObject({ ...eventFields, type: z.literal('audit'), entry: nodeAuditSchema }),
  z.strictObject({ ...eventFields, type: z.literal('stopped') }),
  z.strictObject({ ...eventFields, type: z.literal('locked') }),
])
export type NodeEvent = z.infer<typeof nodeEventSchema>

/** Only inert metadata may be imported into N's closed Git configuration. */
export const nodeGitRepositoryConfigSchema = z.partialRecord(
  z.enum(NODE_GIT_INERT_CONFIG_NAMES),
  z.string().check(z.minLength(1), z.maxLength(NODE_MAX_ARG_CHARS), z.regex(/^[A-Za-z0-9]+$/u)),
)
/** A status branch is a catalog ref and often the short name (`main`);
the credentialed network tuple needs the full branch path. Both the
page (when it builds the tuple) and N (when it admits it) normalize
through this one function so the two sides always agree. */
export function nodeNetworkBranchRef(branch: string): string {
  return branch.startsWith('refs/heads/') ? branch : `refs/heads/${branch}`
}
/** SSH destination and verified host key, included in the step-up action digest. */
export const nodeGitDestinationSchema = z.strictObject({
  host: nodeDomainSchema,
  port: z.int().check(z.minimum(1), z.maximum(NODE_MAX_PORT)),
  user: nodeIdentifierSchema.check(z.regex(/^[A-Za-z_][A-Za-z0-9_-]*$/u)),
  repository: nodeRelativePathSchema,
  hostKeyDigest: nodeDigestSchema,
})

export const nodeToolRequestSchema = z.strictObject({
  id: nodeIdentifierSchema,
  workspaceId: nodeIdentifierSchema,
  argv: z
    .array(
      z.string().check(
        z.maxLength(NODE_MAX_ARG_CHARS),
        z.refine((arg) => !arg.includes('\0')),
      ),
    )
    .check(
      z.minLength(1),
      z.maxLength(NODE_MAX_ARGV_ITEMS),
      z.refine((argv) => argv[0] !== ''),
    ),
  cwd: z.nullable(nodeRelativePathSchema),
})
export type NodeToolRequest = z.infer<typeof nodeToolRequestSchema>
export const nodeToolResultSchema = z.strictObject({
  id: nodeIdentifierSchema,
  user: z.literal(NODE_TOOLS_USER),
  exitCode: z.int(),
  stdout: z.string().check(
    z.maxLength(NODE_TERMINAL_OUTPUT_BYTES),
    z.refine((data) => new TextEncoder().encode(data).byteLength <= NODE_TERMINAL_OUTPUT_BYTES),
  ),
  stderr: z.string().check(
    z.maxLength(NODE_TERMINAL_OUTPUT_BYTES),
    z.refine((data) => new TextEncoder().encode(data).byteLength <= NODE_TERMINAL_OUTPUT_BYTES),
  ),
})
export interface NodeToolHostPort {
  /** Direct Git uses NODE_GIT_OPTIONS/environment; no service credential crosses this port. */
  run(request: NodeToolRequest, signal: AbortSignal): Promise<z.infer<typeof nodeToolResultSchema>>
  /**
  Install the observer before starting the child; events include its ID even
  if it exits before open resolves. Await each onEvent acknowledgement in
  order, pause the PTY at the output-byte cap, and never drop output. Exactly
  one terminalEnded follows acknowledged output, then release the PTY,
  descendants and observer. Abort/disconnect ends it as lost; observer
  rejection also terminates it. A callback must settle promptly on abort.
  */
  openTerminal(
    workspaceId: string,
    size: z.infer<typeof nodeTerminalSizeSchema>,
    onEvent: (event: NodeTerminalHostEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<{
    id: string
    user: typeof NODE_TOOLS_USER
  }>
  writeTerminal(id: string, data: string): Promise<void>
  resizeTerminal(id: string, size: z.infer<typeof nodeTerminalSizeSchema>): Promise<void>
  /** Close/stop resolve after final delivery and disposal; repeated close is harmless. */
  closeTerminal(id: string): Promise<void>
  stopAll(reason: 'stopped' | 'locked'): Promise<void>
}
export interface NodeClock {
  now(): number
  monotonicMs(): number
}

// Listing and transfers expose sizes/digests, never a host absolute path.
export const nodeFileEntrySchema = z.strictObject({
  path: nodeRelativePathSchema,
  kind: z.enum(['file', 'directory']),
  sizeBytes: nodeTimeSchema,
})
export const nodeFileTextSchema = z.strictObject({
  path: nodeRelativePathSchema,
  digest: nodeDigestSchema,
  text: z.string().check(
    z.maxLength(NODE_MAX_FILE_BYTES),
    z.refine((text) => new TextEncoder().encode(text).byteLength <= NODE_MAX_FILE_BYTES),
  ),
})
export const nodeFileListSchema = z.strictObject({
  entries: z.array(nodeFileEntrySchema).check(z.maxLength(NODE_MAX_PAGE_ITEMS)),
  nextCursor: z.nullable(nodeIdentifierSchema),
})
