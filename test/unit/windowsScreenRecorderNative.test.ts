import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { windowsPowerShell } from '../../src/core/execGuard'
import { windowsTrustedPathVerifier } from '../../src/runtime/windowsTrustedPath'
import { MEDIA_FILE_ID_MIN_BYTES, MEDIA_MAX_UPLOAD_MIB } from '../../src/shared/constants'
import {
  createWindowsLatestPort,
  resolveWindowsRecordingFolders,
} from '../../src/host/media/recordingLatest'
import { noWorkspaceChildEnvironment } from '../../src/core/execGuard'
import { runProgram } from '../../src/host/processTree'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { execFileGuarded } from '../../src/core/guardedChildProcess'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { screenRecordExecutable } from '../../src/host/backend/jobBuild'
import { lockWindowsStorageDir, removeFolder } from './helpers/temporaryFolders'

const paths = { root: '', executable: '', source: '' }
const systemRoot = process.env['SystemRoot'] ?? ''
const env = noWorkspaceChildEnvironment('win32', { SystemRoot: systemRoot }, realpathSync)
const icacls = path.win32.join(systemRoot, 'System32', 'icacls.exe')
const SOURCE = path.resolve('native/windows/MuseSparkScreenRecord.cs')
const CHECKS = path.resolve('test/unit/helpers/windowsScreenRecorderChecks.cs')

const check = async (...args: string[]) => {
  const result = await runProgram(paths.executable, args, env)
  return result.trim()
}
const destination = () => path.join(paths.root, `muse-spark-screen-${crypto.randomUUID()}`)
/** The production CopyLatest over these folders ('|' joins them; no Windows path holds one). */
const latest = async (source: string | readonly string[], target: string) =>
  await check('latest', typeof source === 'string' ? source : source.join('|'), target, String(100))
const HOUR_MS = 60 * 60 * 1000
// The real Windows trust check: the inbox compiler and the built helper must
// each pass the owner, ACL and link checks in their real folders before the
// helper is built or run. Its PowerShell probes run as real processes through
// the same runner as the compiler; a probe that exits non-zero refuses.
const powershell = windowsPowerShell(systemRoot)
const verifier = windowsTrustedPathVerifier(async (file, args) => {
  if (file !== 'powershell.exe') throw new Error(`unexpected trust probe ${file}`)
  return { exitCode: 0, stdout: await runProgram(powershell.file, args, powershell.env) }
})
const isTrusted = async (file: string) =>
  'ok' in (await verifier.verify(file, { leafKind: 'file' }))
