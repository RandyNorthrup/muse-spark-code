// The job type the Windows shell tool's commands join (M27, PLAN.md D25),
// compiled with MuseSparkMcpJob.cs into one library on first use and kept
// out of the host bundle (PLAN.md D6). The class name is SHELL_JOB_TYPE_NAME
// in src/shared/constants.ts; test/unit/jobSource.test.ts holds them together.
// C# 5, which Windows PowerShell 5.1's Add-Type compiles. The shell keeps
// its handle for its whole life: a job's name lasts as long as a handle to
// it, and the Stop opens the job by that name.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;

public static class MuseSparkJob {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);

  const uint JOB_OBJECT_TERMINATE = 0x0008;
  static IntPtr held = IntPtr.Zero;

  // M107 T query region. Read-only rights; no limits, priority, suspension or termination.
  const uint JOB_OBJECT_QUERY = 0x0004;
  const uint PROCESS_QUERY_INFORMATION = 0x0400;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const uint PROCESS_VM_READ = 0x0010;
  const int ERROR_FILE_NOT_FOUND = 2, ERROR_INVALID_PARAMETER = 87, ERROR_MORE_DATA = 234;
  const int BASIC_ACCOUNTING = 1, BASIC_PROCESS_IDS = 3;
  const int INITIAL_PROCESS_CAPACITY = 32, MAX_PROCESS_CAPACITY = 65536, QUERY_ATTEMPTS = 3;
  const double TICKS_PER_SECOND = 10000000.0;

  [StructLayout(LayoutKind.Sequential)]
  struct JOB_ACCOUNTING {
    public long TotalUserTime, TotalKernelTime, ThisPeriodUserTime, ThisPeriodKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_MEMORY {
    public uint cb, PageFaultCount;
    public UIntPtr PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage;
    public UIntPtr QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage, PagefileUsage, PeakPagefileUsage;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("psapi.dll", SetLastError = true)]
  static extern bool GetProcessMemoryInfo(IntPtr process, ref PROCESS_MEMORY counters, uint size);

  static readonly System.Globalization.CultureInfo Invariant = System.Globalization.CultureInfo.InvariantCulture;
  static string IdentityJson(uint pid, long created) {
    return "{\"pid\":" + pid.ToString(Invariant) + ",\"startTime\":\"" + created.ToString(Invariant) + "\"}";
  }
  static IntPtr QueryJob(string name) {
    IntPtr job = OpenJobObjectW(JOB_OBJECT_QUERY, false, name);
    if (job == IntPtr.Zero && Marshal.GetLastWin32Error() != ERROR_FILE_NOT_FOUND) throw new Win32Exception();
    return job;
  }
  static IntPtr QueryProcess(uint pid, bool memory) {
    IntPtr process = OpenProcess((memory ? PROCESS_QUERY_INFORMATION | PROCESS_VM_READ : PROCESS_QUERY_LIMITED_INFORMATION) | SYNCHRONIZE, false, pid);
    if (process == IntPtr.Zero && Marshal.GetLastWin32Error() != ERROR_INVALID_PARAMETER) throw new Win32Exception();
    return process;
  }
  static long Creation(IntPtr process) {
    long created, exited, kernel, user;
    if (!GetProcessTimes(process, out created, out exited, out kernel, out user)) throw new Win32Exception();
    return created;
  }
  static bool Member(IntPtr process, IntPtr job) {
    bool member;
    if (!IsProcessInJob(process, job, out member)) throw new Win32Exception();
    return member;
  }

  /** Exact start identity, held by a process handle rather than a second-resolution table. */
  public static string Identity(uint pid) {
    IntPtr process = QueryProcess(pid, false);
    if (process == IntPtr.Zero) return "null";
    try { return IsAlive(process) ? IdentityJson(pid, Creation(process)) : "null"; }
    finally { CloseHandle(process); }
  }

  /** Same handle for both identity and job membership: the PID cannot change underneath this proof. */
  public static bool Contains(string name, uint pid, string startTime) {
    long expected;
    if (!long.TryParse(startTime, System.Globalization.NumberStyles.None, Invariant, out expected)) return false;
    IntPtr job = QueryJob(name);
    if (job == IntPtr.Zero) return false;
    try {
      IntPtr process = QueryProcess(pid, false);
      if (process == IntPtr.Zero) return false;
      try { return Creation(process) == expected && Member(process, job) && IsAlive(process); }
      finally { CloseHandle(process); }
    } finally { CloseHandle(job); }
  }

  static uint[] ProcessIds(IntPtr job) {
    int capacity = INITIAL_PROCESS_CAPACITY;
    for (int attempt = 0; attempt < QUERY_ATTEMPTS; attempt++) {
      int size = checked(8 + capacity * IntPtr.Size);
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        if (QueryInformationJobObject(job, BASIC_PROCESS_IDS, buffer, size, IntPtr.Zero)) {
          int count = Marshal.ReadInt32(buffer, 4);
          if (count < 0 || count > capacity) throw new InvalidOperationException("invalid job process count");
          uint[] ids = new uint[count];
          for (int index = 0; index < count; index++) ids[index] = checked((uint)Marshal.ReadIntPtr(buffer, 8 + index * IntPtr.Size).ToInt64());
          return ids;
        }
        int error = Marshal.GetLastWin32Error();
        if (error != ERROR_MORE_DATA) throw new Win32Exception(error);
        int assigned = Marshal.ReadInt32(buffer, 0);
        capacity = Math.Max(checked(capacity * 2), assigned);
        if (capacity > MAX_PROCESS_CAPACITY) throw new InvalidOperationException("job process count exceeds query bound");
      } finally { Marshal.FreeHGlobal(buffer); }
    }
    throw new InvalidOperationException("job membership changed during query");
  }

  /** Lifetime job CPU (including exited members), current aggregate resident working sets. */
  public static string Query(string name) {
    IntPtr job = QueryJob(name);
    if (job == IntPtr.Zero) return "null";
    try {
      var members = new List<string>();
      ulong resident = 0;
      foreach (uint pid in ProcessIds(job)) {
        IntPtr process = QueryProcess(pid, true);
        if (process == IntPtr.Zero) continue;
        try {
          if (!IsAlive(process) || !Member(process, job)) continue;
          long created = Creation(process);
          var memory = new PROCESS_MEMORY();
          memory.cb = (uint)Marshal.SizeOf(typeof(PROCESS_MEMORY));
          if (!GetProcessMemoryInfo(process, ref memory, memory.cb)) {
            if (Marshal.GetLastWin32Error() == ERROR_INVALID_PARAMETER) continue;
            throw new Win32Exception();
          }
          if (!IsAlive(process) || !Member(process, job)) continue;
          resident = checked(resident + memory.WorkingSetSize.ToUInt64());
          members.Add(IdentityJson(pid, created));
        } finally { CloseHandle(process); }
      }
      int size = Marshal.SizeOf(typeof(JOB_ACCOUNTING));
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        if (!QueryInformationJobObject(job, BASIC_ACCOUNTING, buffer, size, IntPtr.Zero)) throw new Win32Exception();
        var accounting = (JOB_ACCOUNTING)Marshal.PtrToStructure(buffer, typeof(JOB_ACCOUNTING));
        double cpu = (accounting.TotalUserTime + accounting.TotalKernelTime) / TICKS_PER_SECOND;
        return "{\"members\":[" + string.Join(",", members) + "],\"usage\":{\"cpuSeconds\":" + cpu.ToString("R", Invariant) + ",\"residentBytes\":" + resident.ToString(Invariant) + "}}";
      } finally { Marshal.FreeHGlobal(buffer); }
    } finally { CloseHandle(job); }
  }
  // End M107 T query region. Lane A adds priority/rate controls separately.

  // M107 T2 signal region. Stop/cancel only; never governor priority/rate controls.
  const uint PROCESS_TERMINATE = 0x0001, SYNCHRONIZE = 0x00100000;
  const uint WAIT_OBJECT_0 = 0, WAIT_TIMEOUT = 258;
  const uint EXIT_TERMINATED = 143, EXIT_KILLED = 137;
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint exitCode);

  static bool IsAlive(IntPtr process) {
    uint status = WaitForSingleObject(process, 0);
    if (status == WAIT_OBJECT_0) return false;
    if (status != WAIT_TIMEOUT) throw new Win32Exception();
    return true;
  }

  /** Birth, live state, job membership AND termination through this same retained handle. */
  public static string Signal(string name, uint pid, string startTime, bool force) {
    long expected;
    if (pid == 0 || !long.TryParse(startTime, System.Globalization.NumberStyles.None, Invariant, out expected)) return "refused";
    IntPtr job = QueryJob(name);
    if (job == IntPtr.Zero) return "gone";
    try {
      IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE, false, pid);
      if (process == IntPtr.Zero) return Marshal.GetLastWin32Error() == ERROR_INVALID_PARAMETER ? "gone" : "refused";
      try {
        if (Creation(process) != expected) return "identity-changed";
        if (!IsAlive(process)) return "gone";
        if (!Member(process, job)) return "refused";
        if (TerminateProcess(process, force ? EXIT_KILLED : EXIT_TERMINATED)) return "done";
        return IsAlive(process) ? "refused" : "gone";
      } finally { CloseHandle(process); }
    } finally { CloseHandle(job); }
  }
  // End M107 T2 signal region.

  /** Creates the named job and puts this process in it; its children follow. */
  public static void Join(string name) {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, name);
    if (job == IntPtr.Zero) {
      throw new Win32Exception();
    }
    if (!AssignProcessToJobObject(job, GetCurrentProcess())) {
      int error = Marshal.GetLastWin32Error();
      CloseHandle(job);
      throw new Win32Exception(error);
    }
    held = job;
  }

  /** Ends every process in the named job; false when there is no such job. */
  public static bool Terminate(string name, uint exitCode) {
    IntPtr job = OpenJobObjectW(JOB_OBJECT_TERMINATE, false, name);
    if (job == IntPtr.Zero) {
      return false;
    }
    try {
      if (!TerminateJobObject(job, exitCode)) {
        throw new Win32Exception();
      }
      return true;
    } finally {
      CloseHandle(job);
    }
  }
}

