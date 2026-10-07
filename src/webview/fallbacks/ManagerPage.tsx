import { useRef, useState } from 'react'
import { UI_TEXT } from '../../shared/l10n/text'

export type ManagerKind = 'skills' | 'mcp' | 'hooks' | 'memory' | 'worktrees' | 'rules' | 'agents'
export interface ManagerAction {
  readonly id: string
  readonly title: string
  run(): Promise<void>
}
export interface ManagerEntry {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly actions: readonly ManagerAction[]
}
function managerTitle(kind: ManagerKind): string {
  switch (kind) {
    case 'skills': {
      return UI_TEXT.skillsPickTitle
    }
    case 'mcp': {
      return UI_TEXT.mcpTitle
    }
    case 'hooks': {
      return UI_TEXT.hooksTitle
    }
    case 'memory': {
      return UI_TEXT.memoryTitle
    }
    case 'worktrees': {
      return UI_TEXT.fallbackWorktrees
    }
    case 'rules':
    case 'agents': {
      throw new Error('MHP_MANAGER_TITLE_REQUIRED')
    }
  }
}
function Actions({
  actions,
  isBusy,
  run,
}: {
  readonly actions: readonly ManagerAction[]
  readonly isBusy: boolean
  readonly run: (action: ManagerAction) => Promise<void>
}) {
  return (
    <>
      <div className="fallback-actions">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={isBusy}
            onClick={() => {
              void run(action)
            }}
          >
            {action.title}
          </button>
        ))}
      </div>
    </>
  )
}

/** Host supplies current records and real actions; writes retain its confirmations. */
export function ManagerPage({
  kind,
  entries,
  actions,
  title,
}: {
  readonly kind: ManagerKind
  readonly entries: readonly ManagerEntry[]
  readonly actions: readonly ManagerAction[]
  /** Installed-language title; required for rules/agents. Legacy Muse titles remain the fallback. */
  readonly title?: string
}) {
  const pending = useRef(false)
  const [isBusy, setBusy] = useState(false)
  const [hasError, setError] = useState(false)
  async function run(action: ManagerAction): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(false)
    try {
      await action.run()
    } catch {
      setError(true)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <main className="fallback-page" aria-busy={isBusy}>
      <h1>{title ?? managerTitle(kind)}</h1>
      {hasError && <p role="alert">{UI_TEXT.fallbackActionFailed}</p>}
      <Actions actions={actions} isBusy={isBusy} run={run} />
      {entries.length === 0 ? (
        <p role="status">{UI_TEXT.fallbackEmpty}</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li className="fallback-manager-row" key={entry.id}>
              <h2>{entry.title}</h2>
              <p>{entry.detail}</p>
              <Actions actions={entry.actions} isBusy={isBusy} run={run} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
