// M98-2j C# 5 helper. No shell, credentials or request content.
// Read the established SERVER row for the client's reversed four-tuple.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

public static class LocalJudgePeer {
  const int AF_INET = 2, AF_INET6 = 23, OWNER_PID_CONNECTIONS = 4;
  const uint ESTABLISHED = 5, QUERY_LIMITED_INFORMATION = 0x1000;
  const uint SYNCHRONIZE = 0x100000, TOKEN_QUERY = 8, WAIT_TIMEOUT = 258;
  const uint INSUFFICIENT_BUFFER = 122;

  [StructLayout(LayoutKind.Sequential)]
  struct Row4 {
    public uint State, LocalAddress, LocalPort, RemoteAddress, RemotePort, Pid;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Row6 {
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] LocalAddress;
    public uint LocalScope, LocalPort;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] RemoteAddress;
    public uint RemoteScope, RemotePort, State, Pid;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct FileTime { public uint Low, High; }
  [DataContract]
  class Identity {
    [DataMember] public uint pid;
    [DataMember] public string creationTime;
    [DataMember] public string executable;
    [DataMember] public string executableDigest;
    [DataMember] public string ownerSid;
    [DataMember] public string callerSid;
  }
  [DllImport("iphlpapi.dll")]
  static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order,
    int family, int tableClass, uint reserved);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool QueryFullProcessImageName(IntPtr process, uint flags,
    StringBuilder path, ref int size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetProcessTimes(IntPtr process, out FileTime created,
    out FileTime exited, out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll")]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

  static int Port(uint port) { return (int)(((port & 255) << 8) | ((port >> 8) & 255)); }
  static IPAddress Address4(uint address) { return new IPAddress(BitConverter.GetBytes(address)); }

  static uint Owner(IPAddress local, int localPort, IPAddress remote, int remotePort) {
    int family = local.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
      ? AF_INET : AF_INET6;
    if (local.AddressFamily != remote.AddressFamily) throw new InvalidOperationException();
    int size = 0;
    uint result = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, OWNER_PID_CONNECTIONS, 0);
    if (result != INSUFFICIENT_BUFFER || size < 4) throw new Win32Exception((int)result);
    // A growing table fails closed; the caller may retry on a new connection.
    IntPtr table = Marshal.AllocHGlobal(size);
    try {
      result = GetExtendedTcpTable(table, ref size, false, family, OWNER_PID_CONNECTIONS, 0);
      if (result != 0) throw new Win32Exception((int)result);
      int count = Marshal.ReadInt32(table);
      int rowSize = Marshal.SizeOf(family == AF_INET ? typeof(Row4) : typeof(Row6));
      if (count < 0 || count > (size - 4) / rowSize) throw new InvalidOperationException();
      var owners = new List<uint>();
      for (int i = 0; i < count; i++) {
        IntPtr at = IntPtr.Add(table, 4 + i * rowSize);
        if (family == AF_INET) {
          Row4 row = (Row4)Marshal.PtrToStructure(at, typeof(Row4));
          if (row.State == ESTABLISHED && Address4(row.LocalAddress).Equals(local)
            && Port(row.LocalPort) == localPort && Address4(row.RemoteAddress).Equals(remote)
            && Port(row.RemotePort) == remotePort) owners.Add(row.Pid);
        } else {
          Row6 row = (Row6)Marshal.PtrToStructure(at, typeof(Row6));
          if (row.State == ESTABLISHED && new IPAddress(row.LocalAddress, row.LocalScope).Equals(local)
            && Port(row.LocalPort) == localPort
            && new IPAddress(row.RemoteAddress, row.RemoteScope).Equals(remote)
            && Port(row.RemotePort) == remotePort) owners.Add(row.Pid);
        }
      }
      if (owners.Count != 1 || owners[0] == 0) throw new InvalidOperationException();
      return owners[0];
    } finally { Marshal.FreeHGlobal(table); }
  }

  public static int Main(string[] args) {
    try {
      if (args.Length == 2 && args[0] == "root") {
        string root = Path.GetFullPath(args[1]);
        var drive = new DriveInfo(Path.GetPathRoot(root));
        if (!Directory.Exists(root) || root.StartsWith(@"\\")
          || drive.DriveType != DriveType.Fixed || drive.DriveFormat != "NTFS") return 1;
        // The caller compares realpath as well to refuse junction components.
        Console.Write("{\"local\":true}");
        return 0;
      }
      if (args.Length != 4) return 1;
      IPAddress local = IPAddress.Parse(args[0]), remote = IPAddress.Parse(args[2]);
      if (!IPAddress.IsLoopback(local) || !IPAddress.IsLoopback(remote)) return 1;
      int localPort = int.Parse(args[1]), remotePort = int.Parse(args[3]);
      uint pid = Owner(local, localPort, remote, remotePort);
      // Hold this process object through the second table read: PID reuse
      // cannot replace the object named by the handle between these reads.
      IntPtr process = OpenProcess(QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, pid);
      if (process == IntPtr.Zero) throw new Win32Exception();
      try {
        var image = new StringBuilder(32768);
        int length = image.Capacity;
        if (!QueryFullProcessImageName(process, 0, image, ref length)) throw new Win32Exception();
        FileTime created, exited, kernel, user;
        if (!GetProcessTimes(process, out created, out exited, out kernel, out user)) throw new Win32Exception();
        IntPtr token;
        if (!OpenProcessToken(process, TOKEN_QUERY, out token)) throw new Win32Exception();
        string sid;
        try { using (var identity = new WindowsIdentity(token)) { sid = identity.User.Value; } }
        finally { CloseHandle(token); }
        string callerSid;
        using (var caller = WindowsIdentity.GetCurrent()) { callerSid = caller.User.Value; }
        if (sid != callerSid) throw new InvalidOperationException();
        string digest;
        using (var file = File.OpenRead(image.ToString()))
        using (var hash = SHA256.Create()) {
          digest = BitConverter.ToString(hash.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
        }
        if (Owner(local, localPort, remote, remotePort) != pid
          || WaitForSingleObject(process, 0) != WAIT_TIMEOUT) throw new InvalidOperationException();
        var answer = new Identity {
          pid = pid, creationTime = (((ulong)created.High << 32) | created.Low).ToString(),
          executable = image.ToString(), executableDigest = digest,
          ownerSid = sid, callerSid = callerSid
        };
        new DataContractJsonSerializer(typeof(Identity)).WriteObject(Console.OpenStandardOutput(), answer);
        return 0;
      } finally { CloseHandle(process); }
    } catch { Console.Error.WriteLine("unverified-peer"); return 1; }
  }
}
