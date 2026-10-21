// Generated-only installed broker receipt. Run in an isolated unlocked Secret Service.
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createWarningBudget,
  expectedReceiptWarning,
} from '../unit/helpers/vault/receiptWarnings.mjs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import { cp, mkdtemp, mkdir, readFile, readdir, symlink } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'

if (process.platform !== 'linux' || process.env['MUSE_VAULT_TEST_ISOLATED'] !== '1')
  throw new Error('Run through test/hosts/run-vault-posix.sh with its isolated Secret Service')

function stopReceiptBroker(pid) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

const workspace = process.cwd()
const root = await mkdtemp(path.join(os.tmpdir(), 'vi-'))
// Keep registry files until asynchronous admission retirement finishes and Node exits.
process.once('exit', () => rmSync(root, { recursive: true, force: true }))
const distDir = path.join(root, 'dist')
let handle
let client
let resources
let platform
let brokerPid
const admission = { host: undefined }
let stopObserving
const sampling = new AsyncLocalStorage()
const pressure = []
const value = randomBytes(32)
try {
  await cp(path.join(workspace, 'dist'), distDir, { recursive: true })
  const nativeDirectory =
    process.platform === 'darwin' ? ['native', 'darwin'] : ['native', 'linux', process.arch]
  await cp(path.join(workspace, ...nativeDirectory), path.join(root, ...nativeDirectory), {
    recursive: true,
  })
  await symlink(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  await mkdir(path.join(root, 'data'), { mode: 0o700 })
  const testClient = path.join(distDir, 'vaultTestClient.cjs')
  await build({
    stdin: {
      contents: [
        "export { VaultBrokerClient } from './src/core/vault/broker/client'",
        "export { VaultManageSession } from './src/core/vault/broker/manageClient'",
        "export { lazyRuntimeResources } from './src/runtime/resources/load'",
      ].join('\n'),
      resolveDir: workspace,
    },
    plugins: [
      {
        name: 'installed-admission',
        setup(builder) {
          builder.onResolve({ filter: /\/admission$/ }, () => ({
            path: './resourceAdmission.js',
            external: true,
          }))
        },
      },
    ],
    outfile: testClient,
    platform: 'node',
    format: 'cjs',
    bundle: true,
  })
  const require = createRequire(import.meta.url)
  const { posixVaultClientPlatform } = require(path.join(distDir, 'vaultPosix.js'))
  const { createVaultBrokerBindings } = require(path.join(distDir, 'vaultRuntime.js'))
  assert.equal(typeof createVaultBrokerBindings, 'function')
  const { VaultBrokerClient, VaultManageSession, lazyRuntimeResources } = require(testClient)
  const { onResourceWindow } = require(path.join(distDir, 'resourceAdmission.js'))
  stopObserving = onResourceWindow(({ port }) => {
    admission.host = port
    // Observe the exact concurrent work whose unchanged installed sampler calls onError.
    const sampleTree = port.sampleTree.bind(port)
    port.sampleTree = (work) => sampling.run(work, () => sampleTree(work))
  })
  // RVCM109JD P2-2: only the exact known harmless warning is ever ignored,
  // whole-line matched with a counted allowance (three times the last green
  // replay's two); any other sampler output, or a storm of them, fails below.
  const warningBudget = createWarningBudget({ 'finished-native-helper-membership-race': 6 })
  let ignoredWarnings = 0
  const resourceError = (kind) => {
    const stack = new Error('resource receipt diagnostic').stack
    const expected = expectedReceiptWarning(kind, stack, sampling.getStore())
    if (expected !== null && warningBudget.admit(expected)) {
      ignoredWarnings += 1
      process.stdout.write(
        `EXPECTED resource warning: ${expected}; native helper and process group exited\n`,
      )
      return
    }
    const frame = stack
      ?.split('\n')
      .map((line) =>
        line
          .replaceAll('\\', '/')
          .match(/\/(resource(?:Governor|Admission|Process|Journal)\.js):([0-9]+):([0-9]+)/)
          ?.slice(1)
          .join(':'),
      )
      .find((line) => line !== undefined)
    const isOverBudget = expected !== null
    process.stderr.write(
      `native resource receipt failed: ${kind}; ${isOverBudget ? 'warning allowance exceeded' : (frame ?? 'no package frame')}\n`,
    )
    process.exitCode = 1
  }
  resources = lazyRuntimeResources({
    machineDir: path.join(root, 'data'),
    distDir,
    sleep: delay,
    onError: () => resourceError('runtime'),
    log: {
      trace: () => resourceError('trace'),
      info: () => resourceError('info'),
      warn: () => resourceError('warn'),
      error: () => resourceError('error'),
    },
  })
  const hostId = randomBytes(16).toString('hex'),
    hostSession = randomBytes(16).toString('hex')
  platform = await posixVaultClientPlatform({
    dataDir: path.join(root, 'data'),
    distDir,
    hostId,
    hostSession,
  })
  for (let count = 0; count < 2; count++) {
    const child = spawn(process.execPath, ['-e', 'for (;;) Math.sqrt(Math.random())'], {
      env: {},
      detached: true,
      stdio: 'ignore',
    })
    pressure.push(child)
    await once(child, 'spawn')
  }
  const startedAt = performance.now()
  handle = await platform.process.launch()
  await handle.ready
  const launchMs = Math.round(performance.now() - startedAt)
  process.stdout.write(
    `MEASURE: governed broker launch under two CPU workers: ${launchMs} ms; comparison window 5000 ms\n`,
  )
  assert.ok(launchMs < 5000, 'observed governed launch under the five-second comparison window')
  const location = await platform.discovery.discover(platform.process.identity)
  assert.ok(location)
  brokerPid = location.lock.processId
  const checkedPeers = {
    verify: async (socket) => {
      const peer = await platform.peers.verify(socket)
      assert.equal(peer.processId, location.lock.processId, 'native broker peer PID')
      assert.equal(peer.startedAt, location.lock.startedAt, 'native broker birth')
      return peer
    },
  }
  const context = {
    dataDir: path.join(root, 'data', 'vault'),
    runDirectory: path.join(root, 'data', 'vault', 'run'),
    installRoot: root,
    userSession: platform.discovery.userSession,
  }
  const bindings = await createVaultBrokerBindings(context)
  const identity = await platform.process.identity(process.pid)
  const authority = await bindings.identify(identity, hostId, hostSession)
  assert.equal(authority.manage, true)
  const connect = () => VaultBrokerClient.open(location, hostId, hostSession, checkedPeers)
  const session = new VaultManageSession(connect)
  const initial = await session.snapshot()
  assert.equal(initial.status.state, 'uncreated')
  const setup = await session.setup()
  assert.match(setup.code.toString('ascii'), /^[a-f0-9]{40}$/u)
  setup.code.fill(0)
  await session.confirmSetup(setup.setupId)
  const origin = 'https://generated.example.test'
  const itemId = randomBytes(16).toString('hex')
  await session.write(
    {
      metadata: {
        id: itemId,
        name: 'native-generated',
        handle: 'secret://native-generated',
        label: 'Generated native receipt',
        kind: 'apiKey',
        hidden: true,
        firstParty: true,
        requirePresence: false,
        bindings: [{ kind: 'origin', origin }],
        policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
        dates: { createdAt: Date.now(), rotatedAt: null, expiresAt: null, lastUsedAt: null },
        publicKey: null,
        fingerprint: null,
      },
      material: { kind: 'apiKey', value, origin, auth: 'bearer' },
    },
    false,
  )
  client = await connect()
  const read = await client.firstPartyRead({
    v: 2,
    kind: 'firstPartyRead',
    itemId,
    origin,
    client: 'provider',
  })
  try {
    assert.ok(read.equals(value))
  } finally {
    read.fill(0)
  }
  client.close()
  client = undefined
  const encrypted = await readFile(path.join(root, 'data', 'vault', 'vault.v1'))
  assert.equal(encrypted.includes(value), false)
  await session.lock()
  await session.unlock(null)
  const reopened = await session.snapshot()
  assert.equal(reopened.items[0]?.id, itemId)
  await session.lock()
  process.stdout.write(`MEASURE: ignored sampler warnings: ${ignoredWarnings} of 6 allowed\n`)
  process.stdout.write(
    'PASS: installed POSIX launch, v2 setup, native OS slot/anchor, private read, Lock and reopen; no model calls\n',
  )
} finally {
  value.fill(0)
  client?.close()
  try {
    await handle?.stop?.()
    // Receipt ownership ends the broker explicitly; client shutdown itself never signals it.
    if (brokerPid !== undefined) {
      stopReceiptBroker(brokerPid)
      for (let count = 0; count < 100; count++) {
        const identity = await platform.process.identity(brokerPid)
        if (!identity.startedAt) break
        await delay(10)
      }
      const files = await readdir(platform.discovery.directory)
      assert.deepEqual(
        files.toSorted((a, b) => a.localeCompare(b)),
        ['launch.lock', 'startup.lock'],
      )
    }
  } finally {
    try {
      platform?.dispose?.()
      for (const child of pressure) {
        const exited = once(child, 'exit')
        process.kill(-child.pid, 'SIGKILL')
        await exited
      }
      if (admission.host !== undefined) {
        await admission.host.refreshTrees()
        assert.equal(admission.host.work.size, 0, 'no live or uncertain governed helper trees')
        for (let count = 0; count < 100 && admission.host.retired.size > 0; count++) await delay(10)
        assert.equal(admission.host.retired.size, 0, 'native helper temporary files retired')
      }
    } finally {
      stopObserving?.()
      resources?.dispose()
    }
  }
}
