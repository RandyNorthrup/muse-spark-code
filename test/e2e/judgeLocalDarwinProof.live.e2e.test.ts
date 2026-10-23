// Native metadata capture only: no inference, model loading or pull.
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { darwinPeerDependencies } from '../../src/core/judge/local/darwinPeer'
import { posixPeer } from '../../src/core/judge/local/posixPeer'
import { localEndpoint, requestLocal } from '../../src/core/judge/local/transport'
import capture from '../unit/fixtures/localJudgeDarwinCapture.json'

const execute = promisify(execFile)
describe.skipIf(
  process.platform !== 'darwin' || process.env['MUSE_LOCAL_JUDGE_DARWIN_PROOF'] !== '1',
)('M98 real lsof/libproc native metadata receipt', () => {
  it('captures numeric NUL fields and exact libproc evidence on the held socket before HTTP', async () => {
    const root = path.resolve('temp/m98-j3')
    const helper = path.resolve('native/darwin/muse-local-judge-peer')
    const getUid = process.getuid
    const uid = getUid?.()
    if (uid === undefined) throw new Error('missing caller uid')
    const installed = {
      platform: 'darwin' as const,
      uid,
      executable: path.join(root, 'install/Ollama.app/Contents/Resources/ollama'),
      executableDigest: capture.executableDigest,
      modelDirectory: path.join(root, 'models'),
    }
    const deps = darwinPeerDependencies(helper, installed)
    const signal = new AbortController().signal
    const endpoint = await localEndpoint('http://127.0.0.1:11434')
    const beforeLedger = await readFile(path.join(root, 'calls.json'), 'utf8')
    let evidence: unknown
    await requestLocal(
      endpoint,
      '/api/tags',
      async (socket) => {
        const peer: unknown = JSON.parse(await posixPeer(socket, installed, deps, signal))
        const owner = z
          .object({ pid: z.number().int().positive(), creationTime: z.string() })
          .parse(peer)
        const { stdout } = await execute(
          '/usr/sbin/lsof',
          ['-nP', '-a', '-p', String(owner.pid), '-i4TCP', '-sTCP:ESTABLISHED', '-F0pufnT'],
          { env: {}, signal, timeout: 30_000, maxBuffer: 65_536 },
        )
        const tuple = `127.0.0.1:11434->127.0.0.1:${String(socket.localPort)}`
        expect(stdout).toContain(`n${tuple}\0`)
        const native = await new Promise<string>((resolve, reject) => {
          const child = execFile(
            helper,
            ['lease', String(owner.pid)],
            { env: {}, signal, timeout: 30_000, maxBuffer: 65_536 },
            (error, output) => {
              if (error) reject(new Error('native-helper-failed', { cause: error }))
              else resolve(output)
            },
          )
          child.stdin?.end()
        })
        const decoded: unknown = JSON.parse(native)
        const identity = z
          .object({
            pid: z.number(),
            uid: z.number(),
            realUid: z.number(),
            creationTime: z.string(),
          })
          .parse(decoded)
        expect(identity).toMatchObject({
          pid: owner.pid,
          uid,
          realUid: uid,
          creationTime: owner.creationTime,
        })
        const volume = await execute(helper, ['volume', installed.modelDirectory], {
          env: {},
          signal,
          timeout: 30_000,
          maxBuffer: 65_536,
        })
        expect(socket.bytesWritten).toBe(0)
        evidence = {
          tuple,
          lsofNulFields: stdout,
          libproc: decoded,
          volume: JSON.parse(volume.stdout),
          bytesWrittenBeforeHttp: socket.bytesWritten,
          inferenceAttempts: 0,
        }
      },
      undefined,
      { signal },
    )
    expect(await readFile(path.join(root, 'calls.json'), 'utf8')).toBe(beforeLedger)
    const scrubbed = JSON.stringify(evidence).replaceAll(
      installed.executable,
      '<rig-install>/Ollama.app/Contents/Resources/ollama',
    )
    await writeFile(
      path.resolve('test/unit/fixtures/localJudgeDarwinNativeCapture.json'),
      JSON.stringify(JSON.parse(scrubbed), null, 2) + '\n',
    )
  })
})
