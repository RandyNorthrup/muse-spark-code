import process from 'node:process'
import { setInterval, setTimeout } from 'node:timers'
// Fake-only helper for lifecycle and malformed-boundary tests; no production fallback.
const [mode, ...args] = process.argv.slice(2)
if (mode === 'nativeProbeFailure') {
  process.stderr.write('{"refused":"landlockAbi"}\n')
  process.exitCode = 125
} else if (mode === 'badProbe') {
  process.stdout.write('{"abi":2,"confined":true}\n')
} else if (args[0] === 'probe') {
  if (mode === 'hangProbe') {
    process.stdout.write('PROBE_RUNNING\n')
    setInterval(() => {
      process.stdout.write('still running\n')
    }, 1000)
  } else process.stdout.write('{"abi":8,"confined":true}\n')
} else if (args[1].includes('b1-test-')) {
  process.stderr.write('{"abi":8,"confined":true,"excluded":4}\n')
  process.stdout.write('B1_ALLOWED_CANARY')
} else {
  if (mode === 'malformed')
    process.stderr.write('{"abi":8,"confined":true,"excluded":0,"extra":true}\n')
  else process.stderr.write('{"abi":8,"confined":true,"excluded":0}\n')
  switch (mode) {
    case 'hang': {
      setInterval(() => {
        process.stdout.write('still running\n')
      }, 1000)
      break
    }
    case 'limit': {
      process.stdout.write('x'.repeat(3 * 1024 * 1024))
      break
    }
    case 'secret': {
      process.stdout.write('password = "synthetic-')
      setTimeout(() => process.stdout.write('sensitive-canary"'), 1)
      break
    }
    case 'stderrSecret': {
      process.stderr.write('password = "synthetic-sensitive-canary"')
      break
    }
    case 'failure': {
      process.exitCode = 125
      break
    }
    case 'killedAfterJson': {
      // A started program's own stderr line that looks like a helper verdict,
      // then death by signal: the runner must never read it as the verdict.
      process.stderr.write('{"refused":"operand"}\n')
      process.kill(process.pid, 'SIGABRT')
      break
    }
    default: {
      process.stdout.write('ordinary output')
      process.exitCode = 1
    }
  }
}
