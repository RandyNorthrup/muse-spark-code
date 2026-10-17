// The Models & Agents panel's app (M95, PLAN.md D74): the section
// navigation from the registry and the active section. Narrow layout
// comes from the registry too: the panel root is a container, and the
// table reflows to cards under 340 px (models.css).

import { MODELS_SECTION_PENDING_MS, UI_TEXT } from '../../shared/constants'
import { useEffect, useLayoutEffect, useReducer, useRef, useState, useTransition } from 'react'
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
import { SectionNavigation } from './SectionNavigation'
import { MoneyUnavailable } from '../money'
import { rememberedSectionHeight, SectionFrame, SectionLoading } from './DeferredSections'
import type { ModelsPanelSection } from '../../shared/modelsPanel'

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
  const [ui, dispatch] = useReducer(panelUiReducer, INITIAL_PANEL_UI)
  const [hostPending, startHostTransition] = useTransition()
  const [hostDestination, setHostDestination] = useState<ModelsPanelSection>('providers')
  const [panelState, setPanelState] = useState<ModelsPanelState | undefined>(undefined)
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
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
        setHostDestination(message.section)
        startHostTransition(() => {
          dispatch({ type: 'host-navigate', section: message.section, itemId: message.itemId })
        })
      }
    }
    host.messages.addEventListener('message', onMessage)
    // Subscribe before ready: the host may reply in the same task.
    host.post({ type: 'modelsPanel/ready' })
    return () => {
      host.messages.removeEventListener('message', onMessage)
    }
  }, [host, report, startHostTransition])
  const post = (message: PanelToHostMessage): void => {
    host.post(message)
  }
  return (
    <>
      {panelState === undefined && rememberedSectionHeight(host, ui.section) === undefined && (
        <p role="status" className="models-visually-hidden" data-deferred-loading>
          {UI_TEXT.connecting}
        </p>
      )}
      <ModelsPanel
        panelState={panelState}
        ui={ui}
        post={post}
        dispatch={dispatch}
        host={host}
        hostPendingSection={hostPending ? hostDestination : undefined}
      />
    </>
  )
}

export interface ModelsPanelProps {
  /** The host-owned state; undefined before the host's first answer. */
  readonly panelState: ModelsPanelState | undefined
  readonly ui: PanelUiState
  readonly post: (message: PanelToHostMessage) => void
  readonly dispatch: (action: PanelUiAction) => void
  readonly host?: HostBridge | undefined
  readonly hostPendingSection?: ModelsPanelSection | undefined
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

export function ModelsPanel({
  panelState,
  ui,
  post,
  dispatch,
  host,
  hostPendingSection,
}: ModelsPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [destination, setDestination] = useState<ModelsPanelSection>(ui.section)
  const [pendingShown, setPendingShown] = useState(false)
  const pendingSection = hostPendingSection ?? (isPending ? destination : undefined)
  useEffect(() => {
    if (pendingSection === undefined) return
    const timer = setTimeout(() => {
      setPendingShown(true)
    }, MODELS_SECTION_PENDING_MS)
    return () => {
      clearTimeout(timer)
      setPendingShown(false)
    }
  }, [pendingSection])
  const navigate = (section: ModelsPanelSection) => {
    setDestination(section)
    startTransition(() => {
      dispatch({ type: 'navigate', section })
    })
  }
  const wizardLife = useWizardLife(ui)
  const active = MODEL_SECTIONS.find((section) => section.id === ui.section) ?? MODEL_SECTIONS[0]
  if (active === undefined) {
    return null
  }
  const Section = active.Component
  return (
    <div
      className="models-panel"
      style={{
        visibility:
          panelState === undefined && rememberedSectionHeight(host, active.id) === undefined
            ? 'hidden'
            : undefined,
      }}
    >
      <SectionNavigation
        activeId={active.id}
        pendingSection={pendingSection}
        pendingShown={pendingShown}
        navigate={panelState === undefined ? undefined : navigate}
      />
      {/* A failed money load (costs, budgets, rates, key usage) is said once
          for every section, with Retry; Accept stays unavailable meanwhile. */}
      <MoneyUnavailable buttonClassName="models-button" onRetry={reloadPanel} />
      {panelState === undefined ? (
        <div className="models-section-slot">
          <SectionLoading section={active.id} host={host} />
        </div>
      ) : (
        <SectionFrame section={active.id} panelState={panelState} host={host}>
          <Section
            panelState={panelState}
            post={post}
            navigate={navigate}
            dispatch={dispatch}
            wizardOpen={ui.wizardOpen}
            wizardLife={wizardLife}
            importOpen={ui.importOpen}
            highlightedItem={ui.highlighted?.itemId}
          />
        </SectionFrame>
      )}
    </div>
  )
}
