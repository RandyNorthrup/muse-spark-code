#!/usr/bin/env node
// Test harness: a hook command that records what the product delivers on
// stdin, then holds before it exits with no output (no permission given).
// Usage: node hookHoldRecorder.mjs <jsonl-file> <hold-ms>. The bytes are
// the product's own hook payload; this only keeps them where the test can
// read them, and the hold keeps the request it guards in flight.
import { Buffer } from 'node:buffer'
import { appendFileSync } from 'node:fs'

const [outFile, holdText = '0'] = process.argv.slice(2)
if (outFile === undefined || outFile === '') {
  process.stderr.write('hookHoldRecorder: missing jsonl file\n')
  process.exit(1)
}
const chunks = []
process.stdin.on('data', (chunk) => {
  chunks.push(chunk)
})
process.stdin.on('end', () => {
  appendFileSync(outFile, `${Buffer.concat(chunks).toString('utf8')}\n`)
  setTimeout(() => {
    process.exit(0)
  }, Number(holdText))
})
