// Windows binding for Devices storage (P-I-WINDOWS-STORAGE). A small native
// helper, compiled once per source like the job helpers, answers one request
// per line for the life of the binding: it reads owner, DACL, attributes and
// link count from one opened handle, installs an owner-only DACL on a path
// this process has just created, flushes a directory, and replaces with
// MoveFileEx write-through. Every decision is made here, from its readings.
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { Socket } from 'node:net'
import path from 'node:path'
import { isErrno } from '../../core/fs/errno'
import { isOwnerOnlyAcl } from '../../core/fs/ownerOnlyAcl'
import type { DeviceStorageProtection } from '../../core/devices/storageProtection'
import { compileJob } from '../backend/jobBuild'
import { jobFileName, type JobBuild } from '../backend/staleJobs'
import type { RunProgram } from '../processTree'

const HELPER_TOKEN = 'MuseSparkDeviceStorage'
// Win32 values the readings carry (winnt.h).
const ATTRIBUTE_DIRECTORY = 0x10
const ATTRIBUTE_REPARSE_POINT = 0x4_00
const ACE_ALLOWED = 0
const ACE_DENIED = 1
const FLAG_OBJECT_INHERIT = 0x1
const FLAG_CONTAINER_INHERIT = 0x2
const FLAG_INHERIT_ONLY = 0x8
const FLAG_INHERITED = 0x10
const FULL_CONTROL = 0x1f_01_ff
const ADD_FILE = 0x2
const ADD_SUBDIRECTORY = 0x4
const DELETE_CHILD = 0x40
const DELETE = 0x1_00_00
const WRITE_DAC = 0x4_00_00
const WRITE_OWNER = 0x8_00_00
const GENERIC_ALL = 0x10_00_00_00
const GENERIC_WRITE = 0x40_00_00_00
const GENERIC_WRITE_RIGHTS = ADD_FILE | ADD_SUBDIRECTORY
// Principals that already control the machine or this account.
const SYSTEM_SID = 'S-1-5-18'
const ADMINISTRATORS_SID = 'S-1-5-32-544'
const TRUSTED_INSTALLER_SID = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'

/** The helper's C#, shipped beside the bundles (PLAN.md D6) and read when it is first built. */
export const DEVICE_STORAGE_SOURCE = path.join('native', 'windows', `${HELPER_TOKEN}.cs`)

/** One helper request: an operation and absolute native paths; resolves to its answer. */
export type StorageHelperRequest = (
  operation: 'ping' | 'inspect' | 'secure' | 'replace' | 'sync',
  paths: readonly string[],
  isDirectory?: boolean,
) => Promise<string>

export interface StorageAce {
  readonly qualifier: number
  readonly flags: number
  readonly mask: number
  readonly sid: string
}
/** What the helper read from one opened handle. `aces` is undefined for a null or unreadable DACL. */
export interface StorageReading {
  readonly ownerSid: string
  readonly currentSid: string
  readonly protected: boolean
  readonly attributes: number
  readonly links: number
  readonly aces: readonly StorageAce[] | undefined
}

const SID = /^S-1(?:-\d+)+$/
// owner|current|protected|attributes|links|aces, and type,flags,mask,sid per ACE.
const READING_FIELDS = 6
const ACE_FIELDS = 4
const NUMBER = /^\d+$/
function count(text: string | undefined): number {
  if (text === undefined || !NUMBER.test(text)) throw new Error('storage-protection')
  return Number(text)
}
function sid(text: string | undefined): string {
  if (text === undefined || !SID.test(text)) throw new Error('storage-protection')
  return text
}

export function parseStorageReading(text: string): StorageReading {
  const fields = text.split('|')
  if (fields.length !== READING_FIELDS) throw new Error('storage-protection')
  const [owner, current, isProtected, attributes, links, aces] = fields
  if (isProtected !== '0' && isProtected !== '1') throw new Error('storage-protection')
  let rows: StorageAce[] | undefined = []
  const entries = aces === '' ? [] : (aces ?? '').split(';')
  for (const entry of entries) {
    const parts = entry.split(',')
    if (parts.length !== ACE_FIELDS) {
      // A null DACL (anyone) or an object/callback ACE: not readable as owner-only.
      rows = undefined
      break
    }
    rows.push({
      qualifier: count(parts[0]),
      flags: count(parts[1]),
      mask: count(parts[2]),
      sid: sid(parts[3]),
    })
  }
  return {
    ownerSid: owner === 'none' ? '' : sid(owner),
    currentSid: sid(current),
    protected: isProtected === '1',
    attributes: count(attributes),
    links: count(links),
    aces: rows,
  }
}

