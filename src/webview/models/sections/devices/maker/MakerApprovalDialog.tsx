// RLF-DEVICES: the exact-payload approval dialog. The host shows one
// prompt at a time; the document only displays it and posts the person's
// echoed answer. Closing, Escape and the backdrop all answer reject;
// the engine's single-use verify keeps a retried answer from actuating
// twice. Machine words (names, ports, commands, digests, units) stay
// spliced detail, never translated sentences.
import { useId } from 'react'
import { UI_TEXT } from '../../../../../shared/constants'
import { fill, formatDateTime, formatNumber } from '../../../../../shared/l10n/text'
import type { MakerAnalysis, MakerApprovalPrompt } from '../../../../../shared/maker'
import {
  makerBoundsParts,
  makerKindText,
  makerOperationText,
} from '../../../../../shared/makerText'
import type { DeviceActionResult } from '../../../../../shared/devicesPanel'
import type { DeviceAction } from '../../agents/DevicePairing'
import { Modal } from '../../../../components/Modal'

export function MakerApprovalDialog({
  prompt,
  busy,
  send,
}: {
  readonly prompt: MakerApprovalPrompt
  readonly busy: boolean
  readonly send: (action: DeviceAction) => Promise<DeviceActionResult>
}) {
  const titleId = useId()
  const { target, analysis } = prompt
  const choose = (decision: 'send' | 'reject'): void => {
    if (busy) return
    const action: DeviceAction = {
      kind: 'answerMakerApproval',
      requestId: prompt.requestId,
      decision,
      digest: prompt.digest,
    }
    void send(action)
  }
  const ranges = analysis?.bounds === undefined ? [] : makerBoundsParts(analysis.bounds)
  const maybeAnalysis: MakerAnalysis | undefined = analysis
  const hasAnalysisBody =
    maybeAnalysis !== undefined &&
    (maybeAnalysis.maxTempC !== undefined ||
      maybeAnalysis.maxFeedMmMin !== undefined ||
      ranges.length > 0 ||
      maybeAnalysis.unknownCommands.length > 0)
  const targetParts = [
    makerKindText(target.kind),
    target.name,
    target.endpoint,
    ...(target.reportedAs === undefined ? [] : [target.reportedAs]),
  ]
  return (
    <Modal
      title={UI_TEXT.devices.makerApprovalTitle}
      titleId={titleId}
      isWide
      onClose={() => {
        choose('reject')
      }}
    >
      <div>
        <dl className="device-facts">
          <div>
            <dt>{UI_TEXT.devices.makerTarget}</dt>
            <dd>{targetParts.join(' · ')}</dd>
          </div>
          <div>
            <dt>{UI_TEXT.devices.makerOperation}</dt>
            <dd>{makerOperationText(prompt.operation)}</dd>
          </div>
          <div>
            <dt>{UI_TEXT.devices.makerDigest}</dt>
            <dd>
              <code>{prompt.digest}</code>
            </dd>
          </div>
        </dl>
        {hasAnalysisBody && (
          <>
            <h3>{UI_TEXT.devices.makerAnalysis}</h3>
            {(maybeAnalysis.maxTempC !== undefined ||
              maybeAnalysis.maxFeedMmMin !== undefined ||
              ranges.length > 0) && (
              <dl className="device-facts">
                {maybeAnalysis.maxTempC !== undefined && (
                  <div>
                    <dt>{UI_TEXT.devices.makerMaxTemp}</dt>
                    <dd>{formatNumber(maybeAnalysis.maxTempC)} °C</dd>
                  </div>
                )}
                {maybeAnalysis.maxFeedMmMin !== undefined && (
                  <div>
                    <dt>{UI_TEXT.devices.makerMaxFeed}</dt>
                    <dd>{formatNumber(maybeAnalysis.maxFeedMmMin)} mm/min</dd>
                  </div>
                )}
                {ranges.length > 0 && (
                  <div>
                    <dt>{UI_TEXT.devices.makerBounds}</dt>
                    <dd>{ranges.join(' · ')}</dd>
                  </div>
                )}
              </dl>
            )}
          </>
        )}
        {target.simulated && (
          <>
            <p>
              <strong>{UI_TEXT.devices.makerSimulator}</strong>
            </p>
            <p>{UI_TEXT.devices.makerSimNote}</p>
          </>
        )}
        {prompt.warning === 'portReset' && <p>{UI_TEXT.devices.makerWarningPortReset}</p>}
        {analysis !== undefined && analysis.unknownCommands.length > 0 && (
          <>
            <h3>{UI_TEXT.devices.makerUnknownCommands}</h3>
            <ul>
              {analysis.unknownCommands.map((command) => (
                <li key={command}>
                  <code>{command}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        <div>
          <h3>{UI_TEXT.devices.makerPayload}</h3>
          {prompt.preview.length === 0 ? (
            <p>{UI_TEXT.devices.makerPayloadEmpty}</p>
          ) : (
            <pre className="device-maker-payload">
              {prompt.preview
                .map((line) => (line.kind === 'text' ? line.text : line.hex))
                .join('\n')}
            </pre>
          )}
        </div>
        {prompt.expiresAt !== undefined && (
          <p>{fill(UI_TEXT.devices.makerExpires, { expiry: formatDateTime(prompt.expiresAt) })}</p>
        )}
        <div className="device-decisions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              choose('send')
            }}
          >
            {UI_TEXT.devices.makerSendOnce}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              choose('reject')
            }}
          >
            {UI_TEXT.devices.makerReject}
          </button>
        </div>
        <p>{UI_TEXT.devices.makerApprovalClosed}</p>
      </div>
    </Modal>
  )
}
