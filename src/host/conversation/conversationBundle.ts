// The synchronous first-surface factory keeps existing surface ordering.
import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from '../lazyBundle'
import type * as ConversationBundle from './conversationEntry'

type Bundle = typeof ConversationBundle

function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createConversation' in value &&
    typeof value.createConversation === 'function'
  )
}

export function conversationLoader(
  deps: Pick<LazyBundleLoaderOptions<Bundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => Bundle {
  return lazyBundleLoader({
    ...deps,
    isBundle,
    label: 'conversation bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}
