// Lane D: one fake UDP socket for the DNS-SD binding, shared by the mDNS
// and discovery-switch suites so the fake exists exactly once. No real
// socket opens; failures are flipped with flags or injected on demand.
import type { DeviceMdnsUdpSocket } from '../../../src/host/devices/deviceMdns'

export class FakeMdnsSocket implements DeviceMdnsUdpSocket {
  private readonly messageListeners: ((message: Buffer, sender: { address: string }) => void)[] = []
  private readonly errorListeners: ((error: Error) => void)[] = []
  public boundPort: number | undefined
  public interfaceAddress: string | undefined
  public memberships: { address: string; interfaceAddress: string }[] = []
  public sent: { message: Buffer; port: number; address: string }[] = []
  public closed = 0
  public bindFails = false
  public sendFails = false
  public membershipFails = false
  public bind(port: number, callback: () => void): void {
    if (this.bindFails) {
      queueMicrotask(() => {
        for (const listener of this.errorListeners) listener(new Error('bind-sentinel'))
      })
      return
    }
    this.boundPort = port
    queueMicrotask(callback)
  }
  public send(message: Buffer, port: number, address: string): void {
    if (this.sendFails) throw new Error('send-sentinel')
    this.sent.push({ message, port, address })
  }
  public addMembership(address: string, interfaceAddress: string): void {
    if (this.membershipFails) throw new Error('membership-sentinel')
    this.memberships.push({ address, interfaceAddress })
  }
  public setMulticastInterface(interfaceAddress: string): void {
    this.interfaceAddress = interfaceAddress
  }
  public onMessage(listener: (message: Buffer, sender: { address: string }) => void): void {
    this.messageListeners.push(listener)
  }
  public onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener)
  }
  public close(): void {
    this.closed += 1
  }
  public inject(message: Buffer, address: string): void {
    for (const listener of this.messageListeners) listener(message, { address })
  }
  public fail(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}