// M104L: creation and ACL proof are bound to the opened directory, never Set-Acl.
public static class MuseSparkPrivateDirectory {
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
  struct SECURITY_ATTRIBUTES {
    public int Length;
    public IntPtr Descriptor;
    public int Inherit;
  }
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
  struct FILE_INFO {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateDirectoryW(string path, ref SECURITY_ATTRIBUTES attributes);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandle(IntPtr handle, out FILE_INFO info);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern uint GetSecurityInfo(IntPtr handle, int kind, uint requested, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")]
  static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr pointer);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  const uint READ_CONTROL = 0x00020000, SHARE_READ_WRITE = 3, OPEN_EXISTING = 3;
  const uint OPEN_REPARSE_BACKUP = 0x02200000, DIRECTORY = 0x10, REPARSE = 0x400;
  const int ALREADY_EXISTS = 183, FULL_CONTROL = 0x1f01ff;
  const uint OWNER_DACL = 5, CREATE_NEW = 1, GENERIC_WRITE = 0x40000000;
  [DllImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateRecordW(string path, uint access, uint share, ref SECURITY_ATTRIBUTES attributes, uint disposition, uint flags, IntPtr template);

  // StrictModes equivalent: every ancestor through the volume root, no reparse.
  public static void VerifyParents(string path) {
    string parent = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path));
    while (parent != null) {
      try {
        IntPtr handle = Open(parent);
        try { Inspect(handle, true, true); } finally { CloseHandle(handle); }
      } catch (Exception error) { throw new InvalidOperationException(parent + ": " + error.Message, error); }
      parent = System.IO.Path.GetDirectoryName(parent);
    }
  }

