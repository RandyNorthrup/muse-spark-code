import type { WebviewToHostMessage } from '../../shared/protocol'
import type { UiStore } from '../state/store'
import { createResourceSurfaceLoader } from './resourceLoader'
import type { ResourceSurfaceLoader } from './resourcePort'

type ResourceAction = Extract<WebviewToHostMessage, { type: 'resourceAction' }>['action']

/**
 * M107 U–C1: the chat window's chip source over the store's bounded status
 * text. Created once in mountChat, outside render; the deferred chip imports
 * only when the first status arrives, and checks its schema before use.
 */
export function windowResourceLoader(
  store: UiStore,
  post: (message: WebviewToHostMessage) => void,
): ResourceSurfaceLoader {
  const action = (name: ResourceAction) => () => {
    post({ type: 'resourceAction', action: name })
  }
  // One parsed object per status text: React's external-store contract.
  const cached: { text: string | null | undefined; status: unknown } = {
    text: undefined,
    status: undefined,
  }
  return createResourceSurfaceLoader(
    {
      getSnapshot: () => {
        const text = store.getState().resourceStatus
        if (text !== cached.text) {
          cached.text = text
          cached.status = parsedJson(text)
        }
        return cached.status
      },
      subscribe: (changed) => store.subscribe(changed),
      resume: action('resume'),
      settings: action('settings'),
      show: action('show'),
    },
    async () => {
      const module = await import('./ResourceSurface')
      return { default: module.ResourceSurface }
    },
  )
}

/** No status yet is undefined; refused or unreadable text is null, which the chip shows as unavailable. */
function parsedJson(text: string | null | undefined): unknown {
  if (text === undefined || text === null) return text
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return null
  }
}
