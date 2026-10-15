// The named-lock race, run as a plain node script so any machine can run it
// without the repository's test tooling:
//   node test/hosts/named-lock-race.mjs <bundle.cjs> <work folder> [processes] [rounds]
// <bundle.cjs> is a build of src/runtime/namedLock.ts (see
// test/unit/namedLockRace.test.ts, which builds one and runs this). On POSIX
// the driver first leaves dead socket files in every round's folder, the way a
// crashed holder leaves them (a process that binds and is SIGKILLed): the old
// "probe, unlink, bind" recovery raced exactly there. Then `processes` real
// processes meet at the same instant in every round and take the lock; the
// worker counts every time two were inside at once. Prints one JSON summary
// and exits 1 on any violation or failure. No credentials, no service traffic.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FILE = 'race.lock'
const HOLD_MS = 30
const GAP_MS = 2500
const START_DELAY_MS = 1500
const TIMEOUT_MS = 60_000

/** Seed mode: bind every given path, say so, wait to be killed. SIGKILL leaves the files. */
async function seed(paths) {
  for (const target of paths) {
    const server = net.createServer((socket) => socket.destroy())
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(target, resolve)
    })
  }
  process.send?.('seeded')
  await once(process, 'message')
}

/** A worker's exit code and everything it printed. */
async function finished(child, printed) {
  const [code] = await once(child, 'exit')
  return { code, output: printed() }
}

async function main(bundle, base, processes, rounds) {
  const isWindows = process.platform === 'win32'
  const stale = []
  for (let round = 0; round < rounds; round += 1) {
    const directory = path.join(base, `r${String(round)}`)
    await mkdir(directory, { recursive: true })
    // The old shared name, and one entry of the per-contender kind: dead both.
    stale.push(path.join(directory, FILE), path.join(directory, `${FILE}.deadbeef`))
  }
  if (!isWindows) {
    const seeder = spawn(process.execPath, [fileURLToPath(import.meta.url), '--seed', ...stale], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    const [message] = await once(seeder, 'message')
    if (message !== 'seeded') throw new Error('could not leave dead sockets')
    const exited = once(seeder, 'exit')
    seeder.kill('SIGKILL')
    await exited
  }
  const plan = {
    base,
    pipe: `muse-spark-race-${String(process.pid)}`,
    file: FILE,
    rounds,
    holdMs: HOLD_MS,
    gapMs: GAP_MS,
    startAt: Date.now() + START_DELAY_MS,
    timeoutMs: TIMEOUT_MS,
  }
  const workers = []
  for (let index = 0; index < processes; index += 1) {
    const child = spawn(
      process.execPath,
      [path.join(here, 'named-lock-worker.mjs'), bundle, JSON.stringify(plan)],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    workers.push(finished(child, () => output))
  }
  const summary = { processes, rounds, entered: 0, violations: 0, failures: [], crashed: 0 }
  const results = await Promise.all(workers)
  for (const worker of results) {
    if (worker.code !== 0) {
      summary.crashed += 1
      continue
    }
    const tally = JSON.parse(worker.output)
    summary.entered += tally.entered
    summary.violations += tally.violations
    summary.failures.push(...tally.failures)
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  const isBroken = summary.crashed > 0 || summary.violations > 0
  const isWhole = summary.entered === processes * rounds
  process.exit(isWhole && !isBroken ? 0 : 1)
}

if (process.argv[2] === '--seed') {
  await seed(process.argv.slice(3))
} else {
  const [bundle, base, processes = '6', rounds = '40'] = process.argv.slice(2)
  if (bundle === undefined || base === undefined) {
    process.stderr.write(
      'usage: named-lock-race.mjs <bundle.cjs> <work folder> [processes] [rounds]\n',
    )
    process.exit(2)
  }
  await main(path.resolve(bundle), path.resolve(base), Number(processes), Number(rounds))
}
