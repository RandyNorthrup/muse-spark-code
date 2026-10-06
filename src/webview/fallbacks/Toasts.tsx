import { UI_TEXT } from '../../shared/l10n/text'
import type { MhpParams } from '../../shared/hostApi/methods'

export function Toasts({
  items,
  onDismiss,
}: {
  readonly items: readonly (MhpParams<'ui/notify'> & { readonly id: string })[]
  readonly onDismiss: (id: string) => void
}) {
  return (
    <aside className="fallback-toasts" aria-label={UI_TEXT.fallbackNotifications}>
      {items.map((item) => (
        <div
          key={item.id}
          className="fallback-toast"
          role={item.severity === 'error' ? 'alert' : 'status'}
        >
          <p>{item.message}</p>
          <button
            type="button"
            aria-label={UI_TEXT.usageClose}
            onClick={() => {
              onDismiss(item.id)
            }}
          >
            {UI_TEXT.usageClose}
          </button>
        </div>
      ))}
    </aside>
  )
}
