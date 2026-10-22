// M88 lane P: Settings Sync registers exactly the library keys while the
// opt-in is on, and none while it is off. The recording sink stands where
// `globalState.setKeysForSync` does, as the panel rig's `post` capture
// stands where the webview does: the keys themselves are production code.
import { describe, expect, it } from 'vitest'
import { applyLibrarySyncKeys, librarySyncKeys } from '../../src/host/stateSync'
import { BOOKMARK_SYNC_KEY, PROMPT_SYNC_KEY } from '../../src/shared/constants'

describe('library sync keys', () => {
  it('registers the prompts and the bookmarks while the setting is on', () => {
    expect(librarySyncKeys(true)).toEqual([PROMPT_SYNC_KEY, BOOKMARK_SYNC_KEY])
  })

  it('registers no key while the setting is off, so nothing leaves the computer', () => {
    expect(librarySyncKeys(false)).toEqual([])
  })

  it('applies the library keys beside the host keys, in one call', () => {
    const seen: (readonly string[])[] = []
    const record = { setKeysForSync: (keys: readonly string[]) => void seen.push(keys) }
    applyLibrarySyncKeys(record, true, ['own.key'])
    applyLibrarySyncKeys(record, false, ['own.key'])
    expect(seen).toEqual([['own.key', PROMPT_SYNC_KEY, BOOKMARK_SYNC_KEY], ['own.key']])
  })
})
