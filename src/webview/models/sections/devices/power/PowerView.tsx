// M100 phase 2 (lane U): battery and pressure from the capability
// advertisement. Power (ac, battery or unknown), sleep inhibition, CPU,
// memory and disk pressure and transport resets come from the advertised
// capability; throttling reads as throttled with its help and the unknown
// time. A throttled or unknown peer never reads offline or down (G5, G34):
// this view renders no offline/down state at all.
import { UI_TEXT } from '../../../../../shared/constants'
import { deviceObservationText } from '../../agents/devicePresentation'
import { fill, formatNumber, formatPercent } from '../../../../../shared/l10n/text'
import type { DeviceCapability, DeviceThrottled } from '../../../../../shared/devices'

function powerText(power: DeviceCapability['power']): string {
  switch (power) {
    case 'ac': {
      return UI_TEXT.devices.powerAc
    }
    case 'battery': {
      return UI_TEXT.devices.powerBattery
    }
    default: {
      return UI_TEXT.devices.powerUnknown
    }
  }
}

export function PowerView({
  capability,
  throttled,
}: {
  readonly capability: DeviceCapability | undefined
  readonly throttled: DeviceThrottled | undefined
}) {
  if (capability === undefined && throttled === undefined) return null
  return (
    <section className="device-power" aria-label={UI_TEXT.devices.power}>
      <h3>{UI_TEXT.devices.power}</h3>
      {capability !== undefined && (
        <>
          <p>
            {UI_TEXT.devices.power}: {powerText(capability.power)}
          </p>
          {capability.sleepInhibited && <p>{UI_TEXT.devices.sleepInhibited}</p>}
          <dl className="device-facts">
            <div>
              <dt>{UI_TEXT.devices.cpuPressure}</dt>
              <dd>{formatPercent(capability.pressure.cpuPercent)}</dd>
            </div>
            <div>
              <dt>{UI_TEXT.devices.memoryPressure}</dt>
              <dd>{formatPercent(capability.pressure.memoryPercent)}</dd>
            </div>
            <div>
              <dt>{UI_TEXT.devices.diskPressure}</dt>
              <dd>{formatPercent(capability.pressure.diskPercent)}</dd>
            </div>
            <div>
              <dt>{UI_TEXT.devices.transportResets}</dt>
              <dd>{formatNumber(capability.pressure.transportResets)}</dd>
            </div>
          </dl>
        </>
      )}
      {throttled !== undefined && (
        <>
          <p role="status">{UI_TEXT.devices.throttled}</p>
          <p>{UI_TEXT.devices.throttledHelp}</p>
          <p>
            {fill(UI_TEXT.devices.unknownSince, {
              time: deviceObservationText(throttled.unknownSince),
            })}
          </p>
        </>
      )}
    </section>
  )
}
