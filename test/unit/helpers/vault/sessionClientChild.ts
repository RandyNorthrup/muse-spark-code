import { posixVaultClientPlatform } from '../../../../src/runtime/vault/posixClientPlatform'
import { VaultBrokerProcess } from '../../../../src/host/vault/brokerProcess'
import { VaultBrokerClient } from '../../../../src/core/vault/broker/client'
import { configureBrokerResources } from '../../../../src/runtime/vault/vaultBrokerEntry'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import process from 'node:process'
const dataDir = process.argv[2],
  installRoot = process.argv[3]
if (!dataDir || !installRoot) throw new Error('missing generated session context')
const hostId = process.argv[4] ?? 'a'.repeat(32),
  hostSession = 'c'.repeat(32)
// The installed host configures admission before any client launch; the
// fixture runs the installed entry's own wiring over its generated paths.
// Each client process owns its creation registry, the way every process
// that configures admission owns its own: one shared file cannot publish
// four concurrent owners, and the broker never shares this one.
const lifecycle: { dispose?: () => void } = {}
void (async () => {
  lifecycle.dispose = await configureBrokerResources(
    { dataDir, runDirectory: path.join(dataDir, `client-run-${hostId}`) },
    () => import('../../../../src/core/resources/resourceGovernorEntry'),
  )
  const platform = await posixVaultClientPlatform({
    dataDir,
    distDir: path.join(installRoot, 'dist'),
    hostId,
    hostSession,
  })
  const broker = new VaultBrokerProcess(platform.discovery, platform.process)
  const location = await broker.get()
  // Reproduce the review's scheduler gap beyond the former 200 ms fixture expiry.
  await delay(300)
  const client = await VaultBrokerClient.open(location, hostId, hostSession, platform.peers)
  process.send?.({ pid: location.lock.processId, directory: platform.discovery.directory })
  process.on('message', (message: unknown) => {
    if (message === 'status')
      void client.send({ kind: 'status' }).then((reply) => process.send?.(reply))
    else if (message === 'close') {
      client.close()
      process.disconnect()
    }
  })
})()
  .finally(() => {
    lifecycle.dispose?.()
  })
  .catch(() => {
    process.send?.({ failed: true })
    process.exitCode = 1
  })
