// The Win32 half of the Windows MCP stdio launcher (M50) and of the shell
// job helper (M27), shipped beside the extension and compiled on first use
// (PLAN.md D6: kept out of the host bundle). C# 5, which Windows PowerShell
// 5.1's Add-Type compiles.
// SPAWN017C: the job object attests its own tree. The helper holds the only
// handle to an unnamed kill-on-close job without breakaway, caps its active
// processes through the job, waits in process until the job is empty, and
// reports one final record on the owner's control pipe. No reader process
// runs per launch.
public sealed class MuseSparkJobAttestation {
  public uint ActiveProcessLimit;
  public uint SpawnLimit;
  public int SpawnWindowMs;
  public int SampleMs;
  public int EmptyTimeoutMs;
  internal System.IO.Stream Control;
  // The job's completion port: the kernel posts a message for each child the
  // active-process cap refused (JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT).
  internal IntPtr Port;
  readonly object writing = new object();

  internal void Send(string line) {
    byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
    lock (writing) {
      Control.Write(bytes, 0, bytes.Length);
      Control.Flush();
    }
  }
}

public static class MuseSparkMcpJob {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public uint cb;
    public IntPtr lpReserved, lpDesktop, lpTitle;
    public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public ushort wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct STARTUPINFOEX {
    public STARTUPINFO StartupInfo;
    public IntPtr lpAttributeList;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public uint dwProcessId, dwThreadId;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct BASIC_LIMITS {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public IntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOB_PORT {
    public IntPtr CompletionKey, CompletionPort;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOB_TOTALS {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct EXTENDED_LIMITS {
    public BASIC_LIMITS BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes,
    IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd,
    ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute,
    IntPtr value, IntPtr valueSize, IntPtr previousValue, IntPtr returnSize);
  [DllImport("kernel32.dll")]
  static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref EXTENDED_LIMITS info, int length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOB_PORT info, int length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr existing, UIntPtr key, uint threads);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetQueuedCompletionStatus(IntPtr port, out uint message, out UIntPtr key,
    out IntPtr overlapped, uint timeout);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out JOB_TOTALS info,
    int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out EXTENDED_LIMITS info,
    int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit,
    out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint timeout);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr sourceHandle, IntPtr targetProcess,
    out IntPtr targetHandle, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern void GetStartupInfoW(out STARTUPINFO startup);

  const uint CREATE_SUSPENDED = 0x4;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const uint STARTF_USESTDHANDLES = 0x00000100;
  const int PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
  const uint DUPLICATE_SAME_ACCESS = 0x2;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
  const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200;
  const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8;
  const uint JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x800;
  const uint JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x1000;
  const int JOB_BASIC_ACCOUNTING = 1;
  const int JOB_EXTENDED_LIMITS = 9;
  const int JOB_ASSOCIATE_COMPLETION_PORT = 7;
  const uint JOB_MSG_ACTIVE_PROCESS_LIMIT = 3;
  const uint JOB_MSG_PROCESS_MEMORY_LIMIT = 9, JOB_MSG_JOB_MEMORY_LIMIT = 10;
  const int EMPTY_POLL_MS = 5;
  const uint OWNER_GONE_EXIT = 4, STOPPED_EXIT = 5, SPAWN_RATE_EXIT = 6;
  const long TICKS_PER_MS = 10000;
  const uint WAIT_OBJECT_0 = 0;
  const uint WAIT_TIMEOUT = 258;
  const uint SYNCHRONIZE = 0x00100000;
  const int HANDSHAKE_TIMEOUT_MS = 5000;
  const int HANDSHAKE_MAX_BYTES = 128;

  static IntPtr InheritStandard(int kind) {
    IntPtr source = GetStdHandle(kind);
    if (source == IntPtr.Zero || source == new IntPtr(-1)) throw new Win32Exception("missing standard handle");
    IntPtr copy;
    if (!DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), out copy, 0, true,
      DUPLICATE_SAME_ACCESS)) throw new Win32Exception(Marshal.GetLastWin32Error());
    return copy;
  }

