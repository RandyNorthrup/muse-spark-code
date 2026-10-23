import { createRoot, type Root } from 'react-dom/client'
import { setUiText } from '../../../shared/l10n/text'
import type { UiText } from '../../../shared/l10n/en'
import { NodePairing, type NodePairingProps } from './Pairing'

/** M104/N loads this separate browser entry only for the public sign-in page. */
export function mountNodePairing(
  element: HTMLElement,
  props: NodePairingProps,
  table: UiText,
  locale: string,
): Root {
  setUiText(table, locale)
  const root = createRoot(element)
  root.render(<NodePairing {...props} />)
  return root
}

export { NodeBrowserAuth } from './client'
