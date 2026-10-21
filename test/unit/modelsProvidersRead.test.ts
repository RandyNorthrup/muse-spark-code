// The configured-providers read (src/host/models/modelsPanelBundle.ts): an
// unreadable providers file reads as no providers, with the log naming
// only the failure's kind — never the file's words.
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { readConfiguredProviders } from '../../src/host/models/modelsPanelBundle'
import type { ProviderEntry } from '../../src/host/providers/providerPorts'

const quiet = (): void => undefined

function memoryLog(warned: string[]): Logger {
  return { trace: quiet, info: quiet, warn: (message) => void warned.push(message), error: quiet }
}

const ENTRIES: readonly ProviderEntry[] = [
  { id: 'p1', preset: 'preset', address: 'https://example.com/', auth: 'apiKey', models: ['m'] },
]

it('reads the providers through when readable', async () => {
  const warned: string[] = []
  await expect(
    readConfiguredProviders(() => Promise.resolve(ENTRIES), memoryLog(warned)),
  ).resolves.toBe(ENTRIES)
  expect(warned).toHaveLength(0)
})

it('reads no providers with kind words when the file cannot be read', async () => {
  let refusal = new Error('the refusal did not refuse')
  try {
    await readFile(path.join(tmpdir(), `no-such-providers-${String(process.pid)}.json`))
  } catch (error: unknown) {
    if (error instanceof Error) refusal = error
  }
  expect(refusal).toBeInstanceOf(Error)
  const warned: string[] = []
  const readProviders = (): Promise<readonly ProviderEntry[]> => Promise.reject(refusal)
  await expect(readConfiguredProviders(readProviders, memoryLog(warned))).resolves.toEqual([])
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('could not be read')
  expect(warned[0]).toContain('Error')
  expect(warned[0]).not.toContain('no such file')
})
