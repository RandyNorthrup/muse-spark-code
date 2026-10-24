// A page entry's crash boundary (the Models & Agents panel, the judge
// setup wizard): a render that throws reaches `onError` (the host's log,
// M39) and the page shows an explicit crash view, never an empty page.
// Reloading re-renders from the host's state; nothing typed lives only in
// the page. The reload button takes the shared control style
// (models/controls.css, imported by both entries).
import { Component, type ReactNode } from 'react'
import { UI_TEXT } from '../../shared/constants'

/** What the crash view says: the page's own container, title and failure sentence. */
export interface PageCrashText {
  readonly className: string
  readonly title: string
  readonly message: string
}

interface PageBoundaryProps {
  readonly children: ReactNode
  readonly onError: (error: unknown) => void
  readonly crashed: PageCrashText
}

interface CrashState {
  readonly crashed: boolean
}

export class PageBoundary extends Component<PageBoundaryProps, CrashState> {
  static getDerivedStateFromError(): CrashState {
    return { crashed: true }
  }

  constructor(props: PageBoundaryProps) {
    super(props)
    this.state = { crashed: false }
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error)
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children
    const { className, title, message } = this.props.crashed
    return (
      <div className={className}>
        <h2>{title}</h2>
        <p role="alert">{message}</p>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            window.location.reload()
          }}
        >
          {UI_TEXT.crashReload}
        </button>
      </div>
    )
  }
}
