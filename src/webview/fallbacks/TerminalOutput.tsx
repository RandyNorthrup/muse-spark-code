import { UI_TEXT } from '../../shared/l10n/text'

/** Output is text, including escape sequences; never HTML or a shell command. */
export function TerminalOutput({
  title,
  output,
  isRunning,
  onStop,
}: {
  readonly title: string
  readonly output: string
  readonly isRunning: boolean
  readonly onStop: () => void
}) {
  return (
    <main className="fallback-page">
      <h1>{title}</h1>
      <pre className="fallback-terminal" tabIndex={0} aria-label={UI_TEXT.fallbackTerminal}>
        {output}
      </pre>
      {isRunning && (
        <button type="button" onClick={onStop}>
          {UI_TEXT.stopTitle}
        </button>
      )}
    </main>
  )
}
