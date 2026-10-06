// A fake never-ending device monitor (M92b): prints a line every 100 ms and
// starts a child process that also sleeps forever, so the bounded-run proof
// can show the shell tool's timeout returns the captured output and leaves
// neither process behind. It never exits on its own, like `idf.py monitor`.

import { spawn } from 'node:child_process'
import { stdout } from 'node:process'
import { setInterval } from 'node:timers'

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
})
stdout.write(`READY ${String(process.pid)} ${String(child.pid)}\n`)
const started = Date.now()
setInterval(() => {
  stdout.write(`tick ${String(Date.now() - started)} ms\n`)
}, 100)
