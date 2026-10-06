import type * as privateDirectories from '../../../src/runtime/privateDirectory'
import { vi } from 'vitest'

// The native directory probe must use this test's signed artifact on a clean checkout.
vi.mock('../../../src/runtime/privateDirectory', async (importOriginal) => {
  const { privateDirectoryFixture } = await import('./lspNativeFixture')
  return await privateDirectoryFixture(await importOriginal<typeof privateDirectories>())
})
