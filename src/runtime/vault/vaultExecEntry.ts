// dist/vaultExec.js (D243 lane X): the feeder. The host starts it in
// place of the command with the approved envelope on inherited fd 3; it
// redeems each ticket on its own broker connection under the host's
// delegation, runs exactly that command with the redeemed values, and
// writes only the scrubbed result to stdout. It never registers as a
// host or a requester (D243.3) and launches no broker: without a
// running broker and a delegation it refuses, in fixed words.

import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import type * as ResourceGovernor from '../../core/resources/resourceGovernorEntry'
import { realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { UI_TEXT, VAULT_PROTOCOL_VERSION } from '../../shared/constants'
import { errorNameForLog } from '../../core/logging'
import { type VaultBrokerClient } from '../../core/vault/broker/client'
import { openVaultFeederClient } from '../../core/vault/broker/feederClient'
import { VaultBrokerDiscovery } from '../../core/vault/broker/discovery'
import { UnixVaultPeerVerifier } from '../../core/vault/broker/peer'
import {
  expectedVaultSocketLocations,
  isExpectedVaultSocket,
} from '../../core/vault/broker/socketDirectory'
import { VaultScrubber } from '../../core/vault/scrub'
import { readVaultExecEnvelope } from '../../core/vault/exec/entry'
import { runVaultFeeder } from '../../core/vault/exec/feeder'
import { vaultExecEnvelopeDigest } from '../../core/vault/exec/envelopeDigest'
import {
  type VaultExecFeederPort,
  type VaultExecLease,
  type VaultExecScrubStream,
} from '../../core/vault/exec/feeder'
import { vaultExecEnvelopeSchema, type VaultExecEnvelope } from '../../core/vault/exec/schema'
import { vaultExecProcessRunner } from '../../host/vault/vaultExecSpawn'
import { killTree, type ProcessTreeDeps } from '../../host/processTree'
import { configureBrokerResources } from './brokerResources'
import { vaultInstallRoot } from './clientLaunch'
import { vaultPeerExecutable, vaultProcessIdentity, vaultSocketDescriptors } from './posixNative'
import { vaultBrokerDataDir } from './vaultStoreScope'
export { setUiText } from '../../shared/l10n/text'

interface FeederBrokerConnection {
  readonly client: VaultBrokerClient
  close(): Promise<void>
}

/** Discovery for a feeder: the running broker only, never a launch. */
async function discoverFeederBroker(
  dataDir: string,
  distDir: string,
): Promise<FeederBrokerConnection> {
  const runDirectory = path.join(dataDir, 'vault', 'run')
  if (process.platform === 'win32') {
    // Files mode only (identity reads and the dialer): the feeder owns
    // no pipe and registers no host. Written for hosted CI, as D243
    // records; the helpers are the installed ones, built by first use.
    const { windowsPipeExecutable } = await import('../../host/vault/slots/windowsVaultBuild')
    const { startWindowsPipeFiles, inspectWindowsPipeServer } = await import('./windowsPipeRelay')
    const { windowsProcessIdentity } = await import('./windowsHost')
    const { readFile } = await import('node:fs/promises')
    const { connect } = await import('node:net')
    const { isVaultPipeServerTrusted, windowsVaultPipeNameSchema } =
      await import('../../core/vault/broker/windowsPipe')
    const { WindowsVaultPeerVerifier } = await import('../../core/vault/broker/peer')
    const installRoot = vaultInstallRoot({ dataDir, distDir, hostId: '', hostSession: '' })
    const systemRoot = process.env['SystemRoot']
    if (!systemRoot) throw new Error(UI_TEXT.vault.noAccess)
    const pipeHelper = await windowsPipeExecutable({
      storageDir: path.join(dataDir, 'vault', 'helpers'),
      systemRoot,
      readSlotSource: () =>
        readFile(path.join(installRoot, 'native/windows/MuseSparkVault.cs'), 'utf8'),
      readPipeSource: () =>
        readFile(path.join(installRoot, 'native/windows/MuseSparkVaultPipe.cs'), 'utf8'),
    })
    const pipeFiles = await startWindowsPipeFiles({
      file: pipeHelper.file,
      sha256: pipeHelper.sha256,
      powershell: pipeHelper.powershell,
      guardSource: pipeHelper.guardSource,
      rebuild: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
      report: () => {
        process.stderr.write('vault-slot-rebuild-refused\n')
      },
    })
    try {
      const self = await pipeFiles.inspectProcess(process.pid)
      const ownerSid = self.ownerSid
      const discovery = new VaultBrokerDiscovery(runDirectory, ownerSid, pipeFiles.privateFiles)
      const location = await discovery.discover(async (pid) => {
        const found = await windowsProcessIdentity(pipeFiles.relay, pid)
        if (!found) throw new Error(UI_TEXT.vault.noAccess)
        return found.process
      })
      if (!location) throw new Error(UI_TEXT.vault.noAccess)
      const pipe = windowsVaultPipeNameSchema.parse(location.lock.socket)
      const server = await pipeFiles.inspectServer(pipe)
      if (!isVaultPipeServerTrusted(server, ownerSid)) throw new Error(UI_TEXT.vault.noAccess)
      const dial = {
        verifyPipe: async (name: string) => {
          const answer = await inspectWindowsPipeServer(pipeFiles.relay, name)
          if (!isVaultPipeServerTrusted(answer, ownerSid) || answer.server === null)
            throw new Error(UI_TEXT.vault.noAccess)
          return {
            processId: answer.server.processId,
            userId: answer.server.userId,
            startedAt: answer.server.startedAt,
            executable: answer.server.executable,
          }
        },
        connectPipe: (name: string) => connect(name),
      }
      const peers = new WindowsVaultPeerVerifier(
        {
          inspect: () => {
            throw new Error(UI_TEXT.vault.noAccess)
          },
        },
        ownerSid,
      )
      const client = await openVaultFeederClient(location, peers, dial)
      return {
        client,
        close: async () => {
          client.close()
          await pipeFiles.stop()
        },
      }
    } catch (error: unknown) {
      await pipeFiles.stop()
      throw error
    }
  }
  const installRoot = vaultInstallRoot({ dataDir, distDir, hostId: '', hostSession: '' })
  const helper = vaultPeerExecutable(installRoot)
  const userSession = `${String(process.getuid?.())}:${process.env['XDG_SESSION_ID'] ?? 'login'}`
  const discovery = new VaultBrokerDiscovery(runDirectory, userSession)
  const location = await discovery.discover(async (pid) => {
    const found = await vaultProcessIdentity(helper, pid)
    if (!found) throw new Error(UI_TEXT.vault.noAccess)
    return found
  })
  if (!location) throw new Error(UI_TEXT.vault.noAccess)
  const expected = expectedVaultSocketLocations(vaultBrokerDataDir(dataDir), {
    platform: process.platform,
    env: process.env,
    tmpdir: os.tmpdir(),
    homeDir: os.homedir(),
  })
  if (!(await isExpectedVaultSocket(location.lock.socket, expected)))
    throw new Error(UI_TEXT.vault.noAccess)
  const peers = new UnixVaultPeerVerifier(
    helper,
    async (pid) => {
      const found = await vaultProcessIdentity(helper, pid)
      if (!found) throw new Error(UI_TEXT.vault.noAccess)
      return found
    },
    vaultSocketDescriptors,
  )
  const client = await openVaultFeederClient(location, peers)
  return {
    client,
    close: () => {
      client.close()
      return Promise.resolve()
    },
  }
}

/** One broker connection for the feeder's whole life; leases end on it. */
class FeederBroker {
  private connection: FeederBrokerConnection | undefined
  private readonly revoked = new AbortController()
  constructor(
    private readonly dataDir: string,
    private readonly distDir: string,
    private readonly envelopeDigest: string,
  ) {}
  private async connect(): Promise<VaultBrokerClient> {
    if (!this.connection) {
      this.connection = await discoverFeederBroker(this.dataDir, this.distDir)
      void this.connection.client.closed().then(() => {
        this.revoked.abort()
      })
    }
    return this.connection.client
  }
  async redeem(
    approval: VaultExecEnvelope['approvals'][number],
    signal: AbortSignal,
  ): Promise<VaultExecLease> {
    signal.throwIfAborted()
    const client = await this.connect()
    signal.throwIfAborted()
    const response = await client.send({
      v: VAULT_PROTOCOL_VERSION,
      kind: 'execRedeem',
      ticket: approval.ticket,
      use: approval.use,
      envelopeDigest: this.envelopeDigest,
    })
    signal.throwIfAborted()
    if (response.kind !== 'execMaterial' || response.ticketId !== approval.ticket.id)
      throw new Error(UI_TEXT.vault.noAccess)
    const decoded = Buffer.from(response.value, 'base64')
    const decodedUser = response.username === null ? null : Buffer.from(response.username, 'base64')
    const value = Buffer.alloc(decoded.length)
    value.set(decoded)
    decoded.fill(0)
    const username = decodedUser === null ? null : Buffer.alloc(decodedUser.length)
    if (username !== null && decodedUser !== null) {
      username.set(decodedUser)
      decodedUser.fill(0)
    }
    const expiresAt = response.expiresAt
    let isClosed = false
    return {
      value,
      username,
      expiresAt,
      revoked: this.revoked.signal,
      close: async (succeeded) => {
        value.fill(0)
        username?.fill(0)
        if (isClosed) return
        isClosed = true
        const answer = await client.send({
          v: VAULT_PROTOCOL_VERSION,
          kind: 'execFinish',
          ticketId: approval.ticket.id,
          succeeded,
        })
        if (answer.kind !== 'ok') throw new Error(UI_TEXT.vault.noAccess)
      },
    }
  }
  async close(): Promise<void> {
    await this.connection?.close()
    this.connection = undefined
  }
}

/** Bytes in, scrubbed text out: split matches wait in the stream. */
function scrubStream(values: readonly Uint8Array[]): VaultExecScrubStream {
  const scrubber = new VaultScrubber(values)
  const stream = scrubber.stream()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  return {
    push: (bytes) => stream.push(decoder.decode(bytes, { stream: true })),
    end: () => stream.push(decoder.decode()) + stream.finish(),
    dispose: () => {
      stream.dispose()
      scrubber.dispose()
    },
  }
}

async function main(): Promise<void> {
  const [dataDir, timeoutText] = process.argv.slice(2)
  if (!dataDir || !path.isAbsolute(dataDir) || !/^\d+$/u.test(timeoutText ?? ''))
    throw new Error(UI_TEXT.vault.noAccess)
  const timeoutMs = Number(timeoutText)
  const distDir = __dirname
  const installRoot = vaultInstallRoot({ dataDir, distDir, hostId: '', hostSession: '' })
  const resourcesDir = path.join(dataDir, 'vault', 'run', `feeder-${String(process.pid)}`)
  const disposeResources = await configureBrokerResources(
    { dataDir: vaultBrokerDataDir(dataDir), runDirectory: resourcesDir, installRoot },
    () =>
      Promise.resolve(
        createRequire(__filename)(path.join(__dirname, 'resourceGovernor.js')) as Pick<
          typeof ResourceGovernor,
          'createResources'
        >,
      ),
  )
  const controller = new AbortController()
  const stop = (): void => {
    controller.abort()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  // The envelope arrives only on the inherited pipe the host spawned us
  // with: never argv, environment or a file (D89.4).
  const pipe = createReadStream('', { fd: 3, autoClose: false })
  let broker: FeederBroker | undefined
  try {
    // The digest binds the delegation to this exact envelope; compute it
    // from the same parsed envelope the feeder core then runs.
    const envelope = vaultExecEnvelopeSchema.parse(await readVaultExecEnvelope(pipe))
    broker = new FeederBroker(dataDir, distDir, vaultExecEnvelopeDigest(envelope))
    const feederBroker = broker
    const tree: ProcessTreeDeps = {
      platform: process.platform,
      systemRoot: process.env['SystemRoot'],
      log: () => {
        process.stderr.write('vault-exec-tree-refused\n')
      },
    }
    let runStartedAt = Date.now()
    const run = vaultExecProcessRunner(tree, timeoutMs, async (child) => {
      await killTree(child, tree, runStartedAt)
    })
    const port: VaultExecFeederPort = {
      platform: process.platform,
      redeem: async (approval, signal) => await feederBroker.redeem(approval, signal),
      scrub: scrubStream,
      realPath: async (candidate) => await realpath(candidate),
      now: () => Date.now(),
      // First increment (D243.1): no SSH or helper surfaces. The broker
      // refuses those uses on this transport before a lease exists, so
      // these stay unreachable; they refuse in fixed words regardless.
      sshSocket: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
      helpers: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
      run: async (invocation, signal, stdout, stderr) => {
        runStartedAt = Date.now()
        return await run(invocation, signal, stdout, stderr)
      },
    }
    const result = await runVaultFeeder(envelope, process.env, port, controller.signal)
    process.stdout.write(
      JSON.stringify({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        isTimedOut: result.isTimedOut,
        isCancelled: result.isCancelled,
        ...(result.isOutputTooLarge !== undefined && {
          isOutputTooLarge: result.isOutputTooLarge,
        }),
      }),
    )
  } finally {
    pipe.destroy()
    await broker?.close()
    disposeResources()
    await rm(resourcesDir, { recursive: true, force: true })
  }
}

/** The feeder's only record is its stderr: fixed words, never a value, a path or an exception's text (D89.4). */
const feederLog = {
  warn: (line: string): void => {
    process.stderr.write(`${line}\n`)
  },
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    feederLog.warn(`vault-exec-refused ${errorNameForLog(error)}`)
    process.exitCode = 1
  })
}
