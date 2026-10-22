/** Lane P supplies an already leased and approved connection; never open a second port. */
export interface SerialMachinePort {
  request(command: string, signal: AbortSignal): Promise<string>
  /** After queue/preparation awaits, await beforeWrite's fresh state read,
   * then invoke its returned guard synchronously at the actual write. */
  send(
    bytes: Uint8Array,
    signal: AbortSignal,
    beforeWrite: () => Promise<() => void>,
  ): Promise<void>
  /** Must bypass the ordinary line queue, even when a request is pending. */
  realtime(bytes: Uint8Array, signal: AbortSignal): Promise<void>
  cancel(): void
}
