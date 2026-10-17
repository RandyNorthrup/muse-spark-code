// M115 X's explicitly named disposable Win11 rig check, never a model call.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import * as z from 'zod/mini'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
assert.equal(process.platform, 'win32')
assert.equal(
  root.toLowerCase(),
  path.resolve('C:/lanes/M115X').toLowerCase(),
  'This disposable task check is restricted to its named rig worktree',
)
const directory = path.join(root, 'temp', 'm115-native-wake')
const bundleDir = path.join(root, 'temp', 'm115-native-bundles')
await mkdir(directory, { recursive: true })
await build({
  entryPoints: [
    path.join(root, 'src/runtime/schedules/nativeBackground.ts'),
    path.join(root, 'src/runtime/schedules/nodeBackgroundIo.ts'),
    path.join(root, 'src/runtime/schedules/registration.ts'),
  ],
  outdir: bundleDir,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const { NativeScheduleBackground } = require(path.join(bundleDir, 'nativeBackground.cjs'))
const { backgroundProcessRunner, nodeBackgroundFiles } = require(
  path.join(bundleDir, 'nodeBackgroundIo.cjs'),
)
const { backgroundRegistrationId } = require(path.join(bundleDir, 'registration.cjs'))
const nativeRun = backgroundProcessRunner(process.env)
const run = async (file, args) => {
  const result = await nativeRun(file, args)
  if (result.exitCode !== 0)
    console.error(`${path.basename(file)} failed (${result.exitCode}): ${result.stderr}`)
  return result
}
const fixture = fileURLToPath(import.meta.resolve('../unit/helpers/fakeScheduleWake.mjs'))
const nextWakeAtMs = Date.now() + 120_000
const entry = new NativeScheduleBackground({
  platform: 'win32',
  homeDir: path.join(directory, 'fake-home'),
  dataDir: directory,
  executable: process.execPath,
  agentFile: fixture,
  uid: 0,
  now: Date.now,
  isWakeProcess: false,
  authorization: () => Promise.resolve({ scheduledPrompts: false }),
  files: nodeBackgroundFiles(),
  run,
})
const attemptsFile = path.join(directory, 'attempts.jsonl')
const taskId = backgroundRegistrationId(path.join(directory, 'fake-home'))
const wakeStatusSchema = z.strictObject({ completed: z.boolean(), exitCode: z.int() })
const wakeStatus = async () => {
  const script = `$ErrorActionPreference = 'Stop'; $task = Get-ScheduledTask -TaskName '${taskId}'; $info = Get-ScheduledTaskInfo -TaskName '${taskId}'; ConvertTo-Json -Compress -InputObject @{ completed = ($task.State -eq 'Ready'); exitCode = $info.LastTaskResult }`
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ])
  assert.equal(result.exitCode, 0)
  return wakeStatusSchema.parse(JSON.parse(result.stdout))
}
const readAttempts = async () => {
  try {
    const text = await readFile(attemptsFile, 'utf8')
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
try {
  await entry.remove()
  await rm(attemptsFile, { force: true })
  await rm(path.join(directory, 'claim'), { force: true })
  await assert.rejects(entry.register(nextWakeAtMs, { choice: 'notNow', decidedAtMs: Date.now() }))
  assert.deepEqual(await entry.status(), { registered: false })
  await entry.register(nextWakeAtMs, { choice: 'yes', decidedAtMs: Date.now() })
  assert.deepEqual(await entry.status(), { registered: true, nextWakeAtMs })
  const editorAttempt = await run(process.execPath, [
    fixture,
    'schedule',
    'run-due',
    '--json',
    '--editor',
  ])
  assert.equal(editorAttempt.exitCode, 0)
  console.log('Disposable per-user task registered; waiting for its one-shot OS wake.')
  const deadline = nextWakeAtMs + 90_000
  let attempts = await readAttempts()
  while (attempts.every((row) => row.source !== 'os') && Date.now() < deadline) {
    await delay(1000)
    attempts = await readAttempts()
  }
  assert.equal(attempts.length, 2, 'One editor attempt and one actual OS wake')
  assert.equal(
    attempts.filter((row) => row.admitted).length,
    1,
    'Permanent wx claim admits only once',
  )
  assert.ok(attempts.some((row) => row.source === 'os' && !row.admitted))
  let completed = await wakeStatus()
  while (!completed.completed && Date.now() < deadline) {
    await delay(1000)
    completed = await wakeStatus()
  }
  assert.ok(completed.completed, 'OS wake must finish within the deadline')
  assert.equal(completed.exitCode, 0, 'OS wake must exit successfully')
  console.log('PASS: actual Task Scheduler wake exited; the editor/OS pair admitted once.')
} finally {
  await entry.remove()
  assert.deepEqual(await entry.status(), { registered: false })
  console.log('Disposable task and its registration files removed.')
}
