// Fake services only: real stdio framing, negotiation and document handling.
import { serveLsp } from '../../../src/runtime/lsp/server'
const transport = serveLsp(process.stdin, process.stdout, process.cwd(), {
  trusted: true,
  supportsReview: false,
  complete: (document, _position, _invoke, signal) =>
    document.text === 'busy'
      ? new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve(undefined)
            },
            { once: true },
          )
        })
      : Promise.resolve('completion🙂'),
  command: (command) => Promise.resolve({ command }),
})
async function main(): Promise<void> {
  await transport.closed
  process.stdin.destroy()
}
void main().catch(() => {
  process.exitCode = 1
})
