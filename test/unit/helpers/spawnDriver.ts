import { spawn } from 'node:child_process'
import { once } from 'node:events'

/**
One node driver run: the driver script with its arguments, the exit code
it ended with, and its collected stdout. Drivers print their JSON
summary to stdout and keep diagnostics on stderr (inherited).
*/
export async function runDriverScript(
  script: string,
  args: readonly string[],
): Promise<{ code: unknown; output: string }> {
  const driver = spawn(process.execPath, [script, ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  let output = ''
  driver.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  const [code] = await once(driver, 'exit')
  return { code, output }
}
