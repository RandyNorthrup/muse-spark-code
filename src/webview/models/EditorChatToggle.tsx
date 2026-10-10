import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { ModelRow, PanelToHostMessage } from '../../shared/modelsPanel'

export default function EditorChatToggle({
  row,
  post,
}: {
  readonly row: ModelRow
  readonly post: (message: PanelToHostMessage) => void
}) {
  return (
    <label>
      <input
        type="checkbox"
        aria-label={fill(UI_TEXT.editorChatModel, { model: row.ref })}
        checked={row.editorChat === true}
        disabled={
          row.editorChat !== true &&
          (!row.ticked || !['priced', 'local', 'free'].includes(row.priceNote))
        }
        onChange={() => {
          post({
            type: 'models/tick',
            scope: { scope: 'editorChat' },
            ref: row.ref,
            ticked: !row.editorChat,
          })
        }}
      />
      {UI_TEXT.editorChatTitle}
    </label>
  )
}
