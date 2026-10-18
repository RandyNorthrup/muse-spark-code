// M124 (D106): `muse-spark-code-acp mcp` as a client launches it: a real
// process speaking MCP over real stdio, with a fake client and a temporary
// data folder. No model, key, network or browser is used.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONNECTOR_SCHEMA_VERSION, PROMPT_USER_FOLDER, UI_TEXT } from '../../src/shared/constants'
import { serialisePromptFile } from '../../src/shared/prompts'

const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'm124-connector-e2e-')))
const agent = path.join(directory, 'dist', 'acp.js')
const data = path.join(directory, 'data')
const CANARY = 'sk-proj-canary0123456789abcdefghijklmnop'
const env = {
  SystemRoot: process.env['SystemRoot'],
  LANG: 'en_US.UTF-8',
  LC_ALL: '',
  LOCALAPPDATA: data,
  XDG_DATA_HOME: data,
  HOME: directory,
  USERPROFILE: directory,
  META_API_KEY: CANARY,
}

function dataFolder(): string {
  if (process.platform === 'win32') return path.join(data, 'Muse Spark Code')
  return process.platform === 'darwin'
    ? path.join(directory, 'Library', 'Application Support', 'Muse Spark Code')
    : path.join(data, 'muse-spark-code')
}

beforeAll(async () => {
  await mkdir(path.dirname(agent), { recursive: true })
  const common = {
    bundle: true,
    platform: 'node' as const,
    format: 'cjs' as const,
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent' as const,
  }
  await build({ ...common, entryPoints: [path.resolve('src/runtime/main.ts')], outfile: agent })
  await build({
    ...common,
    entryPoints: [path.resolve('src/runtime/connector/entry.ts')],
    outfile: path.join(directory, 'dist', 'connector.js'),
  })
  // The real M113 engine behind muse_report (RVM124 P2-11).
  await build({
    ...common,
    entryPoints: [path.resolve('src/runtime/reporting/reportsEntry.ts')],
    outfile: path.join(directory, 'dist', 'reporting.js'),
  })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '0.0.0-test' }))
  await cp(path.resolve('l10n'), path.join(directory, 'l10n'), { recursive: true })
})
afterAll(async () => {
  expect(path.dirname(path.resolve(directory))).toBe(realpathSync(os.tmpdir()))
  await rm(directory, { recursive: true, force: true })
})

/**
 * One session: frames in; stdin stays open until `replies` lines arrived (a
 * client closes stdin to disconnect, which stops calls still in flight).
 */
function session(frames: readonly string[], replies: number, connection = 'default') {
  return new Promise<{ lines: string[]; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [agent, 'mcp', '--connection', connection], { env })
      let stdout = ''
      let stderr = ''
      const lines = () => stdout.split('\n').filter((line) => line !== '')
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
        if (lines().length >= replies) child.stdin.end()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', reject)
      child.on('close', (code) => {
        resolve({ lines: lines(), stderr, code })
      })
      for (const frame of frames) child.stdin.write(`${frame}\n`)
    },
  )
}

const json = (message: unknown) => JSON.stringify(message)
const INIT = json({
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake' } },
})
const call = (id: number, name: string, args: unknown) =>
  json({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })

function byId(lines: readonly string[]) {
  const replies = new Map<unknown, Record<string, unknown>>()
  for (const line of lines) {
    const reply = JSON.parse(line) as Record<string, unknown>
    replies.set(reply['id'], reply)
  }
  return replies
}
function structured(reply: Record<string, unknown> | undefined) {
  return (reply?.['result'] as { structuredContent: Record<string, unknown> }).structuredContent
}

async function grant(
  scopes: readonly string[],
  hasContent = true,
  connection = 'default',
): Promise<void> {
  const folder = path.join(dataFolder(), 'connector', 'grants')
  await mkdir(folder, { recursive: true })
  await writeFile(
    path.join(folder, `${connection}.json`),
    json({
      schemaVersion: CONNECTOR_SCHEMA_VERSION,
      connectionId: connection,
      generation: 1,
      createdAt: '2026-10-09T00:00:00.000Z',
      revoked: false,
      scopes,
      userLibrary: true,
      paidCapMicrousd: 0,
      workspaces: [{ id: 'ws-test', root: directory, label: 'repo', content: hasContent }],
    }),
  )
}

