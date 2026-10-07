import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { screenRecordExecutable } from '../../src/host/backend/jobBuild'
import { runProgram } from '../../src/host/processTree'
import {
  MEDIA_FILE_ID_MIN_BYTES,
  MEDIA_MAX_UPLOAD_MIB,
  SCREEN_RECORDING_MIN_SECONDS,
  SCREEN_RECORDING_MAX_SECONDS,
  SCREEN_RECORDING_RECENT_MAX_AGE_MS,
  PROCESS_TABLE_TIMEOUT_MS,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '', executable: '' }
const systemRoot = process.env['SystemRoot'] ?? ''
const env = { SystemRoot: systemRoot }
const SOURCE = path.resolve('native/windows/MuseSparkScreenRecord.cs')
const CHECKS = path.resolve('test/unit/helpers/windowsScreenRecorderChecks.cs')

const check = async (...args: string[]) => {
  const result = await runProgram(paths.executable, args, env)
  return result.trim()
}
const destination = () => path.join(paths.root, `muse-spark-screen-${crypto.randomUUID()}`)
const latest = async (source: string, target: string, maxBytes = 100) =>
  await check(
    'latest',
    source,
    target,
    String(maxBytes),
    String(SCREEN_RECORDING_RECENT_MAX_AGE_MS),
  )
const folder = async () => await mkdtemp(path.join(paths.root, 'snipping-'))
const clip = async (source: string, name: string, age = 0, size = 1) => {
  const file = path.join(source, name)
  await writeFile(file, Buffer.alloc(size, 1))
  const stamp = new Date(Date.now() - age)
  await utimes(file, stamp, stamp)
  return file
}

