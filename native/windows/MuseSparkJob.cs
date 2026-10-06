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

using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;
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

  /** C1's holder is outside the governed job. Root exit never closes its last handle. */
  const int ERROR_ALREADY_EXISTS = 183;
  public static void Hold(string name) {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, name);
    if (job == IntPtr.Zero) throw new Win32Exception();
    try {
      if (Marshal.GetLastWin32Error() == ERROR_ALREADY_EXISTS) throw new InvalidOperationException("job already exists");
      Console.Out.WriteLine("held");
      Console.Out.Flush();
      // Owner EOF also ends an unused holder. No process is killed or governed here.
      if (Console.In.ReadLine() == null) return;
      while (ProcessIds(job).Length != 0) System.Threading.Thread.Sleep(100);
    } finally { CloseHandle(job); }
  }


  // M107 A priority/rate region. Never terminate, suspend, elevate or set memory limits.
  const uint JOB_OBJECT_SET_ATTRIBUTES = 0x0002, PROCESS_SET_INFORMATION = 0x0200;
  const uint PRIORITY_LIMIT = 0x00000020, NORMAL_PRIORITY = 0x00000020;
  const uint BELOW_NORMAL_PRIORITY = 0x00004000, IDLE_PRIORITY = 0x00000040;
  const int BASIC_LIMITS = 2, CPU_RATE_CONTROL = 15;
  const uint CPU_ENABLE_HARD_CAP = 5, CPU_ENABLE_HARD_CAP_NOTIFY = 13, CPU_MAX_RATE = 10000;

  [StructLayout(LayoutKind.Sequential)]
  struct JOB_LIMITS {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOB_RATE { public uint ControlFlags, CpuRate; }
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, int length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint GetPriorityClass(IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetPriorityClass(IntPtr process, uint value);

  static T ReadJobControl<T>(IntPtr job, int kind) where T : struct {
    int length = Marshal.SizeOf(typeof(T));
    IntPtr buffer = Marshal.AllocHGlobal(length);
    try {
      if (!QueryInformationJobObject(job, kind, buffer, length, IntPtr.Zero)) throw new Win32Exception();
      return (T)Marshal.PtrToStructure(buffer, typeof(T));
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  static void WriteJobControl<T>(IntPtr job, int kind, T value) where T : struct {
    int length = Marshal.SizeOf(typeof(T));
    IntPtr buffer = Marshal.AllocHGlobal(length);
    try {
      Marshal.StructureToPtr(value, buffer, false);
      if (!SetInformationJobObject(job, kind, buffer, length)) throw new Win32Exception();
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  // Both handles survive the action and readback. No PID/name reopen after the proof.
  static bool ResourceHandles(string name, uint pid, string startTime, bool write, out IntPtr job, out IntPtr process) {
    job = OpenJobObjectW(JOB_OBJECT_QUERY | (write ? JOB_OBJECT_SET_ATTRIBUTES : 0), false, name);
    process = IntPtr.Zero;
    if (job == IntPtr.Zero) {
      if (Marshal.GetLastWin32Error() != ERROR_FILE_NOT_FOUND) throw new Win32Exception();
      return false;
    }
    try {
      long expected;
      if (!long.TryParse(startTime, System.Globalization.NumberStyles.None, Invariant, out expected)) return false;
      process = QueryProcess(pid, false);
      return process != IntPtr.Zero && Creation(process) == expected && Member(process, job);
    } catch {
      if (process != IntPtr.Zero) CloseHandle(process);
      CloseHandle(job);
      job = process = IntPtr.Zero;
      throw;
    }
  }
  static string PriorityWord(uint value) {
    if (value == NORMAL_PRIORITY) return "normal";
    if (value == BELOW_NORMAL_PRIORITY) return "belowNormal";
    if (value == IDLE_PRIORITY) return "idle";
    throw new InvalidOperationException("unsupported original priority");
  }
  static uint PriorityValue(string word) {
    if (word == "normal") return NORMAL_PRIORITY;
    if (word == "belowNormal") return BELOW_NORMAL_PRIORITY;
    if (word == "idle") return IDLE_PRIORITY;
    throw new InvalidOperationException("invalid resource priority");
  }
  static int PriorityRank(uint value) {
    string word = PriorityWord(value);
    return word == "idle" ? 0 : word == "belowNormal" ? 1 : 2;
  }

  public static string ReadResourcePriority(string name, uint pid, string startTime) {
    IntPtr job, anchor;
    bool proven = ResourceHandles(name, pid, startTime, false, out job, out anchor);
    try {
      if (!proven) return "null";
      JOB_LIMITS limits = ReadJobControl<JOB_LIMITS>(job, BASIC_LIMITS);
      string priority = (limits.LimitFlags & PRIORITY_LIMIT) == 0 ? "none" : PriorityWord(limits.PriorityClass);
      var rows = new List<string>();
      uint[] ids = ProcessIds(job);
      Array.Sort(ids);
      foreach (uint member in ids) {
        IntPtr process = QueryProcess(member, false);
        if (process == IntPtr.Zero) continue;
        try {
          if (!Member(process, job)) continue;
          string word = PriorityWord(GetPriorityClass(process));
          string identity = IdentityJson(member, Creation(process));
          rows.Add(identity.Substring(0, identity.Length - 1) + ",\"priority\":\"" + word + "\"}");
        } finally { CloseHandle(process); }
      }
      return "{\"priority\":\"" + priority + "\",\"processes\":[" + string.Join(",", rows) + "]}";
    } finally { if (anchor != IntPtr.Zero) CloseHandle(anchor); if (job != IntPtr.Zero) CloseHandle(job); }
  }

  public static bool SetResourcePriority(string name, uint pid, string startTime, string word, string baselines, bool restore) {
    uint desired = word == "none" ? 0 : PriorityValue(word);
    if (!restore && desired == 0) return false;
    var saved = new Dictionary<uint, KeyValuePair<long, uint>>();
    foreach (string row in baselines.Split(';')) {
      if (row.Length == 0) continue;
      string[] parts = row.Split('/');
      if (parts.Length != 3) throw new InvalidOperationException("invalid priority baseline");
      saved.Add(uint.Parse(parts[0], Invariant), new KeyValuePair<long, uint>(long.Parse(parts[1], Invariant), PriorityValue(parts[2])));
    }
    IntPtr job, anchor;
    bool proven = ResourceHandles(name, pid, startTime, true, out job, out anchor);
    var processes = new List<KeyValuePair<IntPtr, uint>>();
    try {
      if (!proven) return false;
      JOB_LIMITS limits = ReadJobControl<JOB_LIMITS>(job, BASIC_LIMITS);
      foreach (uint member in ProcessIds(job)) {
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION, false, member);
        if (process == IntPtr.Zero) throw new Win32Exception();
        bool retained = false;
        try {
          if (!Member(process, job)) continue;
          uint target = desired;
          if (restore) {
            KeyValuePair<long, uint> baseline;
            // A child born while throttled has no pre-change baseline: never invent one.
            if (!saved.TryGetValue(member, out baseline) || Creation(process) != baseline.Key) return false;
            target = baseline.Value;
          } else {
            KeyValuePair<long, uint> baseline;
            uint ceiling = saved.TryGetValue(member, out baseline) && Creation(process) == baseline.Key
              ? baseline.Value : GetPriorityClass(process);
            if (PriorityRank(desired) > PriorityRank(ceiling)) return false;
          }
          processes.Add(new KeyValuePair<IntPtr, uint>(process, target));
          retained = true;
        } finally { if (!retained) CloseHandle(process); }
      }
      limits.LimitFlags = desired == 0 ? limits.LimitFlags & ~PRIORITY_LIMIT : limits.LimitFlags | PRIORITY_LIMIT;
      limits.PriorityClass = desired;
      if (Creation(anchor) != long.Parse(startTime, Invariant) || !Member(anchor, job)) return false;
      WriteJobControl(job, BASIC_LIMITS, limits);
      foreach (var process in processes) {
        if (!Member(process.Key, job)) return false;
        if (restore && !SetPriorityClass(process.Key, process.Value)) throw new Win32Exception();
        if (GetPriorityClass(process.Key) != process.Value) return false;
      }
      JOB_LIMITS actual = ReadJobControl<JOB_LIMITS>(job, BASIC_LIMITS);
      return (actual.LimitFlags & PRIORITY_LIMIT) == (limits.LimitFlags & PRIORITY_LIMIT) &&
        (desired == 0 || actual.PriorityClass == desired);
    } finally {
      foreach (var process in processes) CloseHandle(process.Key);
      if (anchor != IntPtr.Zero) CloseHandle(anchor);
      if (job != IntPtr.Zero) CloseHandle(job);
    }
  }

  static string RateJson(JOB_RATE rate) {
    return "{\"flags\":" + rate.ControlFlags.ToString(Invariant) + ",\"rate\":" + rate.CpuRate.ToString(Invariant) + "}";
  }
  public static string ReadResourceRate(string name, uint pid, string startTime) {
    IntPtr job, anchor;
    bool proven = ResourceHandles(name, pid, startTime, false, out job, out anchor);
    try { return proven ? RateJson(ReadJobControl<JOB_RATE>(job, CPU_RATE_CONTROL)) : "null"; }
    finally { if (anchor != IntPtr.Zero) CloseHandle(anchor); if (job != IntPtr.Zero) CloseHandle(job); }
  }
  public static string SetResourceRate(string name, uint pid, string startTime, uint flags, uint rate) {
    if ((flags != 0 && flags != CPU_ENABLE_HARD_CAP && flags != CPU_ENABLE_HARD_CAP_NOTIFY) ||
        (flags != 0 && (rate == 0 || rate > CPU_MAX_RATE))) return "null";
    IntPtr job, anchor;
    bool proven = ResourceHandles(name, pid, startTime, true, out job, out anchor);
    try {
      if (!proven) return "null";
      var desired = new JOB_RATE { ControlFlags = flags, CpuRate = rate };
      WriteJobControl(job, CPU_RATE_CONTROL, desired);
      return RateJson(ReadJobControl<JOB_RATE>(job, CPU_RATE_CONTROL));
    } finally { if (anchor != IntPtr.Zero) CloseHandle(anchor); if (job != IntPtr.Zero) CloseHandle(job); }
  }
  // End M107 A priority/rate region.
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

  /** Legacy shell stop: the caller owns the freshly generated job name. */
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

// M107 DK: handle-relative created directory protocol, compiled in the existing job assembly.
public static class MuseSparkCreated {
  const uint DIRECTORY = 0x10, REPARSE = 0x400, DELETE = 0x10000, READ_CONTROL = 0x20000;
  const uint ACCESS = 0x100001 | 0x80 | DELETE | READ_CONTROL;
  const uint FILE_OPEN_REPARSE_POINT = 0x200000, FILE_FLAG_OPEN_REPARSE_POINT = 0x200000;
  const int BUFFER = 65536, FILE_NAME_OFFSET = 104, FILE_ID_OFFSET = 96;
  const string MARKER = ".muse-owner.json";
  [StructLayout(LayoutKind.Sequential)] struct Unicode { public ushort Length, MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct Attributes { public int Length; public IntPtr Root, Name; public uint Flags; public IntPtr Security, Quality; }
  [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status, Information; }
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
  [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle file, uint access, ref Attributes attributes, out IoStatus status, IntPtr allocation, uint fileAttributes, uint share, uint disposition, uint options, IntPtr ea, uint eaLength);
  [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle file, out IoStatus status, IntPtr buffer, uint length, int kind);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file, out Info info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, IntPtr buffer, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, IntPtr buffer, uint length);
  [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle file, int kind, uint requested, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  static void Refuse() { throw new IOException("created directory helper refused"); }
  static Info Sample(SafeFileHandle h) { Info s; if (!GetFileInformationByHandle(h, out s)) Refuse(); return s; }
  static ulong Id(Info s) { return ((ulong)s.IndexHigh << 32) | s.IndexLow; }
  static string Key(Info s) { return s.Volume.ToString() + ":" + Id(s).ToString(); }
  static void Match(Info s, string expected) { if (Id(s) == 0 || Key(s) != expected) Refuse(); }
  static void Private(SafeFileHandle h) {
    Info s = Sample(h); if ((s.Attributes & (DIRECTORY | REPARSE)) != DIRECTORY) Refuse();
    Owned(h);
  }
  static void Owned(SafeFileHandle h) {
    IntPtr owner, group, dacl, sacl, descriptor;
    if (GetSecurityInfo(h, 1, 1, out owner, out group, out dacl, out sacl, out descriptor) != 0) Refuse();
    try { using (WindowsIdentity current = WindowsIdentity.GetCurrent()) {
      if (current.User == null || new SecurityIdentifier(owner).Value != current.User.Value) Refuse();
    }} finally { LocalFree(descriptor); }
  }
  static SafeFileHandle Open(SafeFileHandle parent, string name, bool directory, bool create) {
    if (String.IsNullOrEmpty(name) || name.IndexOfAny(new char[] {'/', '\\', ':'}) >= 0 || name == "." || name == "..") Refuse();
    IntPtr chars = Marshal.StringToHGlobalUni(name), unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Unicode)));
    try {
      Unicode text = new Unicode { Length=checked((ushort)(name.Length*2)), MaximumLength=checked((ushort)(name.Length*2)), Buffer=chars };
      Marshal.StructureToPtr(text, unicode, false);
      Attributes attributes = new Attributes { Length=Marshal.SizeOf(typeof(Attributes)), Root=parent.DangerousGetHandle(), Name=unicode, Flags=0x40 };
      SafeFileHandle result; IoStatus status;
      int error = NtCreateFile(out result, create && !directory ? ACCESS | 2u : ACCESS, ref attributes, out status, IntPtr.Zero, directory ? DIRECTORY : 0u, 7, create ? 2u : 1u, FILE_OPEN_REPARSE_POINT | 0x20u | (directory ? 1u : 0u), IntPtr.Zero, 0);
      if (error < 0 || result.IsInvalid) { result.Dispose(); Refuse(); } return result;
    } finally { Marshal.FreeHGlobal(unicode); Marshal.FreeHGlobal(chars); }
  }
  sealed class Entry { public string Name; public ulong Id; public uint Flags; }
  static List<Entry> Entries(SafeFileHandle directory) {
    var entries = new List<Entry>(); IntPtr buffer = Marshal.AllocHGlobal(BUFFER);
    try {
      int kind = 11;
      while (GetFileInformationByHandleEx(directory, kind, buffer, BUFFER)) {
        kind = 10; int offset = 0;
        do {
          IntPtr row = IntPtr.Add(buffer, offset); int length = Marshal.ReadInt32(row, 60);
          if (length < 0 || length % 2 != 0 || offset + FILE_NAME_OFFSET + length > BUFFER) Refuse();
          string name = Marshal.PtrToStringUni(IntPtr.Add(row, FILE_NAME_OFFSET), length / 2);
          if (name != "." && name != "..") entries.Add(new Entry { Name=name, Id=unchecked((ulong)Marshal.ReadInt64(row, FILE_ID_OFFSET)), Flags=unchecked((uint)Marshal.ReadInt32(row, 56)) });
          int next = Marshal.ReadInt32(row); if (next == 0) break;
          if (next < FILE_NAME_OFFSET || next > BUFFER - offset - FILE_NAME_OFFSET) Refuse(); offset += next;
        } while (true);
      }
      if (Marshal.GetLastWin32Error() != 18) Refuse(); return entries;
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  static void DisposeEntry(SafeFileHandle file) {
    IntPtr flags = Marshal.AllocHGlobal(4);
    try { Marshal.WriteInt32(flags, 1 | 2 | 0x10); if (!SetFileInformationByHandle(file, 21, flags, 4)) Refuse(); }
    finally { Marshal.FreeHGlobal(flags); }
  }
  static void Rename(SafeFileHandle source, SafeFileHandle parent, string trash, bool link = false) {
    int rootOffset = IntPtr.Size, lengthOffset = rootOffset + IntPtr.Size, nameOffset = lengthOffset + 4;
    byte[] name = Encoding.Unicode.GetBytes(trash); IntPtr buffer = Marshal.AllocHGlobal(nameOffset + name.Length);
    try {
      for (int i = 0; i < nameOffset; i++) Marshal.WriteByte(buffer, i, 0);
      Marshal.WriteIntPtr(buffer, rootOffset, parent.DangerousGetHandle()); Marshal.WriteInt32(buffer, lengthOffset, name.Length);
      Marshal.Copy(name, 0, IntPtr.Add(buffer, nameOffset), name.Length);
      if (link) {
        IoStatus status;
        if (NtSetInformationFile(source, out status, buffer, (uint)(nameOffset + name.Length), 11) < 0) Refuse();
      } else if (!SetFileInformationByHandle(source, 3, buffer, (uint)(nameOffset + name.Length))) Refuse();
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  static void Marker(SafeFileHandle root, string id, string expected) {
    using (SafeFileHandle file = Open(root, MARKER, false, false)) {
      Owned(file); Info s = Sample(file); if ((s.Attributes & (DIRECTORY | REPARSE)) != 0 || s.SizeHigh != 0 || s.SizeLow > 256) Refuse();
      using (var stream = new FileStream(file, FileAccess.Read)) using (var reader = new StreamReader(stream, Encoding.UTF8)) {
        Match match = Regex.Match(reader.ReadToEnd(), "^\\{\"id\":\"([0-9a-f-]+)\",\"token\":\"([0-9a-f]{32})\"\\}$");
        if (!match.Success || match.Groups[1].Value != id) Refuse();
        using (SHA256 hash = SHA256.Create()) {
          string actual = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(match.Groups[2].Value))).Replace("-", "").ToLowerInvariant();
          if (actual != expected) Refuse();
        }
      }
    }
  }
  static void Walk(SafeFileHandle root, uint volume) {
    foreach (Entry entry in Entries(root)) using (SafeFileHandle child = Open(root, entry.Name, (entry.Flags & (DIRECTORY | REPARSE)) == DIRECTORY, false)) {
      Info held = Sample(child); if (entry.Id == 0 || Id(held) != entry.Id || held.Volume != volume) Refuse();
      if ((held.Attributes & (DIRECTORY | REPARSE)) == DIRECTORY) Walk(child, volume);
      DisposeEntry(child); // Reparse points are disposed themselves; directories must be empty.
    }
  }
  public static string Execute(string[] args) {
    if (args.Length != 7) Refuse();
    if (args[0] == "publish") {
      using (SafeFileHandle parent = CreateFileW(args[1], ACCESS, 7, IntPtr.Zero, 3, 0x02000000 | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero)) {
        if (parent.IsInvalid) Refuse(); Private(parent); Match(Sample(parent), args[2]);
        using (SafeFileHandle stage = Open(parent, args[3], false, false)) {
          Owned(stage); Info held = Sample(stage); Match(held, args[6]);
          if ((held.Attributes & (DIRECTORY | REPARSE)) != 0) Refuse();
          if (args[5] == "") Rename(stage, parent, args[4], true);
          else using (SafeFileHandle previous = Open(parent, args[4], false, false)) {
            Match(Sample(previous), args[5]); Owned(previous);
            // Windows has no atomic exchange here: preserve the held old file under a no-replace name.
            Rename(previous, parent, args[3] + ".previous");
            try { Rename(stage, parent, args[4], true); }
            catch { try { Rename(previous, parent, args[4]); } catch { /* Retain both files on a raced name. */ } throw; }
          }
          using (SafeFileHandle current = Open(parent, args[4], false, false)) { Match(Sample(current), args[6]); }
          return "{\"published\":true}";
        }
      }
    }
    if (!Regex.IsMatch(args[3], "^muse-tree-[0-9a-f-]+$") || !Regex.IsMatch(args[4], "^[0-9a-f-]+$")) Refuse();
    using (SafeFileHandle parent = CreateFileW(args[1], ACCESS, 7, IntPtr.Zero, 3, 0x02000000 | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero)) {
      if (parent.IsInvalid) Refuse(); Private(parent); Match(Sample(parent), args[2]);
      if (args[0] == "create") {
        if (!Regex.IsMatch(args[5], "^[0-9a-f]{32}$")) Refuse();
        using (SafeFileHandle root = Open(parent, args[3], true, true)) {
          Private(root); if (Entries(root).Count != 0) Refuse(); Info identity = Sample(root);
          using (SafeFileHandle file = Open(root, MARKER, false, true)) using (var stream = new FileStream(file, FileAccess.Write)) {
            byte[] bytes = Encoding.UTF8.GetBytes("{\"id\":\"" + args[4] + "\",\"token\":\"" + args[5] + "\"}"); stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
          }
          using (Open(root, "browser-profile", true, true)) {} using (Open(root, "browser-cache", true, true)) {}
          return "{\"identity\":\"" + Key(identity) + "\"}";
        }
      }
      if (args[0] != "remove" || !Regex.IsMatch(args[5], "^[0-9a-f]{64}$")) Refuse();
      using (SafeFileHandle source = Open(parent, args[3], true, false)) {
        Private(source); Match(Sample(source), args[6]); Marker(source, args[4], args[5]);
        string trash = ".muse-trash-" + args[4]; Rename(source, parent, trash);
        using (SafeFileHandle root = Open(parent, trash, true, false)) {
          Private(root); Match(Sample(root), args[6]); Marker(root, args[4], args[5]); Walk(root, Sample(root).Volume);
          using (SafeFileHandle final = Open(parent, trash, true, false)) { Match(Sample(final), args[6]); DisposeEntry(final); }
        }
      }
      return "{\"removed\":true}";
    }
  }
}
