import { useState } from 'react'
import { UI_TEXT } from '../../shared/l10n/text'

export type ManagerKind = 'skills' | 'mcp' | 'hooks' | 'memory' | 'worktrees'
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
  }
}
function Actions({ actions }: { readonly actions: readonly ManagerAction[] }) {
  const [isBusy, setBusy] = useState(false)
  const [hasError, setError] = useState(false)
  async function run(action: ManagerAction): Promise<void> {
    setBusy(true)
    setError(false)
    try {
      await action.run()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
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
      {hasError && <p role="alert">{UI_TEXT.fallbackActionFailed}</p>}
    </>
  )
}

/** Host supplies current records and real actions; writes retain its confirmations. */
export function ManagerPage({
  kind,
  entries,
  actions,
}: {
  readonly kind: ManagerKind
  readonly entries: readonly ManagerEntry[]
  readonly actions: readonly ManagerAction[]
}) {
  return (
    <main className="fallback-page">
      <h1>{managerTitle(kind)}</h1>
      <Actions actions={actions} />
      {entries.length === 0 ? (
        <p role="status">{UI_TEXT.fallbackEmpty}</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li className="fallback-manager-row" key={entry.id}>
              <h2>{entry.title}</h2>
              <p>{entry.detail}</p>
              <Actions actions={entry.actions} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
