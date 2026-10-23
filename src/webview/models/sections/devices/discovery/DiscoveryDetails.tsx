// M100 phase 2 (lane U): the discovery advertisement beside the switch.
// Turning discovery on is an explicit local action (the switch in
// DevicesView); this states exactly what is advertised — an opaque service
// id, port and protocol version — and that discovery grants no trust.
import { DEVICE_LIMITS, UI_TEXT } from '../../../../../shared/constants'
import { fill, formatNumber } from '../../../../../shared/l10n/text'

export function DiscoveryDetails({
  serviceId,
  port,
}: {
  readonly serviceId: string
  readonly port: number
}) {
  return (
    <p className="device-discovery-details">
      {fill(UI_TEXT.devices.discoveryAdvertises, {
        service: serviceId,
        port: formatNumber(port),
        version: formatNumber(DEVICE_LIMITS.protocolVersion),
      })}
    </p>
  )
}
