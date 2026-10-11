// Form and row errors in plain words (M95: nothing is saved until the
// form is valid; errors are inline). The host words them; the panel only
// shows them, as an alert so screen readers hear them.

export function InlineError({ messages }: { readonly messages: readonly string[] }) {
  if (messages.length === 0) {
    return null
  }
  if (messages.length === 1) {
    return (
      <p className="models-error" role="alert">
        {messages[0]}
      </p>
    )
  }
  return (
    <ul className="models-error models-error-list" role="alert">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  )
}