/** The exact owner-only shape `secureFresh` installs: one explicit full-control rule. */
export function isPrivateReading(reading: StorageReading, isDirectory: boolean): boolean {
  if (
    Boolean(reading.attributes & ATTRIBUTE_REPARSE_POINT) ||
    Boolean(reading.attributes & ATTRIBUTE_DIRECTORY) !== isDirectory ||
    (!isDirectory && reading.links !== 1) ||
    reading.aces === undefined
  )
    return false
  const flags = isDirectory ? FLAG_OBJECT_INHERIT | FLAG_CONTAINER_INHERIT : 0
  return (
    reading.aces.every((ace) => ace.flags === flags) &&
    isOwnerOnlyAcl({
      ownerSid: reading.ownerSid,
      currentSid: reading.currentSid,
      protected: reading.protected,
      rules: reading.aces.map((ace) => ({
        sid: ace.sid,
        inherited: Boolean(ace.flags & FLAG_INHERITED),
        allow: ace.qualifier === ACE_ALLOWED,
        fullControl: ace.mask === FULL_CONTROL,
      })),
    })
  )
}

function isTrusted(reading: StorageReading, principal: string): boolean {
  return [reading.currentSid, SYSTEM_SID, ADMINISTRATORS_SID, TRUSTED_INSTALLER_SID].includes(
    principal,
  )
}
/** Rights any other principal holds on the object itself; undefined grants everything. */
function othersRights(reading: StorageReading): number {
  if (reading.aces === undefined) return FULL_CONTROL | GENERIC_ALL
  let rights = 0
  for (const ace of reading.aces) {
    if (ace.qualifier === ACE_DENIED) continue
    if (ace.qualifier !== ACE_ALLOWED) return FULL_CONTROL | GENERIC_ALL
    if (Boolean(ace.flags & FLAG_INHERIT_ONLY) || isTrusted(reading, ace.sid)) continue
    rights |= ace.mask
    if (ace.mask & GENERIC_ALL) rights |= FULL_CONTROL
    if (ace.mask & GENERIC_WRITE) rights |= GENERIC_WRITE_RIGHTS
  }
  return rights
}

/**
Nobody else can take over `directory`, swap one of its entries, or rename
it out of `parent` and plant another. Readable ancestors are fine; a
directory others may add to, but not delete from, is fine too.
*/
export function isSafeAncestorReading(
  directory: StorageReading,
  parent: StorageReading | undefined,
): boolean {
  if (
    Boolean(directory.attributes & ATTRIBUTE_REPARSE_POINT) ||
    !(directory.attributes & ATTRIBUTE_DIRECTORY) ||
    !isTrusted(directory, directory.ownerSid)
  )
    return false
  const rights = othersRights(directory)
  if (rights & (WRITE_DAC | WRITE_OWNER | GENERIC_ALL)) return false
  const canAdd = (value: number) => Boolean(value & (ADD_FILE | ADD_SUBDIRECTORY))
  if (rights & DELETE_CHILD && canAdd(rights)) return false
  if (parent === undefined) return true
  const parentRights = othersRights(parent)
  return !(Boolean(rights & DELETE || parentRights & DELETE_CHILD) && canAdd(parentRights))
}

/** The binding over any helper port; tests drive it with recorded readings. */
export function windowsStorageProtection(request: StorageHelperRequest): DeviceStorageProtection {
  async function assertPrivate(file: string, isDirectory: boolean): Promise<void> {
    const reading = parseStorageReading(await request('inspect', [file]))
    if (!isPrivateReading(reading, isDirectory)) throw new Error('storage-protection')
  }
  return {
    assertPrivate,
    async assertSafeAncestor(directory) {
      // The whole chain to the root in one request, each folder with its parent.
      const chain = [directory]
      for (let next = path.dirname(directory); next !== chain.at(-1); next = path.dirname(next))
        chain.push(next)
      const answer = await request('inspect', chain)
      const readings = answer.split('\t').map((text) => parseStorageReading(text))
      if (
        readings.length !== chain.length ||
        readings.some((reading, index) => !isSafeAncestorReading(reading, readings[index + 1]))
      )
        throw new Error('storage-protection')
    },
    async secureFresh(file, isDirectory) {
      await request('secure', [file], isDirectory)
      await assertPrivate(file, isDirectory)
    },
    async replace(stage, target) {
      await request('replace', [stage, target])
    },
    async syncDirectory(directory) {
      await request('sync', [directory])
    },
  }
}