describe('M124 connector over real stdio', () => {
  it('speaks only MCP on stdout and refuses everything without a grant', async () => {
    const result = await session(
      [
        INIT,
        json({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        json({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        call(2, 'muse_prompt_list', { scope: 'user' }),
        call(3, 'muse_fleet_status', {}),
        '{not json',
        'x'.repeat(70_000),
        json({ jsonrpc: '2.0', id: 4, method: 'ping' }),
      ],
      7,
    )
    expect(result.code).toBe(0)
    for (const line of result.lines) expect(() => JSON.parse(line) as unknown).not.toThrow()
    const replies = byId(result.lines)
    expect(replies.get(0)).toMatchObject({
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'muse-spark-code' } },
    })
    expect(replies.get(1)).toMatchObject({ result: { tools: [] } })
    expect(structured(replies.get(2))).toMatchObject({ status: 'refused', reason: 'forbidden' })
    expect(structured(replies.get(3))).toMatchObject({ status: 'refused', reason: 'unavailable' })
    expect(replies.get(4)).toMatchObject({ result: {} })
    const errors = result.lines.map((line) => JSON.parse(line) as { error?: { code: number } })
    expect(errors.some((reply) => reply.error?.code === -32_700)).toBe(true)
    expect(errors.some((reply) => reply.error?.code === -32_001)).toBe(true)
    // Each frame refused before a call existed left one transport receipt (RVM124B P2-4).
    const journal = await readFile(
      path.join(dataFolder(), 'connector', 'audit', 'default.jsonl'),
      'utf8',
    )
    const receipts = journal
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; rpcCode?: number })
    expect(
      receipts
        .filter((receipt) => receipt.event === 'transport')
        .map((receipt) => receipt.rpcCode ?? 0)
        .toSorted((left, right) => left - right),
    ).toEqual([-32_700, -32_001])
  })

  it('serves granted reads scrubbed and refuses ungranted writes', async () => {
    await grant(['prompts:read', 'content:read', 'operations:read', 'control:stop'])
    const id = 'prompt-canary'
    const prompts = path.join(dataFolder(), PROMPT_USER_FOLDER)
    await mkdir(prompts, { recursive: true })
    await writeFile(
      path.join(prompts, `${createHash('sha256').update(id).digest('hex')}.md`),
      serialisePromptFile({
        schemaVersion: 1,
        id,
        title: 'Canary',
        tags: [],
        variables: [],
        scope: 'user',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        untrusted: false,
        body: `Use ${CANARY} from ${path.join(directory, 'private', 'notes.txt')}`,
      }),
    )
    const result = await session(
      [
        INIT,
        json({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        call(2, 'muse_prompt_get', { promptId: id }),
        call(3, 'muse_prompt_save', {
          requestId: 'r1',
          expectedGeneration: 0,
          scope: 'user',
          title: 'x',
          body: 'y',
        }),
      ],
      4,
    )
    const replies = byId(result.lines)
    const names = (replies.get(1)?.['result'] as { tools: { name: string }[] }).tools.map(
      (tool) => tool.name,
    )
    expect(names).toEqual(
      expect.arrayContaining(['muse_prompt_get', 'muse_prompt_list', 'muse_stop']),
    )
    expect(names).not.toContain('muse_prompt_save')
    const got = structured(replies.get(2))
    expect(got['status']).toBe('ok')
    expect(structured(replies.get(3))).toMatchObject({ reason: 'forbidden' })
    const everything = result.lines.join('\n') + result.stderr
    expect(everything).not.toContain(CANARY)
    expect(everything).not.toContain(path.join(directory, 'private'))
  })

  // Split from the case above by RVMSM124: together they ran past the
  // repository's 5-second test timeout on a loaded rig (five agent
  // processes in one case). Each case keeps every assertion it had.
  it('keeps Stop working under the kill switch and refuses widening without a terminal', async () => {
    await grant(['prompts:read', 'content:read', 'operations:read', 'control:stop'])
    const kill = spawnSync(process.execPath, [agent, 'mcp', 'kill'], { env, encoding: 'utf8' })
    expect(kill.status).toBe(0)
    expect(kill.stdout).toContain(UI_TEXT.acpConnector.killOn)
    const killedSession = await session(
      [
        INIT,
        call(1, 'muse_prompt_list', { scope: 'user' }),
        call(2, 'muse_stop', {
          workspaceId: 'ws-test',
          target: { kind: 'operation', id: 'none' },
        }),
      ],
      3,
    )
    const killed = byId(killedSession.lines)
    expect(structured(killed.get(1))).toMatchObject({ status: 'refused', reason: 'forbidden' })
    expect(structured(killed.get(2))).toMatchObject({ status: 'ok', data: { outcome: 'unknown' } })
    // Widening authority again needs a terminal; a pipe cannot resume it.
    const resume = spawnSync(process.execPath, [agent, 'mcp', 'resume'], { env, encoding: 'utf8' })
    expect(resume.status).toBe(1)
    const grantAttempt = spawnSync(
      process.execPath,
      [agent, 'mcp', 'grant', '--workspace', directory],
      { env, encoding: 'utf8', input: 'y\n' },
    )
    expect(grantAttempt.status).toBe(1)
    expect(grantAttempt.stderr).toContain(UI_TEXT.acpConnector.grantNeedsTerminal)
  })

  // One case per batch (RVMSM124): all ten kinds in one case ran past the
  // repository's 5-second timeout on a loaded rig (three agent processes
  // and ten real report generations). Every kind is still generated. The
  // batch size is the test's own (Codex on PR #227): no fixed read cap
  // stands beside the grant anymore.
  const REPORT_BATCH = 4
  const REPORT_KINDS: readonly (readonly [string, string?])[] = [
    ['project'],
    ['milestone', 'M1'],
    ['release'],
    ['release', 'latest'],
    ['estimate', 'M1'],
    ['playbook'],
    ['playbook', 'M1'],
    ['changes'],
    ['usage'],
    ['schedules'],
  ]
  for (let start = 0; start < REPORT_KINDS.length; start += REPORT_BATCH) {
    const batch = REPORT_KINDS.slice(start, start + REPORT_BATCH)
    it(`generates report kinds ${batch.map(([kind]) => kind).join(', ')} through the real runtime adapter (RVM124 P2-11)`, async () => {
      // Its own connection: authority is kept per grant, across processes.
      await grant(['reports:read', 'content:read'], true, 'reports')
      await rm(path.join(dataFolder(), 'connector', 'kill-switch.json'), { force: true })
      const result = await session(
        [
          INIT,
          ...batch.map(([kind, subjectId], index) =>
            call(index + 1, 'muse_report', {
              workspaceId: 'ws-test',
              kind,
              format: 'markdown',
              ...(subjectId !== undefined && { subjectId }),
            }),
          ),
        ],
        batch.length + 1,
        'reports',
      )
      const replies = byId(result.lines)
      const answers = batch.map((_, index) => structured(replies.get(index + 1)))
      expect(answers.map((answer) => answer['status'])).toEqual(batch.map(() => 'ok'))
    })
  }
})
