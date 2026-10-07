import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseForeignResult } from '../../src/core/backends/modelapi/hookFormats'
import { JUDGE_REQUEST_TIMEOUT_MS } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { CAUTION, PAYLOAD, QUESTION, capture, riskOutcome } from './judgeHookCliFixtures'

const scratch = path.join(process.cwd(), 'temp')
mkdirSync(scratch, { recursive: true })
const folder = mkdtempSync(path.join(scratch, 'm98gh-stdio-'))
const entry = path.join(folder, 'hook.mjs')

beforeAll(async () => {
  // This is a test-only assembly of the actual GH/G code, not G's pending
  // product dispatcher or an installed npm command/support claim.
  const bundle = await build({
    stdin: {
      contents: `
        import { parseJudgeArgs } from './src/runtime/judge/args';
        import { runJudgeHookCommand } from './src/runtime/judge/hook';
        import { runJudgeCommand } from './src/runtime/judge/commands';
        import { createFdWriter } from './src/runtime/exec/fdWriter';
        const controller = new AbortController();
        const io = {
          stdin: process.stdin,
          stdout: createFdWriter(1, () => controller.abort()),
          stderr: createFdWriter(2, () => controller.abort()),
        };
        const command = parseJudgeArgs(['judge', 'ask', ...process.argv.slice(3)]);
        if (command.command !== 'judge') process.exitCode = 2;
        else {
          const outcome = ${JSON.stringify(riskOutcome())};
          process.exitCode = await runJudgeHookCommand(
            command.options, { format: process.argv[2] }, io, {
              runAsk: runJudgeCommand,
              question: ${JSON.stringify(QUESTION)},
              cautionText: () => ${JSON.stringify(CAUTION)},
              resolveSource: async (options) => options.separate === 'unavailable' ? undefined : ({
                source: 'same', model: 'chosen',
                billing: options.separate === 'paid' ? 'paid' : 'free',
                worstCaseUsd: () => 0.01,
                runtime: { judge: async () => outcome },
              }),
            }, controller.signal,
          );
        }
      `,
      resolveDir: process.cwd(),
      sourcefile: 'test/unit/judgeHookCliProcess.entry.ts',
      loader: 'ts',
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    metafile: true,
    logLevel: 'silent',
  })
  expect(Object.keys(bundle.metafile.inputs).join('\n')).not.toMatch(
    /src\/runtime\/backends\.ts|src\/acp\/agent\.ts/,
  )
})
afterAll(async () => {
  await removeFolder(folder)
})

function run(format: string, payload: string, args: readonly string[] = [], shouldEnd = true) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, format, '--model', 'chosen', ...args], {
      cwd: folder,
      env: {
        PATH: process.env['PATH'],
        SystemRoot: process.env['SystemRoot'],
        LANG: 'en_US.UTF-8',
      },
      stdio: 'pipe',
    })
    const output = { stdout: '', stderr: '' }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('fake hook process exceeded its deadline'))
    }, JUDGE_REQUEST_TIMEOUT_MS)
    for (const name of ['stdout', 'stderr'] as const) {
      child[name].setEncoding('utf8')
      child[name].on('data', (chunk: string) => {
        output[name] += chunk
      })
    }
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, ...output })
    })
    if (shouldEnd) child.stdin.end(payload)
  })
}

describe('judge hook built fake-only stdio assembly', () => {
  it('writes native caution JSON on real Node pipes without ACP or a chat backend', async () => {
    const result = await run('muse', JSON.stringify(PAYLOAD))
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      systemMessage: CAUTION,
      hookSpecificOutput: { permissionDecision: 'ask' },
    })
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toMatch(/jsonrpc|session\/|"allow"|"deny"/)
    const gemini = await run(
      'gemini',
      JSON.stringify(capture('gemini/BeforeTool.run_shell_command.json')),
    )
    expect(gemini.code).toBe(0)
    expect(JSON.parse(gemini.stdout)).toMatchObject({ systemMessage: CAUTION })
  })
  it('keeps input errors explicit and paid-admission refusal neutral without protocol output', async () => {
    for (const args of [[], ['--budget-usd', '1']]) {
      const result = await run('muse', JSON.stringify(PAYLOAD), ['--separate', 'paid', ...args])
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
    }
    const unavailable = await run('muse', JSON.stringify(PAYLOAD), ['--separate', 'unavailable'])
    expect(unavailable.code).toBe(0)
    expect(unavailable.stdout).toBe('')
    const malformed = await run('muse', '{private-input')
    expect(malformed.code).toBe(2)
    expect(malformed.stdout).toBe('')
    expect(malformed.stderr).not.toContain('private-input')
  })
  it('keeps Gemini and Copilot no-answer nonblocking on real pipes', async () => {
    for (const format of ['gemini', 'copilot'] as const) {
      const payload =
        format === 'gemini'
          ? capture('gemini/BeforeTool.run_shell_command.json')
          : { ...PAYLOAD, tool_name: 'Bash' }
      for (const source of ['paid', 'unavailable']) {
        const result = await run(format, JSON.stringify(payload), ['--separate', source])
        expect(result.code).toBe(0)
        expect(result.stdout).toBe('')
        expect(result.stderr).toBe('')
        expect(
          parseForeignResult(
            format,
            'PreToolUse',
            result.code ?? -1,
            result.stdout,
            result.stderr,
            { sourceEvent: format === 'gemini' ? 'BeforeTool' : 'PreToolUse' },
          ).status,
        ).toBe('completed')
      }
    }
  })
  it('bounds a real stdin pipe which never reaches EOF', async () => {
    const result = await run('muse', '', ['--timeout-ms', '20'], false)
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toMatch(/jsonrpc|session\//)
  })
})
