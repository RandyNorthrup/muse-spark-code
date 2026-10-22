// Even an active maker host loads the preview adapter only on its first preview.
import { setUiText } from '../../shared/l10n/text'
import { MakerPreviewPanel, type MakerPreviewPanelDeps } from './makerPreviewPanel'

export function createPreviewPanel(deps: MakerPreviewPanelDeps): MakerPreviewPanel {
  setUiText(deps.l10n.table, deps.l10n.locale)
  return new MakerPreviewPanel(deps)
}
