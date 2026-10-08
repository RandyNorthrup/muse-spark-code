# Exercise ordinary Win32 opens, without Node/libuv's extended-path prefix.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class WindowsFileIdentity
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access,
        uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,
        StringBuilder path, uint capacity, uint flags);

    public static string Open(string name)
    {
        using (SafeFileHandle handle = CreateFileW(name, 0, 7, IntPtr.Zero, 3, 0, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            StringBuilder path = new StringBuilder(1024);
            uint length = GetFinalPathNameByHandleW(handle, path, 1024, 0);
            if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (length >= 1024) throw new InvalidOperationException("Native path exceeded buffer");
            return path.ToString();
        }
    }
}
'@
foreach ($FilePath in $args) {
    [WindowsFileIdentity]::Open($FilePath)
}
