// Windows binding for Devices storage (P-I-WINDOWS-STORAGE). A small native
// helper, compiled once per source like the job helpers, answers one request
// per line for the life of the binding: it reads owner, DACL, attributes and
// link count from one opened handle, installs an owner-only DACL on a path
// this process has just created, flushes a directory, and replaces with
// MoveFileEx write-through. Every decision is made here, from its readings.
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { Socket } from 'node:net'
import path from 'node:path'
import { isOwnerOnlyAcl } from '../../core/fs/ownerOnlyAcl'
import type { DeviceStorageProtection } from '../../core/devices/storageProtection'
import { compileJob, jobFileName, type JobBuild } from '../backend/jobBuild'
import type { RunProgram } from '../processTree'
import { WINDOWS_HANDLE_INTEROP } from '../windowsHandleInterop'

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

const SOURCE = String.raw`using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class MuseSparkDeviceStorage {${WINDOWS_HANDLE_INTEROP}
    [DllImport("advapi32.dll")]
    private static extern uint SetSecurityInfo(SafeFileHandle file, uint type, uint provided,
        byte[] owner, IntPtr group, byte[] dacl, IntPtr sacl);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool MoveFileEx(string source, string target, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool FlushFileBuffers(SafeFileHandle file);
    private static string Native(string target) {
        if (target.StartsWith(@"\\?\")) return target;
        if (target.StartsWith(@"\\")) return @"\\?\UNC\" + target.Substring(2);
        return @"\\?\" + target;
    }
    // Backup semantics opens directories; the reparse point itself, never its target.
    private static SafeFileHandle Open(string target, uint access) {
        var handle = CreateFile(Native(target), access, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        return handle;
    }
    private static FileInfo Information(SafeFileHandle handle) {
        FileInfo info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return info;
    }
    private static string Inspect(string target) {
        using (var handle = Open(target, 0x00020000 | 0x80)) {
            var info = Information(handle);
            IntPtr owner, group, dacl, sacl, descriptor;
            uint code = GetSecurityInfo(handle, 1, 1 | 4, out owner, out group, out dacl, out sacl, out descriptor);
            if (code != 0) throw new Win32Exception((int)code);
            byte[] bytes;
            try {
                bytes = new byte[checked((int)GetSecurityDescriptorLength(descriptor))];
                Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            } finally { LocalFree(descriptor); }
            var parsed = new RawSecurityDescriptor(bytes, 0);
            var aces = new StringBuilder();
            if (parsed.DiscretionaryAcl == null) aces.Append("null");
            else foreach (GenericAce ace in parsed.DiscretionaryAcl) {
                if (aces.Length > 0) aces.Append(';');
                var common = ace as CommonAce;
                if (common == null) { aces.Append("other"); continue; }
                aces.Append((int)common.AceQualifier).Append(',').Append((int)common.AceFlags).Append(',')
                    .Append((uint)common.AccessMask).Append(',').Append(common.SecurityIdentifier.Value);
            }
            return (parsed.Owner == null ? "none" : parsed.Owner.Value) + "|" +
                WindowsIdentity.GetCurrent().User.Value + "|" +
                ((parsed.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0 ? "1" : "0") + "|" +
                info.Attributes + "|" + info.Links + "|" + aces;
        }
    }
    private static void Secure(string target, bool isDirectory) {
        using (var handle = Open(target, 0x00020000 | 0x00040000 | 0x00080000 | 0x80)) {
            var info = Information(handle);
            if ((info.Attributes & 0x400) != 0 || ((info.Attributes & 0x10) != 0) != isDirectory ||
                (!isDirectory && info.Links != 1))
                throw new Win32Exception(1);
            var sid = WindowsIdentity.GetCurrent().User;
            var acl = new RawAcl(GenericAcl.AclRevision, 1);
            acl.InsertAce(0, new CommonAce(isDirectory ? AceFlags.ContainerInherit | AceFlags.ObjectInherit : AceFlags.None,
                AceQualifier.AccessAllowed, ${String(FULL_CONTROL)}, sid, false, null));
            var daclBytes = new byte[acl.BinaryLength];
            acl.GetBinaryForm(daclBytes, 0);
            var ownerBytes = new byte[sid.BinaryLength];
            sid.GetBinaryForm(ownerBytes, 0);
            // Owner and DACL; the protected flag drops everything inherited.
            uint code = SetSecurityInfo(handle, 1, 1 | 4 | 0x80000000, ownerBytes, IntPtr.Zero, daclBytes, IntPtr.Zero);
            if (code != 0) throw new Win32Exception((int)code);
        }
    }
    private static string Argument(string[] parts, int index) {
        return Encoding.UTF8.GetString(Convert.FromBase64String(parts[index]));
    }
    private static string Handle(string[] parts) {
        switch (parts[1]) {
            case "ping": return "${HELPER_TOKEN}";
            case "inspect":
                var readings = new string[parts.Length - 2];
                for (int index = 2; index < parts.Length; index++) readings[index - 2] = Inspect(Argument(parts, index));
                return string.Join("\t", readings);
            case "secure": Secure(Argument(parts, 2), parts[3] == "1"); return "";
            case "replace":
                if (!MoveFileEx(Native(Argument(parts, 2)), Native(Argument(parts, 3)), 1 | 8))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return "";
            case "sync":
                using (var handle = Open(Argument(parts, 2), 0x40000000)) {
                    if (!FlushFileBuffers(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                return "";
            default: throw new ArgumentException("operation");
        }
    }
    public static int Main() {
        var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        output.AutoFlush = true;
        output.NewLine = "\n";
        string line;
        while ((line = input.ReadLine()) != null) {
            var parts = line.Split('\t');
            try { output.WriteLine(parts[0] + "\tok\t" + Handle(parts)); }
            catch (Win32Exception error) { output.WriteLine(parts[0] + "\terr\t" + error.NativeErrorCode); }
            catch (Exception) { output.WriteLine(parts[0] + "\terr\t0"); }
        }
        return 0;
    }
}
`

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
 * Nobody else can take over `directory`, swap one of its entries, or rename
 * it out of `parent` and plant another. Readable ancestors are fine; a
 * directory others may add to, but not delete from, is fine too.
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
    } catch {
      return false
    }
  },
}

