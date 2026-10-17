// A stored credential names only the origin it was entered for, never
// the key (M95 acceptance 5). This component receives the key state, not
// a key: there is no prop any key's characters could arrive through.

import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { ProviderKey } from '../../../shared/modelsPanel'

export function KeyState({ credential }: { readonly credential: ProviderKey }) {
  if (credential.state === 'missing') {
    return <span className="models-key-state">{UI_TEXT.keyMissing}</span>
  }
  if (credential.state === 'needs-again') {
    return (
      <span className="models-key-state models-key-state-warning" role="alert">
        {fill(UI_TEXT.originBindingMismatch, {
          actual: credential.actualOrigin ?? '',
          expected: credential.origin ?? '',
        })}
      </span>
    )
  }
  return (
    <span className="models-key-state">
      {fill(UI_TEXT.keyBoundState, { origin: credential.origin ?? '' })}
    </span>
  )
}
