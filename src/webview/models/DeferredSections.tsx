// One stable boundary owns both sections. A transition keeps its already
// revealed content on screen while the next section suspends (MODELSPLIT4).
import { Component, lazy, Suspense, useLayoutEffect, useRef, type ReactNode } from 'react'
import * as z from 'zod/mini'
import {
  MODELS_PROVIDER_ROW_PX,
  MODELS_SECTION_HEADER_PX,
  MODELS_TABLE_ROW_PX,
  UI_TEXT,
} from '../../shared/constants'
import type { ModelsPanelSection, ModelsPanelState } from '../../shared/modelsPanel'
import type { HostBridge } from '../hostBridge'
import { UnavailableSurface } from '../components/DeferredSurface'
import type { SectionProps } from './sections'

const ProvidersSurface = lazy(async () => {
  const { ProvidersSection } = await import('./ProvidersSection')
  return { default: ProvidersSection }
})
const ModelsSurface = lazy(async () => {
  const { ModelsSection } = await import('./ModelsSection')
  return { default: ModelsSection }
})
const JudgeSurface = lazy(async () => {
  const { JudgeSection } = await import('./sections/judge/JudgeSection')
  return { default: JudgeSection }
})

const heightSchema = z.object({
  snapshot: z.object({
    modelsSectionHeights: z.record(z.string(), z.number().check(z.gt(0))),
  }),
})

/** Storage is optional in native hosts and can refuse on a full browser store. */
function heightsOf(host: HostBridge | undefined): Record<string, number> {
  try {
    const saved = heightSchema.safeParse(host?.savedState())
    return saved.success ? saved.data.snapshot.modelsSectionHeights : {}
  } catch (error: unknown) {
    // An unreadable store measures nothing: anything else keeps its kind.
    if (!(error instanceof Error)) throw error
    return {}
  }
}

/** A validated last measurement, or none for this document's first section paint. */
export function rememberedSectionHeight(
  host: HostBridge | undefined,
  section: ModelsPanelSection,
): number | undefined {
  return heightsOf(host)[section]
}

export function SectionLoading({
  section,
  panelState,
  host,
}: {
  readonly section: ModelsPanelSection
  readonly panelState?: ModelsPanelState | undefined
  readonly host?: HostBridge | undefined
}) {
  const rows = section === 'providers' ? panelState?.providers.length : panelState?.models.length
  const rowHeight = section === 'providers' ? MODELS_PROVIDER_ROW_PX : MODELS_TABLE_ROW_PX
  const height = heightsOf(host)[section] ?? MODELS_SECTION_HEADER_PX + (rows ?? 0) * rowHeight
  return (
    <div
      className="models-section-skeleton"
      style={{ height }}
      aria-busy="true"
      data-deferred-loading
    >
      <p className="models-hint" role="status">
        {UI_TEXT.loadingOutput}
      </p>
    </div>
  )
}

class SectionBoundary extends Component<
  { readonly children: ReactNode; readonly section: ModelsPanelSection },
  { readonly failed: boolean; readonly section: ModelsPanelSection }
> {
  static getDerivedStateFromError() {
    return { failed: true }
  }
  static getDerivedStateFromProps(
    props: { readonly section: ModelsPanelSection },
    state: { readonly section: ModelsPanelSection },
  ) {
    return props.section === state.section ? null : { failed: false, section: props.section }
  }
  override state = { failed: false, section: this.props.section }
  override render(): ReactNode {
    return this.state.failed ? (
      <UnavailableSurface isModal={false} className="models-section-error" failed />
    ) : (
      this.props.children
    )
  }
}

export function SectionFrame({
  section,
  panelState,
  host,
  children,
}: {
  readonly section: ModelsPanelSection
  readonly panelState: ModelsPanelState
  readonly host?: HostBridge | undefined
  readonly children: ReactNode
}) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = slot.current
    if (node === null) return
    const remember = () => {
      const height = node.getBoundingClientRect().height
      if (height <= 0 || node.querySelector(':scope .models-section-error') !== null) return
      // A chunk failure keeps the visible box, including a first-load skeleton.
      node.style.setProperty('--ms-models-section-height', `${String(height)}px`)
      // Never persist a skeleton or incomplete money render as settled height.
      if (
        host === undefined ||
        node.querySelector(':scope [data-deferred-loading]') !== null ||
        node.querySelector(':scope section') === null
      )
        return
      try {
        host.saveState({
          snapshot: { modelsSectionHeights: { ...heightsOf(host), [section]: height } },
        })
      } catch {
        // Optional persistence must never break rendering.
      }
    }
    remember()
    // Money text can settle without resizing its labelled row. Observe the
    // marker removal as well as the box; never persist an incomplete frame.
    const paintObserver = new MutationObserver(remember)
    paintObserver.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-deferred-loading'],
    })
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(remember)
    observer?.observe(node)
    return () => {
      observer?.disconnect()
      paintObserver.disconnect()
    }
  }, [host, panelState, section])
  return (
    <div className="models-section-slot" ref={slot}>
      <SectionBoundary section={section}>
        <Suspense
          fallback={<SectionLoading section={section} panelState={panelState} host={host} />}
        >
          {children}
        </Suspense>
      </SectionBoundary>
    </div>
  )
}

export function DeferredProvidersSection(props: SectionProps) {
  return <ProvidersSurface {...props} />
}
export function DeferredModelsSection(props: SectionProps) {
  return <ModelsSurface {...props} />
}
export function DeferredJudgeSection(props: SectionProps) {
  return <JudgeSurface {...props} />
}
