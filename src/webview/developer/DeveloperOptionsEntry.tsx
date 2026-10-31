// The panel's lazy Developer options entry: the shared page plus the
// install's version line, whose seven clicks within the window unlock.
// Loaded only when the page opens; the badge in the header reads the
// pushed snapshot without loading this chunk.
import { UI_TEXT } from '../../shared/constants'
import type { DeveloperRequest } from '../../shared/developerOptions'
import { fill } from '../../shared/l10n/text'
import { Modal } from '../components/Modal'
import { DeveloperOptionsPage } from './DeveloperOptionsPage'

export default function DeveloperOptionsEntry({
  message,
  version,
  post,
  onClose,
}: {
  readonly message: unknown
  readonly version: string
  readonly post: (request: DeveloperRequest) => void
  readonly onClose: () => void
}) {
  return (
    <Modal title={UI_TEXT.developer.title} titleId="developer-options-title" onClose={onClose}>
      <DeveloperOptionsPage message={message} post={post} />
      <footer>
        <button
          type="button"
          onClick={() => {
            post({ type: 'developer/versionClick' })
          }}
        >
          {fill(UI_TEXT.developer.versionLine, { version })}
        </button>
      </footer>
    </Modal>
  )
}
