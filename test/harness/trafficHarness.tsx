import { createRoot } from 'react-dom/client'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { trafficMessageSchema, runnersMessageSchema } from '../../src/shared/modelsPanel'
import { createTrafficView } from '../../src/webview/components/traffic/TrafficView'
import { installEmbeddedTable } from '../../src/webview/installTable'
import { RunnersSection } from '../../src/webview/models/sections/runners/RunnersSection'
import { trafficFixture, runnersFixture } from '../unit/helpers/trafficFixtures'

const SETTLE_MS = 50
const LOAD_TRIES = 100
const loadSurface = async () => await import('../../src/webview/components/traffic/TrafficSurface')
const TrafficView = createTrafficView(loadSurface)
export function mountTrafficHarness(document: Document, scenario: string) {
  const error = installEmbeddedTable(document)
  if (error) throw error
  const target = document.querySelector('#root')
  if (!target) throw new Error('Harness root missing')
  if (scenario === 'team-traffic-320') {
    document.documentElement.style.width = '320px'
    document.body.style.width = '320px'
  }
  const root = createRoot(target)
  if (scenario === 'runners') {
    root.render(
      <RunnersSection
        state={runnersFixture()}
        postMessage={(raw) => {
          const message = runnersMessageSchema.parse(raw)
          document.dispatchEvent(new CustomEvent('traffic-outgoing', { detail: message }))
        }}
      />,
    )
  } else {
    root.render(
      <TrafficView
        mode="team"

        state={trafficFixture()}
        postMessage={(raw) => {
          const message = trafficMessageSchema.parse(raw)
          document.dispatchEvent(new CustomEvent('traffic-outgoing', { detail: message }))
        }}
      />,
    )
  }
  let tab: 'board' | 'otherWindows' | 'recovery' = 'board'
  if (scenario === 'team-traffic-hints') tab = 'otherWindows'
  else if (scenario === 'team-traffic-recovery') tab = 'recovery'

  const select = (remaining: number) => {
    const button =
      scenario === 'runners'
        ? [...document.querySelectorAll<HTMLButtonElement>('button')].find(
            (element) => element.textContent === UI_TEXT.goalEdit,
          )
        : [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
            (element) => element.textContent === UI_TEXT.teamTraffic[tab],
          )
    if (button) {
      button.click()
      requestAnimationFrame(() => {
        document.body.dataset['trafficReady'] = scenario
      })
    } else if (remaining === 0) throw new Error('Traffic harness did not render')
    else
      setTimeout(() => {
        select(remaining - 1)
      }, SETTLE_MS)
  }
  select(LOAD_TRIES)
  return () => {
    root.unmount()
  }
}
