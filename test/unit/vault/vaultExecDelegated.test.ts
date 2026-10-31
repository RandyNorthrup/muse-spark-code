import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import {
  DICTATION_HELPER_DIR,
  REDACTED_MARK,
  UI_TEXT,
  VAULT_PROTOCOL_VERSION,
  darwinDictationHelperSegments,
} from '../../../src/shared/constants'
import { vaultCommandDigest } from '../../../src/core/vault/broker/policy'
import { VaultManageSession } from '../../../src/core/vault/broker/manageClient'
import { encodeVaultMaterial } from '../../../src/core/vault/crypto'
import { type VaultBrokerClient } from '../../../src/core/vault/broker/client'
import { VaultBrokerProcess } from '../../../src/host/vault/brokerProcess'
import { configureResources } from '../../../src/core/resources/admission'
import { createdPathCommands } from '../../../src/core/resources/resourceGovernorEntry'
import { posixVaultClientPlatform } from '../../../src/runtime/vault/posixClientPlatform'
import { openHeadlessVault } from '../../../src/runtime/vault/headlessSession'
import { createHeadlessVaultExecService } from '../../../src/runtime/vault/vaultExecHost'
import { writeVaultPolicy } from '../../../src/runtime/vault/vaultPolicy'
import { vaultBrokerDataDir } from '../../../src/runtime/vault/vaultStoreScope'
import { vaultPeerExecutable } from '../../../src/runtime/vault/posixNative'
import { vaultGrantSchema, type VaultGrant, type VaultItem } from '../../../src/shared/vault'
import { type VaultExecService } from '../../../src/core/vault/exec/service'
import { type ExecVaultSession } from '../../../src/runtime/vault/execVault'
import { buildBrokerChildren } from '../helpers/vault/sessionBrokerBuild'
import { shouldSkipPosixBrokerSuite } from '../helpers/vault/socketFit'

// D243 proof on real parts: the real broker and channel run as a fixture
// child bundled into a fixture install root, as the session suites run them
// (the product's file anchor stands in for the OS store, as it does where
// the binding is not installed); the feeder is a real child process running
// the installed vaultExecEntry bundle; peer identity and ancestry come from
// the compiled native helper over kernel records. The value is minted in
// memory here, used by real commands through the feeder, and must surface
// nowhere a host can read: only its length and a redacted echo prove it
// arrived.

/** Bundling the fixture children, compiling the native helper and creating the vault: seconds, not the 5 s default. */
const SETUP_TIMEOUT_MS = 120_000
/** Two refused uses, each opening a session over the real broker. */
const SHORT_FLOW_TIMEOUT_MS = 30_000
/** Each use spawns a feeder process (a node start); the cases run six to eight of them. */
const FLOW_TIMEOUT_MS = 60_000
/** The fixture broker ends on SIGTERM within moments; a stuck one is a failure, not a wait. */
const BROKER_END_WAIT_MS = 10_000
/** The feeder command starts after authorization, delegation and a spawn: seconds on a loaded Mac. */
const COMMAND_START_WAIT_MS = 20_000
const value = randomBytes(18).toString('hex')
const shouldSkipBroker = shouldSkipPosixBrokerSuite()
const state: {
  root: string
  data: string
  shell: string
  brokerPid?: number
  disposeAdmission?: () => void
  connect?: () => Promise<VaultBrokerClient>
  hostId?: string
  sessions: number
  platform?: { dispose?: () => void }
  manage?: VaultManageSession
  session?: ExecVaultSession
  service?: VaultExecService
  raw?: VaultBrokerClient
  controller: AbortController
} = { root: '', data: '', shell: '', sessions: 0, controller: new AbortController() }
const denials: string[] = []

const command = (script: string) => ({
  executable: state.shell,
  argv: ['-c', script],
  cwd: state.data,
})
const envRun = (script: string) => ({
  command: command(script),
  secrets: { env: { VAULT_PROBE: 'secret://service-key' } },
})
const countUse = () => ({
  kind: 'environment' as const,
  command: command('printf %s "$VAULT_PROBE" | wc -c'),
  names: ['VAULT_PROBE'],
})

async function buildSiblingBundles(root: string): Promise<void> {
  const entries: readonly (readonly [string, string])[] = [
    ['src/runtime/vault/vaultExecEntry.ts', 'vaultExec.js'],
    ['src/core/resources/resourceGovernorEntry.ts', 'resourceGovernor.js'],
    ['src/runtime/vault/vaultPolicyEntry.ts', 'vaultPolicy.js'],
  ]
  for (const [entry, output] of entries)
    await build({
      entryPoints: [entry],
      outfile: path.join(root, 'dist', output),
      bundle: true,
      external: ['@napi-rs/keyring'],
      platform: 'node',
      format: 'cjs',
    })
}

