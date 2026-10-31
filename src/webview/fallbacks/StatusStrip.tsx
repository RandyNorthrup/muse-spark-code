import type { MhpParams } from '../../shared/hostApi/methods'
import { UI_TEXT } from '../../shared/l10n/text'

export function StatusStrip({
  items,
  progress,
  onCommand,
}: {
  readonly items: readonly MhpParams<'ui/status'>[]
  readonly progress: readonly MhpParams<'ui/progress'>[]
  readonly onCommand: (id: string) => void
}) {
  return (
    <footer className="fallback-status" aria-label={UI_TEXT.fallbackStatus}>
      {items
        .filter((item) => item.visible)
        .map((item) =>
          item.command === undefined ? (
            <span key={JSON.stringify(item.id)} role="status">
              {item.text}
            </span>
          ) : (
            <button
              key={JSON.stringify(item.id)}
              type="button"
              onClick={() => {
                if (item.command !== undefined) onCommand(item.command)
              }}
            >
              {item.text}
            </button>
          ),
        )}
      {progress
        .filter((item) => !item.done)
        .map((item) => (
          <label key={JSON.stringify(item.id)}>
            {item.title}
            {item.message !== undefined && <span>: {item.message}</span>}
            <progress aria-label={item.title} max={1} value={item.fraction} />
          </label>
        ))}
    </footer>
  )
}
