// The last line of defence for the panel (PLAN.md D14): a render error
// anywhere in the tree would otherwise unmount everything and leave a blank
// webview with the cause only in the developer tools. The boundary shows the
// message and a Reload button, which asks the host to rebuild the webview.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { UI_TEXT } from '../../shared/constants'

export interface ErrorBoundaryProps {
  readonly onReload: () => void
  readonly children: ReactNode
}

interface ErrorBoundaryState {
  readonly message: string | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: describe(error) }
  }

  public override state: ErrorBoundaryState = { message: undefined }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`${UI_TEXT.crashTitle}: ${describe(error)}${info.componentStack ?? ''}`)
  }

  public override render(): ReactNode {
    if (this.state.message === undefined) {
      return this.props.children
    }
    return (
      <div className="app">
        <main className="body">
          <section className="gate" role="alert" aria-labelledby="crash-title">
            <h2 id="crash-title" className="gate-title">
              {UI_TEXT.crashTitle}
            </h2>
            <p className="gate-detail">{UI_TEXT.crashDetail}</p>
            <p className="gate-diagnostic">{this.state.message}</p>
            <div className="gate-actions">
              <button type="button" className="button-primary" onClick={this.props.onReload}>
                {UI_TEXT.crashReload}
              </button>
            </div>
          </section>
        </main>
      </div>
    )
  }
}
