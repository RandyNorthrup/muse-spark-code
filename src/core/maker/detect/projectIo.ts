// The portable Node adapter for M103 detection. No discovery, writes or device opens.
import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  CHECK_COMMAND_MAX_CHARS,
  MAKER_DETECT_MAX_BYTES,
  MAKER_DETECT_MAX_DEPTH,
  MAKER_DETECT_MAX_FILES,
  MAKER_DETECT_IO_TIMEOUT_MS,
  MAKER_PI_COMMAND_TIMEOUT_MS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../../shared/constants'
import { isBelow } from '../../workspacePath'
import { handleIdentity, lstatIdentity, sameFile } from '../../fs/fileIdentity'
import { windowsProjectIo } from './projectIoWindows'
import type { ProjectDetectIo } from './projectKinds'

const IGNORED = new Set(['.git', 'node_modules', '.pio', 'build', 'dist', '.venv', '__pycache__'])

// macOS's /dev/fd duplicates a directory fd but cannot opendir it. Perl's core
// handle-based chdir uses fchdir; both readdir and lstat then stay on that object.
const DARWIN_LISTING = String.raw`
use strict;
use warnings;
use JSON::PP ();
use Encode ();
open(my $held, '<&=0') or die "handle";
chdir($held) or die "directory";
opendir(my $listing, '.') or die "listing";
my @entries;
while (@entries < $ARGV[0] && defined(my $name = readdir($listing))) {
  next if $name eq '.' || $name eq '..';
  lstat($name) or die "entry";
  my $kind = -f _ ? 'file' : -d _ ? 'directory' : 'other';
  push @entries, { name => Encode::decode('UTF-8', $name, Encode::FB_CROAK), kind => $kind };
}
closedir($listing) or die "close";
close($held) or die "close";
print JSON::PP::encode_json(\@entries);
`

const directoryEntrySchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(CHECK_COMMAND_MAX_CHARS)
    .refine((name) => name !== '.' && name !== '..' && !/[\0/]/.test(name)),
  kind: z.enum(['file', 'directory', 'other']),
})

async function* directoryEntries(
  directory: FileHandle,
  maxNames: number,
): AsyncIterable<z.infer<typeof directoryEntrySchema>> {
  if (process.platform === 'darwin') {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('/usr/bin/perl', ['-e', DARWIN_LISTING, String(maxNames)], {
        env: {},
        stdio: [directory.fd, 'pipe', 'ignore'],
        timeout: MAKER_DETECT_IO_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      })
      const chunks: Buffer[] = []
      let bytes = 0
      let hasExceeded = false
      child.stdout?.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAKER_DETECT_MAX_FILES * CHECK_COMMAND_MAX_CHARS) {
          hasExceeded = true
          child.kill('SIGKILL')
        } else chunks.push(chunk)
      })
      child.once('error', () => {
        reject(new Error('directory listing failed'))
      })
      child.once('close', (code) => {
        if (code !== 0 || hasExceeded) reject(new Error('directory listing failed'))
        else resolve(Buffer.concat(chunks).toString('utf8'))
      })
    })
    yield* z.array(directoryEntrySchema).max(maxNames).parse(JSON.parse(output))
    return
  }
  const listing = await opendir(`/proc/self/fd/${String(directory.fd)}`, { bufferSize: 1 })
  try {
    for (let names = 0; names < maxNames; names += 1) {
      const entry = await listing.read()
      if (entry === null) break
      let kind: z.infer<typeof directoryEntrySchema>['kind'] = 'other'
      if (entry.isFile()) kind = 'file'
      else if (entry.isDirectory()) kind = 'directory'
      yield { name: entry.name, kind }
    }
  } finally {
    await listing.close()
  }
}

/** Linux supplies the opened object's name; macOS binds its canonical name to fstat. */
async function openedPath(handle: FileHandle, hint: string): Promise<string | undefined> {
  const canonical = await realpath(
    process.platform === 'linux' ? `/proc/self/fd/${String(handle.fd)}` : hint,
  )
  return sameFile(await handleIdentity(handle), await lstatIdentity(canonical))
    ? canonical
    : undefined
}

async function confinedPath(
  handle: FileHandle,
  hint: string,
  rootHandle: FileHandle,
  root: string,
): Promise<string | undefined> {
  const canonicalRoot = await openedPath(rootHandle, root)
  const canonical = await openedPath(handle, hint)
  if (canonicalRoot === undefined || canonical === undefined) return
  if (canonical !== canonicalRoot && !isBelow(path.relative(canonicalRoot, canonical), path)) return
  return canonical
}

