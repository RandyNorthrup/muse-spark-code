import { modelAccountsRouteSchema } from '../../shared/modelAccountsRoute'
// The Models & Agents panel's app (M95, PLAN.md D74): the section
// navigation from the registry and the active section. Narrow layout
// comes from the registry too: the panel root is a container, and the
// table reflows to cards under 340 px (models.css).

import { UI_TEXT } from '../../shared/constants'
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  parseHostToPanelMessage,
  type ModelsPanelState,
  type PanelToHostMessage,
} from '../../shared/modelsPanel'
import type { ErrorReporter } from '../errorReport'
import type { HostBridge } from '../hostBridge'
import type { PanelUiAction, PanelUiState, WizardLife } from './reducer'
import { INITIAL_PANEL_UI, panelUiReducer } from './reducer'
import { MODEL_SECTIONS } from './sections'
import { MoneyUnavailable } from '../money'
import { deferred } from '../components/DeferredSurface'

const ModelAccounts = deferred(async () => {
  const chunk = await import('./ModelAccounts')
  return { default: chunk.ModelAccounts }
})

/** The panel's document retry, as its crash screen's Reload. */
function reloadPanel(): void {
  window.location.reload()
}

/** The live app uses the same strict contract as the panel host. */
export function ModelsApp({
  host,
  report,
}: {
  readonly host: HostBridge
  readonly report: ErrorReporter
}) {
  const [hasAccounts, setHasAccounts] = useState(false)
  const [ui, dispatch] = useReducer(panelUiReducer, INITIAL_PANEL_UI)
  const [panelState, setPanelState] = useState<ModelsPanelState | undefined>(undefined)
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const account = modelAccountsRouteSchema.safeParse(event.data)
      if (account.success) {
        if (account.data.type === 'modelAccounts/available') setHasAccounts(true)
        return
      }
      const parsed = parseHostToPanelMessage(event.data)
      if (!parsed.ok) {
        report('hostMessage', new Error(parsed.error))
        return
      }
      const message = parsed.message
      if (message.type === 'modelsPanel/state') {
        setPanelState(message.state)
        dispatch({ type: 'host-state', state: message.state })
      } else {
        dispatch({ type: 'host-navigate', section: message.section, itemId: message.itemId })
      }
    }
    host.messages.addEventListener('message', onMessage)
    // Subscribe before ready: the host may reply in the same task.
    host.post({ type: 'modelsPanel/ready' })
    return () => {
      host.messages.removeEventListener('message', onMessage)
    }
  }, [host, report])
  const post = (message: PanelToHostMessage): void => {
    host.post(message)
  }
  return (
    <>
      <ModelsPanel panelState={panelState} ui={ui} post={post} dispatch={dispatch} />
      {hasAccounts ? (
        <ModelAccounts host={host} label={UI_TEXT.accounts.title} className="accounts-section" />
      ) : null}
    </>
  )
}

export interface ModelsPanelProps {
  /** The host-owned state; undefined before the host's first answer. */
  readonly panelState: ModelsPanelState | undefined
  readonly ui: PanelUiState
  readonly post: (message: PanelToHostMessage) => void
  readonly dispatch: (action: PanelUiAction) => void
}

/**
 * The open wizard's generation as pending work sees it when it settles:
 * the latest one this panel rendered, or none once the wizard closed.
 */
function useWizardLife(ui: PanelUiState): WizardLife {
  const openGeneration = ui.wizardOpen ? ui.wizardGeneration : undefined
  const latest = useRef(openGeneration)
  useLayoutEffect(() => {
    latest.current = openGeneration
  })
  return {
    generation: ui.wizardGeneration,
    isCurrent: (generation) => latest.current === generation,
  }
}

export function ModelsPanel({ panelState, ui, post, dispatch }: ModelsPanelProps) {
  const wizardLife = useWizardLife(ui)
  const active = MODEL_SECTIONS.find((section) => section.id === ui.section) ?? MODEL_SECTIONS[0]
  if (active === undefined) {
    return null
  }
  const Section = active.Component
  return (
    <div className="models-panel">
      <nav className="models-nav" aria-label={UI_TEXT.modelsPanelTitle}>
        {MODEL_SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = section.id === active.id
          return (
            <button
              key={section.id}
              type="button"
              className={isActive ? 'models-nav-item models-nav-item-active' : 'models-nav-item'}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                dispatch({ type: 'navigate', section: section.id })
              }}
            >
              <Icon />
              {section.getTitle()}
            </button>
          )
        })}
      </nav>
      {/* A failed money load (costs, budgets, rates, key usage) is said once
          for every section, with Retry; Accept stays unavailable meanwhile. */}
      <MoneyUnavailable buttonClassName="models-button" onRetry={reloadPanel} />
      {panelState === undefined ? (
        <p className="models-hint" role="status">
          {UI_TEXT.connecting}
        </p>
      ) : (
        <Section
          panelState={panelState}
          post={post}
          navigate={(section) => {
            dispatch({ type: 'navigate', section })
          }}
          dispatch={dispatch}
          wizardOpen={ui.wizardOpen}
          wizardLife={wizardLife}
          importOpen={ui.importOpen}
          highlightedItem={ui.highlighted?.itemId}
        />
      )}
    </div>
  )
}
