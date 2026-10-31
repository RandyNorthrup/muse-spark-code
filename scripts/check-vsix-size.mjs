// Budget history (PLAN.md D6): REL0160B 3,072,000 bytes; CAPS017 3700 KiB
// (3,788,800 bytes), held through 0.19.0.
// D209: one package per platform, each meeting this same budget.
// CC-INT1 (2026-10-24), the owner's decision ("Move budget to measured
// +15%"): the win32-x64 VSIX measured 4,273,804 bytes on cc/vsixsize;
// 4,273,804 x 1.15 rounded up to 25 KiB = 4800 KiB (4,915,200 bytes).
import { statSync } from 'node:fs'
import { isEntryPoint } from './lib/entryPoint.mjs'

export const MAX_VSIX_BYTES = 4800 * 1024

export function checkVsixSize(file) {
  const size = statSync(file).size
  if (size > MAX_VSIX_BYTES) {
    throw new Error(
      `${file} is ${size} bytes; budget is ${MAX_VSIX_BYTES} bytes (${MAX_VSIX_BYTES / 1024} KiB)`,
    )
  }
  return size
}

if (isEntryPoint(import.meta.url)) {
  try {
    // One package per platform (PLAN.md D209): every target meets the
    // same budget, so every artifact is checked, not just one.
    const artifacts = process.argv.slice(2)
    if (artifacts.length === 0) throw new Error('At least one VSIX path required')
    for (const artifact of artifacts)
      console.log(`VSIX: ${checkVsixSize(artifact)} bytes (budget ${MAX_VSIX_BYTES})`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
