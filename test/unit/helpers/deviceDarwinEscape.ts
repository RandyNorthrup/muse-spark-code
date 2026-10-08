import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import * as z from 'zod/mini'
import {
  parseDeviceWorkerQuery,
  type DeviceWorkerAttempt,
  type DeviceWorkerDriver,
} from '../../../src/host/devices/deviceWorkerHost'
import type { RunProgram } from '../../../src/host/processTree'

const treeSchema = z.strictObject({
  root: z.int().check(z.gt(1)),
  held: z.int().check(z.gt(1)),
  escape: z.int().check(z.gt(1)),
  rootGroup: z.int().check(z.gt(1)),
  escapeGroup: z.int().check(z.gt(1)),
  escapeParent: z.int(),
  coalition: z.int().check(z.gt(0)),
  escapeCoalition: z.int().check(z.gt(0)),
  spawnReassignmentDenied: z.boolean(),
})
type Tree = z.infer<typeof treeSchema>

async function ready(file: string) {
  await expect
    .poll(async () => {
      try {
        await access(file)
        return true
      } catch {
        return false
      }
    })
    .toBe(true)
}

export function survivors(tree: Tree): number[] {
  return [tree.root, tree.held, tree.escape].filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')
        return false
      throw error
    }
  })
}

/** Suspend only the supervisor while constructing overflow; then prove its next sample kills. */
export async function darwinEscapeTree(
  run: RunProgram,
  driver: DeviceWorkerDriver,
  directory: string,
  attempt: DeviceWorkerAttempt,
) {
  const fixture = await mkdtemp(path.join(directory, 'escape-'))
  const file = (name: string) => path.join(fixture, name)
  const release = file('release')
  const rootExit = file('root-exit')
  const job = await driver.launch(
    {
      executable: path.join(directory, 'escape-tree'),
      args: [file('create'), file('tree.json'), release, rootExit, file('root-ready')],
      cwd: fixture,
      requiredTools: [],
    },
    {},
    attempt,
  )
  const context = parseDeviceWorkerQuery(job.query).context
  const service = `gui/${String(context.session)}/${context.desktop}`
  const signal = (word: string) => run('/bin/launchctl', ['kill', word, service], {})
  let tree: Tree | undefined
  let isSuspended = false
  try {
    await job.activate()
    await ready(file('root-ready'))
    await signal('SIGSTOP')
    isSuspended = true
  } catch (error) {
    await job.cancel()
    await job.retirement
    await job.remove()
    throw error
  }
  const resume = async () => {
    if (!isSuspended) return
    await signal('SIGCONT')
    isSuspended = false
  }
  return {
    job,
    release,
    rootExit,
    resume,
    create: async () => {
      await writeFile(file('create'), '')
      await ready(file('tree.json'))
      tree = treeSchema.parse(JSON.parse(await readFile(file('tree.json'), 'utf8')))
      return tree
    },
    clean: async () => {
      // Independent fixture cleanup also works when the production kill is deliberately broken.
      await writeFile(release, '')
      await resume()
      if (tree !== undefined) {
        for (const pid of survivors(tree)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch (error) {
            if (!(
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'ESRCH'
            ))
              throw error
          }
        }
      }
      await job.cancel()
      await job.retirement
      await job.remove()
    },
  }
}
