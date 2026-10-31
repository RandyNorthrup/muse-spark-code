import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { vaultFenceEnvironment } from '../../../src/core/vault/exec/fence'
import { feederProcessEnvironment } from '../../../src/host/vault/vaultExecSpawn'

// The feeder has to see the runtime directory the broker socket is bound
// in. The command the feeder starts is fenced again and must not see it.

const execFileAsync = promisify(execFile)
const readChildEnv = async (env: NodeJS.ProcessEnv, name: string): Promise<string> => {
  const result = await execFileAsync(
    process.execPath,
    ['-e', `process.stdout.write(process.env[${JSON.stringify(name)}] ?? '')`],
    { env, encoding: 'utf8' },
  )
  return result.stdout
}

describe('feeder runtime directory', () => {
  it('keeps the broker socket directory and still withholds it from the command', async () => {
    const source: NodeJS.ProcessEnv = {
      PATH: process.env['PATH'],
      XDG_RUNTIME_DIR: '/run/user/1000',
      GH_TOKEN: 'not-a-real-token',
    }
    const feeder = feederProcessEnvironment(source)
    expect(await readChildEnv(feeder, 'XDG_RUNTIME_DIR')).toBe('/run/user/1000')
    expect(await readChildEnv(feeder, 'GH_TOKEN')).toBe('')
    const command = vaultFenceEnvironment(feeder)
    expect(await readChildEnv(command, 'XDG_RUNTIME_DIR')).toBe('')
  })
})
