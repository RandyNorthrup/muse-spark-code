import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildProductionPackage } from './helpers/productionPackage'
import { webviewStartupOutputs } from '../../scripts/lib/webviewBundles.mjs'

const build = { root: '' }
beforeAll(() => {
  mkdirSync('temp', { recursive: true })
  build.root = mkdtempSync(path.resolve('temp/slash-command-build-'))
  // The rig may put temp/ outside the checkout; generated fixtures need the
  // same formatting configuration as the actual production build.
  cpSync('.prettierrc.json', path.join(build.root, '.prettierrc.json'))
  buildProductionPackage(process.cwd(), build.root)
})
afterAll(() => rmSync(build.root, { recursive: true, force: true }))

it('certifies lazy slash-command registration without increasing activation bytes', () => {
  const meta = JSON.parse(readFileSync(path.join(build.root, 'dist/meta/webview.json'), 'utf8'))
  const source = 'src/shared/slashCommands.ts'
  const startup = new Set(webviewStartupOutputs(meta))
  const owners = Object.entries(meta.outputs).filter(([, output]) =>
    Object.keys(output.inputs).some((input) => input.replaceAll('\\', '/') === source),
  )
  expect(owners).toHaveLength(1)
  expect(startup.has(owners[0][0])).toBe(false)
  // a704f711c: the "/" list is no surface of its own; it loads with the
  // palette registry, whose deferred import App already makes.
  const registry = 'src/shared/paletteRegistry.ts'
  const entry = Object.entries(meta.outputs).find(
    ([, output]) => output.entryPoint?.replaceAll('\\', '/') === registry,
  )
  expect(entry).toBeDefined()
  expect(startup.has(entry[0])).toBe(false)
  // It loads with the registry: in its entry chunk or a chunk that entry
  // imports statically (a chunk esbuild shares with another lazy surface).
  const withRegistry = new Set()
  const queue = [entry[0]]
  while (queue.length > 0) {
    const file = queue.pop()
    if (withRegistry.has(file)) continue
    withRegistry.add(file)
    const imports = meta.outputs[file]?.imports ?? []
    for (const edge of imports) if (edge.kind === 'import-statement') queue.push(edge.path)
  }
  expect(withRegistry.has(owners[0][0])).toBe(true)
  expect(statSync(path.join(build.root, 'dist/extension.js')).size).toBeLessThanOrEqual(587_451)
})
