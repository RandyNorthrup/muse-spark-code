import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { killTree, sweepExitedTree } from '../../../src/host/processTree'
import { prepareWindowsSerialHelper } from '../../../src/core/maker/serial/windowsHelper'
import {
  listenNativeOwnerPipe,
  withNativeLeaseMutex,
  type NativeLeaseHelper,
} from '../../../src/core/maker/serial/nativeLease'
import type { SerialProcessDependencies } from '../../../src/core/maker/serial/process'
import type { LeaseDependencies } from '../../../src/core/maker/lease'

export function makerProcessDeps(
  overrides: Partial<SerialProcessDependencies> = {},
): SerialProcessDependencies {
  const tree = {
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    log: () => undefined,
  }
  return {
    platform: process.platform,
    env: { PATH: process.env['PATH'] },
    durationMs: 1000,
    readyTimeoutMs: 5000,
    stopGraceMs: 100,
    maxBytes: 4096,
    maxStatusBytes: 4096,
    kill: (root, startedAt) => killTree(root, tree, startedAt),
    sweep: (pid, startedAt, diedAt) => sweepExitedTree(pid, startedAt, diedAt, tree),
    ...overrides,
  }
}

export async function makerNativeHelper(
  directory: string,
  transformSource?: (source: string) => string,
): Promise<NativeLeaseHelper> {
  const processDeps = makerProcessDeps()
  if (process.platform !== 'win32')
    return {
      file: '/usr/bin/python3',
      prefix: ['-I', path.resolve('native/posix/serial.py')],
      process: processDeps,
    }
  const file = await prepareWindowsSerialHelper({
    directory,
    systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
    env: processDeps.env,
    log: () => undefined,
    readSource: async () => {
      const source = await readFile(path.resolve('native/windows/MuseSparkSerial.cs'), 'utf8')
      return transformSource?.(source) ?? source
    },
    run: (program, args, env) =>
      new Promise((resolve, reject) =>
        execFile(program, [...args], { env, timeout: 20_000 }, (error, stdout) => {
          if (error === null) resolve(stdout)
          else reject(new Error('test-compiler-failed', { cause: error }))
        }),
      ),
  })
  return { file, prefix: [], process: processDeps }
}

export async function makerLeaseDeps(directory: string): Promise<LeaseDependencies> {
  const helper = await makerNativeHelper(directory)
  return {
    directory,
    platform: process.platform,
    timeoutMs: 2000,
    maxRecordBytes: 4096,
    exclusive: (file, operation) => withNativeLeaseMutex(helper, file, operation),
    listenOwnerPipe: (endpoint, id, stop) => listenNativeOwnerPipe(helper, endpoint, id, stop),
  }
}

export async function isTestProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
  if (process.platform !== 'linux') return true
  try {
    const state = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
    return !/^\d+ \(.*\) Z /.test(state)
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ESRCH')
    )
      return false
    throw error
  }
}

export const fakeSerialScript = String.raw`
const mode = process.argv[1];
if (mode === 'unavailable') { process.stderr.write('serial-unavailable\n'); process.exit(1); }
if (mode === 'stderr-overflow') process.stderr.write('A'.repeat(8192));
else if (mode === 'unknown') process.stderr.write('invented\n');
else if (mode !== 'stall') process.stderr.write('serial-ready\n');
if (mode === 'overflow') process.stdout.write(Buffer.alloc(8192, 65));
if (mode === 'orphan') {
  const child = require('node:child_process').spawn(process.execPath, ['-e', "setInterval(() => {}, 100); setTimeout(() => process.exit(0), process.platform === 'win32' ? 15000 : 3000)"], { stdio: ['ignore', 'inherit', 'inherit'] });
  process.stdout.write(String(child.pid) + '\n');
  process.exit(0);
}
if (mode === 'exit') process.exit(0);
process.stdin.on('data', (data) => process.stdout.write(data));
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 100);
setTimeout(() => process.exit(0), 1500);
`
