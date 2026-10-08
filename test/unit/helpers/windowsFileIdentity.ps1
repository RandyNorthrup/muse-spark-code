# Ordinary Win32 opens: the oracle is volume serial + file index, not spelling.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class WindowsFileIdentity
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access,
        uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectoryW(string name, IntPtr security);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetFileType(SafeFileHandle handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFullPathNameW(string name, uint capacity, StringBuilder path, IntPtr part);

    public static int Directory(string name)
    {
        return CreateDirectoryW(name, IntPtr.Zero) ? 0 : Marshal.GetLastWin32Error();
    }

    public static string Open(string name, bool create)
    {
        using (SafeFileHandle handle = CreateFileW(name, 0, 7, IntPtr.Zero,
            create ? 4u : 3u, 0x02000000, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), name);
            uint type = GetFileType(handle);
            // NUL is a character device and has no disk file index.
            if (type == 2) return "character-device:2";
            FileInfo info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return String.Format("{0:X8}:{1:X8}{2:X8}", info.Volume, info.IndexHigh, info.IndexLow);
        }
    }

    public static string Normalize(string name)
    {
        // CreateFileW bypasses normalization for the exact extended prefix.
        // Calling GetFullPathNameW explicitly would opt back into normalization.
        if (name.StartsWith(@"\\?\")) return name;
        StringBuilder path = new StringBuilder(32768);
        uint length = GetFullPathNameW(name, 32768, path, IntPtr.Zero);
        if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (length >= 32768) throw new InvalidOperationException("Native path exceeded buffer");
        return path.ToString();
    }

    public static int OpenError(string name)
    {
        try { Open(name, false); return 0; }
        catch (Win32Exception error) { return error.NativeErrorCode; }
    }
}
'@
if ($args[0] -eq '--oracle') {
    $RootPath = $args[1]
    foreach ($DirectoryName in @('a', 'a..', 'a. ')) {
        $DirectoryError = [WindowsFileIdentity]::Directory("$RootPath\$DirectoryName\")
        if ($DirectoryError -ne 0) { throw "CreateDirectoryW failed: $DirectoryError" }
        $null = [WindowsFileIdentity]::Open("$RootPath\$DirectoryName\child", $true)
    }
    $null = [WindowsFileIdentity]::Open("$RootPath\name", $true)
    $null = [WindowsFileIdentity]::Open("$RootPath\literal", $true)
    $null = [WindowsFileIdentity]::Open("$RootPath\nul.txt", $true)
    $null = [WindowsFileIdentity]::Open("\\?\$RootPath\literal.", $true)
    $Pairs = @(
        @('name.', 'name', '', ''),
        @('name ', 'name', '', ''),
        @('name. .', 'name', '', ''),
        @('a.\child', 'a\child', 'a.\', 'a\'),
        @('a..\child', 'a\child', 'a..\', 'a\'),
        @('a. \child', 'a\child', 'a. \', 'a\'),
        @('NAME', 'name', '', ''),
        @('a. \', 'a\', 'a. \', 'a\'),
        @("\\?\$RootPath\literal.", 'literal', '', ''),
        @('NUL', 'nul', '', ''),
        @('nul.txt', 'NUL.TXT', '', '')
    )
    $Rows = foreach ($Pair in $Pairs) {
        $FirstPath = if ($Pair[0].StartsWith('\\?\')) { $Pair[0] } else { "$RootPath\$($Pair[0])" }
        $SecondPath = "$RootPath\$($Pair[1])"
        $FirstFolder = "$RootPath\$($Pair[2])"
        $SecondFolder = "$RootPath\$($Pair[3])"
        $IsDevice = $Pair[0] -eq 'NUL'
        $DeviceDirectoryError = if ($IsDevice) { [WindowsFileIdentity]::Directory($FirstPath) } else { $null }
        @{
            first = $FirstPath; second = $SecondPath
            firstFolder = $FirstFolder; secondFolder = $SecondFolder
            firstId = [WindowsFileIdentity]::Open($FirstPath, $false)
            secondId = [WindowsFileIdentity]::Open($SecondPath, $false)
            firstFolderId = [WindowsFileIdentity]::Open($FirstFolder, $false)
            secondFolderId = [WindowsFileIdentity]::Open($SecondFolder, $false)
            firstNormalized = [WindowsFileIdentity]::Normalize($FirstPath)
            secondNormalized = [WindowsFileIdentity]::Normalize($SecondPath)
            isDevice = $IsDevice
            deviceDirectoryError = $DeviceDirectoryError
            deviceDirectoryOpenError = if ($IsDevice) { [WindowsFileIdentity]::OpenError("\\?\$FirstPath") } else { $null }
        }
    }
    ConvertTo-Json -InputObject @($Rows) -Compress
} else {
    foreach ($FilePath in $args) {
        [WindowsFileIdentity]::Open($FilePath, $false)
    }
}
