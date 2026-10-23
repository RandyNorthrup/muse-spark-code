// The namespace end of S4 (M110r Y4): runs under `ip netns exec` in the
// node's namespace. Dials the orchestrator's home address, sends
// heartbeats with its (skewed) wall clock, and answers pings. Plain
// JavaScript over node:net: no bundle step, started by path.
import { connect } from 'node:net'
import { clearInterval, setInterval } from 'node:timers'

function flagValue(flag) {
  const args = process.argv.slice(2)
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) {
    process.stderr.write('usage: nsResponder.mjs --home <host:port> --skew-ms <n>\n')
    process.exit(2)
  }
  return args[index + 1]
}

function main() {
  const [host, portText] = flagValue('--home').split(':', 2)
  const port = Number(portText)
  const skewMs = Number(flagValue('--skew-ms'))
  if (host === undefined || !Number.isSafeInteger(port) || !Number.isFinite(skewMs)) {
    process.stderr.write('usage: nsResponder.mjs --home <host:port> --skew-ms <n>\n')
    process.exit(2)
  }

  const socket = connect(port, host)
  socket.setEncoding('utf8')
  let seq = 0
  socket.on('connect', () => {
    const timer = setInterval(() => {
      seq += 1
      socket.write(`${JSON.stringify({ from: 'ns-node', seq, wall: Date.now() + skewMs })}\n`)
    }, 20)
    timer.unref()
    socket.on('close', () => {
      clearInterval(timer)
    })
  })
  socket.on('error', () => {
    process.exit(1)
  })
}

main()