  static string Quote(string part) {
    var quoted = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in part) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') {
        quoted.Append('\\', slashes * 2 + 1).Append('"');
      } else {
        quoted.Append('\\', slashes).Append(c);
      }
      slashes = 0;
    }
    return quoted.Append('\\', slashes * 2).Append('"').ToString();
  }

  static IntPtr EnvironmentBlock(string[] pairs) {
    var entries = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    foreach (string pair in pairs) {
      int separator = pair.IndexOf('=');
      if (separator <= 0 || pair.IndexOf('\0') >= 0) throw new ArgumentException("invalid environment entry");
      entries[pair.Substring(0, separator)] = pair.Substring(separator + 1);
    }
    var block = new StringBuilder();
    foreach (var entry in entries) block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
    block.Append('\0');
    return Marshal.StringToHGlobalUni(block.ToString());
  }

  // The Node owner can answer only while it is alive. It sends GO over a
  // private pipe after this helper has bound the owner's process handle, so
  // even a PID recycled before OpenProcess cannot authorize the child.
  static void ConfirmOwner(string pipeName, string nonce, IntPtr parent) {
    using (OpenOwner(pipeName, nonce, parent)) { }
  }

  static NamedPipeClientStream OpenOwner(string pipeName, string nonce, IntPtr parent) {
    var control = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut,
      PipeOptions.Asynchronous);
    try {
      control.Connect(HANDSHAKE_TIMEOUT_MS);
      byte[] ready = Encoding.UTF8.GetBytes("READY " + nonce + "\n");
      control.Write(ready, 0, ready.Length);
      control.Flush();
      var answer = new List<byte>();
      var one = new byte[1];
      var clock = System.Diagnostics.Stopwatch.StartNew();
      while (answer.Count < HANDSHAKE_MAX_BYTES) {
        int remaining = HANDSHAKE_TIMEOUT_MS - (int)clock.ElapsedMilliseconds;
        if (remaining <= 0) throw new TimeoutException("MCP owner confirmation timed out");
        var reading = control.ReadAsync(one, 0, 1);
        if (!reading.Wait(remaining)) throw new TimeoutException("MCP owner confirmation timed out");
        if (reading.Result == 0) throw new IOException("creating Node process closed the control pipe");
        int value = one[0];
        if (value == '\n') break;
        answer.Add((byte)value);
      }
      if (Encoding.UTF8.GetString(answer.ToArray()) != "GO " + nonce)
        throw new IOException("creating Node process did not authorize the launch");
      if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT)
        throw new IOException("creating Node process exited before launch");
      return control;
    } catch {
      control.Dispose();
      throw;
    }
  }

  public static int Run(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce) {
    return Run(executable, arguments, cwd, parentPid, childEnvironment, verbatimArguments,
      controlPipe, controlNonce, 0, null);
  }

  // Team launches persist the suspended child's kernel identity before resume.
  // Other callers retain the original eight-argument entry and behavior.
  public static int Run(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce,
    Action<uint, IntPtr> beforeResume) {
    return Run(executable, arguments, cwd, parentPid, childEnvironment, verbatimArguments,
      controlPipe, controlNonce, 0, beforeResume);
  }

  public static int Run(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce,
    ulong jobMemoryLimit) {

    return Run(executable, arguments, cwd, parentPid, childEnvironment, verbatimArguments,
      controlPipe, controlNonce, jobMemoryLimit, false, null);
  }

  public static int Run(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce,
    ulong jobMemoryLimit, Action<uint, IntPtr> beforeResume) {
    return Run(executable, arguments, cwd, parentPid, childEnvironment, verbatimArguments,
      controlPipe, controlNonce, jobMemoryLimit, false, beforeResume);
  }

  public static int Run(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce,
    ulong jobMemoryLimit, bool debugPipes) {
    return Run(executable, arguments, cwd, parentPid, childEnvironment, verbatimArguments,
      controlPipe, controlNonce, jobMemoryLimit, debugPipes, null);
  }

  public static int Run(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce,
    ulong jobMemoryLimit, bool debugPipes, Action<uint, IntPtr> beforeResume) {
    return RunCore(executable, arguments, cwd, parentPid, childEnvironment, verbatimArguments,
      controlPipe, controlNonce, jobMemoryLimit, debugPipes, beforeResume, null);
  }

  public static int RunAttested(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce,
    ulong jobMemoryLimit, MuseSparkJobAttestation attestation) {
    if (attestation == null) throw new ArgumentNullException("attestation");
    return RunCore(executable, arguments, cwd, parentPid, childEnvironment, verbatimArguments,
      controlPipe, controlNonce, jobMemoryLimit, false, null, attestation);
  }

  static int RunCore(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce,
    ulong jobMemoryLimit, bool debugPipes, Action<uint, IntPtr> beforeResume,
    MuseSparkJobAttestation attestation) {
    IntPtr job = IntPtr.Zero, input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero;
    IntPtr parent = IntPtr.Zero;
    IntPtr attributeList = IntPtr.Zero, handleList = IntPtr.Zero;
    IntPtr environmentBlock = IntPtr.Zero;
    IntPtr descriptors = IntPtr.Zero;
    var extraHandles = new List<IntPtr>();
    bool attributesReady = false;
    PROCESS_INFORMATION process = new PROCESS_INFORMATION();
    bool created = false, assigned = false;
    try {
      parent = OpenProcess(SYNCHRONIZE, false, parentPid);
      if (parent == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT)
        throw new Exception("creating Node process has already exited");
      if (attestation == null) ConfirmOwner(controlPipe, controlNonce, parent);
      else attestation.Control = OpenOwner(controlPipe, controlNonce, parent);
      // C1: the private launch pipe also names the job the owner's registry queries.
      // An attested job is unnamed: no other process can open it and keep it alive.
      job = CreateJobObjectW(IntPtr.Zero, attestation == null ? "Local\\" + controlPipe : null);
      if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      var limits = new EXTENDED_LIMITS();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      // A bound on everything in the job together (M91b, plugin children).
      if (jobMemoryLimit > 0) {
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
        limits.JobMemoryLimit = new UIntPtr(jobMemoryLimit);
      }
      if (attestation != null && attestation.ActiveProcessLimit > 0) {
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        limits.BasicLimitInformation.ActiveProcessLimit = attestation.ActiveProcessLimit;
      }
      if (!SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(EXTENDED_LIMITS))))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      if (attestation != null) {
        RequireContainment(job);
        // Before any process joins, so no limit message can be missed.
        attestation.Port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
        if (attestation.Port == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var port = new JOB_PORT { CompletionKey = job, CompletionPort = attestation.Port };
        if (!SetInformationJobObject(job, JOB_ASSOCIATE_COMPLETION_PORT, ref port,
          Marshal.SizeOf(typeof(JOB_PORT)))) throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      input = InheritStandard(-10);
      output = InheritStandard(-11);
      error = InheritStandard(-12);
      IntPtr attributeSize = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
      attributeList = Marshal.AllocHGlobal(attributeSize);
      if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      attributesReady = true;
      var inherited = new List<IntPtr> { input, output, error };
      if (debugPipes) {
        STARTUPINFO incoming;
        GetStartupInfoW(out incoming);
        int descriptorBytes = 4 + 5 + 5 * IntPtr.Size;
        if (incoming.lpReserved2 == IntPtr.Zero || incoming.cbReserved2 != descriptorBytes ||
            Marshal.ReadInt32(incoming.lpReserved2) != 5)
          throw new InvalidDataException("invalid CDP descriptor table");
        descriptors = Marshal.AllocHGlobal(descriptorBytes);
        Marshal.WriteInt32(descriptors, 5);
        for (int index = 0; index < 5; index++) {
          IntPtr handle;
          if (index < 3) handle = inherited[index];
          else {
            IntPtr source = Marshal.ReadIntPtr(incoming.lpReserved2, 9 + index * IntPtr.Size);
            if (source == IntPtr.Zero || source == new IntPtr(-1))
              throw new InvalidDataException("missing CDP pipe");
            if (!DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), out handle,
                0, true, DUPLICATE_SAME_ACCESS)) throw new Win32Exception(Marshal.GetLastWin32Error());
            extraHandles.Add(handle);
            inherited.Add(handle);
          }
          Marshal.WriteByte(descriptors, 4 + index, Marshal.ReadByte(incoming.lpReserved2, 4 + index));
          Marshal.WriteIntPtr(descriptors, 9 + index * IntPtr.Size, handle);
        }
      }
      handleList = Marshal.AllocHGlobal(IntPtr.Size * inherited.Count);
      for (int index = 0; index < inherited.Count; index++)
        Marshal.WriteIntPtr(handleList, IntPtr.Size * index, inherited[index]);
      if (!UpdateProcThreadAttribute(attributeList, 0,
        new IntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST), handleList,
        new IntPtr(IntPtr.Size * inherited.Count), IntPtr.Zero, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      var startup = new STARTUPINFOEX();
      startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
      startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
      startup.StartupInfo.hStdInput = input;
      startup.StartupInfo.hStdOutput = output;
      startup.StartupInfo.hStdError = error;
      if (debugPipes) {
        startup.StartupInfo.cbReserved2 = (ushort)(4 + 5 + 5 * IntPtr.Size);
        startup.StartupInfo.lpReserved2 = descriptors;
      }
      startup.lpAttributeList = attributeList;
      environmentBlock = EnvironmentBlock(childEnvironment);
      var command = new StringBuilder(Quote(executable));
      foreach (string argument in arguments) command.Append(' ').Append(verbatimArguments ? argument : Quote(argument));
      if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true,
        CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
        environmentBlock, cwd, ref startup, out process))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      created = true;
      if (!AssignProcessToJobObject(job, process.hProcess))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      assigned = true;
      if (beforeResume != null) beforeResume(process.dwProcessId, process.hProcess);
      if (attestation != null)
        attestation.Send("PID " + process.dwProcessId.ToString(Invariant) + " " +
          Creation(process.hProcess).ToString(Invariant));
      if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) throw new Exception("creating Node process exited before resume");
      if (ResumeThread(process.hThread) == 0xffffffff)
        throw new Win32Exception(Marshal.GetLastWin32Error());
      if (attestation != null) return Attest(job, process.hProcess, parent, attestation);
      uint wait = WaitForMultipleObjects(2, new IntPtr[] { process.hProcess, parent }, false, 0xffffffff);
      if (wait == WAIT_OBJECT_0 + 1) return 4;
      if (wait != WAIT_OBJECT_0) throw new Win32Exception(Marshal.GetLastWin32Error());
      uint exitCode;
      if (!GetExitCodeProcess(process.hProcess, out exitCode))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      return (int)exitCode;
    } finally {
      if (created && !assigned) TerminateProcess(process.hProcess, 3);
      if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
      if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
      if (input != IntPtr.Zero) CloseHandle(input);
      if (output != IntPtr.Zero) CloseHandle(output);
      if (error != IntPtr.Zero) CloseHandle(error);
      foreach (IntPtr handle in extraHandles) CloseHandle(handle);
      if (descriptors != IntPtr.Zero) Marshal.FreeHGlobal(descriptors);
      if (attributesReady) DeleteProcThreadAttributeList(attributeList);
      if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
      if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (parent != IntPtr.Zero) CloseHandle(parent);
      if (attestation != null && attestation.Control != null) attestation.Control.Dispose();
      if (attestation != null && attestation.Port != IntPtr.Zero) CloseHandle(attestation.Port);
    }
  }

  static readonly IFormatProvider Invariant = System.Globalization.CultureInfo.InvariantCulture;

  static long Creation(IntPtr process) {
    long creation, exit, kernel, user;
    if (!GetProcessTimes(process, out creation, out exit, out kernel, out user))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    return creation;
  }

  static JOB_TOTALS Totals(IntPtr job) {
    JOB_TOTALS totals;
    if (!QueryInformationJobObject(job, JOB_BASIC_ACCOUNTING, out totals,
      Marshal.SizeOf(typeof(JOB_TOTALS)), IntPtr.Zero))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    return totals;
  }

  static EXTENDED_LIMITS Limits(IntPtr job) {
    EXTENDED_LIMITS limits;
    if (!QueryInformationJobObject(job, JOB_EXTENDED_LIMITS, out limits,
      Marshal.SizeOf(typeof(EXTENDED_LIMITS)), IntPtr.Zero))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    return limits;
  }

  // Every pending job message, without waiting: the cap's refusals and which memory
  // limits the kernel enforced against this tree.
  static void DrainLimits(IntPtr port, ref uint refusals, ref bool jobMemory, ref bool processMemory) {
    uint message;
    UIntPtr key;
    IntPtr overlapped;
    while (GetQueuedCompletionStatus(port, out message, out key, out overlapped, 0)) {
      if (message == JOB_MSG_ACTIVE_PROCESS_LIMIT) refusals++;
      else if (message == JOB_MSG_JOB_MEMORY_LIMIT) jobMemory = true;
      else if (message == JOB_MSG_PROCESS_MEMORY_LIMIT) processMemory = true;
    }
  }

  // Read back what the kernel holds: kill on close, and no way to break away.
  static void RequireContainment(IntPtr job) {
    uint flags = Limits(job).BasicLimitInformation.LimitFlags;
    if ((flags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) == 0 ||
        (flags & (JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK)) != 0)
      throw new InvalidDataException("job containment flags");
  }

  // Waits for the root, a STOP (or the owner's pipe closing) or the owner's exit;
  // enforces the spawn rate from the job's own birth count; then ends the whole
  // job and waits until it is empty before reporting. The record goes out last.
  static int Attest(IntPtr job, IntPtr root, IntPtr parent, MuseSparkJobAttestation attestation) {
    var stop = new System.Threading.ManualResetEvent(false);
    var reader = new System.Threading.Thread(() => {
      try {
        var buffer = new byte[16];
        var text = new StringBuilder();
        for (;;) {
          int count = attestation.Control.Read(buffer, 0, buffer.Length);
          if (count <= 0) break;
          text.Append(Encoding.UTF8.GetString(buffer, 0, count));
          // STOP is the only message an owner sends; anything else also ends the launch.
          if (text.Length >= 5) break;
        }
      } catch (Exception) {
        // A broken pipe is an owner that can no longer govern this tree.
      }
      stop.Set();
    });
    reader.IsBackground = true;
    reader.Start();
    IntPtr[] handles = { root, parent, stop.SafeWaitHandle.DangerousGetHandle() };
    var births = new Queue<long>();
    var clock = System.Diagnostics.Stopwatch.StartNew();
    uint seen = 0, exitCode = 0, refusals = 0;
    bool jobMemory = false, processMemory = false;
    string ending = "exit";
    for (;;) {
      uint wait = WaitForMultipleObjects(3, handles, false, (uint)attestation.SampleMs);
      JOB_TOTALS totals = Totals(job);
      DrainLimits(attestation.Port, ref refusals, ref jobMemory, ref processMemory);
      long now = clock.ElapsedMilliseconds;
      for (; seen < totals.TotalProcesses; seen++) births.Enqueue(now);
      while (births.Count > 0 && now - births.Peek() >= attestation.SpawnWindowMs) births.Dequeue();
      if (attestation.SpawnLimit > 0 && births.Count > attestation.SpawnLimit) {
        ending = "spawnRate";
        exitCode = SPAWN_RATE_EXIT;
        break;
      }
      if (wait == WAIT_OBJECT_0) {
        if (!GetExitCodeProcess(root, out exitCode))
          throw new Win32Exception(Marshal.GetLastWin32Error());
        break;
      }
      if (wait == WAIT_OBJECT_0 + 1) {
        ending = "owner";
        exitCode = OWNER_GONE_EXIT;
        break;
      }
      if (wait == WAIT_OBJECT_0 + 2) {
        ending = "stopped";
        exitCode = STOPPED_EXIT;
        break;
      }
      if (wait != WAIT_TIMEOUT) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    // A contained tree ends with its root: what the root left behind is ended too.
    if (!TerminateJobObject(job, exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error());
    bool emptied = false;
    var drain = System.Diagnostics.Stopwatch.StartNew();
    for (;;) {
      if (Totals(job).ActiveProcesses == 0) {
        emptied = true;
        break;
      }
      if (drain.ElapsedMilliseconds >= attestation.EmptyTimeoutMs) break;
      System.Threading.Thread.Sleep(EMPTY_POLL_MS);
    }
    JOB_TOTALS final = Totals(job);
    DrainLimits(attestation.Port, ref refusals, ref jobMemory, ref processMemory);
    var limits = new List<string>();
    if (refusals > 0) limits.Add("\"activeProcess\"");
    if (jobMemory) limits.Add("\"jobMemory\"");
    if (processMemory) limits.Add("\"processMemory\"");
    ulong peak = Limits(job).PeakJobMemoryUsed.ToUInt64();
    string record = "{\"v\":1,\"ending\":\"" + ending + "\",\"exitCode\":" +
      ((int)exitCode).ToString(Invariant) + ",\"emptied\":" + (emptied ? "true" : "false") +
      ",\"cpuMs\":" + ((final.TotalUserTime + final.TotalKernelTime) / TICKS_PER_MS).ToString(Invariant) +
      ",\"peakJobMemoryBytes\":" + peak.ToString(Invariant) +
      ",\"totalProcesses\":" + final.TotalProcesses.ToString(Invariant) +
      ",\"capRefusals\":" + refusals.ToString(Invariant) +
      ",\"limits\":[" + string.Join(",", limits.ToArray()) + "]" +
      ",\"activeProcessLimit\":" + attestation.ActiveProcessLimit.ToString(Invariant) + "}";
    try {
      attestation.Send("RESULT " + record);
    } catch (Exception) {
      // The owner treats a missing record as an unobserved retirement (uncertain).
    }
    return (int)exitCode;
  }
}
