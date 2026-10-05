/** Lane P supplies an already leased and approved connection; never open a second port. */
export interface SerialMachinePort {
  request(command: string, signal: AbortSignal): Promise<string>
  send(bytes: Uint8Array, signal: AbortSignal): Promise<void>
  /** Must bypass the ordinary line queue, even when a request is pending. */
  realtime(bytes: Uint8Array, signal: AbortSignal): Promise<void>
  cancel(): void
}
