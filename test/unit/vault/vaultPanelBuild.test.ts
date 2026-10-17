import { beforeAll, afterAll, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { type Metafile } from 'esbuild'
import { VAULT_PANEL_BUDGET_KIB, VAULT_HOST_BUDGET_KIB } from '../../../src/shared/constants'
import { buildVaultSurfaces } from '../../harness/vault/build.mjs'

const built: { dir?: string; browser?: Metafile; host?: Metafile } = {}
beforeAll(async () => {
  await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
  built.dir = await mkdtemp(path.join(process.cwd(), 'temp', 'vault-build-'))
  const result = await buildVaultSurfaces(built.dir)
  if (result.browser === undefined || result.host === undefined) throw new Error('missing metafile')
  built.browser = result.browser
  built.host = result.host
})
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
it('U host has an independent hard 50 KiB cap and does not carry a broker, store or platform helper', async () => {
  const host = built.host!
  const file = Object.keys(host.outputs)[0]!
  const stats = await stat(file)
  expect(stats.size / 1024).toBeLessThanOrEqual(VAULT_HOST_BUDGET_KIB)
  for (const input of Object.keys(host.inputs))
    expect(input.replaceAll('\\', '/')).not.toMatch(/core\/vault\/(?:broker|store)|vault\/slots/)
})
