// The Win32 half of the Windows MCP stdio launcher (M50) and of the shell
// job helper (M27), shipped beside the extension and compiled on first use
// (PLAN.md D6: kept out of the host bundle). C# 5, which Windows PowerShell
// 5.1's Add-Type compiles.
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

  const uint CREATE_SUSPENDED = 0x4;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const uint STARTF_USESTDHANDLES = 0x00000100;
  const int PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
  const uint DUPLICATE_SAME_ACCESS = 0x2;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
  const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200;
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
    using (var control = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut,
      PipeOptions.Asynchronous)) {
      control.Connect(HANDSHAKE_TIMEOUT_MS);
      byte[] ready = Encoding.UTF8.GetBytes("READY " + nonce + "\n");
      control.Write(ready, 0, ready.Length);
      control.Flush();
      var answer = new List<byte>();
      var one = new byte[1];
      DateTime deadline = DateTime.UtcNow.AddMilliseconds(HANDSHAKE_TIMEOUT_MS);
      while (answer.Count < HANDSHAKE_MAX_BYTES) {
        int remaining = (int)(deadline - DateTime.UtcNow).TotalMilliseconds;
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
    }
  }

  public static int Run(string executable, string[] arguments, string cwd, uint parentPid,
    string[] childEnvironment, bool verbatimArguments, string controlPipe, string controlNonce,
    ulong jobMemoryLimit) {
    IntPtr job = IntPtr.Zero, input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero;
    IntPtr parent = IntPtr.Zero;
    IntPtr attributeList = IntPtr.Zero, handleList = IntPtr.Zero;
    IntPtr environmentBlock = IntPtr.Zero;
    bool attributesReady = false;
    PROCESS_INFORMATION process = new PROCESS_INFORMATION();
    bool created = false, assigned = false;
    try {
      parent = OpenProcess(SYNCHRONIZE, false, parentPid);
      if (parent == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT)
        throw new Exception("creating Node process has already exited");
      ConfirmOwner(controlPipe, controlNonce, parent);
      job = CreateJobObjectW(IntPtr.Zero, "Local\\MuseSparkMcp-" + Guid.NewGuid().ToString("N"));
      if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      var limits = new EXTENDED_LIMITS();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      // A bound on everything in the job together (M91b, plugin children).
      if (jobMemoryLimit > 0) {
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
        limits.JobMemoryLimit = new UIntPtr(jobMemoryLimit);
      }
      if (!SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(EXTENDED_LIMITS))))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      input = InheritStandard(-10);
      output = InheritStandard(-11);
      error = InheritStandard(-12);
      IntPtr attributeSize = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
      attributeList = Marshal.AllocHGlobal(attributeSize);
      if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      attributesReady = true;
      handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
      Marshal.WriteIntPtr(handleList, 0, input);
      Marshal.WriteIntPtr(handleList, IntPtr.Size, output);
      Marshal.WriteIntPtr(handleList, IntPtr.Size * 2, error);
      if (!UpdateProcThreadAttribute(attributeList, 0,
        new IntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST), handleList,
        new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      var startup = new STARTUPINFOEX();
      startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
      startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
      startup.StartupInfo.hStdInput = input;
      startup.StartupInfo.hStdOutput = output;
      startup.StartupInfo.hStdError = error;
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
      if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) throw new Exception("creating Node process exited before resume");
      if (ResumeThread(process.hThread) == 0xffffffff)
        throw new Win32Exception(Marshal.GetLastWin32Error());
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
      if (attributesReady) DeleteProcThreadAttributeList(attributeList);
      if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
      if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (parent != IntPtr.Zero) CloseHandle(parent);
    }
  }
}
