import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { workspaceChildEnvironment } from '../../core/execGuard'
import { writePrivateRecord } from './registry'
import path from 'node:path'
import type { ResourceTicket, ResourceProcessIdentity } from '../../shared/resources'
import type { StopBinding } from './stopReceipt'
import { RUNTIME_STOP } from '../../shared/constants'
import { jobSourceReader } from '../../host/backend/jobSource'
import { shellJobAssembly } from '../../host/backend/shellJob'
import { mcpJobExecutable } from '../../host/backend/mcpJobExecutable'
import { spawnMcpJob } from '../../host/backend/mcpJobLaunch'
import { withoutCredentials, withoutKeyringRoutes } from '../credentialVariables'

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
const log = () => {
  /* Fixed LSP failures replace private helper diagnostics. */
}

export async function processAuthority(packageRoot: string, storageDir: string) {
  const {
    LinuxResourceTreeReader,
    MacResourceTreeReader,
    WindowsResourceTreeReader,
    ResourceTreeRegistry,
  } = await import('../../core/resources/resourceGovernorEntry')
  const systemRoot = process.env['SystemRoot'] ?? String.raw`C:\Windows`
  const deps = { storageDir, systemRoot, log, readJobSource: jobSourceReader(packageRoot) }
  const assembly = process.platform === 'win32' ? await shellJobAssembly(deps)() : undefined
  const executable = process.platform === 'win32' ? await mcpJobExecutable(deps)() : undefined
  if (process.platform === 'win32' && (assembly === undefined || executable === undefined))
    throw new Error('ESTOP_JOB')
  let reader:
    | InstanceType<typeof LinuxResourceTreeReader>
    | InstanceType<typeof MacResourceTreeReader>
    | InstanceType<typeof WindowsResourceTreeReader>
  switch (process.platform) {
    case 'linux': {
      reader = new LinuxResourceTreeReader()
      break
    }
    case 'darwin': {
      reader = new MacResourceTreeReader({
        helperPath: path.join(packageRoot, 'native', 'darwin', 'muse-dictate'),
      })
      break
    }
    case 'win32': {
      if (assembly === undefined) throw new Error('ESTOP_JOB')
      reader = new WindowsResourceTreeReader({ assemblyPath: assembly, systemRoot })
      break
    }
    default: {
      throw new Error('ESTOP_PLATFORM')
    }
  }
  const registry = new ResourceTreeRegistry(reader)
  const identity = reader.identity.bind(reader)

  async function register(pid: number, scope: ResourceTicket['scope']): Promise<ResourceTicket> {
    const root = await identity(pid)
    if (root === null) throw new Error('ESTOP_IDENTITY')
    return await registry.register({
      id: randomUUID(),
      root,
      scope,
      kind: 'worker',
      class: 'foreground',
      sessionId: null,
    })
  }
  async function launch(
    file: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    preload: string,
    isIndependent = false,
  ) {
    let ticket: ResourceTicket
    let child: ChildProcessWithoutNullStreams
    const clean = workspaceChildEnvironment(
      process.platform,
      withoutKeyringRoutes(withoutCredentials(env)),
      {
        workspaceRoot: cwd,
        realpath: realpathSync,
      },
    )
    if (executable === undefined) {
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- trusted installed Node workload waits on private fd before execution; exact registry proof precedes admission (PLAN §8).
      child = spawn(file, ['--require', preload, ...args], {
        cwd,
        env: clean,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      })
      const { promise: failed, reject } = Promise.withResolvers<never>()
      child.once('error', reject)
      if (child.pid === undefined) return await failed
      try {
        ticket = await Promise.race([
          register(child.pid, { type: 'group', pgid: child.pid }),
          failed,
        ])
      } catch (error: unknown) {
        child.stdio[RUNTIME_STOP.launchFd]?.destroy()
        child.stdin.destroy()
        child.stdout.resume()
        child.stderr.resume()
        throw error
      }
      const gate = child.stdio[RUNTIME_STOP.launchFd]
      if (gate === null || gate === undefined || !('write' in gate)) throw new Error('ESTOP_LAUNCH')
      // Caller can register the same exact ticket in the EOF guardian before admission.
      return {
        child,
        ticket,
        admit: () => {
          gate.end('G')
        },
      }
    }
    const name = String.raw`Local\MuseSparkLsp-${randomUUID()}`
    const { promise, resolve, reject } = Promise.withResolvers<ResourceTicket>()
    child = spawnMcpJob({
      executablePath: executable,
      file,
      args,
      cwd,
      env: clean,
      isVerbatim: false,
      log,
      jobName: name,
      independent: isIndependent,
      registered: async (pid) => {
        try {
          resolve(await register(pid, { type: 'job', name }))
        } catch (error: unknown) {
          reject(error)
          throw error
        }
      },
    })
    child.once('error', reject)
    child.once('close', () => {
      reject(new Error('ESTOP_JOB'))
    })
    ticket = await promise
    return {
      child,
      ticket,
      admit: () => {
        /* Windows native GO admits its job atomically. */
      },
    }
  }

  async function stop(
    ticket: ResourceTicket,
    shouldGracefullyStop = false,
  ): Promise<readonly ResourceProcessIdentity[]> {
    const observed = new Map<string, ResourceProcessIdentity>([
      [`${String(ticket.root.pid)}:${ticket.root.startTime}`, ticket.root],
    ])
    const deadline = Date.now() + RUNTIME_STOP.exitMs
    let result = await registry.kill(ticket, shouldGracefullyStop ? 'SIGTERM' : 'SIGKILL')
    if (shouldGracefullyStop) await pause(RUNTIME_STOP.graceMs)
    for (;;) {
      for (const member of result.members)
        observed.set(`${String(member.identity.pid)}:${member.identity.startTime}`, member.identity)
      if (result.members.some((member) => member.result === 'refused'))
        throw new Error('ESTOP_TREE')
      // Preserve the registry's detailed snapshot. A later reused group cannot erase
      // these receipts; only fresh verified per-member actions attest their departure.
      if (
        result.status !== 'refused' &&
        result.members.length > 0 &&
        result.members.every(
          (member) => member.result === 'gone' || member.result === 'identity-changed',
        )
      ) {
        registry.unregister(ticket)
        return Array.from(observed, ([, member]) => member)
      }
      if (Date.now() >= deadline) throw new Error('ESTOP_TREE')
      await pause(RUNTIME_STOP.pollMs)
      if (result.status === 'refused') {
        // Unknown enumeration admits no action. Retry inside the same Stop deadline.
        result = await registry.kill(ticket)
        continue
      }
      const members = []
      for (const member of result.members) {
        if (Date.now() >= deadline) throw new Error('ESTOP_TREE')
        members.push({
          identity: member.identity,
          result:
            member.result === 'done'
              ? await registry.signal(ticket, member.identity, 'SIGKILL')
              : member.result,
        })
      }
      result = { status: 'done', members }
      // Surviving registered members can still spawn: refresh while an anchor remains.
      if (members.some((member) => member.result === 'done')) result = await registry.kill(ticket)
    }
  }
  async function writeReceipt(
    file: string,
    binding: StopBinding,
    members: readonly ResourceProcessIdentity[],
    isComplete: boolean,
  ) {
    const text = JSON.stringify({ ...binding, members, isComplete })
    if (Buffer.byteLength(text) > RUNTIME_STOP.recordBytes) throw new Error('ESTOP_RECORD')
    // Completion is immutable and exclusive. Observations have their own sibling;
    // an older completed receipt can never be silently replaced or adopted.
    if (isComplete) await writePrivateRecord(file, text)
    else {
      const next = `${file}.${randomUUID()}`
      await writePrivateRecord(next, text)
      await rename(next, `${file}.observed`)
    }
  }
  return { registry, identity, register, launch, stop, writeReceipt }
}

// The existing deferred authority cohort also owns private-state verification.
export { verifyTrustedPath } from '../trustedPath'
export {
  treeReceiptSchema,
  ownerSchema,
  guardianMessageSchema,
  isSameProcess,
  isReceiptMatching,
  rootLocatorSchema,
} from './stopReceipt'
