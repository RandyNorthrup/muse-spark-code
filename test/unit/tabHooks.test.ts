import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'

import type { ShellResult } from '../../src/core/shellResult'
import {
  createTabHooks,
  type TabHookContext,
  type TabHookEdit,
  type TabHookRun,
  type TabHooksDeps,
  type TabHookState,
} from '../../src/core/tab/tabHooks'
import {
  HOOK_OUTPUT_MAX_BYTES,
  HOOK_STDIN_MAX_BYTES,
  HOOK_TOOL_VALUE_PREVIEW_CHARS,
  TAB_EDIT_HOOK_QUEUE,
} from '../../src/shared/constants'

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

  it('asks again when the epoch moves or the model differs', async () => {
    let version = 'epoch-1'
    const guard = createTabHooks({
      isWorkspaceTrusted: () => true,
      isHooksEnabled: () => true,
      configurationVersion: () => version,
      run: realRun(`process.stdout.write(JSON.stringify({ permission: 'allow' }))`, seen),
      log: (message: string) => {
        logs.push(message)
      },
    })
    await expect(guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).resolves.toBe(true)
    await expect(guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).resolves.toBe(true)
    expect(seen).toHaveLength(1)
    version = 'epoch-2'
    await expect(guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).resolves.toBe(true)
    expect(seen).toHaveLength(2)
    await expect(
      guard.beforeRead('/workspace/a.ts', 'x', { ...CONTEXT, model: 'other-model' }),
    ).resolves.toBe(true)
    expect(seen).toHaveLength(3)
  })

  it('denies exit 2, a timeout and an oversize answer', async () => {
    const refused = hooks('process.exit(2)')
    expect(await refused.beforeRead('/workspace/a.ts', 'x', CONTEXT)).toBe(false)
    const loud = hooks(`process.stdout.write('x'.repeat(${String(HOOK_OUTPUT_MAX_BYTES + 100)}))`)
    expect(await loud.beforeRead('/workspace/a.ts', 'x', CONTEXT)).toBe(false)
    const guard = createTabHooks({
      isWorkspaceTrusted: () => true,
      isHooksEnabled: () => true,
      configurationVersion: () => 'epoch-1',
      run: (request: TabHookRun) =>
        new Promise((resolve) => {
          const child = execFile(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'])
          child.stdin?.write(request.stdin)
          child.stdin?.end()
          setTimeout(() => {
            child.kill()
            const timedOut: readonly ShellResult[] = [
              {
                stdout: '',
                stderr: '',
                exitCode: null,
                isTimedOut: true,
                isCancelled: false,
              },
            ]
            resolve(timedOut)
          }, 200)
        }),
      log: (message: string) => {
        logs.push(message)
      },
    })
    const started = Date.now()
    await expect(guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).resolves.toBe(false)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('refuses an oversize read unrun, and keeps code out of the log', async () => {
    const guard = hooks(`process.stdout.write(JSON.stringify({ permission: 'allow' }))`)
    const big = 'x'.repeat(HOOK_STDIN_MAX_BYTES + 1)
    expect(await guard.beforeRead('/workspace/a.ts', big, CONTEXT)).toBe(false)
    expect(seen).toHaveLength(0)
    expect(logs.some((line) => line.includes('exceeds limit'))).toBe(true)
    const secret = 'const password = "hunter22";\nvalue()'
    expect(await guard.beforeRead('/workspace/a.ts', secret, CONTEXT)).toBe(true)
    for (const line of logs) {
      expect(line).not.toContain('hunter22')
      expect(line).not.toContain('/workspace/a.ts')
    }
  })

  it('refuses every read while the hook configuration is invalid or reloading', async () => {
    let hookState: TabHookState = 'invalid'
    const guard = createTabHooks({
      isWorkspaceTrusted: () => true,
      isHooksEnabled: () => true,
      configurationVersion: () => 'epoch-1',
      hookState: () => Promise.resolve(hookState),
      run: realRun(`process.stdout.write(JSON.stringify({ permission: 'allow' }))`, seen),
      log: (message: string) => {
        logs.push(message)
      },
    })
    const invalid = await guard.bindPolicy()
    expect(invalid.isConfigurationInvalid).toBe(true)
    await expect(guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).resolves.toBe(false)
    expect(seen).toHaveLength(0)
    hookState = 'reloading'
    const reloading = await guard.bindPolicy()
    expect(reloading.isReloading).toBe(true)
    await expect(guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).resolves.toBe(false)
    expect(seen).toHaveLength(0)
    // No hook file at all reads unguarded.
    hookState = 'absent'
    await expect(guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).resolves.toBe(true)
    expect(seen).toHaveLength(0)
  })

  it('refuses the read when the hook state cannot be settled', async () => {
    const guard = createTabHooks({
      isWorkspaceTrusted: () => true,
      isHooksEnabled: () => true,
      configurationVersion: () => 'epoch-1',
      hookState: () => Promise.reject(new Error('no dispatch')),
      run: realRun(`process.stdout.write(JSON.stringify({ permission: 'allow' }))`, seen),
      log: (message: string) => {
        logs.push(message)
      },
    })
    await expect(guard.beforeRead('/workspace/a.ts', 'x', CONTEXT)).resolves.toBe(false)
    expect(seen).toHaveLength(0)
  })

  it('drops the oldest waiting edits past the queue bound', async () => {
    const guard = hooks('setTimeout(() => {}, 100)')
    for (let n = 0; n < TAB_EDIT_HOOK_QUEUE + 3; n += 1) {
      guard.afterEdit({ ...EDIT, newString: `value-${String(n)}` }, CONTEXT)
    }
    for (let n = 0; n < 50 && seen.length < TAB_EDIT_HOOK_QUEUE + 1; n += 1) {
      await sleep(100)
    }
    expect(seen).toHaveLength(TAB_EDIT_HOOK_QUEUE + 1)
    expect(logs.filter((line) => line.includes('oldest waiting edit dropped'))).toHaveLength(2)
  })

  it('cuts the edit strings at the preview bound and counts the cut', async () => {
    const guard = hooks('process.exit(0)')
    guard.afterEdit({ ...EDIT, newString: 'n'.repeat(600), oldLine: 'o'.repeat(600) }, CONTEXT)
    for (let n = 0; n < 50 && seen.length === 0; n += 1) {
      await sleep(100)
    }
    expect(seen).toHaveLength(1)
    const payload = z
      .object({
        edits: z.array(z.object({ new_string: z.string(), old_line: z.string() })),
      })
      .parse(JSON.parse(seen[0]?.stdin ?? ''))
    expect(payload.edits[0]?.new_string).toHaveLength(HOOK_TOOL_VALUE_PREVIEW_CHARS)
    expect(payload.edits[0]?.old_line).toHaveLength(HOOK_TOOL_VALUE_PREVIEW_CHARS)
    expect(logs.some((line) => line.includes('preview omitted 176 characters'))).toBe(true)
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
