import { beforeAll, afterAll, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { type Metafile } from 'esbuild'
import {
  VAULT_ACTIONS_BUDGET_KIB,
  VAULT_MIGRATION_BUDGET_KIB,
  VAULT_PANEL_BUDGET_KIB,
  VAULT_HOST_BUDGET_KIB,
} from '../../../src/shared/constants'
import { buildVaultSurfaces } from '../../harness/vault/build.mjs'

const built: {
  dir?: string
  browser?: Metafile
  host?: Metafile
  actions?: Metafile
  migration?: Metafile
} = {}
// The native helper builds and broker starts take as long as the machine
// needs (a slow hosted Windows runner passed the 30 s hook budget, PR #258):
// no time limit of ours on this setup (owner 2026-10-16).
beforeAll(async () => {
  await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
  built.dir = await mkdtemp(path.join(process.cwd(), 'temp', 'vault-build-'))
  const result = await buildVaultSurfaces(built.dir)
  if (
    result.browser === undefined ||
    result.host === undefined ||
    result.actions === undefined ||
    result.migration === undefined
  )
    throw new Error('missing metafile')
  built.browser = result.browser
  built.host = result.host
  built.actions = result.actions
  built.migration = result.migration
}, 0)
afterAll(async () => {
  if (built.dir !== undefined) await rm(built.dir, { recursive: true, force: true })
})
function closure(meta: Metafile, entry: string, hasDynamic = false): Set<string> {
  const pending = [entry]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const imports = meta.outputs[file]?.imports ?? []
    for (const imported of imports)
      if (!imported.external && (hasDynamic || imported.kind !== 'dynamic-import'))
        pending.push(imported.path)
  }
  return seen
}
it('U new UI has its own lazy graph and hard 75 KiB cap; activation shares no Vault UI input', async () => {
  const browser = built.browser!
  const main = Object.keys(browser.outputs).find((file) =>
    file.replaceAll('\\', '/').endsWith('/main.js'),
  )!
  const eager = closure(browser, main)
  const models = Object.keys(browser.outputs).find((file) =>
    file.replaceAll('\\', '/').endsWith('/models.js'),
  )!
  const graph = closure(browser, models, true)
  const deferred: string[] = []
  for (const file of graph) if (!eager.has(file)) deferred.push(file)
  const assets = new Set(deferred)
  for (const file of graph) {
    const css = browser.outputs[file]?.cssBundle
    if (css !== undefined) assets.add(css)
  }
  const sizes = await Promise.all(
    [...assets].map(async (file) => {
      const stats = await stat(file)
      return stats.size
    }),
  )
  const bytes = sizes.reduce((total, size) => total + size, 0)
  expect(bytes / 1024).toBeLessThanOrEqual(VAULT_PANEL_BUDGET_KIB)
  expect(
    [...eager].flatMap((file) =>
      Object.keys(browser.outputs[file]!.inputs).map((input) => input.replaceAll('\\', '/')),
    ),
  ).not.toContain('src/webview/models/sections/vault/VaultSurface.tsx')
  const staticGraph = [...eager, ...closure(browser, models)]
  for (const file of staticGraph)
    expect(
      Object.keys(browser.outputs[file]!.inputs).some(
        (input) =>
          (input.replaceAll('\\', '/').includes('/sections/vault/') &&
            !input.replaceAll('\\', '/').endsWith('/VaultSurface.tsx')) ||
          input.replaceAll('\\', '/').endsWith('/VaultApprovalCard.tsx'),
      ),
    ).toBe(false)
  expect(
    deferred.some((file) =>
      Object.keys(browser.outputs[file]!.inputs).some((input) =>
        input.replaceAll('\\', '/').endsWith('/VaultApprovalCard.tsx'),
      ),
    ),
  ).toBe(true)
})
it('U host has an independent hard 50 KiB cap and does not carry the broker engine, store or platform helper', async () => {
  const host = built.host!
  const file = Object.keys(host.outputs)[0]!
  const stats = await stat(file)
  expect(stats.size / 1024).toBeLessThanOrEqual(VAULT_HOST_BUDGET_KIB)
  // C-M109-1: the host's client side (client, frames, discovery, manage
  // session) belongs here; the broker's engine, server and store never do.
  for (const input of Object.keys(host.inputs))
    expect(input.replaceAll('\\', '/')).not.toMatch(
      /core\/vault\/(?:store|broker\/(?:broker|state|policy|audit|channel|epoch|management|repository|firstParty))\.ts|vault\/slots/,
    )
})
it('RVAPP-CM1091D5 BYTES the explicit-action code ships only in vaultActions.js under its own cap', async () => {
  const actions = built.actions!
  const file = Object.keys(actions.outputs)[0]!
  const stats = await stat(file)
  expect(stats.size / 1024).toBeLessThanOrEqual(VAULT_ACTIONS_BUDGET_KIB)
  // Cross-bundle members exist on the exporting side: the editor, the
  // dialogs and the write crypto are here...
  for (const member of [
    'src/host/vault/vaultActionsEntry.ts',
    'src/host/vault/vaultActionDialogs.ts',
    'src/host/vault/vaultNativeEditor.ts',
    'src/core/vault/crypto.ts',
  ])
    expect(Object.keys(actions.inputs)).toContain(member)
  // ...and not in the opening bundle, which names only the fault class (not
  // the migration record schema) from the migrate side.
  const host = built.host!
  for (const member of [
    'src/host/vault/vaultActionDialogs.ts',
    'src/host/vault/vaultNativeEditor.ts',
    'src/core/vault/crypto.ts',
    'src/core/vault/migrate/ports.ts',
    'src/host/vault/migrateCredentials.ts',
    'src/host/vault/vaultMigrationEntry.ts',
  ])
    expect(Object.keys(host.inputs)).not.toContain(member)
})
it('U migration ships its own lazy chunk under its own cap; the opening bundle stays lean', async () => {
  const migration = built.migration!
  const file = Object.keys(migration.outputs)[0]!
  const stats = await stat(file)
  expect(stats.size / 1024).toBeLessThanOrEqual(VAULT_MIGRATION_BUDGET_KIB)
  // The engine, its codecs and the first-party reader travel here, on the
  // first unlock edge only — never with the panel, never at activation.
  for (const member of [
    'src/host/vault/vaultMigrationEntry.ts',
    'src/host/vault/migrateCredentials.ts',
    'src/core/vault/migrate/migrate.ts',
    'src/core/vault/migrate/ports.ts',
    'src/core/vault/broker/firstParty.ts',
  ])
    expect(Object.keys(migration.inputs)).toContain(member)
})
