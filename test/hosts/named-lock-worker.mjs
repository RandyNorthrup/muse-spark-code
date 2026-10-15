// One process of the named-lock race: the real withNamedLock (a bundle of
// src/runtime/namedLock.ts built by the caller) on the lock folders the driver
// seeded. For each round it waits for the round's start time, so every process
// meets the others at the same instant, takes the lock, and inside it creates
// a marker file exclusively: if another process already holds the marker, two
// holders are inside at once, and that is counted. Reports one JSON line at
// the end. No credentials and no service traffic.
import { createRequire } from 'node:module'
import { open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const { withNamedLock } = require(process.argv[2])
const plan = JSON.parse(process.argv[3])
const names = { pipe: plan.pipe, folder: 'unused', file: plan.file }
const tally = { entered: 0, violations: 0, failures: [] }

async function critical(marker) {
  let handle
  try {
    handle = await open(marker, 'wx')
  } catch {
    tally.violations += 1
    return
  }
  await delay(plan.holdMs)
  await handle.close()
  await unlink(marker)
  tally.entered += 1
}

for (let round = 0; round < plan.rounds; round += 1) {
  const directory = path.join(plan.base, `r${String(round)}`)
  const wait = plan.startAt + round * plan.gapMs - Date.now()
  if (wait > 0) await delay(wait)
  try {
    await withNamedLock(() => critical(path.join(directory, 'holder')), names, {
      directory,
      pipeName: `${plan.pipe}-r${String(round)}`,
      timeoutMs: plan.timeoutMs,
    })
  } catch (error) {
    const reason =
      error !== null && typeof error === 'object' && 'reason' in error ? error.reason : ''
    tally.failures.push(`${error instanceof Error ? error.message : 'error'} ${String(reason)}`)
  }
}
process.stdout.write(`${JSON.stringify(tally)}\n`)
