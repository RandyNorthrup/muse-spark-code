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
            environment, false, ownerPipe, nonce, (pid, process) => {
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
