// Packed-product proof for lane LIMITSB: the production bundles built by
// `node scripts/build.mjs --production` (`dist/acp.js` `exec` on the Model API
// backend) against a stand-in provider that replays the wire exchange
// (fakeModelApi over a test-owned preloaded fetch, test-owned keyring). No
// network, no paid calls, no fake of our own code: every tool below executes
// in the packed build against a real workspace.
// - (a) a reply longer than one max-output window arrives whole, through a
//   visible continuation;
// - (b) a 30 MiB file is read in byte ranges end to end;
// - (c) a clipped search, file list and file read each name the offset that
//   fetches the rest, and the follow-up calls return it.
// Web pages and diagnostics paging stay at unit level: web_fetch refuses
// private addresses (no loopback page without network), and the headless run
// offers no language service. Both are covered by test/unit/webFetch.test.ts
// and test/unit/diagnostics*.test.ts against the same packed code paths.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import * as z from 'zod/mini'
import {
  execEventV2Schema,
  validateResult,
  type ExecEvent,
  type ExecResult,
} from '../../src/runtime/exec/execProtocol'
import { PRODUCTION_BUILD_KEY, buildProductionPackage } from '../unit/helpers/productionPackage'
import { removeFolder } from '../unit/helpers/temporaryFolders'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SCRATCH = process.env['TMPDIR'] ?? tmpdir()
const WORK = mkdtempSync(path.join(SCRATCH, 'limits-output-'))
const BUILD_ROOT = path.join(WORK, 'build')
const AGENT = path.join(BUILD_ROOT, 'dist', 'acp.js')
const PRELOAD = path.join(WORK, 'preload.cjs')
const ARTIFACTS = path.join(SCRATCH, 'limits-artifacts')
const KEY = 'LLM|1|limits-output-proof-key'
// Genuinely long operations: a production build plus packed headless turns.
// Named per-test timeouts with reasons, as the rig rules require.
const BUILD_TIMEOUT_MS = 300_000
const TURN_TIMEOUT_MS = 120_000
const children: ChildProcessWithoutNullStreams[] = []

afterAll(async () => {
  for (const child of children) child.kill()
  await removeFolder(WORK)
})

