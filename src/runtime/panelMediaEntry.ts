// M105 delivery d (D85): the native panel's `attachments/*` bundle entry.
// dist/runtimePanelMedia.js: the MHP route and one port per conversation,
// loaded on the first attachments call, never with the panel. The bundle
// reads the installed table the caller passes, like dist/media.js.
import { setUiText } from '../shared/l10n/text'
import { createPanelMedia as create, type PanelMediaOptions } from './panel/panelMedia'

export function createPanelMedia(options: PanelMediaOptions) {
  setUiText(options.table, options.locale)
  return create(options)
}

export { routeAttachmentMethod } from './panel/panelMedia'
export type {
  AttachmentDispatch,
  AttachmentOwner,
  PanelMediaHost,
  PanelMediaOptions,
} from './panel/panelMedia'
