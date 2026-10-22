import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from '../../shared/constants'
import { deviceEndpointSchema } from '../../shared/devices'
import { checkedDeviceAddress, checkedDeviceInterface } from '../../core/devices/deviceAddress'

const advertisementSchema = z.strictObject({
  serviceId: z
    .string()
    .check(
      z.minLength(DEVICE_LIMITS.idChars),
      z.maxLength(DEVICE_LIMITS.idChars),
      z.regex(/^[a-f0-9]+$(?![\s\S])/),
    ),
  port: deviceEndpointSchema.shape.port,
  version: z.literal(DEVICE_LIMITS.protocolVersion),
})
type DeviceAdvertisement = z.infer<typeof advertisementSchema>

// No mDNS package was selected by lane 0. I supplies the reviewed lazy DNS-SD
// binding; its decoder receives only packets admitted by this pre-parse cap.
// The binding advertises these three fields only, on this chosen interface,
// never an OS hostname, account, repository, model or stable device name.
// Discovery's one owned status. The switch shows exactly what this says and
// never infers success from a return value: `starting` while the socket
// opens, `on` once the first announcement is out, `off` when stopped, and
// `blocked-or-unreachable` (with the fixed reason, never socket or peer
// text) whenever the session reports failure — at startup or later.
export type DeviceDiscoveryStatus =
  | { readonly state: 'off' | 'starting' | 'on' }
  | { readonly state: 'blocked-or-unreachable'; readonly reason: 'blocked-or-unreachable' }

export interface DeviceMdnsPort {
  open(
    interfaceAddress: string,
    receive: (packet: Buffer, senderAddress: string) => void,
  ): Promise<{
    advertise(advertisement: DeviceAdvertisement): void
    close(): void
    /**
    Publishes session health, including after startup: a later send
    error, a socket error, or a closed port reports `blocked-or-unreachable`
    here. Optional so older fakes keep working; discovery still derives
    the same verdict from a throwing `advertise`.
    */
    onStatus?: (listener: (status: DeviceDiscoveryStatus) => void) => () => void
  }>
  decode(packet: Buffer): unknown
}

export interface DeviceDiscoveryPolicy {
  isEnabled(): boolean
  isPairedReceiverOffering(): boolean
}

export class DeviceDiscovery {
  private session: Awaited<ReturnType<DeviceMdnsPort['open']>> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly hints = new Map<string, { address: string; port: number; observedAt: number }>()
  private generation = 0
  private discoveryStatus: DeviceDiscoveryStatus = { state: 'off' }
  private readonly statusListeners = new Set<(status: DeviceDiscoveryStatus) => void>()

  constructor(
    private readonly mdns: DeviceMdnsPort,
    private readonly interfaces: () => readonly string[],
  ) {}

  private publish(status: DeviceDiscoveryStatus): void {
    this.discoveryStatus = status
    for (const listener of this.statusListeners) listener(status)
  }

  /**
  Halts this generation's traffic but keeps the blocked verdict: unlike
  `stop()`, the status stays `blocked-or-unreachable` so a caller that
  only reads the status still sees the failure. A second halt for the
  same generation is a no-op (the first already moved the generation on).
  */
  private haltBlocked(generation: number): void {
    if (generation !== this.generation) return
    this.generation += 1
    clearInterval(this.timer)
    this.timer = undefined
    const session = this.session
    this.session = undefined
    this.hints.clear()
    session?.close()
    this.publish({ state: 'blocked-or-unreachable', reason: 'blocked-or-unreachable' })
  }

  private expire(): void {
    for (const [id, hint] of this.hints) {
      if (Date.now() - hint.observedAt >= DEVICE_LIMITS.idleConnectionMs) this.hints.delete(id)
    }
  }

  /** The owned verdict; the switch shows exactly what this says. */
  public status(): DeviceDiscoveryStatus {
    return this.discoveryStatus
  }

  /** Subscribes to the owned verdict; returns an unsubscribe. */
  public onStatus(listener: (status: DeviceDiscoveryStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  async start(policy: DeviceDiscoveryPolicy, address: string, port: number): Promise<void> {
    this.stop()
    if (!policy.isEnabled() || !policy.isPairedReceiverOffering()) return
    const local = checkedDeviceInterface(address, this.interfaces())
    if (!deviceEndpointSchema.safeParse({ address: local, port }).success)
      throw new Error('invalid-device-address')
    const generation = this.generation
    let serviceId = ''
    let received = 0
    const isCurrent = () =>
      generation === this.generation && policy.isEnabled() && policy.isPairedReceiverOffering()
    this.publish({ state: 'starting' })
    let session: Awaited<ReturnType<DeviceMdnsPort['open']>>
    try {
      session = await this.mdns.open(local, (packet, sender) => {
        if (generation !== this.generation) return
        if (!isCurrent()) {
          this.stop()
          return
        }
        // Bound floods before decoding, and retained hints independently. Hints
        // contain addresses only: no API here can replace a saved pair or pin.
        received += 1
        if (
          received > DEVICE_LIMITS.queuedFrames ||
          packet.length === 0 ||
          packet.length > DEVICE_LIMITS.frameBytes
        )
          return
        try {
          const senderAddress = checkedDeviceAddress(sender)
          const parsed = advertisementSchema.safeParse(this.mdns.decode(packet))
          if (!parsed.success || parsed.data.serviceId === serviceId) return
          if (
            !this.hints.has(parsed.data.serviceId) &&
            this.hints.size >= DEVICE_LIMITS.pairedDevices
          )
            return
          this.hints.set(parsed.data.serviceId, {
            address: senderAddress,
            port: parsed.data.port,
            observedAt: Date.now(),
          })
        } catch {
          /* Ignore untrusted discovery data without reflecting its text. */
        }
      })
    } catch {
      this.haltBlocked(generation)
      throw new Error('blocked-or-unreachable')
    }
    if (!isCurrent()) {
      session.close()
      // Only this generation may settle its dropped policy. An older open
      // must leave a newer session's verdict alone.
      if (generation === this.generation) this.stop()
      return
    }
    this.session = session
    // Session health after startup reports through the same owned status: a
    // later send error, socket error or closed port halts this generation
    // with the blocked verdict instead of resolving into silent success.
    session.onStatus?.((sessionStatus) => {
      if (sessionStatus.state === 'blocked-or-unreachable') this.haltBlocked(generation)
    })
    const announce = () => {
      if (!isCurrent()) {
        this.stop()
        return
      }
      received = 0
      this.expire()
      serviceId = randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex')
      try {
        session.advertise({ serviceId, port, version: DEVICE_LIMITS.protocolVersion })
      } catch {
        this.haltBlocked(generation)
      }
    }
    announce()
    if (!isCurrent() || this.session !== session) {
      if (generation === this.generation) this.stop()
      return
    }
    this.publish({ state: 'on' })
    this.timer = setInterval(announce, DEVICE_LIMITS.idleConnectionMs)
  }

  // An address hint is never routed automatically; setup chooses it, and T
  // revalidates it while retaining the saved mutual-TLS identity.
  hint(serviceId: string): { readonly address: string; readonly port: number } | undefined {
    this.expire()
    const hint = this.hints.get(serviceId)
    return hint === undefined ? undefined : { address: hint.address, port: hint.port }
  }

  stop(): void {
    this.generation += 1
    clearInterval(this.timer)
    this.timer = undefined
    const session = this.session
    this.session = undefined
    this.hints.clear()
    session?.close()
    this.publish({ state: 'off' })
  }
}
