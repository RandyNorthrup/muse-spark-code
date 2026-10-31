import { Component, type ReactNode } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { Modal } from '../components/Modal'

export class MakerBoundary extends Component<
  {
    readonly children: ReactNode
    readonly stop: ReactNode
    readonly onRetry: () => void
    readonly onClose: () => void
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
      <Modal
        title={UI_TEXT.makerLoadFailed}
        titleId="maker-error-title"
        fixedControls={this.props.stop}
        onClose={() => {
          this.props.onClose()
          this.setState({ failed: false })
        }}
      >
        <p role="alert">{UI_TEXT.makerLoadFailed}</p>
        <button
          type="button"
          onClick={() => {
            this.props.onRetry()
            this.setState({ failed: false })
          }}
        >
          {UI_TEXT.makerRetry}
        </button>
      </Modal>
    )
  }
}
