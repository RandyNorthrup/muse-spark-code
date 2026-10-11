// BEGIN VAULT PATH GUARD
// This independent region is compiled from packaged source by the trusted bootstrap,
// before opening the mutable helper. It never comes from the cache being checked.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class VaultPathGuard
{
    private const uint Mutating = 0x000D0156, ReadControl = 0x00020000;
    private const uint OpenExisting = 3, OpenReparse = 0x00200000, BackupSemantics = 0x02000000;
    private const uint Suspended = 4, NoWindow = 0x08000000, UnicodeEnvironment = 0x400;
    private const string Everyone = "S-1-1-0", Users = "S-1-5-32-545", Authenticated = "S-1-5-11";
    private const string Servicing = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    private static readonly string CurrentUser = WindowsIdentity.GetCurrent().User.Value;
    [StructLayout(LayoutKind.Sequential)]
    private struct Mapping { internal uint Read, Write, Execute, All; }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    { internal uint Attributes; internal System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written; internal uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Startup
    { internal int Size; internal string Reserved, Desktop, Title; internal uint X, Y, Width, Height, Columns, Rows, Fill, Flags; internal short Show, ReservedBytes; internal IntPtr ReservedData, Input, Output, Error; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JobLimits
    { internal long ProcessTime, JobTime; internal uint Flags; internal UIntPtr MinWorking, MaxWorking; internal uint Active; internal UIntPtr Affinity; internal uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    { internal JobLimits Basic; internal ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; internal UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityInfo(SafeFileHandle handle, int type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll")]
    private static extern void MapGenericMask(ref uint mask, ref Mapping mapping);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, string environment, string directory, ref Startup startup, out ProcessInformation process);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int kind);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, int length);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern uint ResumeThread(IntPtr thread);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern bool TerminateProcess(IntPtr process, uint code);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static bool Trusted(string sid)
    { return sid == CurrentUser || sid == "S-1-5-18" || sid == "S-1-5-32-544"; }
    public static void AssertDescriptor(RawSecurityDescriptor descriptor, string name, bool strict)
    {
        string owner = descriptor.Owner == null ? "" : descriptor.Owner.Value;
        bool osRoot = !strict && String.Equals(name, Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows)), StringComparison.OrdinalIgnoreCase) && owner == Servicing;
        if (!Trusted(owner) && !osRoot) throw new InvalidDataException();
        var acl = descriptor.DiscretionaryAcl;
        if (acl == null) throw new InvalidDataException(); // NULL or absent DACL grants all access.
        var principals = new HashSet<string> { Everyone, Users, Authenticated };
        foreach (GenericAce entry in acl)
        {
            if ((entry.AceFlags & AceFlags.InheritOnly) != 0) continue;
            var ace = entry as CommonAce;
            if (ace == null || ace.IsCallback || (ace.AceQualifier != AceQualifier.AccessAllowed && ace.AceQualifier != AceQualifier.AccessDenied)) throw new InvalidDataException();
            if (!Trusted(ace.SecurityIdentifier.Value)) principals.Add(ace.SecurityIdentifier.Value);
        }
        foreach (string principal in principals)
        {
            // Model an outsider's possible group memberships, never the owner's token.
            for (int membership = 0; membership < 3; membership++)
            {
                uint remaining = strict ? Mutating : Mutating & ~4u; // Public ancestors may allow creating subdirectories.
                foreach (GenericAce entry in acl)
                {
                    if ((entry.AceFlags & AceFlags.InheritOnly) != 0) continue;
                    var ace = entry as CommonAce;
                    if (ace == null) throw new InvalidDataException();
                    string sid = ace.SecurityIdentifier.Value;
                    if (Trusted(sid) || !(sid == Everyone || sid == principal || (membership >= 1 && sid == Authenticated) || (membership == 2 && sid == Users))) continue;
                    // CommonAce stores the native unsigned access-mask bit pattern in an int.
                    uint mask = unchecked((uint)ace.AccessMask);
                    var mapping = new Mapping { Read = 0x00120089, Write = 0x00120116, Execute = 0x001200A0, All = 0x001F01FF };
                    MapGenericMask(ref mask, ref mapping);
                    if (ace.AceQualifier == AceQualifier.AccessDenied) remaining &= ~mask;
                    else if ((remaining & mask) != 0) throw new InvalidDataException();
                }
            }
        }
    }
    private static SafeFileHandle Hold(string name, bool strict, bool directory)
    {
        // FILE_LIST_DIRECTORY makes directory handles participate in sharing checks; metadata-only opens do not.
        var handle = CreateFile(name, ReadControl | (directory ? 0x81u : 0x80000000u), directory ? 3u : 1u, IntPtr.Zero, OpenExisting, OpenReparse | BackupSemantics, IntPtr.Zero);
        try
        {
            FileInformation information;
            if (handle.IsInvalid || !GetFileInformationByHandle(handle, out information) || (information.Attributes & 0x400) != 0 || ((information.Attributes & 0x10) != 0) != directory) throw new InvalidDataException();
            IntPtr owner, group, dacl, sacl, descriptor;
            if (GetSecurityInfo(handle, 1, 5, out owner, out group, out dacl, out sacl, out descriptor) != 0) throw new InvalidDataException();
            try
            {
                var bytes = new byte[GetSecurityDescriptorLength(descriptor)];
                Marshal.Copy(descriptor, bytes, 0, bytes.Length);
                AssertDescriptor(new RawSecurityDescriptor(bytes, 0), name, strict);
            }
            finally { LocalFree(descriptor); }
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    private static List<SafeFileHandle> Parents(string target)
    {
        var names = new Stack<string>();
        for (var parent = Directory.GetParent(target); parent != null; parent = parent.Parent) names.Push(parent.FullName);
        var handles = new List<SafeFileHandle>();
        try { foreach (string name in names) handles.Add(Hold(name, false, true)); return handles; }
        catch { foreach (var handle in handles) handle.Dispose(); throw; }
    }
    public static void Prepare(string target)
    {
        var held = Parents(target);
        try
        {
            if (Directory.Exists(target) || File.Exists(target)) throw new InvalidDataException();
            var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
            foreach (string sid in new[] { CurrentUser, "S-1-5-18", "S-1-5-32-544" })
                acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            Directory.CreateDirectory(target, acl);
            using (Hold(target, true, true)) { }
        }
        finally { foreach (var handle in held) handle.Dispose(); }
    }
    public static int Launch(string target, string digest)
    {
        var held = Parents(target);
        IntPtr job = IntPtr.Zero; var process = new ProcessInformation();
        try
        {
            held.Add(Hold(Path.GetDirectoryName(target), true, true));
            using (var file = Hold(target, true, false))
            using (var input = new FileStream(file, FileAccess.Read))
            using (var hash = SHA256.Create())
            {
                string actual = BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
                if (actual != digest) throw new InvalidDataException();
                job = CreateJobObject(IntPtr.Zero, null);
                var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
                if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(limits))) throw new InvalidDataException();
                // Join before creation: the child inherits membership atomically, including cancellation during startup.
                if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new InvalidDataException();
                // Retain this non-inheritable handle in the supervisor's OS table until process exit, not Launch return.
                job = IntPtr.Zero;
                var startup = new Startup { Size = Marshal.SizeOf(typeof(Startup)), Flags = 0x100, Input = GetStdHandle(-10), Output = GetStdHandle(-11), Error = GetStdHandle(-12) };
                // Like Node's empty Windows child environment, retain only the OS root needed by the CLR.
                string environment = "SystemRoot=" + Environment.GetFolderPath(Environment.SpecialFolder.Windows) + "\0\0";
                if (!CreateProcess(target, new StringBuilder("\"" + target + "\""), IntPtr.Zero, IntPtr.Zero, true, Suspended | NoWindow | UnicodeEnvironment, environment, Environment.GetFolderPath(Environment.SpecialFolder.System), ref startup, out process)) throw new InvalidDataException();
                var output = Console.OpenStandardOutput(); output.WriteByte(1); output.Flush();
                if (ResumeThread(process.Thread) == UInt32.MaxValue) throw new InvalidDataException();
                uint code;
                if (WaitForSingleObject(process.Process, UInt32.MaxValue) != 0 || !GetExitCodeProcess(process.Process, out code)) throw new InvalidDataException();
                return checked((int)code); // Reject OS exit codes outside the managed entry's int range.
            }
        }
        finally
        {
            if (process.Process != IntPtr.Zero) { TerminateProcess(process.Process, 1); CloseHandle(process.Process); }
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (job != IntPtr.Zero) CloseHandle(job);
            foreach (var handle in held) handle.Dispose();
        }
    }
}
}
// END VAULT PATH GUARD

