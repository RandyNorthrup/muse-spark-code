// Lane CM80CI: end-to-end runs of the exact template command
// (`node ci-templates/muse-spark-run.mjs`) in a container-free shell process
// with a fake agent binary, asserting the Action's outputs and exit codes:
// key over private stdin only, never in env/argv/logs, and refusal before
// any dispatch for untrusted sources. No network, no spend.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOnce } from '../../ci-templates/muse-spark-run.mjs'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '..', '..')
const RUNNER = path.join(ROOT, 'ci-templates', 'muse-spark-run.mjs')
const SECRET = 'LLM_e2e-fake-key-0123456789'

// A fake `muse-spark-code-acp`: records what it received (argv, whether the
// key leaked into its environment, the exact stdin bytes), prints one canned
// JSON result, and exits with FAKE_AGENT_EXIT. Runs under any Node.
const FAKE_AGENT = `import { writeFileSync } from 'node:fs';
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  writeFileSync(process.env.FAKE_AGENT_RECORD, JSON.stringify({
    argv: process.argv.slice(2),
    envHadKey: 'MUSE_SPARK_MODEL_API_KEY' in process.env,
    stdin: Buffer.concat(chunks).toString('utf8'),
  }));
  process.stdout.write(process.env.FAKE_AGENT_STDOUT ?? '{"v":1,"status":"completed"}');
  process.exit(Number(process.env.FAKE_AGENT_EXIT ?? '0'));
});
`

const state = { scratch: '', fakeAgent: '' }

function baseEnv(): Record<string, string> {
  return {
    MUSE_UNTRUSTED: 'false',
    MUSE_MODE: 'review',
    MUSE_MAX_BUDGET_USD: '2.00',
    MUSE_PROMPT: 'Review this workspace.',
    MUSE_AGENT_BIN: state.fakeAgent,
    MUSE_OUT_DIR: path.join(state.scratch, 'out'),
    MUSE_WORKSPACE: state.scratch,
    MUSE_SPARK_MODEL_API_KEY: SECRET,
    FAKE_AGENT_RECORD: path.join(state.scratch, 'record.json'),
    FAKE_AGENT_EXIT: '0',
  }
}

const record = () =>
  JSON.parse(readFileSync(path.join(state.scratch, 'record.json'), 'utf8')) as {
    argv: string[]
    envHadKey: boolean
    stdin: string
  }

beforeAll(() => {
  state.scratch = mkdtempSync(path.join(tmpdir(), 'muse-ci-templates-'))
  state.fakeAgent = path.join(state.scratch, 'fake-agent.mjs')
  writeFileSync(state.fakeAgent, FAKE_AGENT, 'utf8')
})

afterAll(() => {
  rmSync(state.scratch, { recursive: true, force: true })
})

describe('template run end to end', () => {
  it('pipes the key over private stdin only and propagates completed/0', async () => {
    const result = await runOnce({ ...baseEnv() })
    expect(result.exitCode).toBe(0)
    const seen = record()
    expect(seen.stdin).toBe(`${SECRET}\n`)
    expect(seen.envHadKey).toBe(false)
    expect(seen.argv.join(' ')).not.toContain(SECRET)
    expect(seen.argv.slice(0, 5)).toEqual(['exec', '--key-stdin', '--backend', 'modelApi', '--cwd'])
    expect(seen.argv).toContain('plan')
    expect(seen.argv.at(-1)).toBe('Review this workspace.')
    // runOnce hands stdout back; only the CLI entry archives result.json (covered below).
    expect(result.stdout).toContain('"status":"completed"')
  })

  it('maps fix mode and preserves nonzero exit codes', async () => {
    for (const code of [5, 9, 3]) {
      const env = {
        ...baseEnv(),
        MUSE_MODE: 'fix',
        FAKE_AGENT_EXIT: String(code),
        MUSE_OUT_DIR: path.join(state.scratch, `out-${String(code)}`),
      }
      const result = await runOnce(env)
      expect(result.exitCode).toBe(code)
      expect(result.stdout).toContain('"status":"completed"')
      expect(record().argv).toContain('acceptEdits')
    }
  })

  it('refuses untrusted sources before any dispatch', async () => {
    const env = { ...baseEnv(), MUSE_UNTRUSTED: 'fork-merge-request' }
    const result = await runOnce(env)
    expect(result.exitCode).toBe(0)
    expect(result.refused).toContain('fork-merge-request')
  })

  it('fails closed with missing key on a trusted run', async () => {
    const env = { ...baseEnv() }
    Reflect.deleteProperty(env, 'MUSE_SPARK_MODEL_API_KEY')
    const result = await runOnce(env)
    expect(result.exitCode).toBe(3)
  })

  it('the CLI entry writes run-summary.json and never prints the key', async () => {
    const outDir = path.join(state.scratch, 'out-cli')
    const env = {
      ...baseEnv(),
      MUSE_OUT_DIR: outDir,
      FAKE_AGENT_EXIT: '5',
      FAKE_AGENT_STDOUT: '{"v":1,"status":"budget_exceeded"}',
    }
    let combined = ''
    try {
      await execFileAsync(process.execPath, [RUNNER], { env, encoding: 'utf8' })
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'stdout' in error && 'stderr' in error) {
        if (typeof error.stdout === 'string') combined += error.stdout
        if (typeof error.stderr === 'string') combined += error.stderr
      }
    }
    expect(combined).not.toContain(SECRET)
    const summary = JSON.parse(readFileSync(path.join(outDir, 'run-summary.json'), 'utf8')) as {
      status: string
      exitCode: number
    }
    expect(summary).toEqual({ status: 'budget_exceeded', exitCode: 5 })
  })

  it('installs the exact pinned registry version through npm argv, keyless', async () => {
    const { installAgent } = await import('../../ci-templates/muse-spark-run.mjs')
    const calls: { command: string; argv: string[]; env: Record<string, string> }[] = []
    const fakeSpawn = (
      command: string,
      argv: string[],
      options: { env: Record<string, string> },
    ) => {
      calls.push({ command, argv, env: options.env })
      const handlers = new Map<string, (...args: unknown[]) => void>()
      return {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          handlers.set(event, handler)
          if (event === 'close') {
            queueMicrotask(() => {
              handler(0)
            })
          }
          return undefined
        },
        kill: () => undefined,
      }
    }
    const env = {
      MUSE_AGENT_VERSION: '0.17.0',
      MUSE_NPM_BIN: state.fakeAgent,
      MUSE_SPARK_MODEL_API_KEY: SECRET,
    }
    const result = await installAgent(env, { spawn: fakeSpawn })
    expect(result).toEqual({ exitCode: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.argv).toContain('muse-spark-code-acp@0.17.0')
    expect(calls[0]!.env).not.toContain('MUSE_SPARK_MODEL_API_KEY')
  })

  it('install refuses a tarball whose digest does not match', async () => {
    const { installAgent } = await import('../../ci-templates/muse-spark-run.mjs')
    const tarball = path.join(state.scratch, 'agent.tgz')
    writeFileSync(tarball, 'fake-tarball-bytes', 'utf8')
    const result = await installAgent({
      MUSE_AGENT_TARBALL: tarball,
      MUSE_AGENT_TARBALL_SHA256: '0'.repeat(64),
    })
    expect(result.exitCode).toBe(2)
    expect(result.error).toContain('digest mismatch')
  })
})
