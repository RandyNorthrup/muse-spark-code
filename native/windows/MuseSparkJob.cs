// The job type the Windows shell tool's commands join (M27, PLAN.md D25),
// compiled with MuseSparkMcpJob.cs into one console program on first use and
// kept out of the host bundle (PLAN.md D6): the shell tool's PowerShell loads
// it as the type, and every other caller (the resource governor, the team
// workers' file commands and their process launches, the playbook's contained
// job, the legacy shell stop) runs it as the program MuseSparkJobHost at the
// end, starting no PowerShell. The class name is SHELL_JOB_TYPE_NAME in src/shared/constants.ts;
// test/unit/jobHostNative.test.ts holds them together (it calls the type by
// that name in Windows PowerShell, as the shell tool's commands do).
// C# 5, which the .NET Framework compiler compiles. The shell keeps its
// handle for its whole life: a job's name lasts as long as a handle to it,
// and the Stop opens the job by that name.
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
// Every platform invoke in this file and in the shared half loads its DLL
// from System32 alone (LoadLibraryEx with LOAD_LIBRARY_SEARCH_SYSTEM32),
// never from the working folder or PATH, whether the shell tool's PowerShell
// loads the type or MuseSparkJobHost runs it. Microsoft Learn,
// DefaultDllImportSearchPathsAttribute.
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
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
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
    out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint exitCode);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint length);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

  static void TeamIdentity(IntPtr process, out long creation, out string executable, out string uid) {
    long exit, kernel, user;
    if (!GetProcessTimes(process, out creation, out exit, out kernel, out user))
      throw new Win32Exception();
    uint length = 32768; // Win32 maximum path buffer, not an application tunable.
    var path = new StringBuilder((int)length);
    if (!QueryFullProcessImageName(process, 0, path, ref length)) throw new Win32Exception();
    IntPtr token;
    if (!OpenProcessToken(process, 8, out token)) throw new Win32Exception(); // TOKEN_QUERY
    try {
      using (var identity = new System.Security.Principal.WindowsIdentity(token)) {
        if (identity.User == null) throw new IOException("team process user unavailable");
        uid = identity.User.Value;
      }
    } finally { CloseHandle(token); }
    executable = path.ToString();
  }

  // Basic-and-extended limits have platform-specific alignment. Marshal the
  // same layout used by the shared suspended-child launcher, not byte offsets.
  [StructLayout(LayoutKind.Sequential)]
  struct TeamLimits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr Minimum, Maximum;
    public uint Active;
    public IntPtr Affinity;
    public uint Priority, Scheduling;
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }

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

  /**
  A drive-absolute (`C:\...`) or UNC (`\\server\share\...`) path: never a
  bare name, a relative or a drive-relative path, which Windows would
  complete from a search path or from this helper's working folder. Every
  program this helper starts, and the folder it starts it in, is one; any
  other is refused before anything starts.
  */
  internal static bool IsFullyQualified(string path) {
    if (String.IsNullOrEmpty(path) || path.Length < 3) return false;
    char first = path[0];
    bool separated = path[2] == '\\' || path[2] == '/';
    if (path[1] == ':') return separated && ((first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z'));
    return (first == '\\' || first == '/') && (path[1] == '\\' || path[1] == '/');
  }

  // The playbook's contained job (M116, PLAN.md D96.15 and section 9
  // FIXM116P3-Windows-job-binding; src/host/playbook/containedJob.ts). One
  // helper serves one decision: it joins a fresh named job, so everything a
  // call starts belongs to that job from its creation; it binds the job to its
  // own life (kill-on-close on the only handle, which this process holds), so
  // a helper that dies, however it dies, takes its whole job with it; it ends
  // every other member after each call and answers only then; and it
  // terminates the job, itself included, when the pipe closes or no call
  // arrives in time. The answer flags are PLAYBOOK_JOB_FLAGS in
  // src/shared/constants.ts.
  const int CONTAINED_TIMED_OUT = 1, CONTAINED_OVERFLOWED = 2, CONTAINED_UNCERTAIN = 4, CONTAINED_UNSTARTED = 8;
  const int CONTAINED_HEADER_BYTES = 4; // PLAYBOOK_JOB_FRAME_HEADER_BYTES: one little-endian Int32.
  const int CONTAINED_FIELDS = 5; // program, arguments, directory, time limit, output bound; then the environment.

  /** One redirected stream of a call, drained on its own thread and counted whole. */
  sealed class ContainedStream {
    readonly Stream source;
    readonly long max;
    readonly MemoryStream kept = new MemoryStream();
    long seen;
    public readonly System.Threading.Tasks.Task Copy;
    public ContainedStream(Stream source, long max) {
      this.source = source;
      this.max = max;
      Copy = System.Threading.Tasks.Task.Factory.StartNew(Drain, System.Threading.Tasks.TaskCreationOptions.LongRunning);
    }
    void Drain() {
      byte[] buffer = new byte[65536];
      int read;
      while ((read = source.Read(buffer, 0, buffer.Length)) > 0) {
        // Past the bound nothing more is kept (the call's answer is refused
        // whole), but the stream is still read, so the writer never blocks.
        lock (kept) { if (seen + read <= max) kept.Write(buffer, 0, read); seen += read; }
      }
    }
    public long Length { get { lock (kept) return seen; } }
    public byte[] Bytes() { lock (kept) return kept.ToArray(); }
  }

  static byte[] ContainedRead(Stream pipe, int count, int idleMs) {
    byte[] buffer = new byte[count];
    int done = 0;
    while (done < count) {
      var read = pipe.ReadAsync(buffer, done, count - done);
      if (!read.Wait(idleMs)) throw new TimeoutException("idle");
      if (read.Result <= 0) return null;
      done += read.Result;
    }
    return buffer;
  }

  static string ContainedText(string value) {
    return new UTF8Encoding(false).GetString(Convert.FromBase64String(value));
  }

  /** One call, its whole tree ended, and its answer written; false once the job is uncertain. */
  static bool ContainedCall(string name, uint self, Stream pipe, string[] lines, int sweepMs, int exitPollMs, int sweepPollMs) {
    var start = new System.Diagnostics.ProcessStartInfo();
    start.FileName = ContainedText(lines[0]);
    start.Arguments = ContainedText(lines[1]);
    start.WorkingDirectory = ContainedText(lines[2]);
    int limit = int.Parse(lines[3], System.Globalization.NumberStyles.None, Invariant);
    long max = long.Parse(lines[4], System.Globalization.NumberStyles.None, Invariant);
    start.UseShellExecute = false;
    start.CreateNoWindow = true;
    start.RedirectStandardOutput = true;
    start.RedirectStandardError = true;
    start.RedirectStandardInput = true;
    // Exactly the environment the call was given: nothing of this helper's.
    start.Environment.Clear();
    for (int index = CONTAINED_FIELDS; index < lines.Length; index++) {
      if (lines[index].Length == 0) continue;
      string pair = ContainedText(lines[index]);
      int cut = pair.IndexOf('=', 1);
      start.Environment[pair.Substring(0, cut)] = pair.Substring(cut + 1);
    }
    int flags = 0, status = -1;
    var streams = new List<ContainedStream>();
    System.Diagnostics.Process process = null;
    try {
      try {
        // Never a name for Windows to look up, nor a folder relative to this one.
        if (!IsFullyQualified(start.FileName) || !IsFullyQualified(start.WorkingDirectory))
          throw new ArgumentException("program");
        process = System.Diagnostics.Process.Start(start);
        process.StandardInput.Close();
        streams.Add(new ContainedStream(process.StandardOutput.BaseStream, max));
        streams.Add(new ContainedStream(process.StandardError.BaseStream, max));
        var clock = System.Diagnostics.Stopwatch.StartNew();
        while (!process.WaitForExit(exitPollMs)) {
          if (clock.ElapsedMilliseconds >= limit) { flags |= CONTAINED_TIMED_OUT; break; }
          if (streams[0].Length > max || streams[1].Length > max) { flags |= CONTAINED_OVERFLOWED; break; }
        }
        if (flags == 0) { process.WaitForExit(); status = process.ExitCode; }
      } catch {
        flags |= CONTAINED_UNSTARTED;
      }
      // Every other member of the job is ended, each checked by its start
      // identity, before the call is answered: this helper is then its only member.
      var sweep = System.Diagnostics.Stopwatch.StartNew();
      while (true) {
        int others = 0;
        foreach (Match member in Regex.Matches(Query(name), "\\{\"pid\":(\\d+),\"startTime\":\"(\\d+)\"\\}")) {
          uint id = uint.Parse(member.Groups[1].Value, System.Globalization.NumberStyles.None, Invariant);
          if (id == self) continue;
          others++;
          Signal(name, id, member.Groups[2].Value, true);
        }
        if (others == 0) break;
        if (sweep.ElapsedMilliseconds >= sweepMs) { flags |= CONTAINED_UNCERTAIN; break; }
        System.Threading.Thread.Sleep(sweepPollMs);
      }
      foreach (ContainedStream stream in streams) if (!stream.Copy.Wait(sweepMs)) flags |= CONTAINED_UNCERTAIN;
    } finally {
      // Only now: both streams are read to their end before the handles go.
      if (process != null) process.Dispose();
    }
    foreach (ContainedStream stream in streams) if (stream.Length > max) flags |= CONTAINED_OVERFLOWED;
    byte[] output = new byte[0], error = new byte[0];
    if ((flags & CONTAINED_OVERFLOWED) == 0 && streams.Count == 2) { output = streams[0].Bytes(); error = streams[1].Bytes(); }
    byte[] header = new UTF8Encoding(false).GetBytes(status.ToString(Invariant) + " " + flags.ToString(Invariant) + " " +
      output.Length.ToString(Invariant) + " " + error.Length.ToString(Invariant) + "\n");
    pipe.Write(header, 0, header.Length);
    pipe.Write(output, 0, output.Length);
    pipe.Write(error, 0, error.Length);
    pipe.Flush();
    return (flags & CONTAINED_UNCERTAIN) == 0;
  }

  /** Serves one decision's calls on `pipeName` inside the job `name`, then ends the job. */
  public static void ServeContained(string name, string pipeName, int idleMs, int sweepMs, int exitPollMs, int sweepPollMs) {
    try {
      Join(name);
      // Kill-on-close, on the one handle to the job, which this process holds:
      // the job cannot outlive it. Bound before any pipe exists to serve a call on.
      var limits = new TeamLimits();
      limits.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
      int length = Marshal.SizeOf(typeof(TeamLimits));
      IntPtr buffer = Marshal.AllocHGlobal(length);
      try {
        Marshal.StructureToPtr(limits, buffer, false);
        if (!SetInformationJobObject(held, 9, buffer, (uint)length)) throw new Win32Exception();
      } finally { Marshal.FreeHGlobal(buffer); }
      uint self = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
      using (var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous)) {
        IAsyncResult wait = pipe.BeginWaitForConnection(null, null);
        if (!wait.AsyncWaitHandle.WaitOne(idleMs)) throw new TimeoutException("no caller");
        pipe.EndWaitForConnection(wait);
        while (true) {
          byte[] head = ContainedRead(pipe, CONTAINED_HEADER_BYTES, idleMs);
          if (head == null) break;
          byte[] body = ContainedRead(pipe, BitConverter.ToInt32(head, 0), idleMs);
          if (body == null) break;
          string[] lines = new UTF8Encoding(false).GetString(body).Split('\n');
          if (!ContainedCall(name, self, pipe, lines, sweepMs, exitPollMs, sweepPollMs)) break;
        }
      }
    } catch {
      // Whatever ended the session (a closed or idle pipe, a failed bind, a
      // broken frame), the job ends below, this helper with it.
    }
    Terminate(name, 0);
  }

  /** Ends a job by name; true once it has no member left, or no longer exists. */
  public static bool EndContained(string name, int sweepMs, int pollMs) {
    try { Terminate(name, 1); } catch { /* Seen below: only an emptied job counts as ended. */ }
    var clock = System.Diagnostics.Stopwatch.StartNew();
    while (Query(name).Contains("\"pid\":")) {
      if (clock.ElapsedMilliseconds >= sweepMs) return false;
      System.Threading.Thread.Sleep(pollMs);
    }
    return true;
  }

  // Team-only mode. The shared launcher still performs READY/GO, opens the
  // host handle, creates suspended and assigns before resume. This outer job
  // includes the helper, and excludes breakaway. Never used by M27's Join.
  public static int RunTeam(string executable, string[] arguments, string cwd,
    uint parentPid, string[] environment, string ownerPipe, string nonce,
    string statusPipe, string jobName, bool belowNormal, bool verbatimArguments) {
    // `lpApplicationName` and `lpCurrentDirectory` exactly as given: a name
    // or a relative path is refused before any job exists.
    if (!IsFullyQualified(executable) || !IsFullyQualified(cwd)) throw new ArgumentException("executable");
    IntPtr job = CreateJobObjectW(IntPtr.Zero, jobName);
    if (job == IntPtr.Zero) throw new Win32Exception();
    IntPtr limitsBuffer = IntPtr.Zero;
    bool completed = false;
    try {
      var limits = new TeamLimits();
      limits.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
      int length = Marshal.SizeOf(typeof(TeamLimits));
      limitsBuffer = Marshal.AllocHGlobal(length);
      Marshal.StructureToPtr(limits, limitsBuffer, false);
      if (!SetInformationJobObject(job, 9, limitsBuffer, (uint)length)) throw new Win32Exception();
      if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new Win32Exception();
      if (belowNormal) System.Diagnostics.Process.GetCurrentProcess().PriorityClass =
        System.Diagnostics.ProcessPriorityClass.BelowNormal;
      // An overlapped handle permits the control read and retirement write
      // concurrently. A synchronous PipeStream serializes them on one lock:
      // ReadLine waits for STOP/EOF while END waits for that read to finish.
      using (var status = new NamedPipeClientStream(".", statusPipe, PipeDirection.InOut,
        PipeOptions.Asynchronous)) {
        status.Connect(5000);
        var writer = new StreamWriter(status, new UTF8Encoding(false));
        writer.AutoFlush = true;
        System.Threading.Tasks.Task monitor = null;
        using (var reader = new StreamReader(status, Encoding.UTF8, true, 1024, true)) {
          int code = MuseSparkMcpJob.Run(executable, arguments, cwd, parentPid,
            environment, verbatimArguments, ownerPipe, nonce, (pid, process) => {
              long creation;
              string image, uid;
              TeamIdentity(process, out creation, out image, out uid);
              lock (writer) writer.WriteLine("CONFIRMED " + pid + " " + DateTime.FromFileTimeUtc(creation).ToString("O") +
                " " + Convert.ToBase64String(Encoding.UTF8.GetBytes(image)) + " " + uid);
              // Still suspended and assigned. EOF/STOP cancels without running the command.
              if (reader.ReadLine() != "GO " + nonce)
                throw new IOException("team launch was not released");
              IntPtr pinned;
              if (!DuplicateHandle(GetCurrentProcess(), process, GetCurrentProcess(),
                out pinned, 0, false, 2)) throw new Win32Exception();
              monitor = System.Threading.Tasks.Task.Factory.StartNew(() => {
                try {
                  string command;
                  while ((command = reader.ReadLine()) != null) {
                    if (command != "STOP " + nonce) continue;
                    // This stable process handle cannot be redirected by PID reuse.
                    // Ending the primary makes Run close its inner kill-on-close job.
                    long currentCreation;
                    string currentImage, currentUid;
                    TeamIdentity(pinned, out currentCreation, out currentImage, out currentUid);
                    if (currentCreation == creation && currentImage == image && currentUid == uid &&
                        TerminateProcess(pinned, 1)) return;
                    lock (writer) writer.WriteLine("STOP_FAILED");
                  }
                } finally {
                  CloseHandle(pinned);
                }
              });
            });
          // The shared launcher's inner job has closed. Its active members may
          // still be ending; only the outer job count (minus this helper) proves it.
          var clock = System.Diagnostics.Stopwatch.StartNew();
          while (TeamMembers(job).Length != 1) {
            if (clock.Elapsed >= TimeSpan.FromSeconds(5)) throw new TimeoutException("team job retirement uncertain");
            System.Threading.Thread.Sleep(10);
          }
          lock (writer) writer.WriteLine("END proved");
          // Node closes its pipe after END, releasing the monitor before its reader is disposed.
          if (monitor != null && !monitor.Wait(5000))
            throw new TimeoutException("team control reader did not close");
          completed = true;
          return code;
        }
      }
    } finally {
      if (limitsBuffer != IntPtr.Zero) Marshal.FreeHGlobal(limitsBuffer);
      // Keep the helper's own kill-on-close job until its normal OS exit.
      // Closing it here would kill the helper before its `run-team` returns
      // the child's exit code. Failure still closes immediately and fails shut.
      if (completed) held = job;
      else CloseHandle(job);
    }
  }

  static int[] TeamMembers(IntPtr job) {
    // QueryInformationJobObject reports every active job member. Grow on a
    // full buffer; never interpret a truncated list as retirement proof.
    int capacity = 16;
    while (true) {
      int length = 8 + capacity * IntPtr.Size;
      IntPtr buffer = Marshal.AllocHGlobal(length);
      try {
        if (!QueryInformationJobObject(job, 3, buffer, (uint)length, IntPtr.Zero)) {
          int error = Marshal.GetLastWin32Error();
          if (error == 234) { capacity *= 2; continue; }
          throw new Win32Exception(error);
        }
        int count = Marshal.ReadInt32(buffer, 4);
        int assigned = Marshal.ReadInt32(buffer, 0);
        if (count < assigned) { capacity *= 2; continue; }
        var members = new int[count];
        for (int index = 0; index < count; index++)
          members[index] = Marshal.ReadIntPtr(buffer, 8 + index * IntPtr.Size).ToInt32();
        return members;
      } finally { Marshal.FreeHGlobal(buffer); }
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
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder name, uint length, uint flags);
  [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle file, int kind, uint requested, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  static void Refuse() { throw new IOException("created directory helper refused"); }
  // Worker file refusals carry the shared refusal vocabulary the TypeScript
  // mapper types (src/core/team/workers/workerOps.ts WORKER_REFUSALS): the
  // reason is a short code, never a sentence and never a path.
  static void RefuseReason(string reason) { throw new IOException("worker file helper refused: " + reason); }
  static Info Sample(SafeFileHandle h) { return Sample(h, null); }
  // Worker paths name their own reason (one literal per site); the null
  // reason keeps the directory protocol's bare refusal for the other
  // operations, which their own lane types.
  static Info Sample(SafeFileHandle h, string reason) { Info s; if (!GetFileInformationByHandle(h, out s)) { if (reason == null) Refuse(); else RefuseReason(reason); } return s; }
  static ulong Id(Info s) { return ((ulong)s.IndexHigh << 32) | s.IndexLow; }
  static string Key(Info s) { return s.Volume.ToString() + ":" + Id(s).ToString(); }
  static void Match(Info s, string expected) { if (Id(s) == 0 || Key(s) != expected) Refuse(); }
  static void Match(Info s, string expected, string reason) { if (Id(s) == 0 || Key(s) != expected) RefuseReason(reason); }
  static void Private(SafeFileHandle h) {
    Info s = Sample(h); if ((s.Attributes & (DIRECTORY | REPARSE)) != DIRECTORY) Refuse();
    Owned(h);
  }
  static void Owned(SafeFileHandle h) {
    IntPtr owner, group, dacl, sacl, descriptor;
    if (GetSecurityInfo(h, 1, 1, out owner, out group, out dacl, out sacl, out descriptor) != 0) Refuse();
    try { using (WindowsIdentity current = WindowsIdentity.GetCurrent()) {
      // The token's own default owner counts as this user's: an elevated
      // administrator's new objects can belong to Administrators (Windows
      // Server's default), and the registry folder is made that way.
      string found = new SecurityIdentifier(owner).Value;
      if (current.User == null || (found != current.User.Value && (current.Owner == null || found != current.Owner.Value))) Refuse();
    }} finally { LocalFree(descriptor); }
  }
  // Win32-forbidden file characters: never valid in a name, refused before NtCreateFile.
  static readonly char[] WorkerForbidden = new char[] {'*', '?', '<', '>', '|', '"'};
  // Reserved device stems, with or without an extension: NTFS names them, Win32 cannot open them.
  static bool WorkerReserved(string name) {
    int dot = name.IndexOf('.');
    string stem = (dot < 0 ? name : name.Substring(0, dot)).ToUpperInvariant();
    if (stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL") return true;
    return stem.Length == 4 && stem[3] >= '1' && stem[3] <= '9' &&
      (stem.StartsWith("COM") || stem.StartsWith("LPT"));
  }
  static void WorkerName(string name, string reason) {
    if (name.Length == 0 || name[name.Length - 1] == '.' || name[name.Length - 1] == ' ' ||
        name.IndexOfAny(WorkerForbidden) >= 0 || WorkerReserved(name)) RefuseReason(reason);
    // Win32 names never carry control characters; NtCreateFile would keep
    // them as real names Win32 tools cannot address. Streams (':') are
    // refused with the separators in Open above.
    foreach (char c in name) if (c < ' ') RefuseReason(reason);
  }
  // On the .NET Framework every System.IO.Path member revalidates its input
  // and throws ArgumentException on '"', '<', '>', '|' and control
  // characters: a hostile name would die inside Path.IsPathRooted before
  // WorkerName ever judged it, and the product would report the helper
  // itself failed instead of the typed cannot-create sentence ('*' and '?'
  // are not in the framework's invalid-path set, which is why those two
  // already reached the helper's own check). Every caller-supplied path
  // component is judged by the helper's own rules first, with the same
  // reason the later open would give it; no framework call sees an
  // unvalidated value. C# 5: no string interpolation below.
  static void WorkerValidateComponents(string relative, bool file) {
    if (relative == "") return;
    string[] parts = relative.Split('/');
    for (int index = 0; index < parts.Length; index++) {
      string part = parts[index];
      string reason = (file && index == parts.Length - 1) ? "invalid filename" : "invalid component";
      if (String.IsNullOrEmpty(part) || part.IndexOfAny(new char[] {'/', '\\', ':'}) >= 0 ||
          part == "." || part == "..") RefuseReason(reason);
      WorkerName(part, reason);
    }
  }
  // The framework's own invalid-path set (GetInvalidPathChars): the four
  // punctuation marks above plus the control characters. A root holding one
  // is not a usable path, refused before Path touches it.
  static bool WorkerPathHasInvalid(string path) {
    if (String.IsNullOrEmpty(path)) return false;
    foreach (char c in path)
      if (c < ' ' || c == '"' || c == '<' || c == '>' || c == '|') return true;
    return false;
  }
  // Path.IsPathRooted's two conditions without its input revalidation, so a
  // rootedness answer never throws: a leading separator, or a drive letter.
  static bool WorkerIsRooted(string path) {
    if (String.IsNullOrEmpty(path)) return false;
    if (path[0] == '/' || path[0] == '\\') return true;
    return path.Length >= 2 && path[1] == ':';
  }
  static SafeFileHandle Open(SafeFileHandle parent, string name, bool directory, bool create, bool allowMissing = false, bool worker = false) {
    if (String.IsNullOrEmpty(name) || name.IndexOfAny(new char[] {'/', '\\', ':'}) >= 0 || name == "." || name == "..") {
      if (!worker) Refuse();
      RefuseReason(directory ? "invalid component" : "invalid filename");
    }
    // The worker path refuses reserved devices, trailing dots/spaces, streams
    // (above) and forbidden characters here as well, never only in TypeScript.
    if (worker) WorkerName(name, directory ? "invalid component" : "invalid filename");
    IntPtr chars = Marshal.StringToHGlobalUni(name), unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Unicode)));
    GCHandle security = new GCHandle();
    try {
      Unicode text = new Unicode { Length=checked((ushort)(name.Length*2)), MaximumLength=checked((ushort)(name.Length*2)), Buffer=chars };
      Marshal.StructureToPtr(text, unicode, false);
      Attributes attributes = new Attributes { Length=Marshal.SizeOf(typeof(Attributes)), Root=parent.DangerousGetHandle(), Name=unicode, Flags=0x40 };
      if (create) {
        // An elevated token's default owner can be Administrators. Our own new
        // objects must still belong to the user whose ownership Private proves.
        using (WindowsIdentity current = WindowsIdentity.GetCurrent()) {
          if (current.User == null) RefuseReason("owner unavailable");
          var descriptor = new System.Security.AccessControl.RawSecurityDescriptor("O:" + current.User.Value);
          byte[] bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0);
          security = GCHandle.Alloc(bytes, GCHandleType.Pinned);
          attributes.Security = security.AddrOfPinnedObject();
        }
      }
      SafeFileHandle result; IoStatus status;
      uint access = worker && directory ? 0x100081u : create && !directory ? ACCESS | 2u : ACCESS;
      int error = NtCreateFile(out result, access, ref attributes, out status, IntPtr.Zero, directory ? DIRECTORY : 0u, worker ? 3u : 7u, create ? 2u : 1u, FILE_OPEN_REPARSE_POINT | 0x20u | (directory ? 1u : worker ? 0x40u : 0u), IntPtr.Zero, 0);
      if (error < 0 || result.IsInvalid) {
        result.Dispose();
        if (worker && create && !directory && error == unchecked((int)0xc0000035))
          throw new IOException("worker file helper refused: target exists");
        if (allowMissing && (error == unchecked((int)0xc0000034) || error == unchecked((int)0xc000003a))) return null;
        if (!worker) Refuse();
        // A refused folder creation names itself; any other refused worker
        // open names the link or file, as the POSIX helper does.
        if (directory && create) RefuseReason("directory create failed");
        // A parent that exists as a plain file is not a link: it carries its
        // own reason, mapped to cannot-create as POSIX maps ENOTDIR. A
        // reparse point stays linked; anything absent keeps the reason below.
        if (directory && WorkerParentIsFile(parent, name)) RefuseReason("parent is not a directory");
        if (directory) RefuseReason("parent unavailable or linked");
        RefuseReason("file unavailable or linked");
      } return result;
    } finally { if (security.IsAllocated) security.Free(); Marshal.FreeHGlobal(unicode); Marshal.FreeHGlobal(chars); }
  }
  // True when the named entry exists under the held parent as a plain
  // non-directory, non-link object: opened without the directory flag but
  // still without traversing a reparse point, then judged by attributes. A
  // reparse point, an actual directory, or anything absent answers false,
  // keeping the caller's existing reason. Runs only on a refused directory
  // open, never on the happy path. C# 5: no string interpolation below.
  static bool WorkerParentIsFile(SafeFileHandle parent, string name) {
    IntPtr chars = Marshal.StringToHGlobalUni(name), unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Unicode)));
    try {
      Unicode text = new Unicode { Length=checked((ushort)(name.Length*2)), MaximumLength=checked((ushort)(name.Length*2)), Buffer=chars };
      Marshal.StructureToPtr(text, unicode, false);
      Attributes attributes = new Attributes { Length=Marshal.SizeOf(typeof(Attributes)), Root=parent.DangerousGetHandle(), Name=unicode, Flags=0x40 };
      SafeFileHandle probe; IoStatus status;
      // SYNCHRONIZE plus read-attributes only: no delete or data access, so
      // the probe succeeds wherever the entry can be statted at all.
      int error = NtCreateFile(out probe, 0x100080u, ref attributes, out status, IntPtr.Zero, 0u, 7u, 1u, FILE_OPEN_REPARSE_POINT | 0x20u, IntPtr.Zero, 0);
      if (error < 0 || probe == null || probe.IsInvalid) return false;
      try {
        Info sample; if (!GetFileInformationByHandle(probe, out sample)) return false;
        if ((sample.Attributes & REPARSE) != 0) return false;
        return (sample.Attributes & DIRECTORY) == 0;
      } finally { probe.Dispose(); }
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
    DisposeEntry(file, null);
  }
  static void DisposeEntry(SafeFileHandle file, string reason) {
    IntPtr flags = Marshal.AllocHGlobal(4);
    try { Marshal.WriteInt32(flags, 1 | 2 | 0x10); if (!SetFileInformationByHandle(file, 21, flags, 4)) { if (reason == null) Refuse(); else RefuseReason(reason); } }
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
      } else {
        IoStatus status;
        // Relative names stay bound to the retained parent handle, as Open does.
        if (NtSetInformationFile(source, out status, buffer, (uint)(nameOffset + name.Length), 10) < 0) Refuse();
      }
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
  static void Walk(SafeFileHandle root, uint volume, bool keepMarker = false) {
    foreach (Entry entry in Entries(root)) {
      // The root marker stays until every other name is gone, so a crash
      // mid-walk can still prove this directory on the next start.
      if (keepMarker && entry.Name == MARKER) continue;
      using (SafeFileHandle child = Open(root, entry.Name, (entry.Flags & (DIRECTORY | REPARSE)) == DIRECTORY, false)) {
        Info held = Sample(child); if (entry.Id == 0 || Id(held) != entry.Id || held.Volume != volume) Refuse();
        if ((held.Attributes & (DIRECTORY | REPARSE)) == DIRECTORY) Walk(child, volume);
        DisposeEntry(child); // Reparse points are disposed themselves; directories must be empty.
      }
    }
  }
  static void FinishTrash(SafeFileHandle parent, SafeFileHandle root, string trash, string id, string hash, string identity) {
    Private(root); Match(Sample(root), identity); Marker(root, id, hash);
    Walk(root, Sample(root).Volume, true);
    using (SafeFileHandle marker = Open(root, MARKER, false, false)) DisposeEntry(marker);
    using (SafeFileHandle final = Open(parent, trash, true, false)) { Match(Sample(final), identity); DisposeEntry(final); }
  }
  static string WorkerFinal(SafeFileHandle file) {
    var name = new StringBuilder(32768);
    uint length = GetFinalPathNameByHandleW(file, name, (uint)name.Capacity, 0);
    if (length == 0 || length >= name.Capacity) RefuseReason("handle path unavailable");
    string result = name.ToString();
    if (result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + result.Substring(8);
    return result.StartsWith(@"\\?\", StringComparison.Ordinal) ? result.Substring(4) : result;
  }
  // The null reason keeps the directory protocol's bare refusal for any
  // future non-worker caller; every current caller names its own reason.
  static void WorkerDirectory(SafeFileHandle file, string reason) {
    if ((Sample(file, reason).Attributes & (DIRECTORY | REPARSE)) != DIRECTORY) { if (reason == null) Refuse(); else RefuseReason(reason); }
  }
  static SafeFileHandle WorkerWalk(SafeFileHandle start, string relative, bool create,
    List<SafeFileHandle> held, ref int made) {
    SafeFileHandle current = start;
    if (relative == "") return current;
    foreach (string part in relative.Split('/')) {
      if (String.IsNullOrEmpty(part) || part.EndsWith(".") || part.EndsWith(" ")) RefuseReason("invalid component");
      SafeFileHandle next = Open(current, part, true, false, true, true);
      if (next == null) {
        if (!create) RefuseReason("parent unavailable or linked");
        next = Open(current, part, true, true, false, true); ++made;
      }
      held.Add(next); WorkerDirectory(next, "parent unavailable or linked");
      if (Sample(next, "directory unavailable").Volume != Sample(start, "directory unavailable").Volume) RefuseReason("different device");
      current = next;
    }
    return current;
  }
  // Same protocol as the POSIX helper. No FILE_SHARE_DELETE on the retained
  // root, component or file handles: their names cannot move during the operation.
  static string WorkerExecute(string[] args) {
    if (args.Length != 7) RefuseReason("invalid request");
    if (String.IsNullOrEmpty(args[5])) RefuseReason("invalid path");
    // Rootedness is answered by the helper's own non-throwing check, which
    // matches Path.IsPathRooted exactly: it only indexes, so hostile
    // characters cannot throw here. Own character and name rules then judge
    // every caller-supplied component before any System.IO.Path call sees
    // it: the ancestor's parts as components, the remaining path's inner
    // parts as components and its last part as the file name. The root is
    // scanned for the framework's invalid set before Path.Combine below.
    if (!WorkerIsRooted(args[1]) || WorkerIsRooted(args[3]) ||
      WorkerIsRooted(args[5])) RefuseReason("invalid path");
    WorkerValidateComponents(args[3], false);
    WorkerValidateComponents(args[5], true);
    if (WorkerPathHasInvalid(args[1])) RefuseReason("invalid path");
    string op = args[0];
    if (op != "worker-create" && op != "worker-prepare" && op != "worker-check" && op != "worker-release") RefuseReason("unknown operation");
    var held = new List<SafeFileHandle>();
    try {
      SafeFileHandle root = CreateFileW(args[1], 0x100081, 3, IntPtr.Zero, 3,
        0x02000000 | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
      held.Add(root); if (root.IsInvalid) RefuseReason("root unavailable"); WorkerDirectory(root, "root unavailable"); Match(Sample(root, "root unavailable"), args[2], "identity changed");
      if (!String.Equals(WorkerFinal(root), args[1], StringComparison.OrdinalIgnoreCase)) RefuseReason("root moved");
      int made = 0;
      SafeFileHandle ancestor = WorkerWalk(root, args[3], false, held, ref made);
      Match(Sample(ancestor, "ancestor unavailable"), args[4], "identity changed");
      int slash = args[5].LastIndexOf('/');
      string parents = slash < 0 ? "" : args[5].Substring(0, slash);
      string name = slash < 0 ? args[5] : args[5].Substring(slash + 1);
      if (name.EndsWith(".") || name.EndsWith(" ")) RefuseReason("invalid filename");
      SafeFileHandle parent = WorkerWalk(ancestor, parents, op == "worker-create" || op == "worker-prepare", held, ref made);
      string expectedParent = Path.Combine(args[1], args[3].Replace('/', '\\'), parents.Replace('/', '\\'));
      if (!String.Equals(WorkerFinal(parent), expectedParent, StringComparison.OrdinalIgnoreCase)) RefuseReason("parent moved");
      if (op == "worker-prepare")
        return "{\"identity\":\"" + Key(Sample(parent, "parent unavailable")) + "\",\"createdFolders\":" + made + "}";
      SafeFileHandle file = Open(parent, name, false, op == "worker-create", false, true);
      held.Add(file); Info sample = Sample(file, "file unavailable");
      if ((sample.Attributes & (DIRECTORY | REPARSE)) != 0 || sample.Links != 1) RefuseReason("file is not single-link regular");
      if (op != "worker-create") Match(sample, args[6], "identity changed");
      string expectedFile = Path.Combine(expectedParent, name);
      if (!String.Equals(WorkerFinal(file), expectedFile, StringComparison.OrdinalIgnoreCase)) RefuseReason("file name changed");
      if (!String.Equals(WorkerFinal(root), args[1], StringComparison.OrdinalIgnoreCase)) RefuseReason("root moved");
      if (op == "worker-release") {
        if (sample.SizeHigh != 0 || sample.SizeLow != 0) RefuseReason("reserved file changed");
        DisposeEntry(file, "release failed"); // Delete the held file, never a name that can be replaced.
      }
      return "{\"identity\":\"" + Key(sample) + "\",\"createdFolders\":" + made + "}";
    } finally { for (int index = held.Count - 1; index >= 0; --index) held[index].Dispose(); }
  }
  public static string Execute(string[] args) {
    if (args.Length > 0 && args[0].StartsWith("worker-", StringComparison.Ordinal)) return WorkerExecute(args);
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
          using (SafeFileHandle named = Open(parent, args[3], true, false)) { Match(Sample(named), Key(Sample(root))); }
          Private(root); if (Entries(root).Count != 0) Refuse(); Info identity = Sample(root);
          using (SafeFileHandle file = Open(root, MARKER, false, true)) using (var stream = new FileStream(file, FileAccess.Write)) {
            byte[] bytes = Encoding.UTF8.GetBytes("{\"id\":\"" + args[4] + "\",\"token\":\"" + args[5] + "\"}"); stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
          }
          using (Open(root, "browser-profile", true, true)) {} using (Open(root, "browser-cache", true, true)) {}
          using (SafeFileHandle named = Open(parent, args[3], true, false)) { Match(Sample(named), Key(identity)); }
          return "{\"identity\":\"" + Key(identity) + "\"}";
        }
      }
      if (args[0] != "remove" || !Regex.IsMatch(args[5], "^[0-9a-f]{64}$")) Refuse();
      string trash = ".muse-trash-" + args[4];
      using (SafeFileHandle source = Open(parent, args[3], true, false, true)) {
        if (source == null) {
          // The original name is gone. Finish a quarantine this process can
          // still prove; a different directory at that name is refused.
          using (SafeFileHandle parked = Open(parent, trash, true, false, true)) {
            if (parked == null) return "{\"removed\":true}";
            FinishTrash(parent, parked, trash, args[4], args[5], args[6]);
          }
        } else {
          Private(source); Match(Sample(source), args[6]); Marker(source, args[4], args[5]);
          using (SafeFileHandle occupied = Open(parent, trash, true, false, true)) {
            if (occupied != null) Refuse();
          }
          string before = Key(Sample(source));
          Rename(source, parent, trash);
          using (SafeFileHandle root = Open(parent, trash, true, false)) {
            if (Key(Sample(root)) != before) {
              using (SafeFileHandle back = Open(parent, args[3], true, false, true)) {
                if (back == null) { try { Rename(root, parent, args[3]); } catch { /* A raced name stays quarantined and is refused. */ } }
              }
              Refuse();
            }
            FinishTrash(parent, root, trash, args[4], args[5], args[6]);
          }
        }
      }
      return "{\"removed\":true}";
    }
  }
}

