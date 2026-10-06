// OS1-C-SERVICE: C/A1/M104 supply the real NodeServiceBinding as an immutable
// image input. There is no fallback verifier, tool host, vault codec or engine.
import { runNodeArgs } from '../muse-spark-code/dist/node.js'
import { EN } from '../muse-spark-code/dist/uiText.js'
import { binding } from './service-binding.mjs'

const abort = new globalThis.AbortController()
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => abort.abort())
process.exitCode = await runNodeArgs(
  ['serve', '--data-root', '/var/lib/muse-spark-code-node'],
  {
    root: '/var/lib/muse-spark-code-node',
    signal: abort.signal,
    binding,
    now: Date.now,
    print: (line) => process.stdout.write(`${line}\n`),
    readSecret: async () => {
      throw new Error('OS1-C-LOCAL-CONTROL is required')
    },
  },
  EN,
  'en',
)
