import { lazy, Suspense, type ComponentType } from 'react'
import { UI_TEXT } from '../../../shared/l10n/text'
import { type TrafficMessage, type TrafficSlice } from '../../../shared/modelsPanel'

export interface TrafficSurfaceProps {
  state: TrafficSlice
  postMessage: (message: TrafficMessage) => void
  announce?: (text: string) => void
}
type TrafficViewProps = { mode: 'singleModel' } | (TrafficSurfaceProps & { mode: 'team' })
/** Called once by each panel's registry, outside React render. The injected
 * loader imports the separate browser bundle; the IIFE startup build cannot
 * accidentally inline it. Single-model mode never invokes the loader.
 */
export function createTrafficView(
  loadSurface: () => Promise<{ default: ComponentType<TrafficSurfaceProps> }>,
) {
  const TrafficSurface = lazy(loadSurface)
  return function TrafficView(props: TrafficViewProps) {
    if (props.mode === 'singleModel') return null
    return (
      <Suspense fallback={<p>{UI_TEXT.loadingOutput}</p>}>
        <TrafficSurface {...props} />
      </Suspense>
    )
  }
}
