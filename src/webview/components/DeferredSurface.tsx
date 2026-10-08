import { webviewKey } from '../../shared/keybindings'
import {
  Component,
  type ComponentType,
  type ReactNode,
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { UI_TEXT } from '../../shared/constants'
import { retrySurface } from '../surfaceRetry'
import { Modal } from './Modal'

interface SurfaceProps {
  readonly onClose?: (() => void) | undefined
  readonly isModal?: boolean
  readonly keepFocus?: boolean | undefined
  readonly className?: string | undefined
  /** Names an inline surface in its loading and failure rows ("Resources: …"). */
  readonly label?: string | undefined
}

export function DeferredSurface({
  children,
  fallback,
  ...props
}: SurfaceProps & { readonly children: ReactNode; readonly fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback === undefined ? <UnavailableSurface {...props} /> : fallback}>
      {children}
    </Suspense>
  )
}

/** Loading and failure retain the same dismissal contract as an open menu. */
function UnavailableSurface({
  onClose,
  isModal = true,
  keepFocus = false,
  failed = false,
  opener,
  className = 'palette history',
  label,
}: SurfaceProps & { readonly failed?: boolean; readonly opener?: Element | null }) {
  const container = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [trigger] = useState(() => opener ?? document.activeElement)
  const close = () => {
    if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    onClose?.()
  }
  useLayoutEffect(() => {
    if (isModal) return
    if (!keepFocus) closeButton.current?.focus()
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Node) || container.current?.contains(event.target)) return
      // Focus may stay in an attached composer's input while loading.
      if (event.type === 'focusin' && event.target === trigger) return
      onClose?.()
    }
    const escape = (event: KeyboardEvent) => {
      if (webviewKey('deferred.close', event) !== 'close') return
      event.preventDefault()
      event.stopPropagation()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
      onClose?.()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('focusin', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [isModal, keepFocus, onClose, trigger])
  const scope = label === undefined ? '' : `${label}: `
  const row = failed ? (
    <div role="alert">
      <p>
        {scope}
        {UI_TEXT.surfaceLoadFailed}
      </p>
      <button type="button" className="button-secondary" onClick={retrySurface}>
        {UI_TEXT.surfaceLoadRetry}
      </button>
    </div>
  ) : (
    <p role="status" data-deferred-loading>
      {scope}
      {UI_TEXT.loadingOutput}
    </p>
  )
  if (isModal && onClose !== undefined) {
    return (
      <Modal
        title={failed ? UI_TEXT.surfaceLoadFailed : UI_TEXT.loadingOutput}
        titleId="deferred-title"
        onClose={close}
      >
        {row}
      </Modal>
    )
  }
  return (
    <div ref={container} className={className}>
      {row}
      {onClose === undefined ? null : (
        <button ref={closeButton} type="button" className="button-secondary" onClick={close}>
          {UI_TEXT.usageClose}
        </button>
      )}
    </div>
  )
}

/** Each open owns an intent; cancelling it prevents a pending import taking focus. */
export function deferred<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  isModal = false,
  fallback?: (props: P) => ReactNode,
) {
  const Surface = lazy(load)
  return function Deferred(props: P & SurfaceProps) {
    const [intent, setIntent] = useState(() => ({ active: true, opener: document.activeElement }))
    if (!intent.active) return null
    const onClose =
      props.onClose === undefined
        ? undefined
        : () => {
            setIntent((current) => ({ ...current, active: false }))
            props.onClose?.()
          }
    const surfaceProps = {
      onClose,
      isModal: props.isModal ?? isModal,
      keepFocus: props.keepFocus,
      className: props.className,
      label: props.label,
    }
    return (
      <SurfaceBoundary {...surfaceProps} opener={intent.opener}>
        <DeferredSurface {...surfaceProps} fallback={fallback?.(props)}>
          <Surface {...props} />
        </DeferredSurface>
      </SurfaceBoundary>
    )
  }
}

class SurfaceBoundary extends Component<
  SurfaceProps & { readonly children: ReactNode; readonly opener: Element | null },
  { readonly failed: boolean }
> {
  public static getDerivedStateFromError() {
    return { failed: true }
  }
  public override state = { failed: false }
  public override render(): ReactNode {
    return this.state.failed ? <UnavailableSurface {...this.props} failed /> : this.props.children
  }
}
