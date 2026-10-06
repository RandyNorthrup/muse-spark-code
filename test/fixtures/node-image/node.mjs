// Fake node entry used only to exercise the real image bootstrap on rigs.
import fs from 'node:fs'
import net from 'node:net'
import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers'

assert.equal(process.getuid(), 10_001)
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /CapEff:\s+0+\n/)
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /CapBnd:\s+0+\n/)
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /NoNewPrivs:\s+1\n/)
assert.equal(
  Object.keys(process.env).some((name) => /API_KEY|TOKEN|PASSWORD|SECRET/.test(name)),
  false,
)
fs.writeFileSync('/var/lib/muse-spark-code-node/owner-only', 'private-node-state', { mode: 0o600 })
const connect = () => {
  const socket = net.connect('/run/muse-tools/host.sock')
  socket.on('error', () => setTimeout(connect, 50))
  socket.on('connect', () => socket.write(String(process.pid)))
  socket.on('data', (data) => {
    const result = JSON.parse(data)
    assert.equal(result.uid, 10_002)
    assert.equal(result.protectedState, true)
    assert.equal(result.protectedMemory, true)
    assert.equal(result.cleanEnvironment, true)
    assert.equal(result.pty, true)
    console.log('M110 image runtime probe passed')
  })
}
connect()
process.on('SIGTERM', () => process.exit(0))
