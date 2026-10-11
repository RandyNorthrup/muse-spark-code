// M105-A browser-safe sound choices. Hosts project captured model capabilities
// into these labels; the webview never infers capabilities from model names.
import type { MEDIA_AUDIO_ACTIONS } from './constants'

export type AudioAction = (typeof MEDIA_AUDIO_ACTIONS)[number]

export interface AudioRouteOptions {
  readonly actions: readonly AudioAction[]
  /** Host-localized labels travel with the capability choices. */
  readonly labels: Readonly<Record<AudioAction, string>>
  readonly defaultAction?: AudioAction
  readonly soundtrackModelId?: string
  readonly warning?: string
}