  // Shared vectors exercise the exact owner/type/write predicate used by Inspect.
  // POSIX private groups have no Windows authority: a foreign mutating SID
  // always refuses, while a grant solely to the current user's SID is safe.
  public static bool AllowsComponent(string owner, bool directory, bool reparse, bool unsafeAcl, bool writableForeign, bool leaf) {
    return directory && !reparse && !unsafeAcl && !writableForeign &&
      (leaf ? owner == "user" : owner == "user" || owner == "root");
  }

  static IntPtr Open(string path) {
    IntPtr handle = CreateFileW(path, READ_CONTROL, SHARE_READ_WRITE, IntPtr.Zero, OPEN_EXISTING, OPEN_REPARSE_BACKUP, IntPtr.Zero);
    if (handle == new IntPtr(-1)) throw new Win32Exception();
    return handle;
  }

  static FILE_INFO Inspect(IntPtr handle, bool directory, bool ancestor) {
    var current = System.Security.Principal.WindowsIdentity.GetCurrent().User;
    var system = new System.Security.Principal.SecurityIdentifier("S-1-5-18");
    var administrators = new System.Security.Principal.SecurityIdentifier("S-1-5-32-544");
    FILE_INFO info;
    if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception();
    if (((info.Attributes & DIRECTORY) != 0) != directory || (info.Attributes & REPARSE) != 0 || (!directory && info.Links != 1)) throw new InvalidOperationException("unsafe inode");
    IntPtr owner, group, dacl, sacl, descriptor;
    uint error = GetSecurityInfo(handle, 1, OWNER_DACL, out owner, out group, out dacl, out sacl, out descriptor);
    if (error != 0) throw new Win32Exception((int)error);
    try {
      byte[] binary = new byte[GetSecurityDescriptorLength(descriptor)];
      Marshal.Copy(descriptor, binary, 0, binary.Length);
      var security = new System.Security.AccessControl.RawSecurityDescriptor(binary, 0);
      if (security.DiscretionaryAcl == null) throw new InvalidOperationException("missing ACL");
      bool unsafeAcl = false, writableForeign = false;
      if (ancestor) {
        var write = System.Security.AccessControl.FileSystemRights.Write | System.Security.AccessControl.FileSystemRights.Delete | System.Security.AccessControl.FileSystemRights.DeleteSubdirectoriesAndFiles | System.Security.AccessControl.FileSystemRights.ChangePermissions | System.Security.AccessControl.FileSystemRights.TakeOwnership;
        foreach (System.Security.AccessControl.GenericAce entry in security.DiscretionaryAcl) {
          var ace = entry as System.Security.AccessControl.CommonAce;
          if (ace == null || ace.IsCallback) { unsafeAcl = true; continue; }
          writableForeign |= ace.AceQualifier == System.Security.AccessControl.AceQualifier.AccessAllowed && (ace.AceFlags & System.Security.AccessControl.AceFlags.InheritOnly) == 0 &&
              !current.Equals(ace.SecurityIdentifier) && !system.Equals(ace.SecurityIdentifier) && !administrators.Equals(ace.SecurityIdentifier) && (ace.AccessMask & ((int)write | 0x50000000)) != 0;
        }
      } else {
        unsafeAcl = (security.ControlFlags & System.Security.AccessControl.ControlFlags.DiscretionaryAclProtected) == 0;
        bool hasOwner = false;
        foreach (System.Security.AccessControl.GenericAce entry in security.DiscretionaryAcl) {
          var ace = entry as System.Security.AccessControl.CommonAce;
          if (ace == null || ace.IsCallback || ace.AceQualifier != System.Security.AccessControl.AceQualifier.AccessAllowed ||
              (ace.AceFlags & (System.Security.AccessControl.AceFlags.Inherited | System.Security.AccessControl.AceFlags.InheritOnly)) != 0 ||
              ace.AccessMask != FULL_CONTROL || (!current.Equals(ace.SecurityIdentifier) && !system.Equals(ace.SecurityIdentifier))) { unsafeAcl = true; continue; }
          hasOwner |= current.Equals(ace.SecurityIdentifier);
        }
        unsafeAcl |= !hasOwner;
      }
      string ownerKind = current.Equals(security.Owner) ? "user" : system.Equals(security.Owner) || administrators.Equals(security.Owner) ? "root" : "foreign";
      if (writableForeign) throw new InvalidOperationException("writable parent");
      if (!AllowsComponent(ownerKind, true, (info.Attributes & REPARSE) != 0, unsafeAcl, writableForeign, !ancestor)) throw new InvalidOperationException("unsafe path");
      return info;
    } finally { LocalFree(descriptor); }
  }

