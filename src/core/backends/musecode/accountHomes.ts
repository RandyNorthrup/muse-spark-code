// Portable account-home lease consumed by the live Muse Code host and launcher.
import type { SubscriptionUsage } from '../../../shared/usage'

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
