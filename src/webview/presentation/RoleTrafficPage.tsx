import { useRef, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { formatDateTime } from '../../shared/l10n/text'
import type { PresentationRole, PresentationTraffic } from '../../core/presentation/roleTraffic'
import { agentStatusLabel } from '../agentFormat'

export interface RoleTrafficPageProps {
  /** The two installed-language headings supplied by the owning host. */
  readonly rolesTitle: string
  readonly trafficTitle: string
  readonly roles: readonly PresentationRole[]
  readonly traffic: readonly PresentationTraffic[]
  readonly onOpenRole: (id: string) => Promise<void>
}

/** Inspection only: selecting a role opens its real transcript, never starts a model. */
export function RoleTrafficPage({
  rolesTitle,
  trafficTitle,
  roles,
  traffic,
  onOpenRole,
}: RoleTrafficPageProps) {
  const pending = useRef(false)
  const [isBusy, setBusy] = useState(false)
  const [hasError, setError] = useState(false)
  async function open(role: PresentationRole): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(false)
    try {
      await onOpenRole(role.id)
    } catch {
      setError(true)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const name = (id: string) => roles.find((role) => role.id === id)?.name ?? id
  return (
    <main className="fallback-page" aria-busy={isBusy}>
      <h1>{rolesTitle}</h1>
      {hasError && <p role="alert">{UI_TEXT.fallbackActionFailed}</p>}
      {roles.length === 0 ? (
        <p role="status">{UI_TEXT.fallbackEmpty}</p>
      ) : (
        <ul aria-label={rolesTitle}>
          {roles.map((role) => (
            <li key={role.id} className="fallback-manager-row">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  void open(role)
                }}
              >
                {role.name}
              </button>
              <code dir="ltr">
                {role.providerId} / {role.modelId}
              </code>
              <span>{agentStatusLabel(role.status)}</span>
              <ul>
                {role.capabilities.map((capability) => (
                  <li key={capability}>
                    <code>{capability}</code>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <section aria-label={trafficTitle}>
        <h2>{trafficTitle}</h2>
        {traffic.length === 0 ? (
          <p role="status">{UI_TEXT.fallbackEmpty}</p>
        ) : (
          <ol aria-label={trafficTitle}>
            {traffic.map((message) => (
              <li key={message.id} className="fallback-manager-row">
                <h3 dir="auto">
                  {name(message.sourceId)} / {name(message.targetId)}
                </h3>
                <time dateTime={new Date(message.at).toISOString()}>
                  {formatDateTime(message.at)}
                </time>
                <p dir="auto">{message.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}