describe.skipIf(process.platform !== 'win32')(
  'M105 R2 real inbox Windows helper guards (no recording)',
  () => {
    beforeAll(async () => {
      paths.root = await mkdtemp(path.join(tmpdir(), 'muse-screen-native-test-'))
      const source = `${await readFile(SOURCE, 'utf8')}\n${await readFile(CHECKS, 'utf8')}`
        // C# using directives must precede type declarations, including the
        // test-only appended entry point. These are identical namespace imports.
        .replaceAll(/^using .+;\r?\n/gmu, '')
        // Main still uses its real lifetime/dispatch; only known-folder
        // resolution goes to the test-private source instead of user Videos.
        .replace('Latest(args[1],', 'WindowsScreenRecorderChecks.Latest(args[1],')
        // Pause after one real bounded write to exercise stdin/owner cancellation
        // during copying deterministically, without a slow/large user recording.
        .replace(
          'sink.Write(buffer, 0, count);',
          'sink.Write(buffer, 0, count); WindowsScreenRecorderChecks.CopyBarrier(lifetime);',
        )
      const imports = [
        'System',
        'System.Collections.Generic',
        'System.Diagnostics',
        'System.Globalization',
        'System.IO',
        'System.Reflection',
        'System.Runtime.InteropServices',
        'System.Security.AccessControl',
        'System.Security.Principal',
        'System.Text',
        'System.Threading',
        'System.Threading.Tasks',
        'System.Windows.Forms',
        'Microsoft.Win32',
        'Microsoft.Win32.SafeHandles',
        'Windows.Graphics.Capture',
        'Windows.Graphics.DirectX',
        'Windows.Graphics.DirectX.Direct3D11',
        'Windows.Media.Core',
        'Windows.Media.MediaProperties',
        'Windows.Media.Transcoding',
        'Windows.Foundation',
        'Windows.Storage',
        'Windows.Storage.Streams',
        'FileAttributes = System.IO.FileAttributes',
      ]
        .map((name) => `using ${name};`)
        .join('\n')
      const executable = await screenRecordExecutable({
        storageDir: paths.root,
        systemRoot,
        readSource: () => Promise.resolve(`${imports}\n${source}`),
        verifyTrustedPath: () => Promise.resolve(true),
        run: (file, args, environment) =>
          runProgram(
            file,
            args[0] === '--self-test'
              ? args
              : [...args, '/main:WindowsScreenRecorderChecks', '/warnaserror'],
            environment,
          ),
      })()
      if (executable === undefined)
        throw new Error('inbox recorder/check fixture failed to compile or self-test')
      paths.executable = executable
    })
    afterAll(() => removeFolder(paths.root))

    it('keeps native bounds identical to the shared contract', async () => {
      expect(await check('constants')).toBe(
        [
          SCREEN_RECORDING_MIN_SECONDS,
          SCREEN_RECORDING_MAX_SECONDS,
          MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES,
          SCREEN_RECORDING_RECENT_MAX_AGE_MS,
        ].join(','),
      )
    })

    it('keeps Cancel atomic when a concurrent normal Stop finishes later', async () => {
      expect(await check('cancelRace')).toBe('cancelled:True,closed:True,finish:False')
    })

    it.each(['selection', 'file', 'open', 'prepare'])(
      'Stop cancels a pending %s operation before recording starts',
      async (stage) => {
        expect(await check('pending', stage)).toBe('cancelled:True,closed:True,finish:False')
      },
    )

    it('cancels an operation registered after Cancel was already latched', async () => {
      expect(await check('latePending')).toBe('cancelled:True,closed:True,finish:False')
    })

    it('normal Stop finalizes encoding while a later Cancel cancels it', async () => {
      expect(await check('pendingEncode')).toBe('cancelled:True,closed:True')
    })

    it.each(['stdin', 'owner'] as const)(
      'latest import observes %s cancellation during copying and deletes its partial preview',
      async (control) => {
        const source = await folder()
        const file = await clip(source, 'clip.mp4', 0, 128 * 1024)
        const before = await readFile(file)
        const target = destination()
        const owner =
          control === 'owner'
            ? execFile(paths.executable, ['owner'], { env, windowsHide: true })
            : undefined
        try {
          const ownerPid = owner?.pid ?? process.pid
          const output = await new Promise<string>((resolve, reject) => {
            const child = execFile(
              paths.executable,
              [
                'controlledLatest',
                source,
                target,
                String(before.length),
                String(ownerPid),
                String(SCREEN_RECORDING_RECENT_MAX_AGE_MS),
              ],
              { env, windowsHide: true, timeout: PROCESS_TABLE_TIMEOUT_MS },
              (error, stdout) => {
                if (error === null) resolve(stdout)
                else reject(new Error(error.message, { cause: error }))
              },
            )
            let seen = ''
            let hasSent = false
            child.stdout?.on('data', (chunk: Buffer) => {
              seen += chunk.toString('utf8')
              if (hasSent || !seen.includes('copying')) return
              hasSent = true
              if (owner === undefined) child.stdin?.write('cancel\n')
              else owner.kill()
            })
          })
          expect(output.trim()).toBe('copying\r\n{"type":"error","code":"cancelled"}\r\nexit:1')
          expect(await readdir(paths.root)).not.toContain(path.basename(target))
          expect(await readFile(file)).toEqual(before)
        } finally {
          owner?.kill()
        }
      },
    )

    it('latest import refuses an owner that has already died before copying', async () => {
      const source = await folder()
      await clip(source, 'clip.mp4')
      const target = destination()
      expect(
        await check(
          'mainLatest',
          source,
          target,
          '100',
          '2147483647',
          String(SCREEN_RECORDING_RECENT_MAX_AGE_MS),
        ),
      ).toBe('{"type":"error","code":"cancelled"}\r\nexit:1')
      expect(await readdir(paths.root)).not.toContain(path.basename(target))
    })

    it('deletes a completed private copy when Cancel arrives before acknowledgement', async () => {
      const source = await folder()
      const file = await clip(source, 'clip.mp4')
      const target = destination()
      expect(
        await check(
          'lateCopyCancel',
          source,
          target,
          '100',
          String(SCREEN_RECORDING_RECENT_MAX_AGE_MS),
        ),
      ).toBe('finish:False\r\nok')
      expect(await readdir(paths.root)).not.toContain(path.basename(target))
      expect(await readFile(file)).toEqual(Buffer.alloc(1, 1))
    })

    it('exits on owner death even when native work never cooperates', async () => {
      const result = await new Promise<{ code: string | number | undefined; stdout: string }>(
        (resolve) => {
          execFile(
            paths.executable,
            ['ownerDeath'],
            { env, windowsHide: true, timeout: PROCESS_TABLE_TIMEOUT_MS },
            (error, stdout) => {
              resolve({ code: error?.code ?? 0, stdout })
            },
          )
        },
      )
      expect(result).toEqual({ code: 1, stdout: 'watching\r\n' })
    })

    it('reports Win32 access denial as file access denied', async () => {
      expect(await check('accessDenied')).toBe('accessDenied')
    })

    it('cleanup preserves access denial instead of relabeling it cancellation', async () => {
      expect(await check('disposeFailure')).toBe('accessDenied')
    })

    it('probes availability without starting capture', async () => {
      const output = await check('probe')
      expect(output).toMatch(/exit:[01]$/u)
      expect(output).not.toContain('complete')
      expect(output).not.toContain('"type":"recording"')
    })

    it('atomically creates a protected DACL granting only the current owner', async () => {
      const target = destination()
      expect(await check('private', target)).toBe('ok')
      expect(await readdir(target)).toEqual([])
    })

    it('accepts forward-slash Windows paths before canonical comparison', async () => {
      const target = destination().replaceAll('\\', '/')
      expect(await check('private', target)).toBe('ok')
    })

    it('refuses an existing destination without deleting or modifying its contents', async () => {
      const target = destination()
      await mkdir(target)
      const marker = path.join(target, 'keep.txt')
      await writeFile(marker, 'keep')
      expect(await check('private', target)).toBe('error:Win32Exception')
      expect(await readFile(marker, 'utf8')).toBe('keep')
    })

    it('refuses a destination outside the reserved recording namespace', async () => {
      expect(await check('private', path.join(paths.root, 'other'))).toBe('error:ArgumentException')
    })

    it('refuses a noncanonical reserved destination before creating or deleting anything', async () => {
      const target =
        path.join(paths.root, 'muse-spark-screen-parent') +
        String.raw`\..\muse-spark-screen-traversal`
      expect(await check('private', target)).toBe('error:ArgumentException')
    })

    it.each(['fileWrite', 'fileAsync', 'fileLength'])(
      'enforces the private file cap on %s',
      async (mode) => {
        const target = destination()
        expect(await check(mode, target)).toBe('error:RecordingLimitException')
        const data = await readFile(path.join(target, 'recording.mp4'))
        expect(data.length).toBeLessThanOrEqual(100)
      },
    )

    it.each([
      'streamSize',
      'streamSeek',
      'streamWrite',
      'streamOutput',
      'streamOutputWrite',
      'streamClone',
    ])('enforces the Media Foundation random-access sink cap on %s', async (mode) => {
      expect(await check(mode)).toBe('error:RecordingLimitException')
    })

    it('copies the newest recent mp4, case-insensitively, byte-exact into a private preview', async () => {
      const source = await folder()
      await clip(source, 'older.mp4', 1000)
      const newest = await clip(source, 'newest.MP4', 0, 100)
      await clip(source, 'not-a-recording.txt')
      const before = createHash('sha256')
        .update(await readFile(newest))
        .digest('hex')
      const target = destination()
      expect(await latest(source, target)).toBe('ok')
      expect(
        createHash('sha256')
          .update(await readFile(path.join(target, 'recording.mp4')))
          .digest('hex'),
      ).toBe(before)
      expect(
        createHash('sha256')
          .update(await readFile(newest))
          .digest('hex'),
      ).toBe(before)
      expect(await check('private', target)).toBe('error:Win32Exception')
    })

    it.each([
      { label: 'stale', age: SCREEN_RECORDING_RECENT_MAX_AGE_MS + 1000 },
      { label: 'future-dated', age: -SCREEN_RECORDING_RECENT_MAX_AGE_MS },
    ])('refuses $label recordings before copying', async ({ age }) => {
      const source = await folder()
      await clip(source, 'clip.mp4', age)
      const target = destination()
      expect(await latest(source, target)).toBe('error:FileNotFoundException')
      expect(await readdir(paths.root)).not.toContain(path.basename(target))
    })

    it('refuses the latest oversize file instead of silently importing an older recording', async () => {
      const source = await folder()
      await clip(source, 'older.mp4', 1000)
      await clip(source, 'latest.mp4', 0, 101)
      expect(await latest(source, destination())).toBe('error:RecordingLimitException')
    })

    it('refuses an empty latest file', async () => {
      const source = await folder()
      await clip(source, 'clip.mp4', 0, 0)
      expect(await latest(source, destination())).toBe('error:RecordingLimitException')
    })

    it('does not descend into subfolders or take other filename extensions', async () => {
      const source = await folder()
      await clip(source, 'clip.webm')
      const child = path.join(source, 'child')
      await mkdir(child)
      await clip(child, 'clip.mp4')
      expect(await latest(source, destination())).toBe('error:FileNotFoundException')
    })

    it('refuses a junction in place of the Snipping Tool folder', async () => {
      const source = await folder()
      await clip(source, 'clip.mp4')
      const junction = path.join(paths.root, 'snipping-junction')
      await symlink(source, junction, 'junction')
      expect(await latest(junction, destination())).toBe('error:FileNotFoundException')
    })

    it('binds the held source to its canonical path and refuses a redirected ancestor', async () => {
      const parent = await folder()
      const source = path.join(parent, 'Screen Recordings')
      await mkdir(source)
      await clip(source, 'clip.mp4')
      const junction = path.join(paths.root, 'videos-junction')
      await symlink(parent, junction, 'junction')
      expect(await latest(path.join(junction, 'Screen Recordings'), destination())).toBe(
        'error:IOException',
      )
    })
  },
)