const helperIn = async (storageDir: string) =>
  await screenRecordExecutable({
    storageDir,
    systemRoot,
    readSource: () => Promise.resolve(paths.source),
    verifyTrustedPath: isTrusted,
    run: (file, args, environment) =>
      runProgram(
        file,
        args[0] === '--self-test'
          ? args
          : [...args, '/main:WindowsScreenRecorderChecks', '/warnaserror'],
        environment,
      ),
  })()
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
      paths.source = `${imports}\n${source}`
      // The helper's storage as an extension's own folder is: only this user,
      // SYSTEM and Administrators may change it. A temporary folder may
      // inherit other accounts' write access (it does on some rigs), and the
      // trust check refuses a helper there.
      const storageDir = path.join(paths.root, 'storage')
      await mkdir(storageDir)
      await lockWindowsStorageDir(storageDir, systemRoot)
      const executable = await helperIn(storageDir)
      if (executable === undefined)
        throw new Error('inbox recorder/check fixture failed to compile or self-test')
      paths.executable = executable
      // Exercise hosted Windows' 8.3 TEMP spelling even on a long-path rig.
      const root = paths.root
      paths.root = await check('shortPath', root)
      expect(await realpath(paths.root)).toBe(await realpath(root))
    })
    afterAll(() => removeFolder(paths.root))

    it('keeps the native byte bound identical to the shared contract', async () => {
      expect(await check('constants')).toBe(String(MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES))
    })

    // D121: the person's recording length reaches the helper's --record as
    // set, through its own argument parsing; no floor or ceiling of ours.
    it.each(['5', '3600', '0'])(
      'takes a set recording length of %s seconds as set',
      async (seconds) => {
        expect(await check('record', destination(), String(process.pid), seconds)).toBe(seconds)
      },
    )

    it('refuses a negative recording length', async () => {
      expect(await check('record', destination(), String(process.pid), '-1')).toBe(
        'error:ArgumentException',
      )
    })

    // The helper's own known-folder resolution (read only) names the same two
    // folders the editor's discovery scans: Snipping Tool's and Xbox Game Bar's.
    it('searches the same Screen Recordings and Captures folders as the editor', async () => {
      const folders = await resolveWindowsRecordingFolders()
      expect(folders.videosDir).toEqual(expect.any(String))
      const port = createWindowsLatestPort({ tempRoot: paths.root, ...folders })
      const searched = await check('folders')
      expect(searched.split('|')).toEqual(port.roots)
    })

    it('never runs a built helper from a folder other users may write to', async () => {
      const storageDir = await mkdtemp(path.join(paths.root, 'replaceable-'))
      // The same build, already in place: the helper is not compiled again,
      // so only the trust check stands between it and its self-test.
      await copyFile(paths.executable, path.join(storageDir, path.basename(paths.executable)))
      await runProgram(icacls, [storageDir, '/grant', '*S-1-1-0:(OI)(CI)W'], env)
      expect(await isTrusted(path.join(storageDir, path.basename(paths.executable)))).toBe(false)
      expect(await helperIn(storageDir)).toBeUndefined()
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
            ? execFileGuarded(paths.executable, ['owner'], {
                env,
                windowsHide: true,
              })
            : undefined
        try {
          const ownerPid = owner?.pid ?? process.pid
          const output = await new Promise<string>((resolve, reject) => {
            const child = execFileGuarded(
              paths.executable,
              ['controlledLatest', source, target, String(before.length), String(ownerPid)],
              {
                env,
                windowsHide: true,
              },
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
      expect(await check('mainLatest', source, target, '100', '2147483647')).toBe(
        '{"type":"error","code":"cancelled"}\r\nexit:1',
      )
      expect(await readdir(paths.root)).not.toContain(path.basename(target))
    })

    it('deletes a completed private copy when Cancel arrives before acknowledgement', async () => {
      const source = await folder()
      const file = await clip(source, 'clip.mp4')
      const target = destination()
      expect(await check('lateCopyCancel', source, target, '100')).toBe('finish:False\r\nok')
      expect(await readdir(paths.root)).not.toContain(path.basename(target))
      expect(await readFile(file)).toEqual(Buffer.alloc(1, 1))
    })

    it('exits on owner death even when native work never cooperates', async () => {
      const result = await new Promise<{ code: string | number | undefined; stdout: string }>(
        (resolve) => {
          execFileGuarded(
            paths.executable,
            ['ownerDeath'],
            {
              env,
              windowsHide: true,
            },
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

    it('accepts the long spelling of the same native temporary ancestor', async () => {
      const target = path.join(await realpath(paths.root), path.basename(destination()))
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

    it('copies the newest mp4, case-insensitively, byte-exact into a private preview', async () => {
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

    // D121: no age cutoff. A recording made two hours ago is still the latest.
    it('takes a two-hour-old recording as the latest', async () => {
      const source = await folder()
      const old = await clip(source, 'clip.mp4', 2 * HOUR_MS, 7)
      const target = destination()
      expect(await latest(source, target)).toBe('ok')
      expect(await readFile(path.join(target, 'recording.mp4'))).toEqual(await readFile(old))
    })

    it('refuses a future-dated recording before copying', async () => {
      const source = await folder()
      await clip(source, 'clip.mp4', -HOUR_MS)
      const target = destination()
      expect(await latest(source, target)).toBe('error:FileNotFoundException')
      expect(await readdir(paths.root)).not.toContain(path.basename(target))
    })

    // Snipping Tool's Screen Recordings and Xbox Game Bar's Captures: the
    // newest mp4 across both wins; Game Bar's screenshots (.png) never do.
    it('picks the newest mp4 across Screen Recordings and Captures, never a newer screenshot', async () => {
      const screenRecordings = await folder()
      const captures = await folder()
      await clip(screenRecordings, 'Screen Recording.mp4', 3 * HOUR_MS, 3)
      const gameClip = await clip(captures, 'Game Clip.mp4', 2 * HOUR_MS, 5)
      await clip(captures, 'Screenshot.png', 0, 9)
      const target = destination()
      expect(await latest([screenRecordings, captures], target)).toBe('ok')
      expect(await readFile(path.join(target, 'recording.mp4'))).toEqual(await readFile(gameClip))
      const snip = await clip(screenRecordings, 'Newer Recording.mp4', HOUR_MS, 4)
      const second = destination()
      expect(await latest([screenRecordings, captures], second)).toBe('ok')
      expect(await readFile(path.join(second, 'recording.mp4'))).toEqual(await readFile(snip))
    })

    it('a missing folder, or a junction in place of one, hides nothing in the others', async () => {
      const captures = await folder()
      const gameClip = await clip(captures, 'Game Clip.mp4', HOUR_MS, 6)
      const linked = path.join(paths.root, `screen-junction-${crypto.randomUUID()}`)
      await symlink(await folder(), linked, 'junction')
      const target = destination()
      expect(
        await latest([path.join(paths.root, 'no-such-folder'), linked, captures], target),
      ).toBe('ok')
      expect(await readFile(path.join(target, 'recording.mp4'))).toEqual(await readFile(gameClip))
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
