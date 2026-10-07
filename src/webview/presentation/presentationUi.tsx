import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { UI_TEXT } from '../../shared/constants'
import type { PlanPageProps } from './PlanPage'
import type { RoleTrafficPageProps } from './RoleTrafficPage'
import type { DiffPage as DiffView } from '../fallbacks/DiffPage'
import type { ManagerPage as ManagerView } from '../fallbacks/ManagerPage'
import type { Walkthrough as WalkthroughView } from '../fallbacks/Walkthrough'
import '../fallbacks/fallbacks.css'

const PlanPage = lazy(async () => {
  const { PlanPage } = await import('./PlanPage')
  return { default: PlanPage }
})
const RoleTrafficPage = lazy(async () => {
  const { RoleTrafficPage } = await import('./RoleTrafficPage')
  return { default: RoleTrafficPage }
})
const DiffPage = lazy(async () => {
  const { DiffPage } = await import('../fallbacks/DiffPage')
  return { default: DiffPage }
})
const ManagerPage = lazy(async () => {
  const { ManagerPage } = await import('../fallbacks/ManagerPage')
  return { default: ManagerPage }
})
const Walkthrough = lazy(async () => {
  const { Walkthrough } = await import('../fallbacks/Walkthrough')
  return { default: Walkthrough }
})

interface PresentationOwner {
  readonly onReload: () => void
  readonly onError: (code: string) => void
}
class PresentationBoundary extends Component<
  PresentationOwner & { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  public static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }
  public override state = { failed: false }
  public override componentDidCatch(): void {
    this.props.onError('MHP_PRESENTATION_RENDER_FAILED')
  }
  public override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className="fallback-page">
        <h1>{UI_TEXT.crashTitle}</h1>
        <p role="alert">{UI_TEXT.crashDetail}</p>
        <button type="button" onClick={this.props.onReload}>
          {UI_TEXT.crashReload}
        </button>
      </main>
    )
  }
}

/** Mounted only when the carrier asks for a presentation page; each view loads lazily. */
export function createPresentationUi(element: Element, owner: PresentationOwner) {
  const root = createRoot(element)
  let isDisposed = false
  let revision = 0
  let hasCrashed = false
  function show(page: ReactNode): void {
    if (isDisposed) throw new Error('MHP_PRESENTATION_DISPOSED')
    // A published state reconciles into the mounted page so a pending action
    // keeps its local result. Only a crashed boundary takes a fresh key.
    if (hasCrashed) {
      hasCrashed = false
      revision += 1
    }
    root.render(
      <PresentationBoundary
        key={revision}
        onReload={owner.onReload}
        onError={(code) => {
          hasCrashed = true
          owner.onError(code)
        }}
      >
        <Suspense fallback={<p role="status">{UI_TEXT.loadingOutput}</p>}>{page}</Suspense>
      </PresentationBoundary>,
    )
  }
  return {
    showPlans(props: PlanPageProps): void {
      show(<PlanPage {...props} />)
    },
    showRoles(props: RoleTrafficPageProps): void {
      show(<RoleTrafficPage {...props} />)
    },
    showDiff(props: ComponentProps<typeof DiffView>): void {
      show(<DiffPage {...props} />)
    },
    showManager(props: ComponentProps<typeof ManagerView>): void {
      show(<ManagerPage {...props} />)
    },
    showWalkthrough(props: ComponentProps<typeof WalkthroughView>): void {
      show(<Walkthrough {...props} />)
    },
    dispose(): void {
      if (isDisposed) return
      isDisposed = true
      root.unmount()
    },
  }
}
