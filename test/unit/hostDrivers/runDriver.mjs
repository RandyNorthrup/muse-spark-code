// Native conformance driver runner (RLF-M104GL): `node runDriver.mjs <driver>
// '<json>'` bundles the beside-it cli.ts with the repo's esbuild and runs
// one driver, printing its observations JSON on stdout. Native harnesses
// (which cannot import TypeScript) spawn this. A failure carries the
// runner's fixed word on stderr with the driver's exit code, as any native
// harness failure does; child output never passes through.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const DRIVER_FAILED = 'MHP_CONFORMANCE_DRIVER_FAILED'
const directory = path.dirname(fileURLToPath(import.meta.url))

function fail(code) {
  console.error(DRIVER_FAILED)
  process.exitCode = code
}

const [driver, json = ''] = process.argv.slice(2)
if (driver !== 'checkpoint' && driver !== 'hunks' && driver !== 'settings') {
  fail(2)
} else {
  const stage = mkdtempSync(path.join(tmpdir(), 'muse-conformance-driver-'))
  try {
    const bundle = path.join(stage, 'driver.mjs')
    let isBuilt = false
    try {
      buildSync({
        entryPoints: [path.join(directory, 'cli.ts')],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        logLevel: 'silent',
      })
      isBuilt = true
    } catch {
      fail(1)
    }
    if (isBuilt) {
      const ran = spawnSync(process.execPath, [bundle, driver, json], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      })
      if (ran.error !== undefined || ran.status !== 0)
        fail(ran.status === 0 || ran.status === null ? 1 : ran.status)
      else process.stdout.write(ran.stdout)
    }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
