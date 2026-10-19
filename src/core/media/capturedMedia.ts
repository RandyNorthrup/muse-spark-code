// M105 lane V: video, audio and Files from the captured record, the same one
// the session's media service gates and prices with, over a host's
// established image and document projection. A model with no captures stays
// unknown, which the gate refuses with its reason. Shared by the VS Code
// attach bundle and the runtime's ACP and exec media port.
import type { MediaModelCapabilities } from './modalityGate'
import { metaMediaCapabilities } from './metaMediaCapabilities'

export function withCapturedMedia(model: MediaModelCapabilities): MediaModelCapabilities {
  const captured = metaMediaCapabilities(model.modelId)
  return {
    ...model,
    provider: captured.provider,
    modalities: {
      ...model.modalities,
      video: captured.modalities.video,
      audio: captured.modalities.audio,
    },
    files: captured.files,
  }
}
