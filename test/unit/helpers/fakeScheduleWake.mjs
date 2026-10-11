// Fake-only Win11 OS-entry receipt: no backend, credential read or network.
import { appendFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const directory = path.join(root, 'temp', 'm115-native-wake')
const args = process.argv.slice(2)
// The editor receipt has one fixture-only source argument.
if (
  args.slice(0, 4).join(' ') !== 'schedule run-due --json' &&
  args.join(' ') !== 'schedule run-due --json --editor'
)
  throw new Error('Invalid fake wake arguments')
mkdirSync(directory, { recursive: true })
let isAdmitted = false
try {
  const handle = openSync(path.join(directory, 'claim'), 'wx', 0o600)
  closeSync(handle)
  isAdmitted = true
} catch (error) {
  if (error.code !== 'EEXIST') throw error
}
appendFileSync(
  path.join(directory, 'attempts.jsonl'),
  JSON.stringify({
    admitted: isAdmitted,
    source: args.includes('--editor') ? 'editor' : 'os',
    atMs: Date.now(),
  }) + '\n',
)
process.stdout.write(JSON.stringify({ kind: 'accepted' }) + '\n')
