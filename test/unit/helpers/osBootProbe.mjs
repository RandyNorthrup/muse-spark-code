// QEMU qualification ONLY. Never staged into a product image by os/build.py.
// The real installed node service and health implementation run against
// synthetic state, with no auth/engine/tools integration or paid request.
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createServer, get } from 'node:http'
import { z } from 'zod'
import { NodeStateStore } from '../../../src/runtime/node/state'
import { nodeState } from './node/records'
import { FixtureCodec } from './nodeVaultCodec'

export async function runOsBootProbe({ NodeService, nodeHealth }) {
  if (process.platform !== 'linux' || process.getuid() !== 61_100)
    throw new Error('OS1 wrong service UID')
  const state = new NodeStateStore('/var/lib/muse-spark-code-node')
  for (const unit of ['systemd-resolved.service', 'systemd-networkd.service'])
    execFileSync('/usr/bin/systemctl', ['is-active', '--quiet', unit])
  const initial = nodeState()
  initial.setup = null
  initial.auditHead = { seq: 0, hash: '0'.repeat(64) }
  await state.initialize(initial)
  const service = new NodeService(state, {
    clock: { now: Date.now, monotonicMs: () => globalThis.performance.now() },
    vaultCodec: new FixtureCodec(),
    createResources: () => Promise.reject(new Error('OS1 probe never starts tools')),
    endSessions: () => Promise.resolve(),
  })
  await service.boot()
  if (!service.keys.isSealed || service.attendance.sessions().length > 0)
    throw new Error('OS1 boot did not seal keys/end sessions')
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url !== '/readyz') {
        response.writeHead(404).end()
        return
      }
      const result = await nodeHealth('/readyz', {
        state,
        journalsReadable: async () => {
          await state.load()
          return true
        },
        isKeyStoreSealed: () => service.keys.isSealed,
        keysNeeded: () => false,
      })
      response.writeHead(result.status, { 'Content-Type': 'text/plain' }).end(result.word)
    })().catch(() => response.writeHead(503).end('not-ready'))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('OS1 no health socket')
  const ready = await new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${address.port}/readyz`, (response) => {
      let word = ''
      response.on('data', (bytes) => {
        word += String(bytes)
      })
      response.on('end', () =>
        resolve(
          z.object({ status: z.literal(200), word: z.literal('ready') }).safeParse({
            status: response.statusCode,
            word,
          }).success,
        ),
      )
      response.on('error', reject)
    }).on('error', reject)
  })
  if (!ready) throw new Error('OS1 real /readyz did not pass')
  const mounts = await readFile('/proc/mounts', 'utf8')
  const usr = mounts.split('\n').find((line) => line.split(' ', 2)[1] === '/usr')
  if (
    usr === undefined ||
    !usr.startsWith('/dev/mapper/') ||
    !usr.split(' ', 4)[3].split(',').includes('ro')
  )
    throw new Error('OS1 /usr is not a read-only device mapper mount')
  await writeFile('/var/lib/muse-spark-code-node/os1-private-canary', 'os1-private-canary', {
    mode: 0o600,
  })
  await service.shutdown()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  process.stdout.write('OS1_READY_OK sealed unattended verified-usr uid=61100\n')
}
