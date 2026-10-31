import {
  MAKER_REVIEW_BYTE_MAX,
  MAKER_REVIEW_TEMPERATURE_VALUES,
  MILLIMETERS_PER_METER,
  UI_TEXT,
} from '../../shared/constants'
import {
  fill,
  formatBytes,
  formatList,
  formatNumber,
  formatPercent,
  formatUnit,
  plural,
} from '../../shared/l10n/text'
import type { ApprovalRequest, MakerMachineSummary } from '../../shared/makerProtocol'
import type { CanonicalPayload } from '../../core/maker/canonicalPayload'
import type { PayloadSummary } from '../../core/maker/payloadSummary'

export function PayloadSummaryView({
  payload,
  summary,
  request,
  limits,
}: {
  readonly payload: CanonicalPayload
  readonly summary: PayloadSummary
  readonly request: ApprovalRequest | undefined
  readonly limits: MakerMachineSummary['limits'] | undefined
}) {
  const unknown = UI_TEXT.makerSummaryUnknown
  const reasons = {
    temperature: UI_TEXT.makerDangerTemperature,
    travel: UI_TEXT.makerDangerTravel,
    safety: UI_TEXT.makerDangerSafety,
    unknown: UI_TEXT.makerDangerUnknown,
  }
  return (
    <section aria-label={UI_TEXT.makerAnalysisLabel}>
      <h3>{UI_TEXT.makerAnalysisLabel}</h3>
      <p>
        {fill(UI_TEXT.makerPayloadSize, {
          size: formatBytes(payload.byteLength),
          lines: formatNumber(payload.lineCount),
        })}
      </p>
      <p>
        {UI_TEXT.makerDigestLabel}: <code className="maker-digest">{payload.digest}</code>
      </p>
      {request?.action === 'program' ? (
        <>
          <p>
            {UI_TEXT.makerEntryPoint}: {summary.entryPoint ?? unknown}
          </p>
          <p>{UI_TEXT.makerFirmwareSizeNotice}</p>
        </>
      ) : (
        <>
          {(['extruder', 'bed', 'chamber'] as const).map((heater) => {
            const temperature = summary.temperatures[heater]
            const settings = summary.temperatureSettings[heater]
            const shown = settings.slice(0, MAKER_REVIEW_TEMPERATURE_VALUES)
            return (
              <p key={heater}>
                {plural(UI_TEXT.makerTemperatureSettings, settings.length, {
                  temperatures:
                    shown.length === 0
                      ? unknown
                      : formatList(shown.map((value) => formatUnit(value, 'celsius'))),
                  shown: formatNumber(shown.length),
                  maximum: temperature === undefined ? unknown : formatUnit(temperature, 'celsius'),
                })}{' '}
                ({heater})
              </p>
            )
          })}
          <p>
            {UI_TEXT.makerFan}:{' '}
            {summary.fan === undefined
              ? unknown
              : formatPercent((summary.fan / MAKER_REVIEW_BYTE_MAX) * 100)}
          </p>
          <p>
            {fill(UI_TEXT.makerMaximumFeed, {
              feed:
                summary.feed === undefined
                  ? unknown
                  : formatUnit(summary.feed / MILLIMETERS_PER_METER, 'meter-per-minute'),
            })}
          </p>
          <p>
            {UI_TEXT.makerEstimatedTime}:{' '}
            {summary.seconds === undefined ? unknown : formatUnit(summary.seconds, 'second')}
          </p>
          <p>
            {UI_TEXT.makerTravelSummary}:{' '}
            {summary.bounds === undefined
              ? unknown
              : JSON.stringify(summary.bounds, (_key, value: unknown) =>
                  typeof value === 'number' ? formatNumber(value) : value,
                )}
          </p>
          <p>
            {UI_TEXT.makerLimitsTitle}:{' '}
            {limits === undefined
              ? unknown
              : JSON.stringify(limits, (_key, value: unknown) =>
                  typeof value === 'number' ? formatNumber(value) : value,
                )}
          </p>
        </>
      )}
      {summary.dangers.map((reason) => (
        <p key={reason} className="maker-danger">
          {reasons[reason]}
        </p>
      ))}
    </section>
  )
}