// M109 P: one bounded binary request per process; no secret in argv/env/files.
// Compiled with Windows' .NET Framework compiler, not PowerShell/Add-Type.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

internal static class MuseSparkVault
{
    private const uint System32Search = 0x800;
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetDefaultDllDirectories(uint flags);
    internal const int Version = 1, KeyBytes = 32, HeaderLimit = 4096;
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = HeaderLimit };

    internal static Dictionary<string, object> Object(object value)
    {
        var result = value as Dictionary<string, object>;
        if (result == null) throw new InvalidDataException();
        return result;
    }
    internal static void Fields(Dictionary<string, object> value, params string[] names)
    {
        if (value.Count != names.Length) throw new InvalidDataException();
        foreach (var name in names) if (!value.ContainsKey(name)) throw new InvalidDataException();
    }
    internal static string Text(Dictionary<string, object> value, string name)
    {
        var text = value[name] as string;
        if (String.IsNullOrEmpty(text) || text.Length > HeaderLimit || text.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)
            throw new InvalidDataException();
        return text;
    }
    internal static void Format(Dictionary<string, object> value)
    {
        if (!(value["v"] is int) || (int)value["v"] != Version) throw new InvalidDataException();
    }
    internal static byte[] Bytes(string value, int expected)
    {
        var bytes = Convert.FromBase64String(value);
        if ((expected >= 0 && bytes.Length != expected) || Convert.ToBase64String(bytes) != value)
        { Array.Clear(bytes, 0, bytes.Length); throw new InvalidDataException(); }
        return bytes;
    }
    internal static string Identity(Dictionary<string, object> identity)
    {
        Fields(identity, "slotId", "vaultId", "tier");
        var slot = Text(identity, "slotId"); var vault = Text(identity, "vaultId"); var tier = Text(identity, "tier");
        if (!System.Text.RegularExpressions.Regex.IsMatch(slot, "\\A[a-f0-9]{32}\\z") ||
            !System.Text.RegularExpressions.Regex.IsMatch(vault, "\\A[a-f0-9]{32}\\z") ||
            (tier != "osStore" && tier != "hardware" && tier != "presence")) throw new InvalidDataException();
        return "MuseSparkVault." + vault + "." + slot + "." + tier;
    }
    internal static byte[] Read(Stream input, int count)
    {
        var bytes = new byte[count]; int offset = 0;
        try
        {
            while (offset < count) { int read = input.Read(bytes, offset, count - offset); if (read == 0) throw new InvalidDataException(); offset += read; }
            return bytes;
        }
        catch { Array.Clear(bytes, 0, bytes.Length); throw; }
    }
    internal static void Reply(object metadata, byte[] key)
    {
        var header = Encoding.UTF8.GetBytes(Json.Serialize(metadata));
        if (header.Length > HeaderLimit) throw new InvalidDataException();
        using (var output = Console.OpenStandardOutput())
        {
            var length = BitConverter.GetBytes(header.Length); if (BitConverter.IsLittleEndian) Array.Reverse(length);
            output.Write(length, 0, length.Length); output.Write(header, 0, header.Length);
            if (key != null) output.Write(key, 0, key.Length);
            output.Flush();
        }
    }
    private static Dictionary<string, object> Ok()
    { return new Dictionary<string, object> { { "v", Version }, { "status", "ok" } }; }
    internal static byte[] WrapDpapi(byte[] key, string identity)
    { return ProtectedData.Protect(key, Encoding.UTF8.GetBytes(identity), DataProtectionScope.CurrentUser); }
    internal static byte[] UnwrapDpapi(byte[] wrapped, string identity)
    { return ProtectedData.Unprotect(wrapped, Encoding.UTF8.GetBytes(identity), DataProtectionScope.CurrentUser); }
    private static bool DpapiAvailable()
    {
        var key = new byte[KeyBytes]; byte[] wrapped = null;
        try
        {
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(key);
            wrapped = WrapDpapi(key, "MuseSparkVault.probe");
            return true;
        }
        catch { return false; }
        finally
        {
            Array.Clear(key, 0, key.Length);
            if (wrapped != null) Array.Clear(wrapped, 0, wrapped.Length);
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        byte[] key = null; byte[] outputKey = null;
        try
        {
            if (!SetDefaultDllDirectories(System32Search)) throw new InvalidOperationException();
            if (args.Length != 0) throw new InvalidDataException();
            Dictionary<string, object> request;
            using (var input = Console.OpenStandardInput())
            {
                var lengthBytes = Read(input, sizeof(int)); if (BitConverter.IsLittleEndian) Array.Reverse(lengthBytes);
                var length = BitConverter.ToInt32(lengthBytes, 0);
                if (length <= 0 || length > HeaderLimit) throw new InvalidDataException();
                var header = Read(input, length);
                try { request = Object(Json.DeserializeObject(new UTF8Encoding(false, true).GetString(header))); }
                finally { Array.Clear(header, 0, header.Length); }
                Format(request);
                key = Read(input, Text(request, "operation") == "wrap" ? KeyBytes : 0);
                if (input.ReadByte() != -1) throw new InvalidDataException();
            }
            string operation = Text(request, "operation"); var reply = Ok();
            if (operation == "probe")
            {
                Fields(request, "v", "operation");
                var capabilities = VaultCng.Probe();
                reply.Add("rsa", capabilities[0]); reply.Add("ecc", capabilities[1]);
                reply.Add("hello", VaultHello.IsSupported());
                reply.Add("dpapi", DpapiAvailable());
            }
            else if (operation == "screenLock")
            {
                Fields(request, "v", "operation");
                VaultScreenLock.Wait(); reply.Add("locked", true);
            }
            else
            {
                var identity = Object(request["identity"]); string name = Identity(identity);
                string tier = Text(identity, "tier");
                if (operation == "delete")
                {
                    Fields(request, "v", "operation", "identity");
                    if (tier != "osStore") { VaultCng.Delete(name); if (tier == "presence") VaultHello.Delete(name); }
                }
                else if (operation == "wrap")
                {
                    Fields(request, "v", "operation", "identity", "title", "use");
                    Text(request, "title"); Text(request, "use");
                    var container = new Dictionary<string, object> { { "v", Version }, { "identity", identity } };
                    byte[] wrapped = null;
                    try
                    {
                        if (tier == "osStore") wrapped = WrapDpapi(key, name);
                        else
                        {
                            using (var window = VaultHello.Window(request, tier == "presence"))
                            {
                                string publicKey = tier == "presence" ? VaultHello.Create(name) : null;
                                try { wrapped = VaultCng.Wrap(name, key, window, Text(request, "title"), Text(request, "use")); }
                                catch { if (tier == "presence") VaultHello.Delete(name); throw; }
                                container.Add("helloPublicKey", publicKey);
                            }
                        }
                        if (tier == "osStore") container.Add("helloPublicKey", null);
                        container.Add("sealed", Convert.ToBase64String(wrapped)); reply.Add("container", container);
                    }
                    finally { if (wrapped != null) Array.Clear(wrapped, 0, wrapped.Length); }
                }
                else if (operation == "unwrap")
                {
                    Fields(request, "v", "operation", "identity", "container", "title", "use", "challenge");
                    Text(request, "title"); Text(request, "use");
                    var challenge = Bytes(Text(request, "challenge"), KeyBytes); Array.Clear(challenge, 0, challenge.Length);
                    var container = Object(request["container"]);
                    Fields(container, "v", "identity", "sealed", "helloPublicKey"); Format(container);
                    if (Identity(Object(container["identity"])) != name) throw new InvalidDataException();
                    if (tier != "presence" && container["helloPublicKey"] != null) throw new InvalidDataException();
                    var sealedKey = Bytes(Text(container, "sealed"), tier == "osStore" ? -1 : VaultCng.RsaBytes);
                    try
                    {
                        if (tier == "osStore") outputKey = UnwrapDpapi(sealedKey, name);
                        else using (var window = VaultHello.Window(request, tier == "presence"))
                        {
                            if (tier == "presence") reply.Add("presence", VaultHello.Sign(name, request, Text(container, "helloPublicKey")));
                            if (window != null && (window.IsDisposed || !window.Visible)) throw new CryptographicException();
                            outputKey = VaultCng.Unwrap(name, sealedKey, window, tier == "presence");
                        }
                    }
                    finally { Array.Clear(sealedKey, 0, sealedKey.Length); }
                    if (outputKey.Length != KeyBytes) throw new CryptographicException();
                }
                else throw new InvalidDataException();
            }
            Reply(reply, outputKey); return 0;
        }
        catch
        {
            // Never relay an exception, path, account, OS diagnostic or caller text.
            Reply(new { v = Version, status = "error", code = "refused" }, null); return 1;
        }
        finally
        {
            if (key != null) Array.Clear(key, 0, key.Length);
            if (outputKey != null) Array.Clear(outputKey, 0, outputKey.Length);
        }
    }
}
}
