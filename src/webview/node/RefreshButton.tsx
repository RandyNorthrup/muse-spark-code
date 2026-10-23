import { UI_TEXT } from '../../shared/constants'

/** The refresh button every node page shares: disabled while its page is busy. */
export function RefreshButton({
  busy,
  onClick,
}: {
  readonly busy: boolean
  readonly onClick: () => void
}) {
  return (
    <button type="button" disabled={busy} onClick={onClick}>
      {UI_TEXT.nodeWorkspace.refresh}
    </button>
  )
}