const HELPER: JobBuild = {
  stem: `${HELPER_TOKEN}-`,
  extension: '.exe',
  outputType: 'exe',
  references: [],
  label: 'Devices storage helper',
  isPresent: async (file) => {
    try {
      const info = await stat(file)
      return info.isFile()
    } catch (error) {
      if (isErrno(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false
      throw error
    }
  },
}

/** The helper's file name for this source: a changed source builds a new helper. */
export function storageHelperName(csharp: string): string {
  return jobFileName(HELPER, csharp)
}

/** One running helper child. `exited` settles once its process has ended. */
export interface StorageHelper {
  readonly request: StorageHelperRequest
  readonly hasFailed: () => boolean
  readonly exited: Promise<void>
  readonly dispose: () => void
}

/**
Starts the helper as one long-lived child answering in request order. It is
unreferenced while idle, so it never holds the host open, and it ends when
our stdin closes. `deadlineMs` is the caller's own deadline; without one a
request waits until the helper answers, dies or is disposed (no deadline of
ours, PLAN.md D121). A late, dead, garbled or mismatched helper fails that
request and every other one waiting, and is killed.
*/
export function startStorageHelper(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  deadlineMs?: number,
): StorageHelper {
  const child = spawn(executable, [...args], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    env,
  })
  const exited = new Promise<void>((resolve) => {
    child.once('close', () => {
      resolve()
    })
  })
  const pending: { id: string; settle: (line: string | Error) => void }[] = []
  let failure: Error | undefined
  let buffer = ''
  let sequence = 0
  const streams = [child.stdin, child.stdout]
  const idle = () => {
    child.unref()
    for (const stream of streams) if (stream instanceof Socket) stream.unref()
  }
  const fail = (error: Error) => {
    failure ??= error
    for (const waiter of pending.splice(0)) waiter.settle(failure)
    child.kill()
    idle()
  }
  child.on('error', fail)
  child.on('exit', () => {
    fail(new Error('storage-protection'))
  })
  child.stdin.on('error', fail)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      const waiter = pending.shift()
      if (waiter === undefined) {
        fail(new Error('storage-protection'))
        return
      }
      waiter.settle(line)
    }
    if (pending.length === 0) idle()
  })
  idle()
  const request: StorageHelperRequest = (operation, paths, isDirectory) =>
    new Promise<string>((resolve, reject) => {
      if (failure !== undefined) {
        reject(failure)
        return
      }
      if (paths.some((item) => !path.win32.isAbsolute(item))) {
        reject(new Error('storage-protection'))
        return
      }
      sequence += 1
      const id = String(sequence)
      // A helper that stops answering fails this request and all others,
      // but only on a deadline the caller passed.
      const deadline =
        deadlineMs === undefined
          ? undefined
          : setTimeout(() => {
              fail(new Error('storage-protection'))
            }, deadlineMs)
      pending.push({
        id,
        settle(line) {
          if (deadline !== undefined) clearTimeout(deadline)
          if (line instanceof Error) {
            reject(line)
            return
          }
          const [answerId, status, ...rest] = line.split('\t')
          if (answerId !== id) {
            reject(new Error('storage-protection'))
            fail(new Error('storage-protection'))
          } else if (status === 'ok') resolve(rest.join('\t'))
          else reject(new Error('storage-protection'))
        },
      })
      child.ref()
      for (const stream of streams) if (stream instanceof Socket) stream.ref()
      const fields = paths.map((item) => Buffer.from(item, 'utf8').toString('base64'))
      if (isDirectory !== undefined) fields.push(isDirectory ? '1' : '0')
      child.stdin.write(`${[id, operation, ...fields].join('\t')}\n`)
    })
  return {
    request,
    hasFailed: () => failure !== undefined,
    exited,
    dispose() {
      child.stdin.end()
      fail(new Error('storage-protection'))
    },
  }
}

/**
One helper at a time. After one fails (late, dead, garbled), the next
request starts a fresh helper; nothing retries the failed request itself.
Disposal ends the current helper and refuses every later request.
*/
export function supervisedStorageHelper(start: () => StorageHelper): {
  readonly request: StorageHelperRequest
  readonly current: () => StorageHelper | undefined
  readonly dispose: () => void
} {
  let helper: StorageHelper | undefined
  let isDisposed = false
  return {
    request(operation, paths, isDirectory) {
      if (isDisposed) return Promise.reject(new Error('storage-protection'))
      if (helper === undefined || helper.hasFailed()) {
        helper?.dispose()
        helper = start()
      }
      return helper.request(operation, paths, isDirectory)
    },
    current: () => helper,
    dispose() {
      isDisposed = true
      helper?.dispose()
    },
  }
}

/**
Reads the shipped C# from `extensionPath`, compiles it once per source into
`directory`, starts the helper and proves it answers. The caller owns
`dispose`, which ends the helper process.
*/
export async function startWindowsStorageProtection(options: {
  readonly directory: string
  readonly systemRoot: string
  readonly extensionPath: string
  readonly run?: RunProgram
}): Promise<{
  protection: DeviceStorageProtection
  current: () => StorageHelper | undefined
  dispose: () => void
}> {
  const csharp = await readFile(path.join(options.extensionPath, DEVICE_STORAGE_SOURCE), 'utf8')
  const executable = path.join(options.directory, storageHelperName(csharp))
  if (!(await HELPER.isPresent(executable)))
    await compileJob(HELPER, executable, csharp, options.systemRoot, options.run)
  const helper = supervisedStorageHelper(() =>
    startStorageHelper(executable, [], { SystemRoot: options.systemRoot }),
  )
  try {
    if ((await helper.request('ping', [])) !== HELPER_TOKEN) throw new Error('storage-protection')
  } catch (error) {
    helper.dispose()
    throw error
  }
  return {
    protection: windowsStorageProtection(helper.request),
    current: helper.current,
    dispose: helper.dispose,
  }
}
