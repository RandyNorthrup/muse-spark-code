// M110's extension to MHP, independent of M104's absent envelope on this base.
// The adapter must authenticate first, then parse params AND results. See
// docs/certification/m110-captures.md: M110-MHP-v1; never expose this port raw.
import * as z from 'zod/mini'
import {
  NODE_BASE64_CHARS_PER_BLOCK,
  NODE_BASE64_BYTES_PER_BLOCK,
  NODE_MAX_COMMIT_CHARS,
  NODE_MAX_FILE_BASE64_CHARS,
  NODE_MAX_FILE_BYTES,
  NODE_MAX_PAGE_ITEMS,
  NODE_REF_PATTERN,
  NODE_REVISION_PATTERN,
} from '../constants'
import {
  nodeAuditSchema,
  nodeDashboardSchema,
  nodeFileListSchema,
  nodeFileTextSchema,
  nodeGitDestinationSchema,
  nodeRelativePathSchema,
  nodeTerminalSizeSchema,
  nodeTerminalInputSchema,
} from '../node'
import {
  nodeAssertionSchema,
  nodeChallengeTokenSchema,
  nodeAuthChallengeSchema,
  nodeAuthenticationSchema,
  nodeDigestSchema,
  nodeIdentifierSchema,
  nodeRegistrationSchema,
  nodeStepUpActionSchema,
  nodeStepUpSchema,
  nodeTokenSchema,
} from '../nodeAuth'

const empty = z.strictObject({})
const done = z.strictObject({ done: z.literal(true) })
const workspace = { workspaceId: nodeIdentifierSchema }
const pathFields = { ...workspace, path: nodeRelativePathSchema }
const cursor = z.nullable(nodeIdentifierSchema)
const stepUp = { stepUpId: nodeIdentifierSchema, actionDigest: nodeDigestSchema }
const terminal = z.strictObject({ terminalId: nodeIdentifierSchema })
const credentialProof = { challengeId: nodeChallengeTokenSchema, credential: nodeAssertionSchema }
const fileMutation = { ...pathFields, expectedDigest: z.nullable(nodeDigestSchema) }
const ref = z
  .string()
  .check(z.maxLength(NODE_MAX_COMMIT_CHARS), z.regex(new RegExp(NODE_REF_PATTERN, 'u')))
const revision = z.string().check(z.regex(new RegExp(NODE_REVISION_PATTERN, 'u')))
const head = z.nullable(revision)
const base64 = z.string().check(
  z.maxLength(NODE_MAX_FILE_BASE64_CHARS),
  z.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  z.refine(
    (value) =>
      (value.length / NODE_BASE64_CHARS_PER_BLOCK) * NODE_BASE64_BYTES_PER_BLOCK -
        (Number(value.endsWith('=')) + Number(value.endsWith('=='))) <=
      NODE_MAX_FILE_BYTES,
  ),
)
const fileBytes = { data: base64, digest: nodeDigestSchema }
const paths = z
  .array(nodeRelativePathSchema)
  .check(z.minLength(1), z.maxLength(NODE_MAX_PAGE_ITEMS))
const networkGit = z.strictObject({
  ...workspace,
  ...stepUp,
  remote: nodeIdentifierSchema.check(z.regex(/^(?!-)/u)),
  destination: nodeGitDestinationSchema,
  ref: ref.check(z.startsWith('refs/heads/')),
  expectedHead: head,
})
const gitResult = z.strictObject({ head, changed: z.boolean() })