function item(): VaultItem {
  const environment = (script: string) => ({
    kind: 'environment' as const,
    commandDigest: vaultCommandDigest(command(script)),
    names: ['VAULT_PROBE'],
  })
  return {
    metadata: {
      id: 'a'.repeat(32),
      name: 'service-key',
      handle: 'secret://service-key',
      label: 'Service key',
      kind: 'apiKey',
      bindings: [
        environment('printf %s "$VAULT_PROBE" | wc -c'),
        environment('printenv VAULT_PROBE'),
        environment('sleep 30'),
        { kind: 'stdin' as const, commandDigest: vaultCommandDigest(command('wc -c')) },
      ],
      requirePresence: false,
      hidden: false,
      firstParty: false,
      policy: { mode: 'alwaysAllow', unattendedAllowed: true, allowDisclosure: false },
      dates: { createdAt: Date.now(), rotatedAt: null, expiresAt: null, lastUsedAt: null },
      publicKey: null,
      fingerprint: null,
    },
    material: {
      kind: 'apiKey',
      value: Buffer.from(value, 'utf8'),
      auth: 'bearer',
      origin: 'https://api.example.com',
    },
  }
}

function grants(): readonly VaultGrant[] {
  const base = {
    itemId: 'a'.repeat(32),
    roles: [{ kind: 'headless' as const }],
    workspaces: 'any' as const,
    maxUses: null,
    uses: 0,
    expiresAt: null,
    window: null,
    unattendedAllowed: true,
    sessionId: null,
    taskId: null,
    ceiling: ['secret://service-key'],
    createdAt: Date.now(),
    createdBy: 'vaultCli' as const,
  }
  const environment = (id: string, script: string): VaultGrant => ({
    ...base,
    id,
    target: {
      kind: 'environment',
      commandDigest: vaultCommandDigest(command(script)),
      names: ['VAULT_PROBE'],
    },
  })
  return [
    environment('b'.repeat(32), 'printf %s "$VAULT_PROBE" | wc -c'),
    environment('c'.repeat(32), 'printenv VAULT_PROBE'),
    environment('e'.repeat(32), 'sleep 30'),
    {
      ...base,
      id: 'd'.repeat(32),
      target: { kind: 'stdin', commandDigest: vaultCommandDigest(command('wc -c')) },
    },
  ].map((grant) => vaultGrantSchema.parse(grant))
}

beforeAll(async () => {
  if (shouldSkipBroker) return
  state.root = await realpath(await mkdtemp(path.join(os.tmpdir(), 've-')))
  state.data = state.root
  state.shell = await realpath('/bin/sh')
  // Compiles the native peer helper, stages the created-directories helper
  // and bundles the broker fixture child as the install root's broker.
  await buildBrokerChildren(state.root, [['execBrokerChild', 'vaultBroker.js']])
  await buildSiblingBundles(state.root)
  // One-time OS costs belong in hooks, never in a case: the first exec of
  // each fresh helper binary pays macOS trust evaluation.
  execFileSync(vaultPeerExecutable(state.root), ['identity', String(process.pid)], {
    stdio: 'ignore',
  })
  if (process.platform === 'darwin')
    execFileSync(
      path.join(state.root, DICTATION_HELPER_DIR, ...darwinDictationHelperSegments(process.arch)),
      ['proc-identity', String(process.pid)],
      { stdio: 'ignore' },
    )
  // The host's own admission, as the installed host configures it before any
  // client launch, with only the created helper rooted at the staged install
  // layout: the bundled default spells dist/../native, which from source
  // would read src/core/native.
  state.disposeAdmission = configureResources({
    registryFile: path.join(state.data, 'test-run', 'resource-created', 'registry.json'),
    inspect: () => ({}),
    onError: () => undefined,
    createdDirectories: createdPathCommands(path.join(state.root, 'native'), undefined),
  })
  const hostId = 'b'.repeat(32)
  const hostSession = 'd'.repeat(32)
  const platform = await posixVaultClientPlatform({
    dataDir: state.data,
    distDir: path.join(state.root, 'dist'),
    hostId,
    hostSession,
  })
  state.platform = platform
  const brokerProcess = new VaultBrokerProcess(platform.discovery, platform.process)
  const broker = await brokerProcess.get()
  state.brokerPid = broker.lock.processId
  const connect = async (): Promise<VaultBrokerClient> => {
    state.raw = await brokerProcess.connect(hostId, hostSession, platform.peers, platform.dial)
    return state.raw
  }
  state.manage = new VaultManageSession(connect, encodeVaultMaterial)
  const snapshot = await state.manage.snapshot()
  if (snapshot.status.state === 'uncreated') {
    const begun = await state.manage.setup()
    begun.code.fill(0)
    await state.manage.confirmSetup(begun.setupId)
  } else if (snapshot.status.state !== 'unlocked') await state.manage.unlock(null)
  await state.manage.write(item(), false)
  for (const grant of grants()) await state.manage.grant(grant)
  state.connect = connect
  state.hostId = hostId
}, SETUP_TIMEOUT_MS)

