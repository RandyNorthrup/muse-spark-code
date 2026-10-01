import { afterEach, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  harness,
  holdRestoreRef,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

describe('a native startup that a restore refuses (M72)', () => {
  it(
    'leaves the window safe, as nothing was started',
    async () => {
      const h = await harness()
      await holdRestoreRef(h)
      await expect(h.store.markNativeBackend()).rejects.toThrow(UI_TEXT.restoreTurnElsewhere)
      expect(h.store.isNativeUnsafe).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps the fence an earlier startup set',
    async () => {
      const h = await harness()
      await h.store.markNativeBackend()
      expect(h.store.isNativeUnsafe).toBe(true)
      await holdRestoreRef(h)
      await expect(h.store.markNativeBackend()).rejects.toThrow(UI_TEXT.restoreTurnElsewhere)
      expect(h.store.isNativeUnsafe).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
