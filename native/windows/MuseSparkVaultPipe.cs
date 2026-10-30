// The vault broker's named-pipe helper (docs/design/vault-windows-pipe-helper.md).
// serve mode owns the owner-only pipe and relays each accepted connection to
// the broker over its standard streams; files mode answers file and
// process/server queries for any other process. Standard error carries only
// fixed words, never a path, SID or byte of payload.
//
// The build concatenates the VAULT PATH GUARD region of MuseSparkVault.cs
// with this file, so VaultPathGuard (Protect, Verify, Prepare, Launch) is
// shared, not copied. This file holds no secret, key or credential logic.
namespace MuseSparkVaultNative
{
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class MuseSparkVaultPipe
{
    private const int RelayVersion = 1;
    private const int HeaderBytes = 9;
    // VAULT_LIMITS.frameBytes: one relay payload never exceeds it.
    private const int FrameLimit = 4 * 1024 * 1024;
    // WINDOWS_VAULT_PIPE_MAX_CONNECTIONS: at most this many simultaneous
    // clients; ids start at 1 and are never reused, without an upper bound.
    private const int MaxConnections = 64;
    private const int PipeBufferBytes = 65536;
    private const int NameHex = 32;

    private const byte Ready = 0x01, Open = 0x02, Data = 0x03, End = 0x04, Fault = 0x05;
    private const byte FileResult = 0x06, ServerResult = 0x07, ProcessResult = 0x08;
    private const byte Send = 0x13, Close = 0x14, File = 0x21, Server = 0x22, Process = 0x23;

    private const uint PipeAccessDuplex = 0x3;
    private const uint FileFlagFirstPipeInstance = 0x00080000;
    private const uint FileFlagOverlapped = 0x40000000;
    private const uint PipeTypeByte = 0x00000000, PipeReadmodeByte = 0x00000000;
    private const uint PipeRejectRemoteClients = 0x00000008;
    private const uint PipeUnlimitedInstances = 255;
    private const uint GenericRead = 0x80000000, GenericWrite = 0x40000000;
    private const uint OpenExisting = 3;
    private const uint SecuritySqosPresent = 0x00100000, SecurityIdentification = 0x00010000;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint TokenQuery = 0x0008;
    private const int TokenUserClass = 1;
    private const uint ErrorPipeConnected = 535, ErrorPipeBusy = 231, ErrorAccessDenied = 5;
    private const uint ErrorFileNotFound = 2, ErrorInvalidParameter = 87, ErrorSemTimeout = 121, NmpwaitUseDefaultWait = 0;
    private const uint SeKernelObject = 6;
    private const uint OwnerSecurityInformation = 0x00000001, DaclSecurityInformation = 0x00000004;
    private const uint GenericAllMask = 0x10000000;
    // GENERIC_ALL as the kernel stores it on a pipe: mapped through the
    // file object's generic mapping to FILE_ALL_ACCESS.
    private const uint FileAllAccessMask = 0x001F01FF;
    private const ulong FiletimeToUnixBias = 116444736000000000UL;
    private const ulong FiletimeTicksPerMillisecond = 10000UL;
    private const int HeaderLimit = 4096;

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    { internal int Length; internal IntPtr Descriptor; internal bool Inherit; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Filetime
    { internal uint Low; internal uint High; }
    [StructLayout(LayoutKind.Sequential)]
    private struct TokenUserRecord
    { internal IntPtr Sid; }

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maxInstances, uint outBuffer, uint inBuffer, uint timeout, ref SecurityAttributes security);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ConnectNamedPipe(SafeHandle handle, IntPtr overlapped);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DisconnectNamedPipe(SafeHandle handle);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeClientProcessId(SafeHandle pipe, out uint clientProcessId);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetNamedPipeClientComputerName(SafeHandle pipe, StringBuilder name, uint length);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeServerProcessId(SafeHandle pipe, out uint serverProcessId);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool WaitNamedPipe(string name, uint timeout);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr process, out Filetime creation, out Filetime exit, out Filetime kernel, out Filetime user);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int informationClass, ref ProcessBasicInformation information, int length, out int returned);
    private struct ProcessBasicInformation
    {
        internal IntPtr Reserved1, PebBaseAddress, Reserved2a, Reserved2b, UniqueProcessId, InheritedFromUniqueProcessId;
    }
    private const int ProcessBasicInformationClass = 0;
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint length);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr information, uint length, out uint returned);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr text);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr descriptor, out uint length);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityInfo(SafeHandle handle, uint objectType, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = FrameLimit };
    private static readonly string OwnerSid = WindowsIdentity.GetCurrent().User.Value;
    private static readonly object OutputLock = new object();
    private static readonly object TableLock = new object();
    private static readonly Dictionary<int, Connection> Connections = new Dictionary<int, Connection>();
    private static int NextId;
    private static bool Shutdown;
    private static SafeHandle ListenHandle;

    private sealed class Connection
    {
        internal int Id;
        internal NamedPipeServerStream Stream;
        internal bool Closed;
        internal readonly object WriteLock = new object();
    }

    private static Dictionary<string, object> Object(object value)
    {
        var result = value as Dictionary<string, object>;
        if (result == null) throw new InvalidDataException();
        return result;
    }
    private static void Fields(Dictionary<string, object> value, params string[] names)
    {
        if (value.Count != names.Length) throw new InvalidDataException();
        foreach (string name in names) if (!value.ContainsKey(name)) throw new InvalidDataException();
    }
    private static string Text(Dictionary<string, object> value, string name)
    {
        var text = value[name] as string;
        if (String.IsNullOrEmpty(text) || text.Length > HeaderLimit || text.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)
            throw new InvalidDataException();
        return text;
    }
    private static int Counter(Dictionary<string, object> value, string name)
    {
        if (!(value[name] is int)) throw new InvalidDataException();
        int counter = (int)value[name];
        if (counter < 0) throw new InvalidDataException();
        return counter;
    }
    private static bool ValidPipeName(string name)
    {
        if (name == null || !name.StartsWith(@"\\.\pipe\muse-spark-vault-", StringComparison.Ordinal)) return false;
        string tail = name.Substring(@"\\.\pipe\muse-spark-vault-".Length);
        return tail.Length == NameHex && Regex.IsMatch(tail, @"\A[a-f0-9]{32}\z");
    }
    private static bool ValidAbsolutePath(string path)
    {
        return path.Length > 3 && ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) &&
            path[1] == ':' && path[2] == '\\' && path.IndexOfAny(new[] { '\0', '\r', '\n' }) < 0;
    }

    private static byte[] ReadExact(Stream input, int count, bool allowEof)
    {
        var bytes = new byte[count]; int offset = 0;
        try
        {
            while (offset < count)
            {
                int read = input.Read(bytes, offset, count - offset);
                if (read == 0)
                {
                    if (allowEof && offset == 0) return null;
                    throw new InvalidDataException();
                }
                offset += read;
            }
            return bytes;
        }
        catch { Array.Clear(bytes, 0, bytes.Length); throw; }
    }
    private static void WriteFrame(byte type, int id, byte[] payload)
    {
        var header = new byte[HeaderBytes];
        header[0] = type;
        WriteBigEndian(header, 1, id);
        WriteBigEndian(header, 5, payload == null ? 0 : payload.Length);
        lock (OutputLock)
        {
            using (var output = Console.OpenStandardOutput())
            {
                output.Write(header, 0, header.Length);
                if (payload != null && payload.Length > 0) output.Write(payload, 0, payload.Length);
                output.Flush();
            }
        }
    }
    private static void WriteBigEndian(byte[] header, int offset, int value)
    {
        header[offset] = (byte)((value >> 24) & 0xFF);
        header[offset + 1] = (byte)((value >> 16) & 0xFF);
        header[offset + 2] = (byte)((value >> 8) & 0xFF);
        header[offset + 3] = (byte)(value & 0xFF);
    }
    private static void Fail(string word)
    {
        try
        {
            WriteFrame(Fault, 0, Encoding.UTF8.GetBytes("\"" + word + "\""));
            Console.Error.WriteLine("vault-pipe-fault " + word);
        }
        catch { }
        Environment.Exit(1);
    }

    private static string TokenUserSid(IntPtr process)
    {
        IntPtr token = IntPtr.Zero;
        try
        {
            if (!OpenProcessToken(process, TokenQuery, out token) || token == IntPtr.Zero) return null;
            uint length;
            GetTokenInformation(token, TokenUserClass, IntPtr.Zero, 0, out length);
            if (length == 0) return null;
            IntPtr information = Marshal.AllocHGlobal((int)length);
            try
            {
                uint returned;
                if (!GetTokenInformation(token, TokenUserClass, information, length, out returned)) return null;
                var user = (TokenUserRecord)Marshal.PtrToStructure(information, typeof(TokenUserRecord));
                IntPtr text;
                if (!ConvertSidToStringSid(user.Sid, out text) || text == IntPtr.Zero) return null;
                try { return Marshal.PtrToStringUni(text); }
                finally { LocalFree(text); }
            }
            finally { Marshal.FreeHGlobal(information); }
        }
        finally { if (token != IntPtr.Zero) CloseHandle(token); }
    }
    private static long StartedAtMillis(IntPtr process)
    {
        Filetime created, exit, kernel, user;
        if (!GetProcessTimes(process, out created, out exit, out kernel, out user)) return -1;
        ulong filetime = ((ulong)created.High << 32) | created.Low;
        if (filetime < FiletimeToUnixBias) return -1;
        return (long)((filetime - FiletimeToUnixBias) / FiletimeTicksPerMillisecond);
    }
    private static string ImagePath(IntPtr process)
    {
        var name = new StringBuilder(32767); uint length = (uint)name.Capacity;
        if (!QueryFullProcessImageName(process, 0, name, ref length)) return null;
        return name.ToString(0, (int)length);
    }
    // D216: the parent pid from the kernel's own process record, for the
    // broker's feeder ancestry walk; 0 when the OS names no parent.
    private static long ParentProcessId(IntPtr process)
    {
        var information = new ProcessBasicInformation();
        int returned;
        int status = NtQueryInformationProcess(process, ProcessBasicInformationClass,
            ref information, Marshal.SizeOf(information), out returned);
        if (status != 0) return -1;
        long parent = information.InheritedFromUniqueProcessId.ToInt64();
        return parent < 0 || parent > int.MaxValue ? -1 : parent;
    }
    private static Dictionary<string, object> ProcessRecord(uint processId)
    {
        IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero) return null;
        try
        {
            string user = TokenUserSid(process);
            long startedAt = StartedAtMillis(process);
            string executable = ImagePath(process);
            long parentProcessId = ParentProcessId(process);
            if (user == null || startedAt < 0 || executable == null || parentProcessId < 0) return null;
            return new Dictionary<string, object>
            {
                { "processId", (int)processId }, { "userId", user },
                { "startedAt", startedAt }, { "executable", executable },
                { "parentProcessId", (int)parentProcessId },
            };
        }
        finally { CloseHandle(process); }
    }

    // Exactly the owner-only DACL the pipe is created with: protected, one
    // allow ACE granting generic-all to the helper's own token user (read
    // back mapped to FILE_ALL_ACCESS, the form the kernel stores).
    private static bool IsOwnerOnlyPipe(SafeHandle handle)
    {
        IntPtr owner, group, dacl, sacl, descriptor;
        if (GetSecurityInfo(handle, SeKernelObject, OwnerSecurityInformation | DaclSecurityInformation,
            out owner, out group, out dacl, out sacl, out descriptor) != 0) return false;
        try
        {
            var bytes = new byte[GetSecurityDescriptorLength(descriptor)];
            Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            var security = new RawSecurityDescriptor(bytes, 0);
            if ((security.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0) return false;
            if (security.Owner == null || security.Owner.Value != OwnerSid) return false;
            var acl = security.DiscretionaryAcl;
            if (acl == null || acl.Count != 1) return false;
            var ace = acl[0] as CommonAce;
            if (ace == null || ace.AceQualifier != AceQualifier.AccessAllowed) return false;
            if (ace.SecurityIdentifier.Value != OwnerSid) return false;
            uint mask = unchecked((uint)ace.AccessMask);
            return mask == FileAllAccessMask || mask == GenericAllMask;
        }
        catch { return false; }
        finally { LocalFree(descriptor); }
    }

    private static Dictionary<string, object> ClientRecord(SafeHandle handle, bool ownerOnlyDacl)
    {
        uint processId;
        if (!GetNamedPipeClientProcessId(handle, out processId) || processId == 0) return null;
        var name = new StringBuilder(256); uint capacity = (uint)name.Capacity;
        // A successful read names a remote client, which the broker refuses.
        bool remote = GetNamedPipeClientComputerName(handle, name, capacity);
        IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero) return null;
        try
        {
            string user = TokenUserSid(process);
            long startedAt = StartedAtMillis(process);
            string executable = ImagePath(process);
            if (user == null || startedAt < 0 || executable == null || !ValidAbsolutePath(executable)) return null;
            return new Dictionary<string, object>
            {
                { "v", RelayVersion }, { "processId", (int)processId }, { "userId", user },
                { "startedAt", startedAt }, { "executable", executable },
                { "remote", remote }, { "ownerOnlyDacl", ownerOnlyDacl },
            };
        }
        finally { CloseHandle(process); }
    }

    private static void SendEnd(int id)
    {
        WriteFrame(End, id, null);
    }
    private static void RemoveConnection(int id, bool notify)
    {
        Connection removed = null;
        lock (TableLock)
        {
            Connection found;
            if (Connections.TryGetValue(id, out found)) { Connections.Remove(id); removed = found; }
        }
        if (removed == null) return;
        lock (removed) { removed.Closed = true; }
        try { DisconnectNamedPipe(removed.Stream.SafePipeHandle); }
        catch { }
        try { removed.Stream.Dispose(); }
        catch { }
        if (notify)
        {
            try { SendEnd(id); }
            catch { }
        }
    }
    private static void ReadPump(object state)
    {
        var connection = (Connection)state;
        var buffer = new byte[PipeBufferBytes];
        for (;;)
        {
            int read;
            try { read = connection.Stream.Read(buffer, 0, buffer.Length); }
            catch { break; }
            if (read <= 0) break;
            var payload = new byte[read];
            try
            {
                Buffer.BlockCopy(buffer, 0, payload, 0, read);
                WriteFrame(Data, connection.Id, payload);
            }
            catch { Array.Clear(payload, 0, payload.Length); break; }
            finally { Array.Clear(payload, 0, payload.Length); }
        }
        Array.Clear(buffer, 0, buffer.Length);
        RemoveConnection(connection.Id, true);
    }
    // One owner-only instance of the pipe. Only the first may fail as
    // squatted: it carries FILE_FLAG_FIRST_PIPE_INSTANCE, so a pipe of that
    // name that already exists is another process's.
    private static SafePipeHandle CreateInstance(string pipe, bool first)
    {
        var security = new SecurityAttributes();
        IntPtr descriptor = IntPtr.Zero;
        uint length;
        try
        {
            if (!ConvertStringSecurityDescriptorToSecurityDescriptor(
                "O:" + OwnerSid + "G:" + OwnerSid + "D:P(A;;GA;;;" + OwnerSid + ")", 1, out descriptor, out length))
                throw new InvalidOperationException();
            security.Length = Marshal.SizeOf(typeof(SecurityAttributes));
            security.Descriptor = descriptor;
            security.Inherit = false;
            // Overlapped, so a connection's waiting read never holds back its
            // writes: synchronous calls on one handle run one at a time, and an
            // answer could never leave while the read waits for the client.
            uint openMode = PipeAccessDuplex | FileFlagOverlapped;
            if (first) openMode |= FileFlagFirstPipeInstance;
            SafePipeHandle handle = CreateNamedPipe(pipe, openMode, PipeTypeByte | PipeReadmodeByte | PipeRejectRemoteClients,
                PipeUnlimitedInstances, PipeBufferBytes, PipeBufferBytes, 0, ref security);
            if (handle == null || handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                if (handle != null) handle.Dispose();
                if (first && (error == (int)ErrorAccessDenied || error == (int)ErrorPipeBusy))
                {
                    WriteFrame(Fault, 0, Encoding.UTF8.GetBytes("\"squatted\""));
                    Console.Error.WriteLine("vault-pipe-fault squatted");
                    Environment.Exit(1);
                }
                throw new InvalidOperationException();
            }
            return handle;
        }
        finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    private static void AcceptLoop(string pipe)
    {
        bool first = true;
        SafePipeHandle next = null;
        for (;;)
        {
            lock (TableLock) { if (Shutdown) return; }
            SafePipeHandle handle = null;
            try
            {
                if (next == null)
                {
                    next = CreateInstance(pipe, first);
                    if (first)
                    {
                        bool ownerOnly = IsOwnerOnlyPipe(next);
                        var ready = new Dictionary<string, object>
                        { { "v", RelayVersion }, { "pipe", pipe }, { "ownerSid", OwnerSid } };
                        if (!ownerOnly)
                        {
                            WriteFrame(Fault, 0, Encoding.UTF8.GetBytes("\"integrity\""));
                            Console.Error.WriteLine("vault-pipe-fault integrity");
                            Environment.Exit(1);
                        }
                        WriteFrame(Ready, 0, Encoding.UTF8.GetBytes(Json.Serialize(ready)));
                        first = false;
                    }
                }
                handle = next;
                next = null;
                // The async stream owns the instance from here and waits for its
                // client (an overlapped handle needs an overlapped connect).
                var listening = new NamedPipeServerStream(PipeDirection.InOut, true, false, handle);
                lock (TableLock) { ListenHandle = handle; }
                bool connected;
                // A client that connected and already closed before the wait
                // (ERROR_NO_DATA) leaves this instance nothing to serve.
                try { listening.WaitForConnection(); connected = true; }
                catch (IOException) { connected = false; }
                lock (TableLock) { ListenHandle = null; }
                // The next instance exists before this one can be released, so the
                // pipe's name never vanishes between connections: a client never
                // meets a missing pipe while the broker runs (an instance released
                // before the next existed left none, and a client dialing then
                // failed with ENOENT), and no other process can create a first
                // instance of it. A failed creation is retried at the top of the
                // loop while this instance still holds the name.
                try { next = CreateInstance(pipe, false); }
                catch (InvalidOperationException) { next = null; }
                if (!connected)
                {
                    listening.Dispose();
                    handle = null;
                    continue;
                }
                int simultaneous;
                lock (TableLock) { simultaneous = Connections.Count; }
                if (simultaneous >= MaxConnections)
                {
                    try { DisconnectNamedPipe(handle); }
                    catch { }
                    listening.Dispose();
                    handle = null;
                    continue;
                }
                var record = ClientRecord(handle, true);
                if (record == null)
                {
                    try { DisconnectNamedPipe(handle); }
                    catch { }
                    listening.Dispose();
                    handle = null;
                    continue;
                }
                int id;
                lock (TableLock)
                {
                    if (Shutdown) throw new InvalidOperationException();
                    id = ++NextId;
                    handle = null;
                    var connection = new Connection { Id = id, Stream = listening };
                    Connections.Add(id, connection);
                    try { WriteFrame(Open, id, Encoding.UTF8.GetBytes(Json.Serialize(record))); }
                    catch { RemoveConnection(id, false); continue; }
                    var thread = new Thread(ReadPump);
                    thread.IsBackground = true;
                    thread.Start(connection);
                }
            }
            catch
            {
                lock (TableLock) { ListenHandle = null; }
                if (handle != null && !handle.IsInvalid) handle.Dispose();
                lock (TableLock) { if (Shutdown) return; }
                Thread.Sleep(100);
            }
        }
    }

    private static string FileAnswer(int id, string command, string kind, string path)
    {
        string result;
        try
        {
            bool directory = kind == "directory";
            if (command == "protect") VaultPathGuard.Protect(path, directory);
            else VaultPathGuard.Verify(path, directory);
            result = "ok";
        }
        catch (FileNotFoundException) { result = "missing"; }
        catch (DirectoryNotFoundException) { result = "missing"; }
        catch { result = "refused"; }
        var answer = new Dictionary<string, object> { { "v", RelayVersion }, { "id", id }, { "result", result } };
        return Json.Serialize(answer);
    }
    private static void OnFile(Dictionary<string, object> request)
    {
        Fields(request, "v", "id", "command", "kind", "path");
        if (!(request["v"] is int) || (int)request["v"] != RelayVersion) throw new InvalidDataException();
        int id = Counter(request, "id");
        string command = Text(request, "command"), kind = Text(request, "kind"), path = Text(request, "path");
        if ((command != "protect" && command != "verify") || (kind != "directory" && kind != "file")) throw new InvalidDataException();
        if (!ValidAbsolutePath(path) || path.Length > HeaderLimit) throw new InvalidDataException();
        WriteFrame(FileResult, 0, Encoding.UTF8.GetBytes(FileAnswer(id, command, kind, path)));
    }
    private static void OnServer(Dictionary<string, object> request)
    {
        Fields(request, "v", "id", "pipe");
        if (!(request["v"] is int) || (int)request["v"] != RelayVersion) throw new InvalidDataException();
        int id = Counter(request, "id");
        string pipe = Text(request, "pipe");
        if (!ValidPipeName(pipe)) throw new InvalidDataException();
        string result = "refused";
        Dictionary<string, object> server = null;
        // Between connections a live server can have every instance taken for
        // a moment (ERROR_PIPE_BUSY): wait for the instance its accept loop
        // makes next, as a client connect does, instead of reading it refused.
        SafeFileHandle handle;
        int openError = 0;
        for (;;)
        {
            handle = CreateFile(pipe, GenericRead | GenericWrite, 0, IntPtr.Zero, OpenExisting,
                SecuritySqosPresent | SecurityIdentification, IntPtr.Zero);
            if (handle != null && !handle.IsInvalid) break;
            openError = Marshal.GetLastWin32Error();
            if (openError != (int)ErrorPipeBusy) break;
            if (WaitNamedPipe(pipe, NmpwaitUseDefaultWait)) continue;
            openError = Marshal.GetLastWin32Error();
            if (openError != (int)ErrorSemTimeout) break;
        }
        if (handle != null && !handle.IsInvalid)
        {
            try
            {
                uint processId;
                if (GetNamedPipeServerProcessId(handle, out processId) && processId != 0)
                {
                    var record = ProcessRecord(processId);
                    if (record != null)
                    {
                        record["v"] = RelayVersion;
                        record["remote"] = false;
                        record["ownerOnlyDacl"] = IsOwnerOnlyPipe(handle);
                        server = record;
                        result = "ok";
                    }
                }
                else if (Marshal.GetLastWin32Error() == (int)ErrorFileNotFound) result = "missing";
            }
            finally { handle.Dispose(); }
        }
        else if (openError == (int)ErrorFileNotFound) result = "missing";
        var answer = new Dictionary<string, object>
        { { "v", RelayVersion }, { "id", id }, { "result", result }, { "ownerSid", OwnerSid }, { "server", server } };
        WriteFrame(ServerResult, 0, Encoding.UTF8.GetBytes(Json.Serialize(answer)));
    }
    private static void OnProcess(Dictionary<string, object> request)
    {
        Fields(request, "v", "id", "processId");
        if (!(request["v"] is int) || (int)request["v"] != RelayVersion) throw new InvalidDataException();
        int id = Counter(request, "id");
        if (!(request["processId"] is int) || (int)request["processId"] <= 0) throw new InvalidDataException();
        uint processId = unchecked((uint)(int)request["processId"]);
        string result = "refused";
        Dictionary<string, object> process = null;
        IntPtr handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle != IntPtr.Zero)
        {
            try
            {
                var record = ProcessRecord(processId);
                if (record != null) { process = record; result = "ok"; }
            }
            finally { CloseHandle(handle); }
        }
        else if (Marshal.GetLastWin32Error() == (int)ErrorInvalidParameter) result = "missing";
        var answer = new Dictionary<string, object>
        { { "v", RelayVersion }, { "id", id }, { "result", result }, { "ownerSid", OwnerSid }, { "process", process } };
        WriteFrame(ProcessResult, 0, Encoding.UTF8.GetBytes(Json.Serialize(answer)));
    }
    private static void OnSend(int id, byte[] payload)
    {
        Connection connection;
        bool opened;
        lock (TableLock) { Connections.TryGetValue(id, out connection); opened = id <= NextId; }
        if (connection == null)
        {
            // Ids are never reused, so only an id never opened is a protocol
            // fault. One that ended (its client went away; the End frame is
            // sent or on its way) drops the broker's late bytes: an answer or
            // watch event crossing the client's close used to fault the whole
            // helper, and every connection and the pipe with it.
            if (!opened) throw new InvalidDataException();
            return;
        }
        lock (connection.WriteLock)
        {
            lock (connection) { if (connection.Closed) return; }
            try
            {
                int offset = 0;
                while (offset < payload.Length)
                {
                    connection.Stream.Write(payload, offset, payload.Length - offset);
                    offset = payload.Length;
                }
                connection.Stream.Flush();
            }
            catch { RemoveConnection(id, true); }
        }
    }

    private static Dictionary<string, object> ParseJson(byte[] payload)
    {
        try { return Object(Json.DeserializeObject(Encoding.UTF8.GetString(payload))); }
        catch { throw new InvalidDataException(); }
    }
    // The first line is read byte by byte (no StreamReader: its buffer
    // would swallow the binary frames that follow on the same stream).
    private static string ReadLine(Stream input)
    {
        var bytes = new List<byte>();
        for (;;)
        {
            int next = input.ReadByte();
            if (next < 0 || next == '\n') break;
            if (next != '\r') bytes.Add((byte)next);
            if (bytes.Count > HeaderLimit) throw new InvalidDataException();
        }
        // An empty line fails the JSON parse below; truncated input exits uncleanly.
        return Encoding.UTF8.GetString(bytes.ToArray());
    }
    private static void PumpStdin(bool serve, Stream input)
    {
        for (;;)
        {
            var header = ReadExact(input, HeaderBytes, true);
            if (header == null) return;
            int id = (header[1] << 24) | (header[2] << 16) | (header[3] << 8) | header[4];
            int size = (header[5] << 24) | (header[6] << 16) | (header[7] << 8) | header[8];
            if (id < 0 || size < 0 || size > FrameLimit) Fail("protocol");
            byte[] payload = size == 0 ? new byte[0] : ReadExact(input, size, false);
            if (payload == null) Environment.Exit(1);
            try
            {
                switch (header[0])
                {
                    case Send:
                        if (id == 0 || !serve) throw new InvalidDataException();
                        OnSend(id, payload);
                        break;
                    case Close:
                        if (id == 0 || payload.Length != 0 || !serve) throw new InvalidDataException();
                        RemoveConnection(id, false);
                        break;
                    case File:
                        if (id != 0) throw new InvalidDataException();
                        OnFile(ParseJson(payload));
                        break;
                    case Server:
                        if (id != 0) throw new InvalidDataException();
                        OnServer(ParseJson(payload));
                        break;
                    case Process:
                        if (id != 0) throw new InvalidDataException();
                        OnProcess(ParseJson(payload));
                        break;
                    default: throw new InvalidDataException();
                }
            }
            catch (InvalidDataException) { Fail("protocol"); }
            finally { Array.Clear(payload, 0, payload.Length); }
        }
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 0) throw new InvalidDataException();
            using (var input = Console.OpenStandardInput())
            {
                string line = ReadLine(input);
                Dictionary<string, object> first;
                try { first = Object(Json.DeserializeObject(line)); }
                catch { return 1; }
                // The serve handshake names its pipe; files mode names nothing
                // else. Each mode's exact field set is checked before any field
                // is read, so neither can carry an extra one.
                object named;
                bool isServe = first.TryGetValue("mode", out named) && named as string == "serve";
                if (isServe) Fields(first, "v", "mode", "pipe");
                else Fields(first, "v", "mode");
                if (!(first["v"] is int) || (int)first["v"] != RelayVersion) return 1;
                string mode = Text(first, "mode");
                if (mode != "serve" && mode != "files") return 1;
                string pipe = null;
                if (mode == "serve")
                {
                    pipe = Text(first, "pipe");
                    if (!ValidPipeName(pipe)) return 1;
                }
                if (mode == "serve")
                {
                    var thread = new Thread(() => AcceptLoop(pipe));
                    thread.IsBackground = true;
                    thread.Start();
                }
                PumpStdin(mode == "serve", input);
            }
            lock (TableLock) { Shutdown = true; }
            SafeHandle listening = null;
            lock (TableLock) { listening = ListenHandle; ListenHandle = null; }
            if (listening != null && !listening.IsInvalid)
            {
                try { DisconnectNamedPipe(listening); }
                catch { }
            }
            List<Connection> remaining;
            lock (TableLock)
            {
                remaining = new List<Connection>(Connections.Values);
                Connections.Clear();
            }
            foreach (var connection in remaining)
            {
                try { DisconnectNamedPipe(connection.Stream.SafePipeHandle); }
                catch { }
                try { connection.Stream.Dispose(); }
                catch { }
            }
            return 0;
        }
        catch
        {
            // Never relay an exception, path, account, OS diagnostic or caller text.
            try { Console.Error.WriteLine("vault-pipe-fault refused"); }
            catch { }
            return 1;
        }
    }
}
}
