// M100 phase 2, lane V (D100: G1, G2, G12): capability advertisement,
// built and admitted under lane 0's schema and byte cap. The device
// supplies measured capabilities (OS, tools, engines, hardware presence,
// power, slot cap) and aggregate live pressure; transport reset deltas and
// pressure leave here as typed signals for M107's governor. The offer
// capability region binds an offer to the live advertisement; the offer
// shapes themselves stay lane 0's, in new files only.
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  deviceCapabilitySchema,
  deviceOfferSchema,
  type DeviceCapability,
} from '../../shared/devices'
import { DevicePairingError } from './pairing'

/**
Builds the advertisement from measured values, stamped at now. Parse
success is proof of the byte cap (lane 0's refine holds it); a
measurement that serializes past the cap refuses here instead of
shipping a silently truncated advertisement.
*/
export function buildCapability(
  input: Omit<DeviceCapability, 'observedAt'>,
  now: number,
): DeviceCapability {
  const parsed = deviceCapabilitySchema.safeParse({ ...input, observedAt: now })
  if (!parsed.success) throw new DevicePairingError('invalid-frame')
  return parsed.data
}

/**
Admits a wire advertisement: the schema checks the version, the fields
and the UTF-8 byte cap, and observedAt must not run past now plus clock
skew. Age policy stays with the consumer (M107 reads observedAt); admit
proves shape and cap, never freshness.
*/
export function admitCapability(candidate: unknown, now: number): DeviceCapability {
  const parsed = deviceCapabilitySchema.safeParse(candidate)
  if (!parsed.success) throw new DevicePairingError('invalid-frame')
  const capability = parsed.data
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    capability.observedAt > now + DEVICE_LIMITS.clockSkewMs
  )
    throw new DevicePairingError('invalid-frame')
  return capability
}

// Offer capability region (new files only): an offer is admitted only
// against the incarnation and platform the device currently advertises,
// with workers inside the advertised slot cap.
export function admitOfferCapability(offer: unknown, capability: unknown, now: number): void {
  const admitted = admitCapability(capability, now)
  const parsedOffer = deviceOfferSchema.safeParse(offer)
  if (!parsedOffer.success) throw new DevicePairingError('invalid-frame')
  if (
    parsedOffer.data.deviceId !== admitted.deviceId ||
    parsedOffer.data.receiverIncarnationId !== admitted.receiverIncarnationId
  )
    throw new DevicePairingError('grant')
  if (parsedOffer.data.platform !== admitted.platform) throw new DevicePairingError('incompatible')
  if (parsedOffer.data.caps.workers > admitted.slotCap) throw new DevicePairingError('capacity')
}

/** The previous pressure sample the governor compares against, if any. */
export interface CapabilityPressureSample {
  readonly observedAt: number
  readonly transportResets: number
}

/**
Pressure and transport signals for M107's governor. Rates stay the
governor's division: this reports the reset delta and elapsed time, null
without a previous sample or when time did not advance.
*/
export interface CapabilityGovernorSignals {
  readonly cpuPercent: number
  readonly memoryPercent: number
  readonly diskPercent: number
  readonly power: DeviceCapability['power']
  readonly slotCap: number
  readonly transportResets: number
  readonly observedAt: number
  readonly resetDelta: number | null
  readonly elapsedMs: number | null
}

export function capabilityGovernorSignals(
  capability: DeviceCapability,
  previous?: CapabilityPressureSample,
): CapabilityGovernorSignals {
  const parsed = deviceCapabilitySchema.safeParse(capability)
  if (!parsed.success) throw new DevicePairingError('invalid-frame')
  const current = parsed.data
  const base = {
    cpuPercent: current.pressure.cpuPercent,
    memoryPercent: current.pressure.memoryPercent,
    diskPercent: current.pressure.diskPercent,
    power: current.power,
    slotCap: current.slotCap,
    transportResets: current.pressure.transportResets,
    observedAt: current.observedAt,
  }
  if (previous === undefined) return { ...base, resetDelta: null, elapsedMs: null }
  if (
    !Number.isSafeInteger(previous.observedAt) ||
    previous.observedAt < 0 ||
    !Number.isSafeInteger(previous.transportResets) ||
    previous.transportResets < 0
  )
    throw new DevicePairingError('invalid-frame')
  const elapsed = current.observedAt - previous.observedAt
  // A counter restart supplies no comparable rate; never emit a negative delta.
  if (!(elapsed > 0) || current.pressure.transportResets < previous.transportResets)
    return { ...base, resetDelta: null, elapsedMs: null }
  return {
    ...base,
    resetDelta: current.pressure.transportResets - previous.transportResets,
    elapsedMs: elapsed,
  }
}
