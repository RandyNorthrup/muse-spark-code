// Native only; bounded, sequential fork/wait. No networking or inference.
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const execute = promisify(execFile)
describe.skipIf(process.platform !== 'darwin')('M98 native macOS actual PID reuse', () => {
  it('keeps the original kernel watch invalid after the PID is reused', async () => {
    await mkdir(path.resolve('temp/m98-j3'), { recursive: true })
    const helper = path.resolve('temp/m98-j3/darwin-pid-reuse')
    await execute(
      '/usr/bin/xcrun',
      [
        'clang',
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        'test/unit/helpers/localJudgeDarwin.c',
        '-lproc',
        '-o',
        helper,
      ],
      { env: {} },
    )
    const child = spawn(helper, ['reuse'], {
      env: {},
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 110_000,
      killSignal: 'SIGKILL',
    })
    const exited = once(child, 'exit')
    const reader = createInterface({ input: child.stdout })
    const lines = reader[Symbol.asyncIterator]()
    const start = performance.now()
    try {
      const first = await lines.next()
      const pid = z.coerce.number().int().positive().parse(first.value)
      child.stdin.write('go\n')
      const line = await lines.next()
      if (line.done) throw new Error('native PID cycle did not produce evidence')
      const decoded: unknown = JSON.parse(line.value)
      const receipt = z
        .object({
          pid: z.number().int().positive(),
          attempts: z.number().int().positive(),
          differentStart: z.boolean(),
          exitWatchStillInvalid: z.boolean(),
          beforeCreationTime: z.string(),
          afterCreationTime: z.string(),
        })
        .parse(decoded)
      await writeFile(
        path.resolve('temp/m98-j3/pid-reuse.json'),
        JSON.stringify({ ...receipt, elapsedMs: performance.now() - start }, null, 2) + '\n',
      )
      child.stdin.end('done\n')
      const exit = await exited
      expect(exit[0]).toBe(0)
      expect(receipt.pid).toBe(pid)
      expect(receipt.differentStart).toBe(true)
      expect(receipt.exitWatchStillInvalid).toBe(true)
      expect(receipt.beforeCreationTime).not.toBe(receipt.afterCreationTime)
    } finally {
      child.kill('SIGKILL')
      reader.close()
    }
  })
})
