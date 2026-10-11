// Generated-only installed broker receipt. Run in an isolated unlocked Secret Service.
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'

if (process.platform !== 'linux' || process.env['MUSE_VAULT_TEST_ISOLATED'] !== '1')
  throw new Error('Run through test/hosts/run-vault-posix.sh with its isolated Secret Service')

const workspace = process.cwd()
const root = await mkdtemp(path.join(os.tmpdir(), 'vi-'))
// Keep registry files until asynchronous admission retirement finishes and Node exits.
process.once('exit', () => rmSync(root, { recursive: true, force: true }))
const distDir = path.join(root, 'dist')
let handle
let client
let resources
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
  const resourceError = () => {
    process.stderr.write('native resource receipt failed\n')
    process.exitCode = 1
  }
  resources = lazyRuntimeResources({
    machineDir: path.join(root, 'data'),
    distDir,
    sleep: delay,
    onError: resourceError,
    log: { trace: resourceError, info: resourceError, warn: resourceError, error: resourceError },
  })
  const hostId = randomBytes(16).toString('hex'),
    hostSession = randomBytes(16).toString('hex')
  const platform = await posixVaultClientPlatform({
    dataDir: path.join(root, 'data'),
    distDir,
    hostId,
    hostSession,
  })
  handle = await platform.process.launch()
  await handle.ready
  const location = await platform.discovery.discover(platform.process.identity)
  assert.ok(location)
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
  process.stdout.write(
    'PASS: installed POSIX launch, v2 setup, native OS slot/anchor, private read, Lock and reopen; no model calls\n',
  )
} finally {
  value.fill(0)
  client?.close()
  await handle?.stop()
  resources?.dispose()
}
