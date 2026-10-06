import type {
  ResourceLevel,
  ResourceProcessIdentity,
  ResourceTicket,
} from '../../../shared/resources'

export type ResourceControlName =
  | 'jobPriority'
  | 'jobCpuRate'
  | 'cpuWeight'
  | 'ioWeight'
  | 'memoryHigh'
  | 'nice'
  | 'ionice'
  | 'taskpolicy'

/** Local only: neither keys, identities nor saved OS values belong in resource history. */
export interface ResourceControl {
  readonly key: string
  readonly name: ResourceControlName
  readonly identity: ResourceProcessIdentity | null
  readonly reversible: boolean
  readonly minimumLevel: 'throttle' | 'pause'
  read(identity: ResourceProcessIdentity): Promise<string | null>
  lower(level: ResourceLevel, original: string): string
  /** Must reprove identity/membership at the OS boundary. Null means unknown, including failure. */
  write(value: string, identity: ResourceProcessIdentity): Promise<string | null>
  close(): Promise<void>
}

export interface ResourceActuatorPort {
  /** A partial list is allowed: unavailable controls must throw on read, never claim success. */
  controls(ticket: ResourceTicket): Promise<readonly ResourceControl[]>
}

/** C1/C2's independent retirement proof, including the complete owned tree, not root exit alone. */
export interface ResourceTreeCompletionPort {
  hasCompleted(ticket: ResourceTicket): Promise<boolean>
}

export interface ResourceActionResult {
  readonly control: ResourceControlName | null
  readonly status: 'applied' | 'restored' | 'unchanged' | 'unknown' | 'lifetimeLowered'
}
