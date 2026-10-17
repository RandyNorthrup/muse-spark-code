// Independent English expectations for the host's localized D85.5 choices.
import type { AudioRouteOptions } from '../../../src/shared/audioRouting'

export const audioLabels: AudioRouteOptions['labels'] = {
  transcribe: 'Transcribe the Sound (Paid: $0.18 per hour of audio)',
  useSoundtrackModel: 'Use muse-spark-1.2 for This Message',
  wrapAsVideo: 'Send to muse-spark-1.2 as a Video',
  sendWithoutSound: 'Send Without Sound',
  sendAudio: 'Send',
}