/** The helper's file name for this source. */
export function storageHelperName(): string {
  return jobFileName(HELPER, SOURCE)
}

/**
 * Starts the helper as one long-lived child answering in request order. It is
 * unreferenced while idle, so it never holds the host open, and it ends when
 * our stdin closes. A dead, garbled or mismatched helper fails every request.
 */
export function startStorageHelper(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { request: StorageHelperRequest; dispose: () => void } {
  const child = spawn(executable, [...args], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    env,
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
        child.kill()
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
      pending.push({
        id,
        settle(line) {
          if (line instanceof Error) {
            reject(line)
            return
          }
          const [answerId, status, ...rest] = line.split('\t')
          if (answerId !== id) {
            fail(new Error('storage-protection'))
            child.kill()
            reject(new Error('storage-protection'))
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
    dispose() {
      child.stdin.end()
      fail(new Error('storage-protection'))
    },
  }
}

/** Compiles once per source into `directory`, starts the helper and proves it answers. */
export async function startWindowsStorageProtection(options: {
  readonly directory: string
  readonly systemRoot: string
  readonly run?: RunProgram
}): Promise<{ protection: DeviceStorageProtection; dispose: () => void }> {
  const executable = path.join(options.directory, storageHelperName())
  if (!(await HELPER.isPresent(executable)))
    await compileJob(HELPER, executable, SOURCE, options.systemRoot, options.run)
  const helper = startStorageHelper(executable, [], { SystemRoot: options.systemRoot })
  try {
    if ((await helper.request('ping', [])) !== HELPER_TOKEN) throw new Error('storage-protection')
  } catch (error) {
    helper.dispose()
    throw error
  }
  return { protection: windowsStorageProtection(helper.request), dispose: helper.dispose }
}
