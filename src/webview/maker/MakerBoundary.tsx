import { Component, type ReactNode } from 'react'
import { UI_TEXT } from '../../shared/constants'

export class MakerBoundary extends Component<
  {
    readonly children: ReactNode
    readonly stop: ReactNode
    readonly onRetry: () => void
  },
  { failed: boolean }
> {
  public static getDerivedStateFromError() {
    return { failed: true }
  }
  public override state = { failed: false }
  public override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert">
        {this.props.stop}
        <p>{UI_TEXT.makerLoadFailed}</p>
        <button
          type="button"
          onClick={() => {
            this.props.onRetry()
            this.setState({ failed: false })
          }}
        >
          {UI_TEXT.makerRetry}
        </button>
      </div>
    )
  }
}
