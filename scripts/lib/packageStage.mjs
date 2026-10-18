// A packager's stage directory is build output, never an artifact: it is
// removed when packaging succeeds and when it fails, so a stale stage can
// never poison a later gate's scan of dist/ (the phantom lazy-registry
// problems a leftover dist/*-package stage caused). The ACP receipt names
// every staged file for the release SBOM, which runs after the stage is
// gone.
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Remove a packaging stage, tolerating its absence (a failure before staging). */
export function removePackageStage(stage) {
  rmSync(stage, { recursive: true, force: true })
}

/** The stage's files as forward-slash relative paths, sorted and deterministic. */
export function stageFiles(stage) {
  const found = []
  const walk = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else found.push(file)
    }
  }
  walk(stage)
  return found
    .map((file) => path.relative(stage, file).replaceAll(path.sep, '/'))
    .toSorted((a, b) => a.localeCompare(b, 'en'))
}

/** Write the stage receipt the release SBOM reads after the stage is gone. */
export function writeStageReceipt(stage, receipt) {
  writeFileSync(receipt, `${JSON.stringify(stageFiles(stage), null, 2)}\n`)
}
