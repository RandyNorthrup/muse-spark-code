// The created-registry race, run as a plain node script so any machine can
// run it without the repository's test tooling:
//   node test/hosts/created-registry-race.mjs <bundle.cjs> <work folder> <storage folder> <package root> <native root> [processes] [rounds] [creates]
// <bundle.cjs> is a build of test/hosts/created-registry-race-entry.ts (see
// test/unit/createdRegistryRace.test.ts, which builds one and runs this).
// On Windows <storage folder> must already hold the built job assembly (the
// test builds it); the workers reuse it. Then `processes` real processes
// meet at the same instant in every round and save the shared manifest; the
// driver counts every failed save and every created entry the live manifest
// lost. Prints one JSON summary and exits 1 on any failure, loss, or crash.
// No credentials, no service traffic.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST = 'registry.json'
const TREES = 'trees'
const GAP_MS = 2500
const START_DELAY_MS = 1500

/** A worker's exit code and everything it printed. */
async function finished(child, printed) {
  const [code] = await once(child, 'exit')
  return { code, output: printed() }
}

async function main(bundle, base, storageDir, packageRoot, nativeRoot, processes, rounds, creates) {
  await mkdir(base, { recursive: true, mode: 0o700 })
  const startAt = Date.now() + START_DELAY_MS
  const workers = []
  for (let index = 0; index < processes; index += 1) {
    const plan = {
      manifest: path.join(base, MANIFEST),
      base: path.join(base, TREES),
      storageDir,
      packageRoot,
      nativeRoot,
      rounds,
      creates,
      startAt,
      gapMs: GAP_MS,
      worker: index,
    }
    const child = spawn(
      process.execPath,
      [path.join(here, 'created-registry-race-worker.mjs'), bundle, JSON.stringify(plan)],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    workers.push(finished(child, () => output))
  }
  const summary = {
    processes,
    rounds,
    creates,
    created: 0,
    failures: [],
    missing: [],
    crashed: 0,
  }
  const seen = []
  const results = await Promise.all(workers)
  for (const worker of results) {
    if (worker.code !== 0) {
      summary.crashed += 1
      continue
    }
    const tally = JSON.parse(worker.output)
    summary.created += tally.created.length
    summary.failures.push(...tally.failures)
    seen.push(...tally.created)
  }
  const live = JSON.parse(await readFile(path.join(base, MANIFEST), 'utf8'))
  const kept = new Set(live.map((entry) => entry.id))
  summary.missing.push(...seen.filter((id) => !kept.has(id)))
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  const expected = processes * rounds * creates
  const isBroken = summary.crashed > 0 || summary.failures.length > 0 || summary.missing.length > 0
  process.exit(!isBroken && summary.created === expected ? 0 : 1)
}

{
  const [
    bundle,
    base,
    storageDir,
    packageRoot,
    nativeRoot,
    processes = '2',
    rounds = '2',
    creates = '2',
  ] = process.argv.slice(2)
  if (
    bundle === undefined ||
    base === undefined ||
    storageDir === undefined ||
    packageRoot === undefined ||
    nativeRoot === undefined
  ) {
    process.stderr.write(
      'usage: created-registry-race.mjs <bundle.cjs> <work folder> <storage folder> <package root> <native root> [processes] [rounds] [creates]\n',
    )
    process.exit(2)
  }
  await main(
    path.resolve(bundle),
    path.resolve(base),
    path.resolve(storageDir),
    path.resolve(packageRoot),
    path.resolve(nativeRoot),
    Number(processes),
    Number(rounds),
    Number(creates),
  )
}
