// Independent English expectations for the host's localized D85.5 choices.
import type { AudioRouteOptions } from '../../../src/shared/audioRouting'

export const audioLabels: AudioRouteOptions['labels'] = {
  transcribe: 'Transcribe the sound (paid: $0.18 per hour of audio)',
  useSoundtrackModel: 'Use muse-spark-1.2 for this message',
  wrapAsVideo: 'Send to muse-spark-1.2 as a video',
  sendWithoutSound: 'Send without sound',
  sendAudio: 'Send',
}
