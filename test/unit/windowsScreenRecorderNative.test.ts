import { createHash } from 'node:crypto'
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
