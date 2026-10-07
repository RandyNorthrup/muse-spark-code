import type * as FileSystem from 'node:fs/promises'
import type * as ProcessTree from '../../../src/host/processTree'
import { vi } from 'vitest'

vi.mock('../../../src/host/processTree', async (original) => ({
  ...(await original<typeof ProcessTree>()),
}))
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof FileSystem>()),
}))
