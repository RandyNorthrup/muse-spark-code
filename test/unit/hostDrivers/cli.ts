// One native conformance driver invocation: `node <bundle> <driver> '<json>'`
// prints the driver's observations as JSON. runDriver.mjs bundles this file
// with esbuild and spawns it; native harnesses call runDriver.mjs. Failures
// carry the runner's fixed word only, as any native harness failure does.
import * as z from 'zod/mini'
import type { Logger } from '../../../src/host/logger'
import { runCheckpointDriver } from './checkpoint'
import { runHunksDriver } from './hunks'
import { runSettingsDriver } from './settings'

const DRIVER_FAILED = 'MHP_CONFORMANCE_DRIVER_FAILED'

const checkpointArgs = z.strictObject({
  workspaceRoot: z.string().check(z.minLength(1)),
  dataRoot: z.string().check(z.minLength(1)),
  sessionId: z.string().check(z.minLength(1)),
  backend: z.enum(['museCode', 'modelApi']),
})

const hunksArgs = z.strictObject({
  workspaceRoot: z.string().check(z.minLength(1)),
})

const settingsArgs = z.strictObject({
  workspaceRoot: z.string().check(z.minLength(1)),
  dataRoot: z.string().check(z.minLength(1)),
})

const invocation = z.strictObject({
  driver: z.enum(['checkpoint', 'hunks', 'settings']),
  args: z.unknown(),
})

async function main(): Promise<void> {
  const [driver, json] = process.argv.slice(2)
  let args: unknown
  try {
    args = json === undefined ? undefined : JSON.parse(json)
  } catch {
    console.error(DRIVER_FAILED)
    process.exitCode = 2
    return
  }
  const parsed = invocation.safeParse({ driver, args })
  if (!parsed.success) {
    console.error(DRIVER_FAILED)
    process.exitCode = 2
    return
  }
  const warnings: string[] = []
  const log: Logger = {
    trace: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warnings.push(message)
    },
    error: (message) => {
      warnings.push(message)
    },
  }
  try {
    if (parsed.data.driver === 'checkpoint') {
      const args = checkpointArgs.parse(parsed.data.args)
      process.stdout.write(`${JSON.stringify(await runCheckpointDriver(args, log))}\n`)
    } else if (parsed.data.driver === 'hunks') {
      const args = hunksArgs.parse(parsed.data.args)
      process.stdout.write(`${JSON.stringify(await runHunksDriver(args, log))}\n`)
    } else {
      const args = settingsArgs.parse(parsed.data.args)
      process.stdout.write(`${JSON.stringify(await runSettingsDriver(args))}\n`)
    }
  } catch {
    console.error(DRIVER_FAILED)
    process.exitCode = 1
    return
  }
  for (const warning of warnings) console.error(warning)
}

await main()
