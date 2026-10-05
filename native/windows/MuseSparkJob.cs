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
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint length, IntPtr returned);

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

  // Team-only mode. The shared launcher still performs READY/GO, opens the
  // host handle, creates suspended and assigns before resume. This outer job
  // includes the helper, and excludes breakaway. Never used by M27's Join.
  public static int RunTeam(string executable, string[] arguments, string cwd,
    uint parentPid, string[] environment, string ownerPipe, string nonce,
    string statusPipe, string jobName, bool belowNormal) {
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
      using (var status = new NamedPipeClientStream(".", statusPipe, PipeDirection.InOut)) {
        status.Connect(5000);
        var writer = new StreamWriter(status, new UTF8Encoding(false));
        writer.AutoFlush = true;
        var monitor = System.Threading.Tasks.Task.Factory.StartNew(() => {
          int self = System.Diagnostics.Process.GetCurrentProcess().Id;
          while (true) {
            foreach (int pid in TeamMembers(job)) {
              if (pid == self) continue;
              try {
                using (var child = System.Diagnostics.Process.GetProcessById(pid)) {
                  // The OS start identity and job membership, not a PID liveness lease.
                  writer.WriteLine("CONFIRMED " + pid + " " + child.StartTime.ToUniversalTime().ToString("O"));
                  using (var reader = new StreamReader(status, Encoding.UTF8, true, 1024, true)) {
                    if (reader.ReadLine() == "STOP " + nonce) child.Kill();
                  }
                }
              } catch (ArgumentException) { }
              return;
            }
            System.Threading.Thread.Sleep(10);
          }
        });
        int code = MuseSparkMcpJob.Run(executable, arguments, cwd, parentPid,
          environment, false, ownerPipe, nonce);
        // The shared launcher's inner job has closed. Its active members may
        // still be ending; only the outer job count (minus this helper) proves it.
        DateTime deadline = DateTime.UtcNow.AddSeconds(5);
        while (TeamMembers(job).Length != 1) {
          if (DateTime.UtcNow >= deadline) throw new TimeoutException("team job retirement uncertain");
          System.Threading.Thread.Sleep(10);
        }
        writer.WriteLine("END proved");
        // Closing the status stream releases the blocked control reader. No
        // background task is consulted to establish process-tree retirement.
        GC.KeepAlive(monitor);
        completed = true;
        return code;
      }
    } finally {
      if (limitsBuffer != IntPtr.Zero) Marshal.FreeHGlobal(limitsBuffer);
      // Keep the helper's own kill-on-close job until its normal OS exit.
      // Closing it here would kill the helper before PowerShell returns the
      // child's exit code. Failure still closes immediately and fails shut.
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