  public static void WriteRecord(string path, string text) {
    VerifyParents(path);
    IntPtr parent = Open(System.IO.Path.GetDirectoryName(path));
    try {
      FILE_INFO parentInfo = Inspect(parent, true, false);
      var security = new System.Security.AccessControl.FileSecurity();
      var current = System.Security.Principal.WindowsIdentity.GetCurrent().User;
      security.SetOwner(current);
      security.SetAccessRuleProtection(true, false);
      security.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(current, System.Security.AccessControl.FileSystemRights.FullControl, System.Security.AccessControl.AccessControlType.Allow));
      byte[] binary = security.GetSecurityDescriptorBinaryForm();
      var pinned = System.Runtime.InteropServices.GCHandle.Alloc(binary, System.Runtime.InteropServices.GCHandleType.Pinned);
      IntPtr handle = new IntPtr(-1);
      try {
        var attributes = new SECURITY_ATTRIBUTES();
        attributes.Length = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        attributes.Descriptor = pinned.AddrOfPinnedObject();
        handle = CreateRecordW(path, READ_CONTROL | GENERIC_WRITE, SHARE_READ_WRITE, ref attributes, CREATE_NEW, OPEN_REPARSE_BACKUP, IntPtr.Zero);
        if (handle == new IntPtr(-1)) throw new Win32Exception();
        FILE_INFO recordInfo = Inspect(handle, false, false);
        IntPtr currentRecord = Open(path);
        try {
          FILE_INFO actualRecord = Inspect(currentRecord, false, false);
          if (actualRecord.Volume != recordInfo.Volume || actualRecord.IndexHigh != recordInfo.IndexHigh || actualRecord.IndexLow != recordInfo.IndexLow) throw new InvalidOperationException("record replaced");
        } finally { CloseHandle(currentRecord); }
        IntPtr currentParent = Open(System.IO.Path.GetDirectoryName(path));
        try {
          FILE_INFO actual = Inspect(currentParent, true, false);
          if (actual.Volume != parentInfo.Volume || actual.IndexHigh != parentInfo.IndexHigh || actual.IndexLow != parentInfo.IndexLow) throw new InvalidOperationException("parent replaced");
        } finally { CloseHandle(currentParent); }
        // Parent's no-delete share and the held record handle remain live through write.
        using (var safe = new Microsoft.Win32.SafeHandles.SafeFileHandle(handle, false))
        using (var stream = new System.IO.FileStream(safe, System.IO.FileAccess.Write)) {
          byte[] bytes = System.Text.Encoding.UTF8.GetBytes(text);
          stream.Write(bytes, 0, bytes.Length);
        }
      } finally { if (handle != new IntPtr(-1)) CloseHandle(handle); pinned.Free(); }
    } finally { CloseHandle(parent); }
  }

  public static string Verify(string path, bool create) {
    VerifyParents(path);
    var current = System.Security.Principal.WindowsIdentity.GetCurrent().User;
    var system = new System.Security.Principal.SecurityIdentifier("S-1-5-18");
    bool isNew = false;
    if (create) {
      var security = new System.Security.AccessControl.DirectorySecurity();
      security.SetOwner(current);
      security.SetAccessRuleProtection(true, false);
      var inheritance = System.Security.AccessControl.InheritanceFlags.ContainerInherit | System.Security.AccessControl.InheritanceFlags.ObjectInherit;
      foreach (var sid in new[] { current, system })
        security.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(sid,
          System.Security.AccessControl.FileSystemRights.FullControl, inheritance,
          System.Security.AccessControl.PropagationFlags.None, System.Security.AccessControl.AccessControlType.Allow));
      byte[] binary = security.GetSecurityDescriptorBinaryForm();
      var pinned = System.Runtime.InteropServices.GCHandle.Alloc(binary, System.Runtime.InteropServices.GCHandleType.Pinned);
      try {
        var attributes = new SECURITY_ATTRIBUTES();
        attributes.Length = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        attributes.Descriptor = pinned.AddrOfPinnedObject();
        isNew = CreateDirectoryW(path, ref attributes);
        if (!isNew && Marshal.GetLastWin32Error() != ALREADY_EXISTS) throw new Win32Exception();
      } finally { pinned.Free(); }
    }
    // Omitting FILE_SHARE_DELETE prevents rename/replacement throughout the receipt.
    IntPtr handle = Open(path);
    try {
      FILE_INFO info = Inspect(handle, true, false);
      return "{\"isNew\":" + (isNew ? "true" : "false") + ",\"volume\":\"" + info.Volume.ToString() + "\",\"index\":\"" + (((ulong)info.IndexHigh << 32) | info.IndexLow).ToString() + "\"}";
    } finally { CloseHandle(handle); }
  }
}
