import { connect } from 'node:net'
import { UI_TEXT } from '../../../shared/constants'
import { VaultBrokerClient } from './client'
import { type VaultBrokerLocation } from './discovery'
import { type VaultPeerVerifier, type VaultPipeDialPort } from './peer'
import { verifyVaultSocketFile } from './socketDirectory'
import { windowsVaultPipeNameSchema } from './windowsPipe'

/**
D216: the feeder's own connection. The broker is verified exactly as
in `VaultBrokerClient.open` (socket owner, then the lock's process
over kernel peer credentials; on Windows the dialer's pipe-owner
check), but no hello is sent: the feeder never registers as a host or
a requester. Its first frame is a private `execRedeem`. Kept out of
client.ts so only the feeder bundle carries it.
*/
export async function openVaultFeederClient(
  location: VaultBrokerLocation,
  peers: VaultPeerVerifier,
  dial?: VaultPipeDialPort,
): Promise<VaultBrokerClient> {
  if (process.platform !== 'win32') await verifyVaultSocketFile(location.lock.socket)
  if (process.platform === 'win32') {
    if (!dial) throw new Error(UI_TEXT.vault.brokerBlocked)
    const pipe = windowsVaultPipeNameSchema.parse(location.lock.socket)
    await dial.verifyPipe(pipe)
    const pipeSocket = dial.connectPipe(pipe)
    const pipeClient = VaultBrokerClient.fromFeederSocket(pipeSocket)
    try {
      await new Promise<void>((resolve, reject) => {
        pipeSocket.once('connect', resolve)
        pipeSocket.once('error', reject)
      })
      return pipeClient
    } catch (error: unknown) {
      pipeClient.close()
      throw error
    }
  }
  const socket = connect(location.lock.socket)
  const client = VaultBrokerClient.fromFeederSocket(socket)
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    const identity = await peers.verify(socket)
    if (
      identity.processId !== location.lock.processId ||
      identity.startedAt !== location.lock.startedAt
    )
      throw new Error(UI_TEXT.vault.noAccess)
    return client
  } catch (error: unknown) {
    client.close()
    throw error
  }
}
