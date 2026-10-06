// Actual guardian, synthetic PID/birth snapshots and intercepted signals only.
import nativeProcess from 'node:process'
import { PassThrough } from 'node:stream'
import { RUNTIME_STOP } from '../../../src/shared/constants'

const fault = nativeProcess.argv[2]
const input = new PassThrough()
const signals: number[] = []
const owner = { pid: 10, parent: 1, group: 10, born: 'owner' }
const root = { pid: 100, parent: 10, group: 100, born: 'root' }
const child = { pid: 101, parent: 100, group: fault === 'group' ? 100 : 101, born: 'child' }
const initial = fault === 'owner' ? [owner] : [owner, root, child]
const state = { rows: initial, reads: 0 }
if (fault === 'deadline') Date.now = () => (state.reads >= 6 ? RUNTIME_STOP.exitMs + 1 : 0)
export function execFile(
  _file: string,
  _args: readonly string[],
  _options: unknown,
  callback: (error: Error | null, stdout: string) => void,
): void {
  state.reads += 1
  if (fault !== 'signal' && fault !== 'deadline' && state.reads === 3) {
    switch (fault) {
      case 'parent': {
        state.rows = [
          owner,
          root,
          { ...child, born: 'recycled' },
          { pid: 202, parent: 101, group: 202, born: 'unrelated' },
        ]
        break
      }
      case 'root': {
        state.rows = [
          owner,
          { ...root, born: 'recycled', parent: 55 },
          child,
          { pid: 202, parent: 100, group: 202, born: 'unrelated' },
        ]
        break
      }
      case 'group': {
        state.rows = [owner, child, { pid: 202, parent: 55, group: 100, born: 'unrelated' }]
        break
      }
      case 'owner': {
        state.rows = [
          { ...owner, born: 'recycled' },
          root,
          { pid: 202, parent: 100, group: 202, born: 'unrelated' },
        ]
        break
      }
      default: {
        throw new Error('fixture fault')
      }
    }
  }
  if (fault === 'signal' && state.reads === 6)
    state.rows = [owner, { ...root, born: 'recycled' }, child]
  queueMicrotask(() => {
    callback(
      null,
      state.rows
        .map((row) => `${String(row.pid)} ${String(row.parent)} ${String(row.group)} ${row.born}`)
        .join('\n'),
    )
    if (state.reads === 3) setTimeout(() => input.end(), 0)
  })
}
export default {
  argv: ['node', 'guardian', '10'],
  env: {},
  platform: 'darwin',
  pid: 999,
  stdin: input,
  once: nativeProcess.once.bind(nativeProcess),
  stdout: {
    write: () => {
      input.write('{"pid":100}\n')
    },
  },
  kill: (pid: number) => {
    signals.push(pid)
    state.rows = state.rows.filter((row) => (pid > 0 ? row.pid !== pid : row.group !== -pid))
  },
  set exitCode(code: number) {
    nativeProcess.stdout.write(`${JSON.stringify({ signals, code })}\n`)
  },
}