/** Links are skipped, including linked directories; even ignored names count towards the cap. */
async function* files(root: string, maxNames: number): AsyncIterable<string> {
  if (process.platform === 'win32') {
    yield* await windowsProjectIo.files(root, maxNames)
    return
  }
  const canonical = await realpath(root)
  const rootHandle = await open(
    canonical,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    const pending = [{ name: '', depth: 0 }]
    let names = 0
    while (pending.length > 0 && names < maxNames) {
      const next = pending.shift()
      if (next === undefined) break
      const directory = path.join(canonical, next.name)
      const info = await lstat(directory)
      if (!info.isDirectory()) continue
      const directoryHandle = await open(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      try {
        // The listing uses only the checked descriptor, never the mutable pathname.
        if ((await confinedPath(directoryHandle, directory, rootHandle, canonical)) !== directory)
          continue
        const entries = directoryEntries(directoryHandle, maxNames - names)
        for await (const entry of entries) {
          names += 1
          const relative = path.join(next.name, entry.name)
          if (entry.kind === 'file') yield relative.split(path.sep).join('/')
          else if (
            entry.kind === 'directory' &&
            next.depth < MAKER_DETECT_MAX_DEPTH &&
            !IGNORED.has(entry.name)
          ) {
            pending.push({ name: relative, depth: next.depth + 1 })
          }
        }
      } finally {
        await directoryHandle.close()
      }
    }
  } finally {
    await rootHandle.close()
  }
}

async function read(
  root: string,
  relative: string,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (process.platform === 'win32') return await windowsProjectIo.read(root, relative, maxBytes)
  const canonicalRoot = await realpath(root)
  const target = path.resolve(canonicalRoot, relative)
  if (!isBelow(path.relative(canonicalRoot, target), path)) return
  const info = await lstat(target)
  if (!info.isFile()) return
  const rootHandle = await open(
    canonicalRoot,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    )
    try {
      const opened = await handle.stat()
      if (
        !opened.isFile() ||
        (await confinedPath(handle, target, rootHandle, canonicalRoot)) !== target
      )
        return
      const buffer = Buffer.alloc(maxBytes)
      let filled = 0
      while (filled < maxBytes) {
        const { bytesRead } = await handle.read(buffer, filled, maxBytes - filled, filled)
        if (bytesRead === 0) break
        filled += bytesRead
      }
      return buffer.subarray(0, filled)
    } finally {
      await handle.close()
    }
  } finally {
    await rootHandle.close()
  }
}

async function volumeLabel(root: string, platform: NodeJS.Platform): Promise<string | undefined> {
  if (platform === 'darwin') {
    return path.posix.dirname(root) === '/Volumes' ? path.posix.basename(root) : undefined
  }
  if (platform !== 'linux' && platform !== 'win32') return
  if (
    platform === 'win32' &&
    path.win32.resolve(root) !== path.win32.parse(path.win32.resolve(root)).root
  )
    return
  const systemRoot = process.env['SystemRoot']
  let file = '/usr/bin/findmnt'
  if (platform === 'win32') {
    if (systemRoot === undefined || !path.win32.isAbsolute(systemRoot)) return
    file = path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
  }
  const script = `$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(root).toString('base64')}')); [Console]::Write(([IO.DriveInfo]::new($root)).VolumeLabel)`
  const args =
    platform === 'win32'
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ]
      : ['--json', '--output', 'TARGET,LABEL', '--target', root]
  const result = await new Promise<string | undefined>((resolve) => {
    execFile(
      file,
      args,
      {
        env: {},
        encoding: 'utf8',
        windowsHide: true,
        timeout: MAKER_PI_COMMAND_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: MAKER_DETECT_MAX_BYTES,
      },
      (error, stdout) => {
        resolve(error === null ? stdout : undefined)
      },
    )
  })
  if (result === undefined) return
  if (platform === 'win32') return result.trim()
  try {
    const parsed = z
      .object({
        filesystems: z.array(z.object({ target: z.string(), label: z.string().nullable() })),
      })
      .parse(JSON.parse(result))
    const mount = parsed.filesystems[0]
    return mount !== undefined && path.resolve(mount.target) === path.resolve(root)
      ? (mount.label ?? undefined)
      : undefined
  } catch (error) {
    // A malformed helper answer (not JSON, or not the schema) is no label at
    // all; anything else is a failure the caller should see.
    if (!isLabelParseFailure(error)) throw error
    return
  }
}

function isLabelParseFailure(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.name === '$ZodError')
}

export const nodeProjectDetectIo: ProjectDetectIo = { files, read, volumeLabel }
