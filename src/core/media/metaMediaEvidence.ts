// D85.1 capture evidence, as plain data the light attach bundle
// (dist/media.js) and the capability record both read: the two
// contributor models' measured video rows from
// `docs/certification/m105-captures.md` (U4: 1.2 hears the soundtrack,
// 1.3 does not; U17b: fps 1 and 2 accepted and billed, 600 seconds
// the longest measured turn; U7 lives on the record's audio row).
// Nothing here is a vendor-wide default: a model with no row has no
// captures and stays unknown at the gate.
import { MEDIA_CALIBRATION_VIDEO_MAX_SECONDS } from '../../shared/constants'

export interface MetaMediaCapture {
  readonly modelId: string
  readonly videoFormats: readonly string[]
  readonly maxDurationSeconds: number
  readonly fps: { readonly min: number; readonly max: number }
  readonly hearsSoundtrack: boolean
}

const VIDEO_FORMATS = ['video/mp4', 'video/quicktime'] as const

const CAPTURES: readonly MetaMediaCapture[] = [
  {
    modelId: 'muse-spark-1.2-contributor',
    videoFormats: VIDEO_FORMATS,
    maxDurationSeconds: MEDIA_CALIBRATION_VIDEO_MAX_SECONDS,
    fps: { min: 1, max: 2 },
    hearsSoundtrack: true,
  },
  {
    modelId: 'muse-spark-1.3-contributor',
    videoFormats: VIDEO_FORMATS,
    maxDurationSeconds: MEDIA_CALIBRATION_VIDEO_MAX_SECONDS,
    fps: { min: 1, max: 2 },
    hearsSoundtrack: false,
  },
]

/** The captured media row for one model, or undefined when nobody measured it. */
export function metaMediaCapture(modelId: string): MetaMediaCapture | undefined {
  return CAPTURES.find((capture) => capture.modelId === modelId)
}
