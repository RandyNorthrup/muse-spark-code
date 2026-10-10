// Optional M105 chip region; loaded only when a chip carries media metadata.
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, plural } from '../../shared/l10n/text'
import { formatUsd as formatExactUsd } from '../../shared/l10n/exactUsd'
import type { MediaChip } from '../../shared/media'
import { formatDurationMs } from '../agentFormat'

export function AttachmentMediaCost({
  media,
  isContributor,
}: {
  readonly media: MediaChip
  readonly isContributor: boolean
}) {
  const { info, estimate } = media
  const labels: string[] = []
  if (info.kind === 'video' || info.kind === 'audio') {
    labels.push(
      info.durationSeconds === null
        ? UI_TEXT.media.durationUnknown
        : formatDurationMs(info.durationSeconds * MILLISECONDS_PER_SECOND),
    )
  }
  labels.push(formatBytes(info.sizeBytes))
  if (info.kind === 'video') {
    let sound = UI_TEXT.media.soundUnknown
    if (info.hasSoundtrack !== null)
      sound = info.hasSoundtrack ? UI_TEXT.media.sound : UI_TEXT.media.noSound
    labels.push(sound)
  }
  if (estimate !== undefined) {
    labels.push(
      `~${plural(UI_TEXT.media.estimateTokens, estimate.estimatedInputTokens)}`,
      estimate.contributorCostUsd === undefined
        ? formatExactUsd(estimate.standardCostUsd, 2)
        : fill(UI_TEXT.media.estimatePrices, {
            standard: formatExactUsd(estimate.standardCostUsd, 2),
            contributor: formatExactUsd(estimate.contributorCostUsd, 2),
          }),
    )
  }
  return (
    <span className="chip-size">
      <span>{labels.join(' · ')}</span>
      {isContributor &&
        (info.kind === 'video' || info.kind === 'audio' || media.isScreenRecording === true) && (
          <>
            <br />
            <span>{UI_TEXT.media.contributorWarning}</span>
          </>
        )}
      {media.isScreenRecording === true && (
        <>
          <br />
          <span>{UI_TEXT.media.recordingWarning}</span>
        </>
      )}
    </span>
  )
}
