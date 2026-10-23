import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const BYTES_PER_KIB = 1024
// Bound the shipped startup graph, including the native loader. Deferred modules
// remain separately loaded and counted by the unchanged shared graph gate.
const NATIVE_BUDGETS = [
  { entry: 'main', budgetKiB: 950 },
  { entry: 'whatsNew', budgetKiB: 25 },
]

export function checkNativeBundleSize(directory, portableDirectory) {
  for (const { entry, budgetKiB } of NATIVE_BUDGETS) {
    const file = path.join(directory, `${entry}.inline.js`)
    const manifestPath =
      portableDirectory === undefined ? '' : path.join(portableDirectory, 'modules.json')
    let size = statSync(
      entry === 'main' && existsSync(manifestPath)
        ? path.resolve(import.meta.dirname, 'src/main/resources/nativeModules.mjs')
        : file,
    ).size
    if (entry === 'main' && existsSync(manifestPath)) {
      if (size > 50 * BYTES_PER_KIB) throw new Error('OVER native module loader (budget 50 KiB)')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const modules = new Map(manifest.modules.map((module) => [module.path, module]))
      const seen = new Set()
      const visit = (key) => {
        if (seen.has(key)) return
        seen.add(key)
        const module = modules.get(key)
        if (module === undefined) throw new Error('MHP_MODULE_UNLISTED')
        const asset = path.join(portableDirectory, key.slice('/assets/portable/'.length))
        const bytes = statSync(asset).size
        if (bytes !== module.bytes) throw new Error('MHP_MODULE_CHANGED')
        size += bytes
        for (const imported of module.imports) if (!imported.dynamic) visit(imported.target)
      }
      visit('/assets/portable/main.js')
    }
    const sizeKiB = size / BYTES_PER_KIB
    if (sizeKiB > budgetKiB) {
      throw new Error(`OVER native ${entry}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`)
    }
    console.log(`ok   native ${entry}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`)
  }
}
