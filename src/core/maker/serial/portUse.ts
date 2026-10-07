import * as z from 'zod/mini'
import type { SerialIdentity } from './identity'

/** Metadata tools report existing users without opening the port themselves. */
export async function querySerialPortUse(
  identity: SerialIdentity,
  deps: {
    readonly platform: 'linux' | 'darwin'
    readonly executable: string
    readonly maxBytes: number
    readonly run: (file: string, args: readonly string[]) => Promise<unknown>
  },
): Promise<'busy' | 'free'> {
  const args = deps.platform === 'linux' ? ['--', identity.port] : ['-t', '--', identity.port]
  const result = z
    .object({ code: z.int(), stdout: z.string() })
    .parse(await deps.run(deps.executable, args))
  if (Buffer.byteLength(result.stdout) > deps.maxBytes) throw new Error('serial-port-use-oversize')
  const output = result.stdout.trim()
  if (output === '' && result.code === 1) return 'free'
  if (result.code === 0 && /^\d+(?:\s+\d+)*$/.test(output)) return 'busy'
  throw new Error('serial-port-use-unknown')
}