afterAll(async () => {
  state.controller.abort()
  try {
    await state.session?.close()
  } catch {
    // Teardown continues to the broker and the fixture root either way.
  }
  state.raw?.close()
  if (state.brokerPid !== undefined) await endBroker(state.brokerPid)
  state.platform?.dispose?.()
  state.disposeAdmission?.()
  if (state.root) await rm(state.root, { recursive: true, force: true })
})

/**
A new headless session over the real broker. The person's ceiling is read
when a requester registers (D243), so a case that changes the policy opens
the session after writing it, as a run started after `vault policy` does.
*/
async function openSession(): Promise<void> {
  const connect = state.connect
  const hostId = state.hostId
  if (!connect || hostId === undefined) throw new Error('missing broker connection')
  try {
    await state.session?.close()
  } catch {
    // The earlier session's broker end may be gone already; a new one follows.
  }
  state.sessions += 1
  state.session = await openHeadlessVault(
    connect,
    {
      cwd: state.data,
      sessionId: `${'e'.repeat(31)}${String(state.sessions)}`,
      signal: state.controller.signal,
      source: 'headless',
      unattended: true,
      onDenied: (message) => {
        denials.push(message)
      },
    },
    hostId,
    process.pid,
  )
  state.service = createHeadlessVaultExecService({
    broker: state.session.execBroker(),
    distDir: path.join(state.root, 'dist'),
    dataDir: state.data,
    nodePath: process.execPath,
    env: process.env,
    platform: process.platform,
  })
}

/** Ends the fixture broker and waits for it to be gone, so it writes nothing into the folder removed next. */
async function endBroker(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Already gone: the fixture root is removed either way.
    return
  }
  const deadline = Date.now() + BROKER_END_WAIT_MS
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      // Signal 0 fails once the process no longer exists.
      return
    }
    if (Date.now() > deadline) throw new Error('the fixture broker did not end')
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
}

/** The person's ceiling for this workspace and the headless role, as `vault policy` writes it. */
async function allowThisWorkspace(): Promise<void> {
  await writeVaultPolicy(vaultBrokerDataDir(state.data), {
    ceilings: [
      { workspaceId: state.data, role: { kind: 'headless' }, ceiling: ['secret://service-key'] },
    ],
  })
}

/** Polls the process table until a process whose command line holds `needle` exists. */
async function waitForRunningCommand(needle: string): Promise<void> {
  const deadline = Date.now() + COMMAND_START_WAIT_MS
  for (;;) {
    try {
      execFileSync('/usr/bin/pgrep', ['-f', needle], { stdio: 'ignore' })
      return
    } catch {
      // pgrep exits 1 while nothing matches yet; the deadline below ends the wait.
    }
    if (Date.now() > deadline) throw new Error(`the command ${needle} never started`)
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
  }
}

const assertCanRun = (): void => {
  state.controller.signal.throwIfAborted()
}

/** A use the broker refuses: the run rejects, and the words the host was told are returned. */
async function refusedWords(): Promise<string> {
  const service = state.service
  if (!service) throw new Error('missing exec service')
  denials.length = 0
  await expect(
    service.run(envRun('printf %s "$VAULT_PROBE" | wc -c'), state.controller.signal, assertCanRun),
  ).rejects.toThrow()
  return denials.join('\n')
}

