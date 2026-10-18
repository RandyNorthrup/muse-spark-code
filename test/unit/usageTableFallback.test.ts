// The usage table fallback (src/host/usage/usagePanelEntry.ts): when the
// workspace read fails, the installed disk copy stands in and the log
// names only the failure's kind. A working primary never touches the disk.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { readHostUsageTableText } from '../../src/host/usage/usageTableText'
import { warnLog } from './helpers/memoryLogs'

it('reads the disk copy with kind words when the primary read fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-table-'))
  await writeFile(path.join(root, 'table.json'), '{"disk":true}')
  let refusal = new Error('the refusal did not refuse')
  try {
    await readFile(path.join(root, 'missing.json'))
  } catch (error: unknown) {
    if (error instanceof Error) refusal = error
  }
  expect(refusal).toBeInstanceOf(Error)
  const warned: string[] = []
  const readPrimary = (): Promise<Uint8Array> => Promise.reject(refusal)
  await expect(
    readHostUsageTableText(readPrimary, root, ['table.json'], warnLog(warned)),
  ).resolves.toBe('{"disk":true}')
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('disk copy')
  expect(warned[0]).toContain('Error')
  expect(warned[0]).not.toContain('missing.json')
})

it('a working primary never touches the disk or the log', async () => {
  const warned: string[] = []
  const text = await readHostUsageTableText(
    () => Promise.resolve(new TextEncoder().encode('{"live":true}')),
    tmpdir(),
    ['table.json'],
    warnLog(warned),
  )
  expect(text).toBe('{"live":true}')
  expect(warned).toHaveLength(0)
})