/**
The calls above, for a caller that is not PowerShell: the resource governor's
tree reads, its job holder and its created-path registry; the team workers'
file commands and their process launches (`run-team`); the playbook's
contained job and its end by name; and the legacy shell stop's job
termination. A Windows PowerShell start costs 200 ms
and more (seconds on a busy machine); this program starts in about 40 ms. The
compiled file is both the type PowerShell loads with `LoadFrom` (the shell
tool's commands, which run in PowerShell, join their job with it) and this
program. Every answer is the text the matching PowerShell call printed; a call
that fails prints nothing and exits 1, as the scripts' `catch { exit 1 }` did.
The worker file commands keep their own failure lines (`Worker` below).

It starts in its own folder with PATH empty (`windowsJobHost`), so the
loader's search for the DLLs it needs while it starts reaches no folder but
its own and the system's. Its first act restricts every later DLL load in the
process to its own folder and System32 (`RestrictDllSearch`): no working
folder, no PATH, whatever a caller gave it.
*/
public static class MuseSparkJobHost {
  static readonly System.Globalization.CultureInfo Invariant = System.Globalization.CultureInfo.InvariantCulture;
  // LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32
  // (Microsoft Learn: SetDefaultDllDirectories; Dynamic-link library search order).
  const uint DllSearchApplicationAndSystem32 = 0x00000200 | 0x00000800;
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetDefaultDllDirectories(uint directoryFlags);
  /**
  The process DLL search path, for the life of this process: a library
  loaded without a full path, or a dependency of one, is looked for in this
  program's folder and in System32 alone. A system that refuses fails the
  call closed.
  */
  static void RestrictDllSearch() {
    if (!SetDefaultDllDirectories(DllSearchApplicationAndSystem32)) throw new Win32Exception();
  }
  // WORKER_REFUSAL_PREFIX and WORKER_HELPER_FAILED_PREFIX in
  // src/core/team/workers/workerOps.ts.
  const string WorkerRefused = "worker file helper refused: ";
  const string WorkerFailed = "worker file helper failed: ";
  static uint Number(string text) {
    return uint.Parse(text, System.Globalization.NumberStyles.None, Invariant);
  }
  static int Milliseconds(string text) {
    return int.Parse(text, System.Globalization.NumberStyles.None, Invariant);
  }
  static bool Flag(string text) {
    if (text == "true") return true;
    if (text == "false") return false;
    throw new ArgumentException("flag");
  }
  static void Count(string[] args, int count) {
    if (args.Length != count) throw new ArgumentException("arguments");
  }
  static string Run(string[] args) {
    switch (args.Length > 0 ? args[0] : "") {
      case "identity": Count(args, 2); return MuseSparkJob.Identity(Number(args[1]));
      case "query": Count(args, 2); return MuseSparkJob.Query(args[1]);
      case "contains":
        Count(args, 4);
        return MuseSparkJob.Contains(args[1], Number(args[2]), args[3]) ? "true" : "false";
      case "signal":
        Count(args, 5);
        return "\"" + MuseSparkJob.Signal(args[1], Number(args[2]), args[3], Flag(args[4])) + "\"";
      case "hold": Count(args, 2); MuseSparkJob.Hold(args[1]); return null;
      case "read-priority": Count(args, 4); return MuseSparkJob.ReadResourcePriority(args[1], Number(args[2]), args[3]);
      case "set-priority":
        Count(args, 7);
        return MuseSparkJob.SetResourcePriority(args[1], Number(args[2]), args[3], args[4], args[5], Flag(args[6])) ? "true" : "false";
      case "read-rate": Count(args, 4); return MuseSparkJob.ReadResourceRate(args[1], Number(args[2]), args[3]);
      case "set-rate":
        Count(args, 6);
        return MuseSparkJob.SetResourceRate(args[1], Number(args[2]), args[3], Number(args[4]), Number(args[5]));
      case "created": return MuseSparkCreated.Execute(Rest(args));
      case "terminate":
        Count(args, 3);
        return MuseSparkJob.Terminate(args[1], Number(args[2])) ? "true" : "false";
      case "contained":
        Count(args, 7);
        MuseSparkJob.ServeContained(args[1], args[2], Milliseconds(args[3]), Milliseconds(args[4]),
          Milliseconds(args[5]), Milliseconds(args[6]));
        return null;
      case "end-job":
        Count(args, 4);
        if (!MuseSparkJob.EndContained(args[1], Milliseconds(args[2]), Milliseconds(args[3])))
          throw new TimeoutException("job end unseen");
        return null;
      default: throw new ArgumentException("command");
    }
  }
  static string[] Rest(string[] args) {
    string[] rest = new string[args.Length - 1];
    Array.Copy(args, 1, rest, 0, rest.Length);
    return rest;
  }
  /**
  A team worker's file command (MuseSparkCreated's worker operations, and
  only those). A refusal is the helper's own fixed line on standard error
  (the reason a short code, never a path); any other failure is the fixed
  helper-failed line with the exception's type name only. Either exits 1.
  */
  static int Worker(string[] args) {
    try {
      RestrictDllSearch();
      if (args.Length < 2 || !args[1].StartsWith("worker-", StringComparison.Ordinal))
        throw new ArgumentException("operation");
      Console.Out.WriteLine(MuseSparkCreated.Execute(Rest(args)));
      Console.Out.Flush();
      return 0;
    } catch (Exception error) {
      Exception cause = error.GetBaseException();
      if (cause is IOException && cause.Message.StartsWith(WorkerRefused, StringComparison.Ordinal))
        Console.Error.WriteLine(cause.Message);
      else Console.Error.WriteLine(WorkerFailed + cause.GetType().Name);
      Console.Error.Flush();
      return 1;
    }
  }
  // run-team <executable> <cwd> <parentPid> <ownerPipe> <nonce> <statusPipe>
  // <jobName> <belowNormal> <verbatim> <argumentCount>, then the arguments.
  const int TeamFixedArguments = 11;
  /**
  A team worker's process launch (`MuseSparkJob.RunTeam`). The exit code is
  the payload's, as `exit [MuseSparkJob]::RunTeam(...)` in PowerShell
  returned it; the payload's own arguments follow the fixed ones, then its
  whole environment (`KEY=value`), one program argument each, so no shell
  or script reads a value. Standard input, output and error are the
  payload's: a launch that fails writes nothing to them and exits 1 (one
  that fails after its job exists ends inside it, by kill-on-close).
  */
  static int Team(string[] args) {
    try {
      RestrictDllSearch();
      if (args.Length < TeamFixedArguments) throw new ArgumentException("arguments");
      int count = int.Parse(args[TeamFixedArguments - 1], System.Globalization.NumberStyles.None, Invariant);
      if (count > args.Length - TeamFixedArguments) throw new ArgumentException("arguments");
      string[] arguments = new string[count];
      Array.Copy(args, TeamFixedArguments, arguments, 0, count);
      string[] environment = new string[args.Length - TeamFixedArguments - count];
      Array.Copy(args, TeamFixedArguments + count, environment, 0, environment.Length);
      return MuseSparkJob.RunTeam(args[1], arguments, args[2], Number(args[3]), environment,
        args[4], args[5], args[6], args[7], Flag(args[8]), Flag(args[9]));
    } catch {
      return 1;
    }
  }
  public static int Main(string[] args) {
    if (args.Length > 0 && args[0] == "worker") return Worker(args);
    if (args.Length > 0 && args[0] == "run-team") return Team(args);
    try {
      RestrictDllSearch();
      if (args.Length == 1 && args[0] == "--self-test") {
        Console.Out.WriteLine("muse-spark-job-host-ready");
        return 0;
      }
      string answer = Run(args);
      if (answer != null) Console.Out.WriteLine(answer);
      Console.Out.Flush();
      return 0;
    } catch {
      return 1;
    }
  }
}