describe.skipIf(shouldSkipBroker)(
  'delegated vault exec over the real broker and feeder (D243)',
  () => {
    it(
      'refuses without a person ceiling, in words',
      async () => {
        await openSession()
        expect(await refusedWords()).toContain(UI_TEXT.vault.ceilingNone)
        // A ceiling for another workspace still refuses this one.
        await writeVaultPolicy(vaultBrokerDataDir(state.data), {
          ceilings: [
            {
              workspaceId: '/somewhere/else',
              role: { kind: 'headless' },
              ceiling: ['secret://service-key'],
            },
          ],
        })
        await openSession()
        expect(await refusedWords()).toContain('ceiling')
      },
      SHORT_FLOW_TIMEOUT_MS,
    )

    it(
      'runs env and stdin uses through the feeder; the value never surfaces',
      async () => {
        await allowThisWorkspace()
        await openSession()
        const service = state.service
        if (!service || !state.raw || !state.session) throw new Error('missing exec service')
        const counted = await service.run(
          envRun('printf %s "$VAULT_PROBE" | wc -c'),
          state.controller.signal,
          assertCanRun,
        )
        expect(counted.exitCode).toBe(0)
        expect(counted.stdout.trim()).toBe(String(value.length))
        const echoed = await service.run(
          envRun('printenv VAULT_PROBE'),
          state.controller.signal,
          assertCanRun,
        )
        expect(echoed.exitCode).toBe(0)
        expect(echoed.stdout).not.toContain(value)
        expect(echoed.stdout).toContain(REDACTED_MARK)
        const stdin = await service.run(
          { command: command('wc -c'), secrets: { stdin: 'secret://service-key' } },
          state.controller.signal,
          assertCanRun,
        )
        expect(stdin.stdout.trim()).toBe(String(value.length))
        // A git use refuses at the host port (first increment scope).
        await expect(
          service.run(
            {
              command: command('true'),
              secrets: {
                git: {
                  handle: 'secret://service-key',
                  protocol: 'https',
                  host: 'example.com',
                  path: 'repo',
                },
              },
            },
            state.controller.signal,
            assertCanRun,
          ),
        ).rejects.toThrow()
        // A delegation to the wrong process identity is refused by the broker.
        const inner = state.session.execBroker()
        const foreign = createHeadlessVaultExecService({
          broker: {
            authorize: inner.authorize,
            list: inner.list,
            delegate: async (ticketId, feeder, digest) => {
              await inner.delegate(
                ticketId,
                { processId: process.pid, startedAt: feeder.startedAt },
                digest,
              )
            },
          },
          distDir: path.join(state.root, 'dist'),
          dataDir: state.data,
          nodePath: process.execPath,
          env: process.env,
          platform: process.platform,
        })
        const refused = await foreign.run(
          envRun('printf %s "$VAULT_PROBE" | wc -c'),
          state.controller.signal,
          assertCanRun,
        )
        expect(refused.exitCode).not.toBe(0)
        expect(refused.stdout).not.toContain(String(value.length))
        // A tainted proposal denies as tainted over the real channel.
        await state.raw.send({
          kind: 'reportProvenance',
          taint: { tainted: false, reasons: [] },
        })
        const approval = await state.raw.send({
          kind: 'requestUse',
          proposal: {
            handle: 'secret://service-key',
            use: countUse(),
            taint: {
              tainted: true,
              reasons: [{ source: 'web', label: 'fixture web page' }],
            },
          },
        })
        expect(approval).toMatchObject({ kind: 'denied', reason: 'tainted' })
        // No redemption is served on the requester socket itself.
        const ticket = await inner.authorize(
          'secret://service-key',
          countUse(),
          { tainted: false, reasons: [] },
          state.controller.signal,
        )
        if (ticket.kind !== 'ticket') throw new Error('missing ticket')
        const redeem = await state.raw.send({
          kind: 'redeem',
          ticket: ticket.ticket,
          use: countUse(),
        })
        expect(redeem).toMatchObject({ kind: 'denied' })
        const feederFrame = await state.raw.send({
          v: VAULT_PROTOCOL_VERSION,
          kind: 'execRedeem',
          ticket: ticket.ticket,
          use: countUse(),
          envelopeDigest: '0'.repeat(64),
        })
        expect(feederFrame).toMatchObject({ kind: 'denied' })
      },
      FLOW_TIMEOUT_MS,
    )

    it(
      'a lock ends a running feeder command',
      async () => {
        // The previous case sent a feeder frame on its requester connection, which
        // the broker closes for it: this case registers a fresh session and takes
        // a fresh management connection for the lock.
        await allowThisWorkspace()
        await openSession()
        const service = state.service
        if (!service || !state.connect) throw new Error('missing exec service')
        const manage = new VaultManageSession(state.connect, encodeVaultMaterial)
        const started = Date.now()
        // The lock ends the feeder's lease: the run fails, as a result or as the
        // closed channel's said failure, long before the command's 30 seconds.
        const ending = (async (): Promise<{ succeeded: boolean }> => {
          try {
            const reply = await service.run(
              envRun('sleep 30'),
              state.controller.signal,
              assertCanRun,
            )
            return { succeeded: reply.exitCode === 0 }
          } catch {
            // The lock closed the run's own channel: the failure is the expected end.
            return { succeeded: false }
          }
        })()
        // Lock only once the command is really running behind the feeder: a lock
        // that lands while the use is still being authorized refuses it instead.
        await waitForRunningCommand('sleep 30')
        try {
          await manage.lock()
        } catch {
          // The lock drops the host's connections, the locking one among them,
          // before its reply can land: the state read below proves the lock.
        }
        const ended = await ending
        expect(Date.now() - started).toBeLessThan(25_000)
        expect(ended.succeeded).toBe(false)
        const afterLock = await new VaultManageSession(
          state.connect,
          encodeVaultMaterial,
        ).snapshot()
        expect(afterLock.status.state).toBe('locked')
        await new VaultManageSession(state.connect, encodeVaultMaterial).unlock(null)
      },
      FLOW_TIMEOUT_MS,
    )
  },
)
