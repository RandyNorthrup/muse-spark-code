import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ShellResult } from '../../src/core/shellResult'
import {
  createTabHooks,
  type TabHookContext,
  type TabHookEdit,
  type TabHookRun,
  type TabHooksDeps,
} from '../../src/core/tab/tabHooks'

// M94 acceptance 17 (the runner half): the hook guard over real subprocesses.
// Each `run` below starts a real `node -e` child, feeds it the guard's own
// stdin, and reports its real exit code and pipes: the verdict cache, the
// fail-closed denials and the after-edit envelope are all proven against
// answers no test double could invent.

const CONTEXT: TabHookContext = {
  workspaceRoots: ['/workspace'],
  model: 'muse-spark-1.3',
  generationId: 'generation-1',
}

const EDIT: TabHookEdit = {
  filePath: '/workspace/a.ts',
  oldString: '',
  newString: 'value()',
  oldLine: 'const result = ',
  newLine: 'const result = value()',
  range: { startLineNumber: 10, startColumn: 16, endLineNumber: 10, endColumn: 16 },
  acceptance: 'full',
}

function realRun(script: string, seen: TabHookRun[]): TabHooksDeps['run'] {
  return (request: TabHookRun): Promise<readonly ShellResult[] | undefined> =>
    new Promise((resolve, reject) => {
      seen.push(request)
      const child = execFile(process.execPath, ['-e', script], (error, stdout, stderr) => {
        if (error !== null && (error as { code?: unknown }).code === 'ENOENT') {
          reject(error instanceof Error ? error : new Error('node binary missing'))
          return
        }
        const code = (error as { code?: unknown } | null)?.code
        let exitCode = 0
        if (error !== null) {
          exitCode = typeof code === 'number' ? code : 1
        }
        resolve([{ stdout, stderr, exitCode, isTimedOut: false, isCancelled: false }])
      })
      child.stdin?.write(request.stdin)
      child.stdin?.end()
    })
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe('Tab hooks over real subprocesses', () => {
  let directory = ''
  const seen: TabHookRun[] = []
  const logs: string[] = []
  let isTrusted = true

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'm94-tab-hooks-'))
    seen.length = 0
    logs.length = 0
    isTrusted = true
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function hooks(script: string) {
    return createTabHooks({
      isWorkspaceTrusted: () => isTrusted,
      isHooksEnabled: () => true,
      configurationVersion: () => 'epoch-1',
      run: realRun(script, seen),
      log: (message: string) => {
        logs.push(message)
      },
    })
  }

  it('runs the hook with the Cursor read envelope and honors an allow answer', async () => {
    const received = path.join(directory, 'read-stdin.json')
    const guard = hooks(
      `require('node:fs').writeFileSync(${JSON.stringify(received)}, require('node:fs').readFileSync(0, 'utf8'));` +
        `process.stdout.write(JSON.stringify({ permission: 'allow' }))`,
    )
    const isAllowed = await guard.beforeRead('/workspace/a.ts', 'const result = ', CONTEXT)
    expect(isAllowed).toBe(true)
    expect(seen).toHaveLength(1)
    const envelope = JSON.parse(await readFile(received, 'utf8')) as {
      hook_event_name: string
      file_path: string
      model: string
      content: string
    }
    expect(envelope.hook_event_name).toBe('beforeTabFileRead')
    expect(envelope.file_path).toBe('/workspace/a.ts')
    expect(envelope.model).toBe(CONTEXT.model)
    expect(envelope.content).toBe('const result = ')
    // The same read answers from the verdict cache: no second process starts.
    const isAllowedAgain = await guard.beforeRead('/workspace/a.ts', 'const result = ', CONTEXT)
    expect(isAllowedAgain).toBe(true)
    expect(seen).toHaveLength(1)
  })

  it('denies when the hook answers deny, fails, or misanswers', async () => {
    const deny = hooks(`process.stdout.write(JSON.stringify({ permission: 'deny' }))`)
    expect(await deny.beforeRead('/workspace/a.ts', 'x', CONTEXT)).toBe(false)
    const crash = hooks('process.exit(3)')
    expect(await crash.beforeRead('/workspace/a.ts', 'x', CONTEXT)).toBe(false)
    const garbage = hooks(`process.stdout.write('not json{{')`)
    expect(await garbage.beforeRead('/workspace/a.ts', 'x', CONTEXT)).toBe(false)
    expect(logs.filter((line) => line.includes('denied'))).toHaveLength(3)
  })

  it('reads nothing in an untrusted workspace, without starting a hook', async () => {
    isTrusted = false
    const guard = hooks(`process.stdout.write(JSON.stringify({ permission: 'allow' }))`)
    expect(await guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).toBe(false)
    expect(seen).toHaveLength(0)
  })

  it('reports an accepted edit with its envelope, and stays silent while typing', async () => {
    const received = path.join(directory, 'edit-stdin.json')
    const guard = hooks(
      `require('node:fs').appendFileSync(${JSON.stringify(received)}, require('node:fs').readFileSync(0, 'utf8'));`,
    )
    guard.afterEdit(EDIT, CONTEXT)
    let payload = ''
    for (let n = 0; n < 50; n += 1) {
      try {
        payload = await readFile(received, 'utf8')
        if (payload.length > 0) break
      } catch {
        await sleep(20)
      }
    }
    const envelope = JSON.parse(payload) as {
      hook_event_name: string
      edits: { new_string: string; inferred?: boolean }[]
    }
    expect(envelope.hook_event_name).toBe('afterTabFileEdit')
    expect(envelope.edits).toHaveLength(1)
    expect(envelope.edits[0]?.new_string).toBe('value()')
    expect(envelope.edits[0]?.inferred).toBeUndefined()
    // Typing through an inline suggestion is not an edit: nothing is queued.
    const runs = seen.length
    guard.afterEdit({ ...EDIT, acceptance: 'typing' }, CONTEXT)
    await sleep(100)
    expect(seen).toHaveLength(runs)
  })
})
