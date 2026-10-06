// Node has no final-path-by-handle or directory-by-handle API on Windows.
// This private helper performs the complete bounded operation on its own held handles.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { z } from 'zod'
import {
  CHECK_COMMAND_MAX_CHARS,
  MAKER_DETECT_MAX_BYTES,
  MAKER_DETECT_MAX_DEPTH,
  MAKER_DETECT_MAX_FILES,
  MAKER_DETECT_IO_TIMEOUT_MS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_PSMODULEPATH_SEGMENTS,
  WINDOWS_PSMODULEPATH_VARIABLE,
} from '../../../shared/constants'
import { resolveWorkspacePath } from '../../workspacePath'
import { relativePathSchema } from './presetOffers'

const NATIVE_SOURCE = String.raw`
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MuseProjectIo {
  const uint ReadAccess = 0x80000000, ShareReadWrite = 3, OpenExisting = 3;
  const uint BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
  const uint DirectoryAttribute = 16, ReparseAttribute = 1024, DiskFileType = 1;
  const int NameCapacity = 32768, DirectoryBufferSize = 65536;
  const int AttributesOffset = 56, NameLengthOffset = 60, NameOffset = 64;
  const int NoMoreFiles = unchecked((int)0x80000006);
  [StructLayout(LayoutKind.Sequential)] struct Information {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status, Bytes; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint length, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file, out Information information);
  [DllImport("kernel32.dll")] static extern uint GetFileType(SafeFileHandle file);
  [DllImport("ntdll.dll")] static extern int NtQueryDirectoryFile(SafeFileHandle file, IntPtr e, IntPtr a, IntPtr c, ref IoStatus status, IntPtr buffer, uint length, uint informationClass, [MarshalAs(UnmanagedType.U1)] bool single, IntPtr name, [MarshalAs(UnmanagedType.U1)] bool restart);
  static SafeFileHandle Open(string path, bool root) {
    var file = CreateFile(path, ReadAccess, ShareReadWrite, IntPtr.Zero, OpenExisting, BackupSemantics | (root ? 0 : OpenReparsePoint), IntPtr.Zero);
    if (file.IsInvalid) { file.Dispose(); throw new IOException("open"); }
    return file;
  }
  static uint Attributes(SafeFileHandle file) {
    Information info;
    if (GetFileType(file) != DiskFileType || !GetFileInformationByHandle(file, out info)) throw new IOException("identity");
    return info.Attributes;
  }
  static string FinalPath(SafeFileHandle file) {
    var name = new StringBuilder(NameCapacity);
    var length = GetFinalPathNameByHandle(file, name, (uint)name.Capacity, 0);
    if (length == 0 || length >= name.Capacity) throw new IOException("path");
    return name.ToString();
  }
  static bool Confined(SafeFileHandle file, string expected, SafeFileHandle root) {
    // Root's no-share-delete handle pins its identity and name throughout the operation.
    var basePath = FinalPath(root).TrimEnd('\\') + "\\";
    var actual = FinalPath(file);
    return String.Equals(actual, expected, StringComparison.Ordinal) &&
      (String.Equals(actual.TrimEnd('\\'), basePath.TrimEnd('\\'), StringComparison.Ordinal) || actual.StartsWith(basePath, StringComparison.Ordinal));
  }
  public static string Read(string root, string relative, int maxBytes) {
    using (var baseHandle = Open(root, true)) {
      if ((Attributes(baseHandle) & DirectoryAttribute) == 0) throw new IOException("root");
      var target = Path.Combine(FinalPath(baseHandle), relative.Replace('/', '\\'));
      using (var file = Open(target, false)) {
        if ((Attributes(file) & (DirectoryAttribute | ReparseAttribute)) != 0 || !Confined(file, target, baseHandle)) return null;
        using (var stream = new FileStream(file, FileAccess.Read, maxBytes, false)) {
          var bytes = new byte[maxBytes]; int filled = 0, count;
          while (filled < bytes.Length && (count = stream.Read(bytes, filled, bytes.Length - filled)) != 0) filled += count;
          return Convert.ToBase64String(bytes, 0, filled);
        }
      }
    }
  }
  public static string[] Files(string root, int maxNames, int maxDepth) {
    var result = new List<string>();
    var ignored = new HashSet<string>(new [] { ".git", "node_modules", ".pio", "build", "dist", ".venv", "__pycache__" });
    using (var baseHandle = Open(root, true)) {
      if ((Attributes(baseHandle) & DirectoryAttribute) == 0) throw new IOException("root");
      var basePath = FinalPath(baseHandle);
      var pending = new Queue<Tuple<string,int>>(); pending.Enqueue(Tuple.Create("", 0));
      int seen = 0;
      while (pending.Count > 0 && seen < maxNames) {
        var next = pending.Dequeue(); var target = next.Item1 == "" ? basePath : Path.Combine(basePath, next.Item1);
        using (var file = Open(target, false)) {
          if ((Attributes(file) & (DirectoryAttribute | ReparseAttribute)) != DirectoryAttribute || !Confined(file, target, baseHandle)) continue;
          var buffer = Marshal.AllocHGlobal(DirectoryBufferSize);
          try {
            var status = new IoStatus(); bool restart = true;
            while (seen < maxNames) {
              var code = NtQueryDirectoryFile(file, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, ref status, buffer, DirectoryBufferSize, 1, true, IntPtr.Zero, restart); restart = false;
              if (code == NoMoreFiles) break;
              if (code != 0 || status.Bytes.ToInt64() < NameOffset) throw new IOException("listing");
              var length = Marshal.ReadInt32(buffer, NameLengthOffset);
              if (length < 0 || length % 2 != 0 || length > status.Bytes.ToInt64() - NameOffset) throw new IOException("name");
              var name = Marshal.PtrToStringUni(IntPtr.Add(buffer, NameOffset), length / 2);
              if (name == "." || name == "..") continue;
              seen++; var attributes = (uint)Marshal.ReadInt32(buffer, AttributesOffset);
              if ((attributes & ReparseAttribute) != 0) continue;
              var relative = Path.Combine(next.Item1, name);
              if ((attributes & DirectoryAttribute) == 0) result.Add(relative.Replace('\\', '/'));
              else if (next.Item2 < maxDepth && !ignored.Contains(name)) pending.Enqueue(Tuple.Create(relative, next.Item2 + 1));
            }
          } finally { Marshal.FreeHGlobal(buffer); }
        }
      }
    }
    return result.ToArray();
  }
}`

