import { createInterface } from 'node:readline'
import { Buffer } from 'node:buffer'
import { setImmediate } from 'node:timers'

const mode = process.argv[2]
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  if (line !== 'sample') process.exit(1)
  if (mode === 'stall') return
  if (mode === 'exit') process.exit(1)
  if (mode === 'stderr') {
    process.stderr.write('untrusted helper diagnostic')
    return
  }
  if (mode === 'invalid-utf8') {
    process.stdout.write(Buffer.from([255, 10]))
    return
  }
  const response = mode === 'normal' ? '{"availableBytes":6000}\n' : mode
  // Real pipes can split JSON across chunks. Confirm that the reader handles it.
  process.stdout.write(response.slice(0, 1))
  setImmediate(() => process.stdout.write(response.slice(1)))
})
