// Fake tool host; the PTY, file access and process isolation checks are real.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// This separate fixture package is installed inside the image. Load its
// compiled native dependency relative to the staged dist entry, not from the
// rig's repository node_modules (which deliberately does not install PTYs).
const { default: pty } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', 'node_modules', 'node-pty', 'lib', 'index.js'))
    .href
)

assert.equal(process.getuid(), 10_002)
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /CapEff:\s+0+\n/)
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /CapBnd:\s+0+\n/)
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /NoNewPrivs:\s+1\n/)
const cannotRead = (file) => {
  try {
    fs.readFileSync(file)
    return false
  } catch {
    return true
  }
}
const server = net.createServer((socket) =>
  socket.once('data', (nodePid) => {
    const terminal = pty.spawn('/bin/bash', ['-c', 'id -u'], {
      cwd: '/workspaces',
      env: process.env,
    })
    let output = ''
    terminal.onData((data) => {
      output += data
    })
    terminal.onExit(() =>
      socket.write(
        JSON.stringify({
          uid: process.getuid(),
          protectedState: cannotRead('/var/lib/muse-spark-code-node/owner-only'),
          protectedMemory: cannotRead(`/proc/${Number(nodePid)}/mem`),
          cleanEnvironment: Object.keys(process.env).every(
            (name) => !/API_KEY|TOKEN|PASSWORD|SECRET/.test(name),
          ),
          pty: output.trim() === '10002',
        }),
      ),
    )
  }),
)
server.listen('/run/muse-tools/host.sock', () => {
  fs.chownSync('/run/muse-tools/host.sock', 10_002, 10_003)
  fs.chmodSync('/run/muse-tools/host.sock', 0o660)
})
