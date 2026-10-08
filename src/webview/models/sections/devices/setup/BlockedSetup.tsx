// M100 phase 2 (lane U): the blocked-or-unreachable recovery block. The
// blocked summary itself (application, interface, address and port) and the
// unresolved attempts and liability live in DeviceCard and stay shown
// through every retry; this adds the OS and administrator recovery steps.
// It never promises prompt-free or admin-free access and never changes the
// firewall: recovery happens on the device or with an administrator.
import { UI_TEXT } from '../../../../../shared/constants'
import { fill, formatNumber } from '../../../../../shared/l10n/text'

export function BlockedSetup({
  application,
  interfaceLabel,
  address,
  port,
}: {
  readonly application: string
  readonly interfaceLabel: string
  readonly address: string
  readonly port: number
}) {
  return (
    <div className="device-blocked-setup">
      <p>
        {fill(UI_TEXT.devices.blockedRecovery, {
          application,
          interface: interfaceLabel,
          address,
          port: formatNumber(port),
        })}
      </p>
    </div>
  )
}
