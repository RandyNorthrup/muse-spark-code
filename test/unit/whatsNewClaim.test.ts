// What's New version claims (src/host/whatsNew/whatsNew.ts): claiming is
// a real file claim — the first window wins, a second sees the claim —
// while any other filesystem failure still shows the page, logged with
// the failure's closed code rather than its words.
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { hasClaimedVersion } from '../../src/host/whatsNew/whatsNew'
import { warnLog } from './helpers/memoryLogs'

it('the first window claims, the second sees the claim', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whats-new-'))
  const warned: string[] = []
  await expect(hasClaimedVersion(dir, '0.19.0', warnLog(warned))).resolves.toBe(true)
  await expect(hasClaimedVersion(dir, '0.19.0', warnLog(warned))).resolves.toBe(false)
  expect(warned).toHaveLength(0)
  expect(await readdir(dir)).toHaveLength(1)
})

it('any other filesystem failure still shows, logged by code', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whats-new-'))
  const warned: string[] = []
  // A NUL byte fails the claim on every platform with a codeless refusal.
  await expect(
    hasClaimedVersion(path.join(dir, 'a\u{0}b'), '0.19.0', warnLog(warned)),
  ).resolves.toBe(true)
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('could not record its claim (ERR_INVALID_ARG_VALUE)')
})
