import { randomBytes } from 'node:crypto'
import { vi } from 'vitest'
import type { VaultCommandDeps, VaultCommandPort } from '../../../../src/runtime/vault/vaultCommand'
import { audit, metadata, panel } from './fixtures'

export function commandHarness(events: readonly unknown[] = []) {
  const port = {
    status: vi.fn<VaultCommandPort['status']>(() => Promise.resolve(panel().status)),
    list: vi.fn<VaultCommandPort['list']>(() => Promise.resolve([metadata()])),
    lock: vi.fn(() => Promise.resolve()),
    audit: vi.fn<VaultCommandPort['audit']>(() => Promise.resolve([audit()])),
    unlock: vi.fn(() => Promise.resolve()),
    add: vi.fn<VaultCommandPort['add']>(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    grant: vi.fn(() => Promise.resolve()),
    revoke: vi.fn(() => Promise.resolve()),
    importFile: vi.fn(() => Promise.resolve()),
    publicKey: vi.fn<VaultCommandPort['publicKey']>(() =>
      Promise.resolve({ ...metadata(), kind: 'sshKey', publicKey: 'ssh-ed25519 public-only' }),
    ),
    watch: vi.fn(async function* () {
      for (const event of events) yield await event
    }),
    answer: vi.fn<VaultCommandPort['answer']>(() =>
      Promise.resolve({ kind: 'denied', reason: 'policy' }),
    ),
    close: vi.fn(() => Promise.resolve()),
  } satisfies VaultCommandPort
  const bytes = randomBytes(32)
  const controller = new AbortController()
  const deps = {
    open: vi.fn(() => Promise.resolve(port)),
    readMaterial: vi.fn(() => Promise.resolve({ kind: 'secret', value: bytes })),
    choose: vi.fn<VaultCommandDeps['choose']>(() => Promise.resolve('allowOnce')),
    print: vi.fn(),
    printError: vi.fn(),
    now: vi.fn(() => 1),
    signal: controller.signal,
  } satisfies VaultCommandDeps
  return { port, deps, bytes, controller }
}
