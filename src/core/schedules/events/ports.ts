import { UI_TEXT } from '../../../shared/constants'
import type {
  ScheduleEventHistory,
  ScheduleHistoryRange,
  ScheduleSourceCapability,
} from '../../../shared/scheduleEvents'

/** Internal projections only. The owning milestone parses its captured wire. */
export interface ScheduleSignalPort {
  capability(): ScheduleSourceCapability
  subscribe(listener: (input: unknown) => void): { dispose(): void }
  history?(range: ScheduleHistoryRange): Promise<ScheduleEventHistory>
}
export interface ScheduleSnapshotPort {
  capability(): ScheduleSourceCapability
  read(): Promise<unknown>
  history?(range: ScheduleHistoryRange): Promise<ScheduleEventHistory>
}
export type ScheduleNetworkRead =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'events'; readonly events: readonly unknown[]; readonly etag?: string }
export interface ScheduleNetworkPort {
  capability(): ScheduleSourceCapability
  isNetworkEnabled(): boolean
  read(etag: string | undefined): Promise<ScheduleNetworkRead>
  history(range: ScheduleHistoryRange): Promise<ScheduleEventHistory>
}
/** M110 checks authentication/signature, replay and body bounds before this port. */
export interface ScheduleWebhookPort extends ScheduleSignalPort {
  isAuthenticated(): boolean
}
export function unavailableSource(
  dependency: string,
): Extract<ScheduleSourceCapability, { available: false }> {
  return { available: false, reason: `${UI_TEXT.scheduleV2.labels.unavailable}: ${dependency}` }
}
export function noEventHistory(): Promise<ScheduleEventHistory> {
  return Promise.resolve({
    available: false,
    reason: UI_TEXT.scheduleV2.messages.historyUnavailable,
  })
}