/**
Access is a dispatch requirement, never a grant implied by a valid shape.
N's Git runner uses NODE_GIT_OPTIONS/environment and a service-owned closed
gitdir; bind/recheck destination, host key, ref and head before credential use.
See M110-N-git in docs/certification/m110-captures.md; argv alone is insufficient.
*/
export const nodeMethods = {
  'node/auth/begin': {
    access: 'public',
    params: z.discriminatedUnion('purpose', [
      z.strictObject({ purpose: z.literal('enroll'), setupCode: nodeTokenSchema }),
      z.strictObject({ purpose: z.literal('signin') }),
    ]),
    result: nodeAuthChallengeSchema,
  },
  'node/auth/enroll': {
    access: 'public',
    params: z.strictObject({
      challengeId: nodeChallengeTokenSchema,
      credential: nodeRegistrationSchema,
    }),
    result: nodeAuthenticationSchema,
  },
  'node/auth/signin': {
    access: 'public',
    params: z.strictObject(credentialProof),
    result: nodeAuthenticationSchema,
  },
  'node/auth/stepUp/begin': {
    access: 'session',
    params: z.strictObject({
      action: nodeStepUpActionSchema,
      actionDigest: nodeDigestSchema,
    }),
    result: nodeAuthChallengeSchema,
  },
  'node/auth/stepUp/complete': {
    access: 'session',
    params: z.strictObject(credentialProof),
    result: nodeStepUpSchema,
  },
  'node/auth/end': { access: 'session', params: empty, result: done },
  'node/files/list': {
    access: 'session',
    params: z.strictObject({ ...workspace, directory: z.nullable(nodeRelativePathSchema), cursor }),
    result: nodeFileListSchema,
  },
  'node/files/search': {
    access: 'session',
    params: z.strictObject({
      ...workspace,
      query: z.string().check(z.minLength(1), z.maxLength(NODE_MAX_COMMIT_CHARS)),
      cursor,
    }),
    result: nodeFileListSchema,
  },
  'node/files/read': {
    access: 'session',
    params: z.strictObject(pathFields),
    result: nodeFileTextSchema,
  },
  'node/files/write': {
    access: 'session',
    params: z.strictObject({ ...fileMutation, text: nodeFileTextSchema.shape.text }),
    result: z.strictObject({ digest: nodeDigestSchema }),
  },
  'node/files/upload': {
    access: 'session',
    params: z.strictObject({ ...fileMutation, ...fileBytes }),
    result: z.strictObject({ digest: nodeDigestSchema }),
  },
  'node/files/download': {
    access: 'session',
    params: z.strictObject(pathFields),
    result: z.strictObject(fileBytes),
  },
  'node/terminal/open': {
    access: 'stepUp',
    params: z.strictObject({ ...workspace, ...stepUp, size: nodeTerminalSizeSchema }),
    result: terminal,
  },
  'node/terminal/close': { access: 'session', params: terminal, result: done },
  'node/terminal/attach': { access: 'session', params: terminal, result: done },
  'node/terminal/write': {
    access: 'session',
    params: z.strictObject({ terminalId: nodeIdentifierSchema, data: nodeTerminalInputSchema }),
    result: done,
  },
  'node/terminal/resize': {
    access: 'session',
    params: z.strictObject({ terminalId: nodeIdentifierSchema, size: nodeTerminalSizeSchema }),
    result: done,
  },
  'node/maker/action': {
    access: 'stepUp',
    params: z.strictObject({
      ...stepUp,
      deviceId: nodeIdentifierSchema,
      operation: nodeIdentifierSchema,
      payload: nodeFileTextSchema.shape.text,
    }),
    result: done,
  },
  'node/git/status': {
    access: 'session',
    params: z.strictObject({ ...workspace, cursor }),
    result: z.strictObject({
      branch: z.nullable(ref),
      head,
      changes: z
        .array(
          z.strictObject({
            path: nodeRelativePathSchema,
            kind: z.enum(['modified', 'added', 'deleted', 'renamed', 'conflicted', 'untracked']),
            oldPath: z.optional(nodeRelativePathSchema),
          }),
        )
        .check(z.maxLength(NODE_MAX_PAGE_ITEMS)),
      nextCursor: cursor,
      remotes: z
        .array(
          z.strictObject({
            name: nodeIdentifierSchema.check(z.regex(/^(?!-)/u)),
            destination: nodeGitDestinationSchema,
          }),
        )
        .check(z.maxLength(NODE_MAX_PAGE_ITEMS)),
    }),
  },
  'node/git/diff': {
    access: 'session',
    params: z.strictObject({
      ...workspace,
      path: z.nullable(nodeRelativePathSchema),
      staged: z.boolean(),
    }),
    result: z.strictObject({
      head,
      digest: nodeDigestSchema,
      diff: nodeFileTextSchema.shape.text,
      truncated: z.boolean(),
    }),
  },
  'node/git/branches': {
    access: 'session',
    params: z.strictObject({ ...workspace, cursor }),
    result: z.strictObject({
      branches: z
        .array(z.strictObject({ name: ref, current: z.boolean() }))
        .check(z.maxLength(NODE_MAX_PAGE_ITEMS)),
      nextCursor: cursor,
    }),
  },
  'node/git/stage': {
    access: 'session',
    params: z.strictObject({ ...workspace, paths }),
    result: done,
  },
  'node/git/commit': {
    access: 'session',
    params: z.strictObject({
      ...workspace,
      expectedHead: head,
      message: z.string().check(z.minLength(1), z.maxLength(NODE_MAX_COMMIT_CHARS)),
    }),
    result: gitResult,
  },
  'node/git/branch': {
    access: 'session',
    params: z.strictObject({ ...workspace, name: ref, expectedHead: head }),
    result: gitResult,
  },
  'node/git/fetch': { access: 'stepUp', params: networkGit, result: gitResult },
  'node/git/pull': { access: 'stepUp', params: networkGit, result: gitResult },
  'node/git/push': { access: 'stepUp', params: networkGit, result: gitResult },
  'node/dashboard/read': { access: 'session', params: empty, result: nodeDashboardSchema },
  'node/audit/list': {
    access: 'session',
    params: z.strictObject({ cursor }),
    result: z.strictObject({
      entries: z.array(nodeAuditSchema).check(z.maxLength(NODE_MAX_PAGE_ITEMS)),
      nextCursor: cursor,
    }),
  },
  'node/stop': { access: 'session', params: empty, result: done },
  'node/lock': { access: 'session', params: empty, result: done },
  'node/wipe': { access: 'stepUp', params: z.strictObject(stepUp), result: done },
} as const
export type NodeMethodName = keyof typeof nodeMethods
export type NodeMethodParams<M extends NodeMethodName> = z.infer<(typeof nodeMethods)[M]['params']>
export type NodeMethodResult<M extends NodeMethodName> = z.infer<(typeof nodeMethods)[M]['result']>

export const nodeMethodErrorSchema = z.strictObject({
  code: z.enum([
    'invalidRequest',
    'unavailable',
    'unauthenticated',
    'forbidden',
    'stepUpRequired',
    'expired',
    'locked',
    'conflict',
    'tooLarge',
    'rateLimited',
    'notText',
    'noSuchWorkspace',
    'notFound',
    'cancelled',
    'untrusted',
    'unsupported',
  ]),
})
export interface NodeMethodPort {
  /**
  Failures are the listener's typed errors; dispatch treats anything else
  as a bug and surfaces it. Ports convert their plain failures (service,
  tools, engine) before they return.
  */
  request<M extends NodeMethodName>(
    method: M,
    params: NodeMethodParams<M>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<M>>
}
