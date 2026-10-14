// D88.8: CLI home leases, independent of editor and credential store.
// Nothing here reads auth files or accepts a Model API credential.
import { type SubscriptionUsage } from '../../../shared/usage'

// Local evidence, never a vendor response or a flag supplied by a page.
export interface MuseCodeHomeCapture {
  readonly reference: string
  readonly cliVersion: string
  readonly platform: 'win32' | 'darwin' | 'linux' | 'android'
  readonly nonSecretConfiguration: readonly (
    'settings' | 'hooks' | 'skills' | 'mcpServers' | 'memory'
  )[]
}

/** One immutable lease, shared by this account's serve and login terminal. */
export interface MuseCodeAccountHome {
  readonly provider: string
  readonly account: string
  /** The migrated default keeps the CLI's existing home and sign-in. */
  readonly configHome: string | undefined
  /** Local request ownership; neither field is part of an MSP frame. */
  readonly generation: number
  readonly signal: AbortSignal
  readonly assertCurrent: () => void
  readonly observeUsage: (usage: SubscriptionUsage) => void
}
