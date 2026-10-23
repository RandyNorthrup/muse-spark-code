import { modelAccountsRouteSchema } from '../../shared/modelAccountsRoute'
// The Models & Agents panel's app (M95, PLAN.md D74): the section
// navigation from the registry and the active section. Narrow layout
// comes from the registry too: the panel root is a container, and the
// table reflows to cards under 340 px (models.css).

import { loadTeamPanelSchemas } from './teamPanelBrowser'
import { MODELS_SECTION_PENDING_MS, UI_TEXT } from '../../shared/constants'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useTransition,
} from 'react'
import type { VaultClientMessage } from '../../shared/hostApi/vaultMessages'
import {
  parseHostToPanelMessage,
  type ModelsPanelState,
  type PanelToHostMessage,
} from '../../shared/modelsPanel'
import type { ErrorReporter } from '../errorReport'
import type { HostBridge } from '../hostBridge'
import type { PanelUiAction, PanelUiState, WizardLife } from './reducer'
import { INITIAL_PANEL_UI, panelUiReducer } from './reducer'
import { MODEL_SECTIONS, loadTeamEnglish } from './sections'
import { SectionNavigation } from './SectionNavigation'
import { MoneyUnavailable } from '../money'
import { deferred } from '../components/DeferredSurface'
import { rememberedSectionHeight, SectionFrame, SectionLoading } from './DeferredSections'
import type { ModelsPanelSection } from '../../shared/modelsPanel'

const ModelAccounts = deferred(async () => {
  const chunk = await import('./ModelAccounts')
  return { default: chunk.ModelAccounts }
})

/** The panel's document retry, as its crash screen's Reload. */
function reloadPanel(): void {
  window.location.reload()
}

/**
The vault host message's envelope, routed without reading its contents:
the full zod validation happens where the state is used, in the lazily
loaded vault surface, so the panel body keeps its size budget. Anything
else unknown is still reported as a host-message error below.
*/
function vaultEnvelopeOf(raw: unknown): unknown {
  return typeof raw === 'object' &&
    raw !== null &&
    'type' in raw &&
    raw.type === 'vaultState' &&
    'state' in raw
    ? raw
    : undefined
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
  const [hostPending, startHostTransition] = useTransition()
  const [hostDestination, setHostDestination] = useState<ModelsPanelSection>('providers')
  const [panelState, setPanelState] = useState<ModelsPanelState | undefined>(undefined)
  const [vaultRaw, setVaultRaw] = useState<unknown>(undefined)
  const [hasLoadFailure, setLoadFailure] = useState(false)
  useEffect(() => {
    let isClosed = false
    const isDocumentOpen = () => !isClosed
    const receive = async (event: MessageEvent): Promise<void> => {
      const account = modelAccountsRouteSchema.safeParse(event.data)
      if (account.success) {
        if (account.data.type === 'modelAccounts/available') setHasAccounts(true)
        return
      }
      await loadTeamPanelSchemas(event.data)
      if (!isDocumentOpen()) return
      const parsed = parseHostToPanelMessage(event.data)
      if (parsed.ok) {
        const message = parsed.message
        if (message.type === 'modelsPanel/state') {
          // Navigation reads the team labels too, before a deferred section
          // opens. Install them only for a validated enabled-team state.
          if (message.state.roles !== undefined) await loadTeamEnglish()
          if (!isDocumentOpen()) return
          setPanelState(message.state)
          dispatch({ type: 'host-state', state: message.state })
        } else {
          setHostDestination(message.section)
          startHostTransition(() => {
            dispatch({ type: 'host-navigate', section: message.section, itemId: message.itemId })
          })
        }
        return
      }
      const vault = vaultEnvelopeOf(event.data)
      if (vault !== undefined) {
        setVaultRaw(vault)
        return
      }
      report('hostMessage', new Error(parsed.error))
    }
    let pending = Promise.resolve()
    const enqueue = async (previous: Promise<void>, event: MessageEvent): Promise<void> => {
      await previous
      if (!isDocumentOpen()) return
      try {
        await receive(event)
      } catch (error) {
        report('hostMessage', error)
        if (isDocumentOpen()) setLoadFailure(true)
      }
    }
    const onMessage = (event: MessageEvent): void => {
      pending = enqueue(pending, event)
    }
    host.messages.addEventListener('message', onMessage)
    // Subscribe before ready: the host may reply in the same task.
    host.post({ type: 'modelsPanel/ready' })
    return () => {
      isClosed = true
      host.messages.removeEventListener('message', onMessage)
    }
  }, [host, report, startHostTransition])
  const post = (message: PanelToHostMessage): void => {
    host.post(message)
  }
  // Stable per panel, so the vault mount asks for its snapshot exactly once.
  const vaultPost = useCallback(
    (message: VaultClientMessage): void => {
      host.post(message)
    },
    [host],
  )
  if (hasLoadFailure)
    return (
      <div role="alert">
        <p>{UI_TEXT.surfaceLoadFailed}</p>
        <button type="button" onClick={reloadPanel}>
          {UI_TEXT.surfaceLoadRetry}
        </button>
      </div>
    )
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
        vaultRaw={vaultRaw}
        vaultPost={vaultPost}
      />
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
  /**
  The vault host message's raw envelope (C-M109-1 P1); undefined before
  the host's first vault answer. The vault mount validates it before use.
  */
  readonly vaultRaw?: unknown
  /** The vault section's post port into the host's vault binding. */
  readonly vaultPost?: ((message: VaultClientMessage) => void) | undefined
  readonly host?: HostBridge | undefined
  readonly hostPendingSection?: ModelsPanelSection | undefined
}

/**
The open wizard's generation as pending work sees it when it settles:
the latest one this panel rendered, or none once the wizard closed.
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
  vaultRaw,
  vaultPost,
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
  // A section with an isOffered gate hides until the host offers it; none
  // has one any more (RLTESTDRIVE 10: the vault tab is always present, with
  // its state or its reason). The team sections (roles, agents) show only
  // while the host sends the team's roles.
  const visible = MODEL_SECTIONS.filter(
    (section) =>
      (section.isOffered?.(panelState) ?? true) &&
      ((section.id !== 'roles' && section.id !== 'agents') || panelState?.roles !== undefined),
  )
  const active = visible.find((section) => section.id === ui.section) ?? visible[0]
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
        sections={visible}
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
            vaultRaw={vaultRaw}
            vaultPost={vaultPost}
          />
        </SectionFrame>
      )}
    </div>
  )
}
