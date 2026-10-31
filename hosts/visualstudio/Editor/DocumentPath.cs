using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using MuseSpark.VisualStudio.Protocol;

namespace MuseSpark.VisualStudio.Editor
{
  // Windows names one file many ways: `\\?\` and `\\?\UNC\` prefixes, `.`/`..`, 8.3 aliases, junctions,
  // other drive letters for one volume. Documents are compared by what the file system resolves, not by spelling.
  internal static class DocumentPath
  {
    private const string ExtendedPrefix = @"\\?\";
    private const string ExtendedUncPrefix = @"\\?\UNC\";
    private const uint FileReadAttributes = 0x80;
    private const uint ShareAll = 0x1 | 0x2 | 0x4;
    private const uint OpenExisting = 3;
    private const uint BackupSemantics = 0x02000000;
    private const uint NameNormalizedDos = 0;

    internal static string Normalize(string path) => Path.GetFullPath(Plain(path)).Replace('\\', '/');

    internal static bool Equal(string left, string right)
    {
      var first = Identity(left);
      return first != null && string.Equals(first, Identity(right), StringComparison.OrdinalIgnoreCase);
    }

    // The volume and file index of an existing file (one key for every spelling, hard links included), else the
    // resolved final path of its nearest existing ancestor with the missing tail appended. Null for no disk path.
    internal static string? Identity(string path)
    {
      string full;
      try
      {
        var plain = Plain(path);
        // A volume GUID path or a drive-relative path names no fixed file here.
        if (!IsFullyQualified(plain)) return null;
        full = Path.GetFullPath(plain);
      }
      // RDT also closes virtual buffers whose moniker is not a filesystem path.
      catch (Exception error) when (error is ArgumentException || error is NotSupportedException || error is PathTooLongException) { return null; }
      using (var handle = Open(full))
      {
        // A zero index means the file system keeps none; such files are told apart by path.
        if (handle != null && GetFileInformationByHandle(handle, out var info) && (info.FileIndexHigh | info.FileIndexLow) != 0)
          return "file:" + Hex(info.VolumeSerialNumber) + ":" + Hex(info.FileIndexHigh) + Hex(info.FileIndexLow);
      }
      return "path:" + Resolved(full);
    }

    internal static string Parse(string source)
    {
      if (!Uri.TryCreate(source, UriKind.Absolute, out var uri) || !uri.IsFile || uri.IsUnc)
        throw new MhpException("invalidParams", "MHP_INVALID_EDITOR_POSITION");
      return uri.LocalPath;
    }

    // The plain spelling behind an extended-length prefix (as src/host/editor/editReview.ts strips it).
    private static string Plain(string path)
    {
      var native = path.Replace('/', '\\');
      if (native.StartsWith(ExtendedUncPrefix, StringComparison.OrdinalIgnoreCase)) return @"\\" + native.Substring(ExtendedUncPrefix.Length);
      return native.StartsWith(ExtendedPrefix, StringComparison.Ordinal) ? native.Substring(ExtendedPrefix.Length) : native;
    }

    private static bool IsFullyQualified(string path)
    {
      var native = path.Replace('/', '\\');
      if (native.StartsWith(@"\\", StringComparison.Ordinal)) return native.Length > 2;
      return native.Length >= 3 && char.IsLetter(native[0]) && native[1] == ':' && native[2] == '\\';
    }

    private static string Resolved(string full)
    {
      var tail = new List<string>();
      var root = Path.GetPathRoot(full) ?? full;
      var current = full.Length > root.Length ? full.TrimEnd('\\') : full;
      while (true)
      {
        using (var handle = Open(current))
          if (handle != null && FinalPath(handle) is string final)
          {
            tail.Reverse();
            tail.Insert(0, final);
            return Path.Combine(tail.ToArray());
          }
        var parent = Path.GetDirectoryName(current);
        // Not even the root exists (an unmounted drive): nothing resolves.
        if (parent == null) return full;
        tail.Add(Path.GetFileName(current));
        current = parent;
      }
    }

    private static SafeFileHandle? Open(string full)
    {
      var extended = full.StartsWith(@"\\", StringComparison.Ordinal) ? ExtendedUncPrefix + full.Substring(2) : ExtendedPrefix + full;
      var handle = CreateFileW(extended, FileReadAttributes, ShareAll, IntPtr.Zero, OpenExisting, BackupSemantics, IntPtr.Zero);
      if (!handle.IsInvalid) return handle;
      handle.Dispose();
      return null;
    }

    private static string? FinalPath(SafeFileHandle handle)
    {
      var buffer = new char[512];
      while (true)
      {
        var length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Length, NameNormalizedDos);
        if (length == 0) return null;
        if (length < buffer.Length) return Plain(new string(buffer, 0, (int)length));
        buffer = new char[length + 1];
      }
    }

    private static string Hex(uint value) => value.ToString("x8", System.Globalization.CultureInfo.InvariantCulture);

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
      public uint FileAttributes;
      public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
      public uint VolumeSerialNumber;
      public uint FileSizeHigh;
      public uint FileSizeLow;
      public uint NumberOfLinks;
      public uint FileIndexHigh;
      public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, [Out] char[] path, uint length, uint flags);
  }
}
