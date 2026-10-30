// A feature the editor on the other end of MHP does not serve is refused in
// words, never answered with an empty success (AGENTS.md rule 6): the
// controller says what failed and this says why.
import { UI_TEXT } from '../../shared/constants'

/** The refusal of a feature this editor's MHP connection does not carry. */
export function unavailable(): never {
  throw new Error(UI_TEXT.hostService.notAvailable)
}
