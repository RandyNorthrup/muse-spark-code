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
    IntPtr process = OpenProcess(memory ? PROCESS_QUERY_INFORMATION | PROCESS_VM_READ : PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
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
    try { return IdentityJson(pid, Creation(process)); }
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
      try { return Creation(process) == expected && Member(process, job); }
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
          if (!Member(process, job)) continue;
          long created = Creation(process);
          var memory = new PROCESS_MEMORY();
          memory.cb = (uint)Marshal.SizeOf(typeof(PROCESS_MEMORY));
          if (!GetProcessMemoryInfo(process, ref memory, memory.cb)) {
            if (Marshal.GetLastWin32Error() == ERROR_INVALID_PARAMETER) continue;
            throw new Win32Exception();
          }
          if (!Member(process, job)) continue;
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
