// Closed Git dispatch (RVM110L0-1). No arbitrary client argv, config or
// inherited GIT_/SSH/credential environment reaches service Git.
import { execFile } from 'node:child_process'
import path from 'node:path'
import * as z from 'zod/mini'
import { lstatIdentity } from '../../core/fs/fileIdentity'
import {
  NODE_BIGINT_ZERO,
  NODE_COMMAND_TIMEOUT_MS,
  NODE_EXECUTABLE_WRITE_MASK,
  NODE_GIT_ENVIRONMENT,
  NODE_GIT_OPTIONS,
  NODE_TERMINAL_OUTPUT_BYTES,
  NODE_TOOLS_PATH,
  NODE_MAX_LABEL_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import {
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
} from '../../shared/hostApi/nodeMethods'
import { nodeGitDestinationSchema } from '../../shared/node'
import type { NodePrivateFiles } from './privateFiles'
import { createNodeGitSnapshot, type NodeGitSnapshot } from './gitSnapshot'

type GitMethod = Extract<NodeMethodName, `node/git/${string}`>
type NetworkParams = NodeMethodParams<'node/git/push'>
export interface NodeGitNetworkPort {
  // Atomically consumes/rechecks step-up, service registration, destination,
  // host key, ref and head immediately before giving the trusted runner a socket.
  // The wrapper pins that host key and refuses SSH config/proxy/forwarding.
  use<T>(
    params: NetworkParams,
    signal: AbortSignal,
    run: (binding: {
      socket: string
      wrapper: string
      destination: NetworkParams['destination']
    }) => Promise<T>,
  ): Promise<T>
}
export interface NodeGitRunnerOptions {
  readonly files: NodePrivateFiles
  readonly workspaceRoot: string
  readonly workspacePath: (id: string) => Promise<string>
  readonly git: string
  readonly execPath: string
  readonly network: NodeGitNetworkPort
  commitIdentity(): Promise<{ name: string; email: string }>
  /** U1 applies the changed data through its tools-UID/stale-write boundary. */
  publish(
    snapshot: NodeGitSnapshot,
    method: GitMethod,
    expectedHead: string | null,
    signal: AbortSignal,
  ): Promise<void>
}

async function trustedExecutable(file: string, isDirectory = false): Promise<void> {
  if (!path.isAbsolute(file)) throw new Error(UI_TEXT.nodeErrors.forbidden)
  const info = await lstatIdentity(file)
  if (
    info.isSymbolicLink() ||
    (isDirectory ? !info.isDirectory() : !info.isFile()) ||
    (info.mode & BigInt(NODE_EXECUTABLE_WRITE_MASK)) !== NODE_BIGINT_ZERO ||
    (info.uid !== NODE_BIGINT_ZERO &&
      info.uid !== BigInt(process.getuid === undefined ? -1 : process.getuid()))
  ) {
    throw new Error(UI_TEXT.nodeErrors.forbidden)
  }
}

function sshUrl(destination: NetworkParams['destination']): string {
  const parsed = nodeGitDestinationSchema.parse(destination)
  return `ssh://${parsed.user}@${parsed.host}:${String(parsed.port)}/${parsed.repository
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`
}

export class NodeClosedGitRunner {
  constructor(private readonly options: NodeGitRunnerOptions) {}

  private async execute(
    snapshot: NodeGitSnapshot,
    args: readonly string[],
    signal: AbortSignal,
    ssh?: { socket: string; wrapper: string },
  ): Promise<string> {
    signal.throwIfAborted()
    const env: NodeJS.ProcessEnv = {
      PATH: NODE_TOOLS_PATH,
      HOME: this.options.files.root,
      ...NODE_GIT_ENVIRONMENT,
      GIT_EXEC_PATH: this.options.execPath,
    }
    if (ssh !== undefined) {
      if (!path.isAbsolute(ssh.socket) || !/^[A-Za-z0-9_/.+-]+$/u.test(ssh.wrapper))
        throw new Error(UI_TEXT.nodeErrors.forbidden)
      await trustedExecutable(ssh.wrapper)
      env['SSH_AUTH_SOCK'] = ssh.socket
      env['GIT_SSH_COMMAND'] = ssh.wrapper
    }
    return await new Promise<string>((resolve, reject) => {
      execFile(
        this.options.git,
        [
          ...NODE_GIT_OPTIONS,
          `--git-dir=${snapshot.gitDir}`,
          `--work-tree=${snapshot.workTree}`,
          ...args,
        ],
        {
          cwd: snapshot.gitDir,
          env,
          signal,
          timeout: NODE_COMMAND_TIMEOUT_MS,
          maxBuffer: NODE_TERMINAL_OUTPUT_BYTES,
          encoding: 'utf8',
        },
        (error, stdout) => {
          if (error !== null) {
            reject(new Error(UI_TEXT.nodeErrors.unavailable))
            return
          }
          resolve(stdout)
        },
      )
    })
  }

  async run<M extends GitMethod>(
    method: M,
    input: NodeMethodParams<M>,
    signal: AbortSignal,
  ): Promise<string> {
    const params = nodeMethods[method].params.parse(input)
    await trustedExecutable(this.options.git)
    await trustedExecutable(this.options.execPath, true)
    const snapshot = await createNodeGitSnapshot(
      this.options.files,
      this.options.workspaceRoot,
      await this.options.workspacePath(params.workspaceId),
      signal,
    )
    try {
      if ('remote' in params) {
        const networkParams = nodeMethods['node/git/push'].params.parse(params)
        const url = sshUrl(networkParams.destination)
        return await this.options.network.use(networkParams, signal, async (binding) => {
          if (
            JSON.stringify(nodeGitDestinationSchema.parse(binding.destination)) !==
            JSON.stringify(networkParams.destination)
          )
            throw new Error(UI_TEXT.nodeErrors.conflict)
          const headOutput = await this.execute(snapshot, ['rev-parse', '--verify', 'HEAD'], signal)
          const head = headOutput.trim()
          if (head !== networkParams.expectedHead) throw new Error(UI_TEXT.nodeErrors.conflict)
          const args =
            method === 'node/git/push'
              ? ['push', '--no-recurse-submodules', url, `${head}:${networkParams.ref}`]
              : ['fetch', '--no-tags', '--no-recurse-submodules', url, networkParams.ref]
          const output = await this.execute(snapshot, args, signal, binding)
          if (method === 'node/git/pull')
            await this.execute(snapshot, ['merge', '--ff-only', '--no-edit', 'FETCH_HEAD'], signal)
          if (method !== 'node/git/push')
            await this.options.publish(snapshot, method, networkParams.expectedHead, signal)
          return output
        })
      }
      let args: string[]
      switch (method) {
        case 'node/git/status': {
          args = ['status', '--porcelain=v1', '-z']
          break
        }
        case 'node/git/branches': {
          args = ['for-each-ref', '--format=%(refname)', 'refs/heads/']
          break
        }
        case 'node/git/diff': {
          const diff = nodeMethods['node/git/diff'].params.parse(params)
          args = [
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            ...(diff.staged ? ['--cached'] : []),
            '--',
            ...(diff.path === null ? [] : [diff.path]),
          ]
          break
        }
        case 'node/git/stage': {
          args = ['add', '--', ...nodeMethods['node/git/stage'].params.parse(params).paths]
          break
        }
        case 'node/git/commit': {
          const identity = z
            .strictObject({
              name: z
                .string()
                .check(z.minLength(1), z.maxLength(NODE_MAX_LABEL_CHARS), z.regex(/^[^\p{Cc}]+$/u)),
              email: z.email(),
            })
            .parse(await this.options.commitIdentity())
          args = [
            '-c',
            `user.name=${identity.name}`,
            '-c',
            `user.email=${identity.email}`,
            'commit',
            '-m',
            nodeMethods['node/git/commit'].params.parse(params).message,
          ]
          break
        }
        case 'node/git/branch': {
          args = ['branch', '--', nodeMethods['node/git/branch'].params.parse(params).name]
          break
        }
        default: {
          throw new Error(UI_TEXT.nodeErrors.unsupported)
        }
      }
      const expectedHead = 'expectedHead' in params ? params.expectedHead : null
      if (expectedHead !== null) {
        const headOutput = await this.execute(snapshot, ['rev-parse', '--verify', 'HEAD'], signal)
        if (headOutput.trim() !== expectedHead) throw new Error(UI_TEXT.nodeErrors.conflict)
      }
      const output = await this.execute(snapshot, args, signal)
      if (['node/git/stage', 'node/git/commit', 'node/git/branch'].includes(method))
        await this.options.publish(snapshot, method, expectedHead, signal)
      return output
    } finally {
      await snapshot.dispose()
    }
  }
}
