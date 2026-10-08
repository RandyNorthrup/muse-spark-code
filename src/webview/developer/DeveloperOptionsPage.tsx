// Own lazy UI entry, shared by every editor and the companion bridge. React
// and the installed table come from the caller's existing webview runtime.
import { useId, useState, type SubmitEvent } from 'react'
import { UI_TEXT } from '../../shared/constants'
import {
  developerReplySchema,
  type DeveloperRequest,
  type DeveloperSnapshot,
} from '../../shared/developerOptions'
import { fill, formatDateTime } from '../../shared/l10n/text'
import './developerOptions.css'

export function DeveloperModeBadge({ snapshot }: { readonly snapshot: DeveloperSnapshot }) {
  return snapshot.isUnlocked ? (
    <span role="status" aria-label={UI_TEXT.developer.badge}>
      {UI_TEXT.developer.badge}
    </span>
  ) : null
}

export function DeveloperOptionsPage({
  message,
  post,
}: {
  readonly message: unknown
  readonly post: (request: DeveloperRequest) => void
}) {
  const reply = developerReplySchema.safeParse(message)
  const [provider, setProvider] = useState('')
  const [account, setAccount] = useState('')
  const prefix = useId()
  const snapshot = reply.success && reply.data.type === 'developer/state' ? reply.data : undefined
  let error: string | undefined
  if (!reply.success) error = UI_TEXT.developer.invalidRequest
  else if (reply.data.type === 'developer/error') error = UI_TEXT.developer[reply.data.code]
  const add = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    post({ type: 'developer/addProfile', provider, account })
  }
  return (
    <main className="developer-options" aria-label={UI_TEXT.developer.title}>
      <h1>{UI_TEXT.developer.title}</h1>
      {snapshot !== undefined && <DeveloperModeBadge snapshot={snapshot} />}
      <p>{UI_TEXT.developer.unlockWarning}</p>
      {error !== undefined && <p role="alert">{error}</p>}
      {snapshot?.isUnlocked !== true && <p>{UI_TEXT.developer.helpUnlock}</p>}
      {snapshot?.expiresAt !== null && snapshot?.expiresAt !== undefined && (
        <p>{fill(UI_TEXT.developer.expires, { time: formatDateTime(snapshot.expiresAt) })}</p>
      )}
      <label>
        <input
          type="checkbox"
          checked={snapshot?.isMultipleAccountsOn ?? false}
          disabled={snapshot?.isUnlocked !== true}
          onChange={(event) => {
            post({ type: 'developer/setMultiple', enabled: event.currentTarget.checked })
          }}
        />
        {UI_TEXT.developer.allowMultiple}
      </label>
      <p>{UI_TEXT.developer.multipleWarning}</p>
      <section aria-label={UI_TEXT.developer.profiles}>
        <h2>{UI_TEXT.developer.profiles}</h2>
        <p>{UI_TEXT.developer.profileInfo}</p>
        <form onSubmit={add}>
          <label htmlFor={`${prefix}-provider`}>{UI_TEXT.developer.provider}</label>
          <input
            id={`${prefix}-provider`}
            aria-label={UI_TEXT.developer.provider}
            value={provider}
            required
            pattern="[a-z][a-z0-9-]{0,31}"
            onChange={(event) => {
              setProvider(event.currentTarget.value)
            }}
          />
          <label htmlFor={`${prefix}-account`}>{UI_TEXT.developer.account}</label>
          <input
            id={`${prefix}-account`}
            value={account}
            required
            pattern="[a-z][a-z0-9-]{0,31}"
            onChange={(event) => {
              setAccount(event.currentTarget.value)
            }}
          />
          <button type="submit" disabled={snapshot?.isMultipleAccountsOn !== true}>
            {UI_TEXT.developer.addProfile}
          </button>
        </form>
        <ul>
          {snapshot?.profiles.map((profile) => (
            <li key={profile.id}>
              <span>{`${profile.provider} · ${profile.account} (${profile.id})`}</span>
              <button
                type="button"
                onClick={() => {
                  post({ type: 'developer/removeProfile', id: profile.id })
                }}
              >
                {UI_TEXT.accounts.remove}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <button
        type="button"
        disabled={snapshot === undefined}
        onClick={() => {
          post({ type: 'developer/reset' })
        }}
      >
        {UI_TEXT.developer.reset}
      </button>
    </main>
  )
}
