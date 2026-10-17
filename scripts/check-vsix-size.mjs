// REL0160B: measured universal VSIX 2,911,436 bytes +5%, rounded up
// to 25 KiB = 3,072,000 bytes. Authorized rebuild budget (PLAN.md D6).
// CAPS017 (0.17.0), PROVISIONAL: 3,272,933 bytes on Kubuntu with the real x64
// Linux helper but an empty arm64 helper and no macOS artifacts; D6's
// 25 x ceil(3,196.2 KiB x 1.15 / 25) = 3700 KiB. The hosted CI universal
// VSIX on the release PR sets the final cap (lead decision, PLAN.md D6).
import { statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_VSIX_BYTES = 3700 * 1024

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
