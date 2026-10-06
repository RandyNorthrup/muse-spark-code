import type { ResourceAdmission, ResourceLaunchRequest } from '../../core/resources/queue'
import type {
  ResourceEvent,
  ResourceRecord,
  ResourceSettings,
  ResourceStatus,
} from '../../shared/resources'

/** Local correlation only; never included in resource events, status or history. */
export interface ResourceWorkContext {
  sessionId: string
  toolCallId?: string
}
export interface RuntimeResourceNotice {
  event: ResourceEvent
  status: ResourceStatus
  text: string
  toolCallId?: string
}
export type ResourceCommandAction = 'status' | 'history' | 'resume'
export interface ResourceMachineStore {
  readSettings(): Promise<ResourceSettings>
  readResumeUntil(): Promise<number | null>
  writeResumeUntil(untilMs: number): Promise<void>
}
/** J supplies the same retained journal to every runtime surface. */
export interface ResourceHistoryPort {
  read(): Promise<readonly ResourceRecord[]>
}
export interface RuntimeResources {
  command(action: ResourceCommandAction, isJson: boolean): Promise<string>
  status(): Promise<ResourceStatus>
  history(): Promise<readonly ResourceRecord[]>
  resume(): Promise<ResourceStatus>
  admit(
    request: ResourceLaunchRequest,
    context?: ResourceWorkContext,
    signal?: AbortSignal,
  ): Promise<ResourceAdmission>
  /** T calls this when its occupancy becomes known or registered work retires. */
  workChanged(): void
  subscribe(sessionId: string, listener: (notice: RuntimeResourceNotice) => void): () => void
  subscribeEvents(
    listener: (event: ResourceEvent, status: ResourceStatus, text: string) => void,
  ): () => void
  dispose(): void
}
