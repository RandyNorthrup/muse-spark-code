import { type Socket } from 'node:net'

export interface VaultProcessIdentity {
  processId: number
  userId: string
  startedAt: number
  executable: string
}
export interface VaultPeerVerifier {
  /** OS credentials and pinned process start/image identity; never a claimed token or pid. */
  verify(socket: Socket): Promise<VaultProcessIdentity>
}
