// The Traffic view's read and dispatch (M96c lane V/X2), in their own
// bundle (dist/teamTraffic.js): loaded only on the first Traffic use, so
// the runners bundle carries transports and check slots alone and the
// models-panel schemas ride only here (RLF-TEAMFIT, D6).
import { handleTrafficMessage, handleRunnersMessage } from '../modelsPanelTraffic'
import { dispatchTeamTraffic, readTeamTraffic } from './teamTrafficDispatch'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export function createTeamTrafficRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return {
    handleTrafficMessage,
    handleRunnersMessage,
    readTeamTraffic,
    dispatchTeamTraffic,
  }
}
