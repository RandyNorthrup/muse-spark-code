import { webviewKey } from '../../shared/keybindings'
// The controls stay unavailable until their chunk loads. Closing while it
// loads unmounts the boundary, so a late import cannot reopen the surface.
import {
  Component,
  type ComponentType,
  type ReactNode,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react'
import { UI_TEXT } from '../../shared/constants'
import { Modal } from './Modal'

export function DeferredSurface({
  children,
  onClose,
  isModal = true,
  keepFocus = false,
}: {
  readonly children: ReactNode
  readonly onClose?: (() => void) | undefined
  readonly isModal?: boolean
  readonly keepFocus?: boolean | undefined
}) {
  return (
    <Suspense
      fallback={<LoadingSurface onClose={onClose} isModal={isModal} keepFocus={keepFocus} />}
    >
      {children}
    </Suspense>
  )
}

function LoadingSurface({
  onClose,
  isModal,
  keepFocus,
}: {
  readonly onClose?: (() => void) | undefined
  readonly isModal: boolean
  readonly keepFocus: boolean
}) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!keepFocus) {
      if (!isModal) close.current?.focus()
      return
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (webviewKey('deferred.close', event) !== 'close') return
      event.preventDefault()
      event.stopPropagation()
      onClose?.()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isModal, keepFocus, onClose])
  const status = (
    <p role="status" data-deferred-loading>
      {UI_TEXT.loadingOutput}
    </p>
  )
  if (isModal && onClose !== undefined) {
    return (
      <Modal title={UI_TEXT.loadingOutput} titleId="deferred-title" onClose={onClose}>
        {status}
      </Modal>
    )
  }
  return (
    <div
      className="palette history"
      onKeyDown={(event) => {
        if (webviewKey('deferred.close', event) !== 'close') return
        event.preventDefault()
        event.stopPropagation()
        onClose?.()
      }}
    >
      {status}
      {onClose === undefined ? null : (
        <button ref={close} type="button" className="button-secondary" onClick={onClose}>
          {UI_TEXT.usageClose}
        </button>
      )}
    </div>
  )
}

/** Each optional surface owns its retryable import and keeps its latest props. */
export function deferred<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  isModal = false,
) {
  let initialSurface = lazy(load)
  return function Deferred(
    props: P & {
      readonly onClose?: (() => void) | undefined
      readonly isModal?: boolean
      readonly keepFocus?: boolean | undefined
    },
  ) {
    const [Surface, setSurface] = useState(() => initialSurface)
    const [attempt, setAttempt] = useState(0)
    const retry = () => {
      initialSurface = lazy(load)
      setSurface(() => initialSurface)
      setAttempt((current) => current + 1)
    }
    return (
      <SurfaceBoundary
        key={attempt}
        onClose={props.onClose}
        onRetry={retry}
        isModal={props.isModal ?? isModal}
      >
        <DeferredSurface
          onClose={props.onClose}
          isModal={props.isModal ?? isModal}
          keepFocus={props.keepFocus}
        >
          <Surface {...props} />
        </DeferredSurface>
      </SurfaceBoundary>
    )
  }
}

class SurfaceBoundary extends Component<
  {
    readonly children: ReactNode
    readonly onClose?: (() => void) | undefined
    readonly onRetry: () => void
    readonly isModal: boolean
  },
  { readonly failed: boolean }
> {
  public static getDerivedStateFromError() {
    return { failed: true }
  }
  public override state = { failed: false }
  public override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const row = (
      <div role="alert">
        <p>{UI_TEXT.surfaceLoadFailed}</p>
        <button type="button" className="button-secondary" onClick={this.props.onRetry}>
          {UI_TEXT.surfaceLoadRetry}
        </button>
      </div>
    )
    return this.props.isModal && this.props.onClose !== undefined ? (
      <Modal
        title={UI_TEXT.surfaceLoadFailed}
        titleId="surface-failure-title"
        onClose={this.props.onClose}
      >
        {row}
      </Modal>
    ) : (
      <div className="palette history">
        {row}
        {this.props.onClose === undefined ? null : (
          <button type="button" className="button-secondary" onClick={this.props.onClose}>
            {UI_TEXT.usageClose}
          </button>
        )}
      </div>
    )
  }
}
