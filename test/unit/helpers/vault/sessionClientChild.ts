import { posixVaultClientPlatform } from '../../../../src/runtime/vault/posixClientPlatform'
import { VaultBrokerProcess } from '../../../../src/host/vault/brokerProcess'
import { setTimeout as delay } from 'node:timers/promises'
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
  // Reproduce the review's scheduler gap beyond the former 200 ms fixture expiry.
  await delay(300)
  const client = await broker.connect(hostId, hostSession, platform.peers)
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
