import { statSync } from 'node:fs'
import path from 'node:path'

const BYTES_PER_KIB = 1024
// JCEF loads eager and deferred shared JS together. Bound that combined entry
// by the unchanged shared startup (900) + deferred (50) budgets (PLAN D6).
const NATIVE_BUDGETS = [
  { entry: 'main', budgetKiB: 950 },
  { entry: 'whatsNew', budgetKiB: 25 },
]

export function checkNativeBundleSize(directory) {
  for (const { entry, budgetKiB } of NATIVE_BUDGETS) {
    const file = path.join(directory, `${entry}.inline.js`)
    const sizeKiB = statSync(file).size / BYTES_PER_KIB
    if (sizeKiB > budgetKiB) {
      throw new Error(`OVER native ${entry}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`)
    }
    console.log(`ok   native ${entry}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`)
  }
}
