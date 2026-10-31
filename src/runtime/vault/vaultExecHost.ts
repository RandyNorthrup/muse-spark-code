// D243 first increment: the headless host port behind `vault_run`.
// It authorizes environment/stdin uses through the run's registered
// headless session, spawns the feeder (dist/vaultExec.js) in place of
// the command, and delegates each ticket to that exact feeder process
// before the envelope reaches it. The values themselves only ever
// travel broker → feeder → command; this host never sees one (D89.4).

import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { UI_TEXT, VAULT_EXEC_BUNDLE_FILE } from '../../shared/constants'
import { spawnGuarded } from '../../core/guardedChildProcess'
import { probeChildEnvironment } from '../../core/executables'
import { VaultExecService, type VaultExecHostPort } from '../../core/vault/exec/service'
import { vaultExecEnvelopeDigest } from '../../core/vault/exec/envelopeDigest'
import { VaultTaintSession } from '../../core/vault/taint'
import { spawnVaultFeeder } from '../../host/vault/vaultExecSpawn'
import { killTree, treeSpawnOptions, type ProcessTreeDeps } from '../../host/processTree'
import { type HeadlessVaultBroker } from './execVault'
import { vaultPeerExecutable, vaultProcessIdentity } from './posixNative'
import { vaultInstallRoot } from './clientLaunch'

export interface HeadlessVaultExecDeps {
  readonly broker: HeadlessVaultBroker
  /** The folder holding dist/vaultExec.js (the install's dist). */
  readonly distDir: string
  /** The client data folder the feeder discovers the broker under. */
  readonly dataDir: string
  readonly nodePath: string
  readonly env: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
}

/** One VaultExecService over the run's headless registration. */
export function createHeadlessVaultExecService(deps: HeadlessVaultExecDeps): VaultExecService {
  // D243 lane T: one provenance session per agent session (this service
  // is built once per exec run and cached by its factory). The workspace
  // is the operator's own chosen folder for the run, so it starts
  // trusted; observations only ever add taint from there.
  const taints = new VaultTaintSession('modelApi')
  taints.beginRequest([], true)
  const tree: ProcessTreeDeps = {
    platform: deps.platform,
    systemRoot: deps.env['SystemRoot'],
    log: () => {
      process.stderr.write('vault-exec-tree-refused\n')
    },
  }
  const port: VaultExecHostPort = {
    platform: deps.platform,
    authorize: async (handle, use, signal) => {
      // First increment (D243.1): environment/stdin uses only. The
      // git/askpass/sudo/SSH surfaces refuse here, before any ticket.
      if (use.kind !== 'environment' && use.kind !== 'stdin')
        throw new Error(UI_TEXT.vault.noAccess)
      const result = await deps.broker.authorize(handle, use, taints.current(), signal)
      if (result.kind !== 'ticket') throw new Error(UI_TEXT.vault.noAccess)
      return result.ticket
    },
    list: async (signal) => {
      signal.throwIfAborted()
      return await deps.broker.list()
    },
    // Headless has no person to ask for a missing item (D89.10).
    requestMissing: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
    realPath: async (candidate) => await realpath(candidate),
    launch: async (envelope, signal, assertCanRun, options) => {
      const timeoutMs = options.timeoutMs ?? Number.MAX_SAFE_INTEGER
      const installRoot = vaultInstallRoot({
        dataDir: deps.dataDir,
        distDir: deps.distDir,
        hostId: '',
        hostSession: '',
      })
      let startedAt = Date.now()
      return await spawnVaultFeeder(
        {
          nodePath: deps.nodePath,
          feederPath: path.join(deps.distDir, VAULT_EXEC_BUNDLE_FILE),
          feederArgs: [deps.dataDir, String(timeoutMs)],
          warn: (word) => {
            process.stderr.write(`${word}\n`)
          },
          timeoutMs,
          env: () => deps.env,
          tree,
          // POSIX containment is the process group plus the tree kill
          // below. On Windows the job launcher cannot yet carry the
          // envelope pipe to its payload, so no contained spawn is
          // offered and spawnVaultFeeder refuses in words (the named
          // next step in PLAN.md's M109 status).
          ...(deps.platform !== 'win32' && {
            spawnContained: (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => {
              startedAt = Date.now()
              return spawnGuarded(file, [...args], {
                env: probeChildEnvironment(env),
                stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
                ...treeSpawnOptions(deps.platform),
              })
            },
            terminateContained: async (child) => {
              await killTree(child, tree, startedAt)
            },
            // D243: delegate every ticket to this exact feeder
            // process (pid + OS start time + envelope digest)
            // before the envelope reaches it.
            onSpawned: async (child) => {
              if (child.pid === undefined) throw new Error(UI_TEXT.vault.noAccess)
              const identity = await vaultProcessIdentity(
                vaultPeerExecutable(installRoot),
                child.pid,
              )
              if (!identity) throw new Error(UI_TEXT.vault.noAccess)
              const digest = vaultExecEnvelopeDigest(envelope)
              for (const approval of envelope.approvals)
                await deps.broker.delegate(
                  approval.ticket.id,
                  { processId: identity.processId, startedAt: identity.startedAt },
                  digest,
                )
            },
          }),
        },
        envelope,
        signal,
        assertCanRun,
      )
    },
  }
  return new VaultExecService(port)
}
