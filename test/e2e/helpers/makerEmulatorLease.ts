import { claimHardwareLease, serialLeaseResource } from '../../../src/core/maker/lease'
import { makerLeaseDeps } from '../../unit/helpers/makerSerial'

/** Compiled into an isolated Node child by the emulator e2e suite. */
export async function makerEmulatorLeaseMain(): Promise<void> {
  const [directory, port] = process.argv.slice(2)
  if (directory === undefined || port === undefined) throw new Error('lease worker arguments')
  const deps = await makerLeaseDeps(directory)
  const { promise: finished, resolve: release } = Promise.withResolvers<undefined>()
  const claimed = await claimHardwareLease(
    deps,
    await serialLeaseResource({ port }, 'linux'),
    'emulator-worker',
    () => {
      release(undefined)
      return Promise.resolve()
    },
  )
  if (claimed.status === 'busy') {
    process.stdout.write(JSON.stringify({ status: 'busy', holderPid: claimed.holder.pid }) + '\n')
    return
  }
  process.stdin.resume()
  process.stdin.once('end', () => {
    release(undefined)
  })
  process.stdout.write(JSON.stringify({ status: 'claimed', record: claimed.record }) + '\n')
  try {
    await finished
  } finally {
    await claimed.release()
  }
  process.stdin.destroy()
}
