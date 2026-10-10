import { act, render } from '@testing-library/react'
import { App } from '../../../src/webview/App'
import { testSettings } from './fakes'

/** The common cold chat state for first-use palette fixtures. */
export function renderSignedInApp(postMessage: Parameters<typeof App>[0]['postMessage']): void {
  render(<App postMessage={postMessage} />)
  act(() => {
    for (const data of [
      { type: 'init', settings: testSettings, emptyStateHint: '', composerPlaceholder: '' },
      { type: 'authState', status: 'signedIn' },
    ]) {
      window.dispatchEvent(new MessageEvent('message', { data }))
    }
  })
}
