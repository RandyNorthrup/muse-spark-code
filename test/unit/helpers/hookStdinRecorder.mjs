#!/usr/bin/env node
// Test harness: a hook command that records what the product delivers on
// stdin. Usage: node hookStdinRecorder.mjs <jsonl-file>. Each run appends
// one line and exits 0 with no output. The bytes are the product's own
// hook payload; this only keeps them where the test can read them.
import { createWriteStream } from 'node:fs'

const outFile = process.argv[2]
if (outFile === undefined || outFile === '') {
  process.stderr.write('hookStdinRecorder: missing jsonl file\n')
  process.exit(1)
}
const out = createWriteStream(outFile, { flags: 'a' })
out.on('error', (error) => {
  process.stderr.write(`hookStdinRecorder: ${error.message}\n`)
  process.exit(1)
})
process.stdin.pipe(out, { end: false })
process.stdin.on('end', () => {
  out.end('\n')
})