async function run(root: string, relative: string | undefined, limit: number): Promise<unknown> {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined || !path.win32.isAbsolute(systemRoot))
    throw new Error('system-directory')
  const request = Buffer.from(
    JSON.stringify({ root, relative, limit, depth: MAKER_DETECT_MAX_DEPTH }),
  ).toString('base64')
  const script = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
${NATIVE_SOURCE}
'@
$r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}')) | ConvertFrom-Json
if ($null -eq $r.relative) { $result = @([MuseProjectIo]::Files($r.root, $r.limit, $r.depth)) }
else { $result = [MuseProjectIo]::Read($r.root, $r.relative, $r.limit) }
[Console]::Write((ConvertTo-Json -Compress -InputObject $result))`
  return await new Promise<unknown>((resolve, reject) => {
    execFile(
      path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        // Only Windows' own cmdlet modules; no inherited environment or user module path.
        env: {
          [WINDOWS_PSMODULEPATH_VARIABLE]: path.win32.join(
            systemRoot,
            ...WINDOWS_PSMODULEPATH_SEGMENTS.systemRoot,
          ),
        },
        windowsHide: true,
        encoding: 'utf8',
        timeout: MAKER_DETECT_IO_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: MAKER_DETECT_MAX_FILES * CHECK_COMMAND_MAX_CHARS,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error instanceof Error ? error : new Error('native helper failed'))
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error('native helper response'))
        }
      },
    )
  })
}

export const windowsProjectIo = {
  async files(root: string, maxNames: number): Promise<string[]> {
    return z
      .array(z.string().max(CHECK_COMMAND_MAX_CHARS))
      .max(maxNames)
      .parse(await run(root, undefined, maxNames))
  },
  async read(root: string, relative: string, maxBytes: number): Promise<Uint8Array | undefined> {
    if (
      !relativePathSchema.safeParse(relative).success ||
      !resolveWorkspacePath(root, relative, 'win32').ok
    )
      return
    const result = z
      .string()
      .max(MAKER_DETECT_MAX_BYTES * 2)
      .regex(/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/)
      .nullable()
      .parse(await run(root, relative, maxBytes))
    if (result === null) return
    const bytes = Buffer.from(result, 'base64')
    if (bytes.length > maxBytes) throw new Error('byte limit')
    return bytes
  },
}
