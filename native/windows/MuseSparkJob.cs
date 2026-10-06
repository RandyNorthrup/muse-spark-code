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
