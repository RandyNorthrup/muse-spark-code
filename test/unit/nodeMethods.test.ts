import { describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import {
  NODE_DEFAULT_PORT,
  NODE_MAX_COMMIT_CHARS,
  NODE_MAX_FILE_BYTES,
  NODE_SIGNIN_BACKOFF_MS,
  NODE_SIGNIN_BACKOFF_MAX_MS,
  NODE_TERMINAL_FRAMES_PER_S,
  NODE_WS_AUTH_MS,
  NODE_SERVICE_USER,
  NODE_GIT_OPTIONS,
  NODE_GIT_ENVIRONMENT,
} from '../../src/shared/constants'
import {
  nodeMethodErrorSchema,
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodPort,
  type NodeMethodResult,
} from '../../src/shared/hostApi/nodeMethods'
import { nodeAuthentication, nodeBearer, nodeDashboard, nodeHash } from './helpers/node/records'
import { nodeRegistrationSchema } from '../../src/shared/nodeAuth'
import { nodeGitRepositoryConfigSchema } from '../../src/shared/node'

const fileParams: NodeMethodParams<'node/files/read'> = {
  workspaceId: 'workspace-1',
  path: 'src/main.ts',
}
const fileResult: NodeMethodResult<'node/files/read'> = {
  path: fileParams.path,
  digest: nodeHash,
  text: 'hello',
}
const networkParams = {
  workspaceId: 'workspace-1',
  stepUpId: 'proof-1',
  actionDigest: nodeHash,
  remote: 'origin',
  destination: {
    host: 'git.example.test',
    port: 22,
    user: 'git',
    repository: 'owner/repo.git',
    hostKeyDigest: nodeHash,
  },
  ref: 'refs/heads/main',
  expectedHead: 'a'.repeat(40),
}

describe('node MHP method extension', () => {
  it('keeps unused node pattern initialization out of the existing runtime bundles', async () => {
    const { outputFiles } = await build({
      stdin: {
        contents: "import { PRODUCT_NAME } from './src/shared/constants'; export { PRODUCT_NAME }",
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      minify: true,
      logLevel: 'silent',
    })
    expect(outputFiles[0]!.text.includes('1,253')).toBe(false)
    expect(outputFiles[0]!.text.includes('.lock(?:/|$)')).toBe(false)
  })
  it('publishes each home-node method with its required access class', () => {
    const publicMethods = new Set(['node/auth/begin', 'node/auth/enroll', 'node/auth/signin'])
    const stepUpMethods = new Set([
      'node/terminal/open',
      'node/git/fetch',
      'node/git/pull',
      'node/git/push',
      'node/wipe',
      'node/maker/action',
    ])
    expect(Object.keys(nodeMethods)).toHaveLength(32)
    for (const [name, entry] of Object.entries(nodeMethods)) {
      const expected = publicMethods.has(name) ? 'public' : 'session'
      expect(entry.access, name).toBe(stepUpMethods.has(name) ? 'stepUp' : expected)
    }
    expect(Object.keys(nodeMethods).some((name) => /relay|pair|peek|secrets/u.test(name))).toBe(
      false,
    )
  })
  it('defines both sides of file, dashboard, terminal and sign-in replies', () => {
    expect(nodeMethods['node/files/read'].params.parse(fileParams)).toEqual(fileParams)
    expect(nodeMethods['node/files/read'].result.parse(fileResult)).toEqual(fileResult)
    expect(nodeMethods['node/dashboard/read'].result.parse(nodeDashboard()).sandbox).toBe('shared')
    expect(nodeMethods['node/auth/signin'].result.parse(nodeAuthentication())).toEqual(
      nodeAuthentication(),
    )
    expect(
      nodeMethods['node/terminal/open'].params.safeParse({
        workspaceId: 'workspace-1',
        size: { cols: 80, rows: 24 },
      }).success,
    ).toBe(false)
    expect(
      nodeMethods['node/terminal/open'].params.parse({
        workspaceId: 'workspace-1',
        stepUpId: 'proof-1',
        actionDigest: nodeHash,
        size: { cols: 80, rows: 24 },
      }).stepUpId,
    ).toBe('proof-1')
  })
  it.each(['../secret', '/state', 'src/../secret', String.raw`src\secret`])(
    'H10 refuses file traversal %s',
    (path) => {
      expect(nodeMethods['node/files/read'].params.safeParse({ ...fileParams, path }).success).toBe(
        false,
      )
    },
  )
  it('H10 requires a digest precondition for writes and upload bytes', () => {
    const write = { ...fileParams, text: 'edited' }
    expect(nodeMethods['node/files/write'].params.safeParse(write).success).toBe(false)
    expect(
      nodeMethods['node/files/write'].params.parse({ ...write, expectedDigest: nodeHash })
        .expectedDigest,
    ).toBe(nodeHash)
    expect(
      nodeMethods['node/files/upload'].params.parse({
        ...fileParams,
        expectedDigest: null,
        data: 'YQ==',
        digest: nodeHash,
      }).data,
    ).toBe('YQ==')
    expect(
      nodeMethods['node/files/upload'].params.safeParse({
        ...fileParams,
        expectedDigest: null,
        data: 'bad===',
        digest: nodeHash,
      }).success,
    ).toBe(false)
  })
  it('H09 bounds upload decoded bytes, download replies and commit messages', () => {
    const oversized = Buffer.alloc(NODE_MAX_FILE_BYTES + 1).toString('base64')
    expect(
      nodeMethods['node/files/upload'].params.safeParse({
        ...fileParams,
        expectedDigest: null,
        data: oversized,
        digest: nodeHash,
      }).success,
    ).toBe(false)
    expect(
      nodeMethods['node/files/download'].result.safeParse({ data: oversized, digest: nodeHash })
        .success,
    ).toBe(false)
    expect(
      nodeMethods['node/git/commit'].params.safeParse({
        workspaceId: 'workspace-1',
        expectedHead: null,
        message: 'x'.repeat(NODE_MAX_COMMIT_CHARS + 1),
      }).success,
    ).toBe(false)
  })
  it.each([
    '-force',
    'refs/heads/a..b',
    'refs/heads/a.lock',
    'refs/heads/@{x}',
    'refs/heads/.hidden',
    'refs/heads/a b',
    String.raw`refs/heads/a\b`,
    'refs/heads/a//b',
    'refs/heads/a/',
    'HEAD',
  ])('H14 refuses unsafe network git ref %s', (ref) => {
    expect(nodeMethods['node/git/push'].params.safeParse({ ...networkParams, ref }).success).toBe(
      false,
    )
  })
  it('git status can request the next page and diffs carry their immutable digest', () => {
    expect(
      nodeMethods['node/git/status'].params.parse({ workspaceId: 'workspace-1', cursor: 'page-2' })
        .cursor,
    ).toBe('page-2')
    expect(
      nodeMethods['node/git/status'].result.parse({
        branch: 'main',
        head: null,
        changes: [],
        nextCursor: 'page-2',
        remotes: [{ name: networkParams.remote, destination: networkParams.destination }],
      }).nextCursor,
    ).toBe('page-2')
    expect(
      nodeMethods['node/git/diff'].params.parse({
        workspaceId: 'workspace-1',
        path: null,
        staged: true,
      }).staged,
    ).toBe(true)
    expect(
      nodeMethods['node/git/diff'].result.parse({
        head: null,
        digest: nodeHash,
        diff: '+hello\n',
        truncated: false,
      }).digest,
    ).toBe(nodeHash)
    expect(
      nodeMethods['node/git/diff'].result.safeParse({ head: null, diff: '', truncated: false })
        .success,
    ).toBe(false)
  })
  it('H09 refuses a git diff beyond the UTF8 preview cap', () => {
    expect(
      nodeMethods['node/git/diff'].result.safeParse({
        head: null,
        digest: nodeHash,
        diff: '界'.repeat(NODE_MAX_FILE_BYTES),
        truncated: true,
      }).success,
    ).toBe(false)
  })
  it('H14 network operations bind remote/ref/head and cannot carry a credential', () => {
    expect(nodeMethods['node/git/push'].params.parse(networkParams)).toEqual(networkParams)
    expect(
      nodeMethods['node/git/push'].params.safeParse({
        ...networkParams,
        remote: '--upload-pack=evil',
      }).success,
    ).toBe(false)
    expect(
      nodeMethods['node/git/push'].params.safeParse({ ...networkParams, expectedHead: 'HEAD' })
        .success,
    ).toBe(false)
    expect(
      nodeMethods['node/git/push'].params.safeParse({
        ...networkParams,
        privateKey: 'SYNTHETIC-NODE-CANARY',
      }).success,
    ).toBe(false)
    expect(
      nodeMethods['node/git/commit'].result.parse({ head: 'a'.repeat(64), changed: true }).head,
    ).toHaveLength(64)
  })
  it.each([
    'core.fsmonitor',
    'core.sshcommand',
    'core.hookspath',
    'core.askpass',
    'filter.canary.smudge',
    'filter.canary.clean',
    'filter.canary.process',
    'diff.canary.command',
    'diff.canary.textconv',
    'merge.canary.driver',
    'credential.helper',
    'include.path',
    'includeif.gitdir:repo.path',
    'protocol.allow',
    'url.ssh://evil/.insteadof',
    'remote.origin.uploadpack',
    'remote.origin.receivepack',
    'future.program',
  ])('H14 closed Git snapshot refuses repository program setting %s', (name) => {
    expect(
      nodeGitRepositoryConfigSchema.safeParse({
        'core.repositoryformatversion': '0',
        [name]: 'SYNTHETICREPOSITORYPROGRAM',
      }).success,
    ).toBe(false)
  })
  it('H14 fixes safe Git overrides and refuses configuration environment injection', () => {
    expect(
      nodeGitRepositoryConfigSchema.parse({
        'core.bare': 'true',
        'extensions.objectformat': 'sha1',
      }),
    ).toEqual({ 'core.bare': 'true', 'extensions.objectformat': 'sha1' })
    expect(
      nodeGitRepositoryConfigSchema.safeParse({ GIT_CONFIG_PARAMETERS: 'core.sshCommand=canary' })
        .success,
    ).toBe(false)
    expect(nodeGitRepositoryConfigSchema.safeParse({ 'core.bare': 'true\0canary' }).success).toBe(
      false,
    )
    expect(
      nodeGitRepositoryConfigSchema.safeParse({ 'core.bare': 'true\n[core]\nsshCommand=canary' })
        .success,
    ).toBe(false)
    expect(nodeGitRepositoryConfigSchema.safeParse({ 'core.bare': '' }).success).toBe(false)
    expect(NODE_GIT_OPTIONS[0]).toBe('--no-replace-objects')
    const overrides = new Map<string, string>()
    for (let index = 1; index < NODE_GIT_OPTIONS.length; index += 2) {
      expect(NODE_GIT_OPTIONS[index]).toBe('-c')
      const [name, value] = NODE_GIT_OPTIONS[index + 1]!.split('=', 2)
      overrides.set(name!, value!)
    }
    expect(Object.fromEntries(overrides)).toEqual({
      'core.fsmonitor': 'false',
      'core.hooksPath': '/dev/null',
      'core.sshCommand': '',
      'credential.helper': '',
      'diff.external': '',
      'core.askPass': '',
      'core.pager': '',
      'interactive.diffFilter': '',
      'core.attributesFile': '/dev/null',
      'core.excludesFile': '/dev/null',
      'commit.gpgsign': 'false',
      'tag.gpgsign': 'false',
      'log.showSignature': 'false',
      'submodule.recurse': 'false',
      'protocol.allow': 'never',
      'protocol.ssh.allow': 'always',
      'maintenance.auto': 'false',
      'gc.auto': '0',
    })
    expect(NODE_GIT_ENVIRONMENT).toEqual({
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'ssh',
    })
  })
  it('H14 requires the resolved SSH destination and host key before approving network Git', () => {
    const { destination, ...aliasOnly } = networkParams
    for (const method of ['node/git/fetch', 'node/git/pull', 'node/git/push'] as const) {
      expect(nodeMethods[method].params.safeParse(aliasOnly).success).toBe(false)
      expect(nodeMethods[method].params.parse(networkParams).destination).toEqual(destination)
      for (const invalid of [
        { ...destination, host: '-evil' },
        { ...destination, host: 'other.test/path' },
        { ...destination, port: 0 },
        { ...destination, user: '-oProxyCommand=canary' },
        { ...destination, repository: '../repo' },
        { ...destination, hostKeyDigest: 'unverified' },
        { ...destination, password: 'SYNTHETIC-NODE-CANARY' },
      ])
        expect(
          nodeMethods[method].params.safeParse({ ...networkParams, destination: invalid }).success,
        ).toBe(false)
    }
    expect(
      nodeMethods['node/git/status'].result.parse({
        branch: 'main',
        head: networkParams.expectedHead,
        changes: [],
        nextCursor: null,
        remotes: [{ name: 'origin', destination }],
      }).remotes,
    ).toEqual([{ name: 'origin', destination }])
  })
  it('H04 setup code is confined to enrollment, never a sign-in reply', () => {
    expect(
      nodeMethods['node/auth/begin'].params.parse({ purpose: 'enroll', setupCode: nodeBearer })
        .purpose,
    ).toBe('enroll')
    expect(
      nodeMethods['node/auth/begin'].params.safeParse({ purpose: 'signin', setupCode: nodeBearer })
        .success,
    ).toBe(false)
    expect(
      nodeMethods['node/auth/enroll'].params.safeParse({
        challengeId: 'c',
        credential: nodeRegistrationSchema.parse({
          id: 'YQ',
          rawId: 'YQ',
          type: 'public-key',
          clientExtensionResults: {},
          response: { clientDataJSON: 'e30', attestationObject: 'YQ' },
        }),
      }).success,
    ).toBe(true)
  })
  it('rejects unknown payloads even for stop/lock and errors have no raw text', () => {
    for (const method of ['node/stop', 'node/lock'] as const) {
      expect(nodeMethods[method].params.safeParse({ command: 'shell' }).success).toBe(false)
      expect(nodeMethods[method].result.parse({ done: true })).toEqual({ done: true })
    }
    expect(nodeMethodErrorSchema.parse({ code: 'stepUpRequired' })).toEqual({
      code: 'stepUpRequired',
    })
    expect(nodeMethodErrorSchema.safeParse({ code: 'expired', message: nodeBearer }).success).toBe(
      false,
    )
  })
  it('provides a typed injected transport seam without guessing the frozen MHP envelope', async () => {
    const port: NodeMethodPort = {
      request: vi.fn(() => Promise.reject(new Error('unbound test transport'))),
    }
    const method: NodeMethodName = 'node/files/read'
    await expect(port.request(method, fileParams, new AbortController().signal)).rejects.toThrow(
      'unbound',
    )
    expect(port.request).toHaveBeenCalledWith(method, fileParams, expect.any(AbortSignal))
  })
  it('fixes first-frame, rate and sign-in defaults for the owning runtime lanes', () => {
    expect({
      NODE_DEFAULT_PORT,
      NODE_WS_AUTH_MS,
      NODE_TERMINAL_FRAMES_PER_S,
      NODE_SIGNIN_BACKOFF_MS,
      NODE_SIGNIN_BACKOFF_MAX_MS,
      NODE_SERVICE_USER,
    }).toEqual({
      NODE_DEFAULT_PORT: 7443,
      NODE_WS_AUTH_MS: 5000,
      NODE_TERMINAL_FRAMES_PER_S: 64,
      NODE_SIGNIN_BACKOFF_MS: 1000,
      NODE_SIGNIN_BACKOFF_MAX_MS: 60_000,
      NODE_SERVICE_USER: 'muse-node',
    })
  })
})
