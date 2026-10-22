import { isIP } from 'node:net'
import { DEVICE_LIMITS } from '../../shared/constants'
import { deviceEndpointSchema } from '../../shared/devices'

export function checkedDeviceAddress(address: string): string {
  if (!deviceEndpointSchema.safeParse({ address, port: 1 }).success || isIP(address) === 0) {
    throw new Error('invalid-device-address')
  }
  return address.includes(':') ? new URL(`https://[${address}]/`).hostname.slice(1, -1) : address
}

export function checkedDeviceInterface(address: string, interfaces: readonly string[]): string {
  const checked = checkedDeviceAddress(address)
  if (
    !interfaces.some((entry) => {
      try {
        return checkedDeviceAddress(entry) === checked
      } catch (error) {
        if (error instanceof Error && error.message === 'invalid-device-address') return false
        throw error
      }
    })
  )
    throw new Error('invalid-device-interface')
  return checked
}

export type DeviceLookup = (hostname: string) => Promise<readonly string[]>

function isLoopback(address: string): boolean {
  return address === '::1' || address.startsWith('127.')
}

// Resolve on every connect, reject mixed answers, then dial this literal only.
// No URL, redirect, proxy option, credential or resolver is handed to TLS.
export async function resolveDeviceAddress(
  hostname: string,
  localAddress: string,
  lookup: DeviceLookup,
): Promise<string> {
  if (
    hostname.length > DEVICE_LIMITS.addressChars ||
    (isIP(hostname) === 0 && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname))
  ) {
    throw new Error('invalid-device-address')
  }
  const answers = isIP(hostname) === 0 ? await lookup(hostname) : [hostname]
  if (answers.length === 0 || answers.length > DEVICE_LIMITS.entries) {
    throw new Error('invalid-device-address')
  }
  const local = checkedDeviceAddress(localAddress)
  const checked = answers.map((address) => checkedDeviceAddress(address))
  if (checked.some((address) => isLoopback(address) !== isLoopback(local))) {
    throw new Error('invalid-device-address')
  }
  const selected = checked.find((address) => isIP(address) === isIP(local))
  if (selected === undefined) throw new Error('invalid-device-address')
  return selected
}
