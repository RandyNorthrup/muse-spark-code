// TRAIN15G, 2026-10-06: measured universal VSIX 2,688,730 bytes +5%, rounded
// up to 25 KiB = 2,841,600 bytes. Lead-approved for the 0.15.0 train only
// (PLAN.md D6); existing individual bundle caps are unchanged.
import { statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_VSIX_BYTES = 2775 * 1024

export function checkVsixSize(file) {
  const size = statSync(file).size
  if (size > MAX_VSIX_BYTES) {
    throw new Error(
      `VSIX is ${size} bytes; budget is ${MAX_VSIX_BYTES} bytes (${MAX_VSIX_BYTES / 1024} KiB)`,
    )
  }
  return size
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3) throw new Error('Exactly one VSIX path required')
    console.log(`VSIX: ${checkVsixSize(process.argv[2])} bytes (budget ${MAX_VSIX_BYTES})`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
