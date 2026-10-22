import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { build, type BuildOptions } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JUDGE_REQUEST_TIMEOUT_MS } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { removeFolder } from './helpers/temporaryFolders'
import { REQUEST } from './judgeCliFixtures'

const folder = mkdtempSync(path.join(process.cwd(), '.m98g-cli-'))
const entry = path.join(folder, 'dist', 'acp.js')
beforeAll(async () => {
  mkdirSync(path.dirname(entry))
  const options: BuildOptions = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'judge-backend-tripwires',
        setup(builder) {
          builder.onLoad({ filter: /[/\\]runtime[/\\]backends\.ts$/ }, () => ({
            contents:
              'export function createRuntimeBackend() { throw new Error("BACKEND_STARTED"); }',
            loader: 'ts',
          }))
          builder.onLoad({ filter: /[/\\]acp[/\\]agent\.ts$/ }, () => ({
            contents: 'export function createAcpAgent() { throw new Error("ACP_STARTED"); }',
            loader: 'ts',
          }))
          builder.onLoad({ filter: /[/\\]core[/\\]judge[/\\]schema\.ts$/ }, (args) => ({
            contents: `if (process.env['M98_JUDGE_SCHEMA_TRIPWIRE'] === '1') throw new Error('JUDGE_SCHEMA_LOADED');\n${readFileSync(args.path, 'utf8')}`,
            resolveDir: path.dirname(args.path),
            loader: 'ts',
          }))
        },
      },
    ],
  }
  await build({ ...options, entryPoints: ['src/runtime/main.ts'], outfile: entry })
  await build({
    ...options,
    entryPoints: ['src/runtime/judge/judgeEntry.ts'],
    outfile: path.join(path.dirname(entry), 'judgeP2.js'),
  })
  writeFileSync(path.join(folder, 'package.json'), '{"version":"test"}')
  mkdirSync(path.join(folder, 'l10n'))
  copyFileSync('l10n/ui.fr.json', path.join(folder, 'l10n', 'ui.fr.json'))
})
afterAll(async () => {
  await removeFolder(folder)
})

function run(
  args: readonly string[],
  stdin: string,
  shouldEnd = true,
  shouldTripSchema = false,
  language = 'en_US.UTF-8',
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: folder,
      env: {
        PATH: process.env['PATH'],
        SystemRoot: process.env['SystemRoot'],
        LANG: language,
        M98_JUDGE_SCHEMA_TRIPWIRE: shouldTripSchema ? '1' : '0',
      },
      stdio: 'pipe',
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('judge subprocess exceeded its deadline'))
    }, JUDGE_REQUEST_TIMEOUT_MS)
    child.stdout.on('data', (bytes: Buffer) => {
      stdout += bytes.toString()
    })
    child.stderr.on('data', (bytes: Buffer) => {
      stderr += bytes.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    if (shouldEnd) child.stdin.end(stdin)
  })
}

describe('judge process dispatch', () => {
  it('keeps judge schemas lazy for ordinary ACP commands', async () => {
    const version = await run(['--version'], '', true, true)
    expect(version.code).toBe(0)
    expect(version.stdout.trim()).toBe('test')
    const serving = await run([], '', true, true)
    expect(serving.stderr).toContain('BACKEND_STARTED')
    expect(serving.stderr).not.toContain('JUDGE_SCHEMA_LOADED')
  })
  it('reserves judge ask without any backend or ACP startup', async () => {
    const result = await run(['judge', 'ask', '--model', 'chosen'], JSON.stringify(REQUEST))
    expect(result.code).toBe(4)
    expect(JSON.parse(result.stdout)).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
    expect(result.stderr).toBe('')
    expect(result.stdout + result.stderr).not.toMatch(
      /BACKEND_STARTED|ACP_STARTED|session\/|initialize/,
    )
  })
  it('refuses judge-looking malformed arguments at usage 2 without protocol output', async () => {
    for (const args of [['judge'], ['judge', 'hook'], ['judge', 'ask', 'a chat prompt']]) {
      const result = await run(args, '')
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toMatch(/BACKEND_STARTED|ACP_STARTED/)
    }
  })
  it('bounds stalled stdin in the real command process', async () => {
    const result = await run(
      ['judge', 'ask', '--model', 'chosen', '--timeout-ms', '100'],
      '',
      false,
    )
    expect(result.code).toBe(4)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toMatch(/BACKEND_STARTED|ACP_STARTED/)
  })
  it('serves MCP stdio without ACP frames or a chat backend', async () => {
    const result = await run(['judge', 'mcp'], '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('"name":"judge"')
    expect(result.stdout + result.stderr).not.toMatch(/BACKEND_STARTED|ACP_STARTED|session\//)
  })
  it('installs the CLI display language in the separately loaded MCP bundle', async () => {
    const french = z
      .object({ judgeNoAnswer: z.string() })
      .parse(JSON.parse(readFileSync('l10n/ui.fr.json', 'utf8')))
    const result = await run(
      ['judge', 'mcp'],
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'judge', arguments: REQUEST },
      })}\n`,
      true,
      false,
      'fr_FR.UTF-8',
    )
    expect(result.code).toBe(4)
    expect(result.stdout).toContain(fill(french.judgeNoAnswer, { reason: 'source-unavailable' }))
    expect(result.stderr).toBe('')
  })
})
