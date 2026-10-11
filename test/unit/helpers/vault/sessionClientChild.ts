import { posixVaultClientPlatform } from '../../../../src/runtime/vault/posixClientPlatform'
import { VaultBrokerProcess } from '../../../../src/host/vault/brokerProcess'
import { VaultBrokerClient } from '../../../../src/core/vault/broker/client'
import { disposeSession } from './sessionAdmission'
import path from 'node:path'
import process from 'node:process'
const dataDir = process.argv[2],
  installRoot = process.argv[3]
if (!dataDir || !installRoot) throw new Error('missing generated session context')
const hostId = process.argv[4] ?? 'a'.repeat(32),
  hostSession = 'c'.repeat(32)
void (async () => {
  const platform = await posixVaultClientPlatform({
    dataDir,
    distDir: path.join(installRoot, 'dist'),
    hostId,
    hostSession,
  })
  const broker = new VaultBrokerProcess(platform.discovery, platform.process)
  const location = await broker.get()
  const client = await VaultBrokerClient.open(location, hostId, hostSession, platform.peers)
  process.send?.({ pid: location.lock.processId, directory: platform.discovery.directory })
  process.on('message', (message: unknown) => {
    if (message === 'status')
      void client.send({ kind: 'status' }).then((reply) => process.send?.(reply))
    else if (message === 'close')
      void (async () => {
        client.close()
        await disposeSession()
        process.disconnect()
      })()
  })
})().catch(() => {
  process.send?.({ failed: true })
  process.exitCode = 1
})