function workspace(name: string): string {
  const dir = path.join(WORK, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function finalResult(stdout: string): ExecResult {
  const events = stdout
    .trim()
    .split('\n')
    .map((line) => execEventV2Schema.parse(JSON.parse(line)))
  const finals = events.filter((event) => event.type === 'result')
  expect(finals).toHaveLength(1)
  const final = finals[0]
  if (final?.type !== 'result') throw new Error('missing final result')
  return validateResult(final.result)
}

const proofRequestSchema = z.looseObject({ path: z.string(), body: z.optional(z.unknown()) })
const proofReportSchema = z.looseObject({ requests: z.array(proofRequestSchema) })

function proofReport(caseName: string): readonly z.infer<typeof proofRequestSchema>[] {
  const parsed = proofReportSchema.safeParse(
    JSON.parse(readFileSync(path.join(WORK, `${caseName}.report.json`), 'utf8')),
  )
  if (!parsed.success) throw new Error(`bad proof report for ${caseName}`)
  return parsed.data.requests
}

const responseBodySchema = z.looseObject({ input: z.optional(z.array(z.unknown())) })

function responseBodies(caseName: string): readonly z.infer<typeof responseBodySchema>[] {
  const bodies: z.infer<typeof responseBodySchema>[] = []
  for (const request of proofReport(caseName)) {
    if (request.path !== '/responses') continue
    const parsed = responseBodySchema.safeParse(request.body)
    if (parsed.success) bodies.push(parsed.data)
  }
  return bodies
}

/**
 * Every tool result the packed run's latest request sent back to the
 * provider, in order. Earlier requests replay the same outputs, so only the
 * last request's carry the complete set exactly once. Later requests carry
 * earlier results packed (first and last lines plus a recall note); the
 * request right after each call carries it whole.
 */
function toolOutputs(caseName: string): readonly string[] {
  const bodies = responseBodies(caseName)
  return outputsIn(bodies.at(-1))
}

/** Every tool result in every request, oldest first. */
function allToolOutputs(caseName: string): readonly string[] {
  return responseBodies(caseName).flatMap((body) => outputsIn(body))
}

const callOutputSchema = z.looseObject({
  type: z.literal('function_call_output'),
  output: z.unknown(),
})

function outputsIn(body: z.infer<typeof responseBodySchema> | undefined): readonly string[] {
  const outputs: string[] = []
  const input = body?.input ?? []
  for (const item of input) {
    const parsed = callOutputSchema.safeParse(item)
    if (!parsed.success) continue
    const output = parsed.data.output
    outputs.push(typeof output === 'string' ? output : JSON.stringify(output))
  }
  return outputs
}

async function runCase(
  caseName: string,
  prompt: string,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const reportPath = path.join(WORK, `${caseName}.report.json`)
  rmSync(reportPath, { force: true })
  const child = spawn(
    process.execPath,
    [
      '--require',
      PRELOAD,
      AGENT,
      'exec',
      '--backend',
      'modelApi',
      '--model',
      'muse-spark-1.3-contributor',
      '--allow-contributor-models',
      '--max-budget-usd',
      '1.00',
      '--max-requests',
      '40',
      '--ephemeral',
      '--key-stdin',
      '--output',
      'jsonl',
      prompt,
    ],
    {
      cwd,
      env: {
        PATH: process.env['PATH'],
        HOME: WORK,
        USERPROFILE: WORK,
        XDG_DATA_HOME: WORK,
        LOCALAPPDATA: WORK,
        LANG: 'C',
        LC_ALL: 'C',
        NODE_PATH: path.join(ROOT, 'node_modules'),
        LIMITS_CASE: caseName,
        LIMITS_REPORT: reportPath,
        LIMITS_KEY: KEY,
      },
      stdio: 'pipe',
    },
  )
  children.push(child)
  child.stdin.end(`${KEY}\n`)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  mkdirSync(ARTIFACTS, { recursive: true })
  writeFileSync(path.join(ARTIFACTS, `${caseName}.json`), JSON.stringify({ code, stdout, stderr }))
  return { code, stdout, stderr }
}

beforeAll(() => {
  buildProductionPackage(ROOT, BUILD_ROOT, inject(PRODUCTION_BUILD_KEY))
  expect(AGENT.endsWith(path.join('dist', 'acp.js'))).toBe(true)
}, BUILD_TIMEOUT_MS)

beforeAll(async () => {
  // The stand-in provider: fakeModelApi's replayed exchange over a preloaded
  // fetch, the run's own key on the wire swapped for the fake's (as M80's
  // E3/E4), and every request body on disk for the assertions. The keyring is
  // test-owned; no OS store opens.
  await build({
    stdin: {
      contents: `
        import Module from 'node:module';
        import { writeFileSync } from 'node:fs';
        import { fakeModelApi, FAKE_MODEL_API_KEY } from ${JSON.stringify(path.join(ROOT, 'test/unit/helpers/fakeModelApi.ts'))};
        const key = process.env.LIMITS_KEY ?? '';
        const reportPath = process.env.LIMITS_REPORT ?? '';
        const api = fakeModelApi();
        api.models = ['muse-spark-1.3-contributor'];
        const usage = { input: 10, output: 5 };
        const readRange = (offset, length) => ({
          name: 'read_file',
          arguments: JSON.stringify({ path: 'big.txt', byteOffset: offset, byteLength: length }),
        });
        // The tool cap is 1 MiB a window (TOOL_FILE_RANGE_MAX_BYTES): thirty
        // windows cover the 30 MiB file end to end.
        const MIB = 1024 * 1024;
        switch (process.env.LIMITS_CASE ?? '') {
          case 'continuation':
            api.script(
              { text: 'PART-ONE ', incomplete: { reason: 'max_output_tokens' }, usage },
              { text: 'PART-TWO', usage },
            );
            break;
          case 'ranges':
            api.script(
              ...Array.from({ length: 30 }, (_, index) => ({
                calls: [readRange(index * MIB, MIB)],
                usage,
              })),
              { text: 'ranges done', usage },
            );
            break;
          case 'pages':
            api.script(
              { calls: [{ name: 'search', arguments: JSON.stringify({ pattern: 'needle', max_results: 5 }) }], usage },
              { calls: [{ name: 'search', arguments: JSON.stringify({ pattern: 'needle', max_results: 5, offset: 5 }) }], usage },
              { calls: [{ name: 'list_files', arguments: JSON.stringify({ limit: 5 }) }], usage },
              { calls: [{ name: 'list_files', arguments: JSON.stringify({ limit: 5, offset: 5 }) }], usage },
              { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'long.txt', limit: 10 }) }], usage },
              { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'long.txt', offset: 11 }) }], usage },
              { text: 'pages done', usage },
            );
            break;
        }
        const FAKE_KEYRING = 'file:///limits-test-owned-keyring.mjs';
        Module.registerHooks({
          resolve(specifier, context, nextResolve) {
            if (specifier === '@napi-rs/keyring') return { url: FAKE_KEYRING, shortCircuit: true };
            return nextResolve(specifier, context);
          },
          load(url, context, nextLoad) {
            if (url !== FAKE_KEYRING) return nextLoad(url, context);
            return {
              format: 'module',
              shortCircuit: true,
              source: 'export class AsyncEntry { getPassword() { return Promise.resolve(' + JSON.stringify(key) + ') } setPassword() { return Promise.resolve() } deletePassword() { return Promise.resolve(true) } }',
            };
          },
        });
        globalThis.fetch = (url, init) => {
          const headers = new Headers(init?.headers);
          if (headers.get('authorization') !== 'Bearer ' + key) {
            return Promise.resolve(Response.json({ error: { message: 'bad key', type: 'authentication_error' } }, { status: 401 }));
          }
          headers.set('authorization', 'Bearer ' + FAKE_MODEL_API_KEY);
          return api.fetch(url, { ...init, headers: Object.fromEntries(headers) });
        };
        process.on('exit', () => writeFileSync(reportPath, JSON.stringify({ requests: api.requests })));
      `,
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile: PRELOAD,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  })
}, BUILD_TIMEOUT_MS)

describe('limits-output packed proof', () => {
  it(
    '(a) a reply past one max-output window arrives whole through a visible continuation',
    async () => {
      const dir = workspace('continuation')
      const run = await runCase('continuation', 'Reply with the two parts.', dir)
      expect(run.code, run.stderr).toBe(0)
      const result = finalResult(run.stdout)
      expect(result.status).toBe('completed')
      // Both windows arrive as complete messages: the first window is no
      // longer withheld once the continuation finishes it.
      const events = run.stdout
        .trim()
        .split('\n')
        .map((line) => execEventV2Schema.parse(JSON.parse(line)))
      const texts = events
        .filter(
          (event): event is Extract<ExecEvent, { type: 'message' }> =>
            event.type === 'message' && event.kind === 'agentMessage' && event.complete,
        )
        .map((event) => event.text)
      expect(texts.join('')).toBe('PART-ONE PART-TWO')
      expect(run.stderr).toContain('incomplete: max_output_tokens')
      const bodies = responseBodies('continuation')
      expect(bodies.length).toBe(2)
      expect(JSON.stringify(bodies[1])).toContain('PART-ONE')
    },
    TURN_TIMEOUT_MS,
  )

  it(
    '(b) a 30 MiB file is read in byte ranges end to end',
    async () => {
      const dir = workspace('ranges')
      const size = 30 * 1024 * 1024
      const bytes = Buffer.alloc(size)
      for (let index = 0; index < size; index += 1) bytes[index] = 65 + (index % 26)
      writeFileSync(path.join(dir, 'big.txt'), bytes)
      const run = await runCase('ranges', 'Read big.txt in thirty 1 MiB ranges.', dir)
      expect(run.code, run.stderr).toBe(0)
      // The last request replays all thirty results packed; each request
      // right after its call carries that window whole.
      const outputs = toolOutputs('ranges')
      expect(outputs.length).toBe(30)
      expect(outputs.join('\n')).toContain('recall_output')
      const whole = allToolOutputs('ranges')
      const MIB = 1024 * 1024
      const dash = '–'
      for (let index = 0; index < 30; index += 1) {
        const first = index * MIB
        const last = (index + 1) * MIB
        const header = `bytes ${String(first)}${dash}${String(last)} of ${String(size)}`
        let start = ''
        for (let at = 0; at < 20; at += 1) start += String.fromCodePoint(65 + ((first + at) % 26))
        const window = whole.find((output) => output.includes(header) && output.includes(start))
        expect(window, `range ${String(index)}`).toBeDefined()
        if (index < 29) expect(window).toContain(`byteOffset ${String(last)} for the rest`)
        else expect(window).toContain('end of file')
      }
    },
    TURN_TIMEOUT_MS,
  )

  it(
    '(c) clipped search, file list and file read name the offset that fetches the rest',
    async () => {
      const dir = workspace('pages')
      for (let index = 0; index < 12; index += 1)
        writeFileSync(
          path.join(dir, `file-${String(index)}.txt`),
          `line with needle ${String(index)}\n`,
        )
      writeFileSync(
        path.join(dir, 'long.txt'),
        Array.from({ length: 40 }, (_, index) => `numbered line ${String(index)}`).join('\n'),
      )
      const run = await runCase('pages', 'Page through the matches, files and lines.', dir)
      expect(run.code, run.stderr).toBe(0)
      const outputs = toolOutputs('pages')
      expect(outputs.length).toBe(6)
      const [searchFirst, searchRest, listFirst, listRest, readFirst, readRest] = outputs
      expect(searchFirst).toContain(
        '[matches 1-5 of 12; call search again with offset 5 for the rest]',
      )
      expect(searchFirst).not.toContain('needle 5')
      expect(searchRest).toContain(
        '[matches 6-10 of 12; call search again with offset 10 for the rest]',
      )
      expect(searchRest).toContain('needle 5')
      expect(listFirst).toContain('call list_files again with offset 5 for the rest')
      expect(listFirst).not.toContain('long.txt')
      expect(listRest).toContain('file-5')
      expect(readFirst).toContain('[lines 1-10 of 40; offset=11]')
      expect(readRest).toContain('numbered line 10')
    },
    TURN_TIMEOUT_MS,
  )
})
