// Devices storage helper (P-I-WINDOWS-STORAGE), compiled once per source by
// src/host/devices/windowsStorageProtection.ts and run as one long-lived child.
// One request per line: id, operation, base64 UTF-8 paths. It only reads,
// claims a path the caller has just created, flushes and replaces; every
// decision is made in TypeScript from its readings.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class MuseSparkDeviceStorage {
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
        IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityInfo(SafeFileHandle file, uint type, uint requested,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

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
                AceQualifier.AccessAllowed, 2032127, sid, false, null));
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
            case "ping": return "MuseSparkDeviceStorage";
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
