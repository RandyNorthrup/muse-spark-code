// M100/H. Independent helper: the existing M27/M50 paths are unchanged.
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class MuseSparkDeviceWorker {
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr Minimum, Maximum;
    public uint Active; public IntPtr Affinity; public uint Priority, Scheduling;
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long User, Kernel, PeriodUser, PeriodKernel;
    public uint Faults, Total, Active, Terminated;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint Size; public IntPtr Reserved; public string Desktop; public IntPtr Title;
    public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
    public ushort Show, ReservedSize; public IntPtr Reserved2, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread; public uint Pid, Tid;
  }
  [StructLayout(LayoutKind.Sequential)] struct PowerStatus {
    public byte AC, Battery, Percent, Reserved; public uint Lifetime, FullLifetime;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, int size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Limits info, int size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string file, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out PowerStatus status);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle, int kind, StringBuilder info, uint size, out uint needed);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr attributes);
  [DllImport("user32.dll")] static extern bool SetThreadDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string file, uint access, uint share, IntPtr attributes, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
  const uint KILL_ON_CLOSE = 0x2000, CONTINUOUS = 0x80000000, SYSTEM_REQUIRED = 1;
  const uint SUSPENDED = 4, UNICODE_ENV = 0x400, NO_WINDOW = 0x08000000;
  const uint DLL_INIT_FAILED = 0xc0000142;
  const int STILL_ACTIVE = 259;
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static string TaskName(string id) { return "MuseSparkDevice-" + id; }
  static string JobName(string id) { return "Global\\MuseSparkDevice-" + id; }
  static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Name(IntPtr handle) {
    uint needed; var value = new StringBuilder(512);
    Check(GetUserObjectInformationW(handle, 2, value, 1024, out needed)); return value.ToString();
  }
  static string Power() {
    PowerStatus status;
    if (!GetSystemPowerStatus(out status)) return "unknown";
    return status.AC == 1 ? "ac" : status.AC == 0 ? "battery" : "unknown";
  }
  static object Query(IntPtr job, bool inhibited) {
    var accounting = new Accounting(); var limits = new Limits();
    if (job != IntPtr.Zero) {
      Check(QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
      Check(QueryInformationJobObject(job, 9, out limits, Marshal.SizeOf(typeof(Limits)), IntPtr.Zero));
    }
    return new { context = new { session = Process.GetCurrentProcess().SessionId,
      station = Name(GetProcessWindowStation()), desktop = Name(GetThreadDesktop(GetCurrentThreadId())) },
      power = Power(), sleepInhibited = inhibited, activeProcesses = accounting.Active,
      cpu100ns = accounting.User + accounting.Kernel, peakMemoryBytes = limits.PeakJobMemory.ToUInt64() };
  }
  static void Write(string file, object value) {
    string temporary = file + ".new";
    File.WriteAllText(temporary, Json.Serialize(value), new UTF8Encoding(false));
    if (File.Exists(file)) File.Delete(file);
    File.Move(temporary, file);
  }
  static string Quote(string value) {
    var output = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      output.Append('\\', c == '"' ? slashes * 2 + 1 : slashes).Append(c); slashes = 0;
    }
    return output.Append('\\', slashes * 2).Append('"').ToString();
  }
  static dynamic Scheduler() {
    var scheduler = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));
    dynamic service = scheduler; service.Connect(); return service;
  }
  static void Launch(string request) {
    var config = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(request));
    string id = (string)config["id"];
    dynamic service = Scheduler(); dynamic definition = service.NewTask(0);
    definition.Principal.UserId = WindowsIdentity.GetCurrent().Name;
    definition.Principal.LogonType = 3; // TASK_LOGON_INTERACTIVE_TOKEN: never a service or logon trigger.
    definition.Settings.ExecutionTimeLimit = "PT0S";
    definition.Settings.DisallowStartIfOnBatteries = false;
    definition.Settings.StopIfGoingOnBatteries = false;
    definition.Settings.AllowDemandStart = true;
    definition.Settings.MultipleInstances = 2; // ignore a second on-demand run.
    dynamic action = definition.Actions.Create(0);
    action.Path = Process.GetCurrentProcess().MainModule.FileName;
    action.Arguments = "--worker " + Quote(request);
    dynamic task = service.GetFolder("\\").RegisterTaskDefinition(TaskName(id), definition, 2, null, null, 3, null);
    task.Run(null);
  }
  static byte[] ReadOutput(Stream stream, int cap, IntPtr job, bool retain) {
    var buffer = new byte[4096]; var output = new MemoryStream(); int count, total = 0;
    while ((count = stream.Read(buffer, 0, buffer.Length)) != 0) {
      total += count;
      if (total > cap) { TerminateJobObject(job, 3); throw new IOException("capacity"); }
      if (retain) output.Write(buffer, 0, count);
    }
    return output.ToArray();
  }
  static void Worker(string request) {
    var config = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(request));
    string directory = (string)config["directory"], id = (string)config["id"];
    int cap = (int)config["outputBytes"], poll = (int)config["pollMs"];
    IntPtr job = IntPtr.Zero, desktop = IntPtr.Zero, input = IntPtr.Zero, environment = IntPtr.Zero;
    IntPtr originalDesktop = GetThreadDesktop(GetCurrentThreadId());
    ProcessInfo child = new ProcessInfo(); bool created = false, assigned = false, inhibited = false;
    string stage = "context";
    try {
      // Refuse before creating any child when not in the interactive scheduler context.
      if (Process.GetCurrentProcess().SessionId == 0 || Name(GetProcessWindowStation()) != "WinSta0") throw new IOException("unsupported-host");
      desktop = CreateDesktopW(TaskName(id), IntPtr.Zero, IntPtr.Zero, 0, 0x01ff, IntPtr.Zero);
      Check(desktop != IntPtr.Zero); Check(SetThreadDesktop(desktop));
      job = CreateJobObjectW(IntPtr.Zero, JobName(id)); Check(job != IntPtr.Zero);
      var limits = new Limits(); limits.Flags = KILL_ON_CLOSE | 8; limits.Active = (uint)(int)config["maxProcesses"];
      Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
      inhibited = SetThreadExecutionState(CONTINUOUS | SYSTEM_REQUIRED) != 0;
      if (!inhibited) throw new IOException("unsupported-host");
      Write(Path.Combine(directory, "ready.json"), Query(job, inhibited));
      var clock = Stopwatch.StartNew();
      while (!File.Exists(Path.Combine(directory, "go"))) {
        if (File.Exists(Path.Combine(directory, "stop")) || clock.ElapsedMilliseconds >= (int)config["readyTimeoutMs"]) {
          Write(Path.Combine(directory, "result.json"), new { exitCode = 1, stdout = "", failure = "none" }); return;
        }
        Thread.Sleep(poll);
      }
      stage = "pipes";
      using (var nullInput = new Microsoft.Win32.SafeHandles.SafeFileHandle(CreateFileW("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero), true))
      using (var output = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable))
      using (var error = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable)) {
        Check(!nullInput.IsInvalid);
        Check(DuplicateHandle(GetCurrentProcess(), nullInput.DangerousGetHandle(), GetCurrentProcess(), out input, 0, true, 2));
        var env = (Dictionary<string, object>)config["environment"];
        stage = "environment";
        string block = string.Join("\0", env.OrderBy(row => row.Key, StringComparer.OrdinalIgnoreCase).Select(row => row.Key + "=" + (string)row.Value)) + "\0\0";
        environment = Marshal.StringToHGlobalUni(block);
        var startup = new Startup(); startup.Size = (uint)Marshal.SizeOf(typeof(Startup)); startup.Desktop = "WinSta0\\" + TaskName(id);
        startup.Flags = 0x100; startup.Input = input; startup.Output = output.ClientSafePipeHandle.DangerousGetHandle(); startup.Error = error.ClientSafePipeHandle.DangerousGetHandle();
        var command = new StringBuilder(Quote((string)config["executable"]));
        foreach (object argument in (System.Collections.IEnumerable)config["args"]) command.Append(' ').Append(Quote((string)argument));
        stage = "create";
        Check(CreateProcessW((string)config["executable"], command, IntPtr.Zero, IntPtr.Zero, true, SUSPENDED | UNICODE_ENV | NO_WINDOW, environment, (string)config["cwd"], ref startup, out child));
        created = true;
        stage = "assign";
        Check(AssignProcessToJobObject(job, child.Process)); assigned = true;
        var stdout = Task.Run(() => ReadOutput(output, cap, job, true));
        var stderr = Task.Run(() => ReadOutput(error, cap, job, false));
        Check(ResumeThread(child.Thread) != 0xffffffff);
        stage = "running";
        output.DisposeLocalCopyOfClientHandle(); error.DisposeLocalCopyOfClientHandle();
        for (;;) {
          Accounting accounting;
          Check(QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
          if (accounting.Active == 0) break; // The only retirement observation, including every descendant.
          if (File.Exists(Path.Combine(directory, "stop"))) Check(TerminateJobObject(job, 1));
          Write(Path.Combine(directory, "query.json"), Query(job, inhibited));
          Thread.Sleep(poll);
        }
        uint exit; Check(GetExitCodeProcess(child.Process, out exit));
        string failure = exit == DLL_INIT_FAILED ? "desktop-heap" : "none", text = "";
        try { Task.WaitAll(stdout, stderr); text = Encoding.UTF8.GetString(stdout.Result); }
        catch { failure = "capacity"; }
        // The channel itself stays bounded after JSON escaping.
        var result = new { exitCode = unchecked((int)exit), stdout = text, failure = failure };
        if (Encoding.UTF8.GetByteCount(Json.Serialize(result)) > cap) result = new { exitCode = 3, stdout = "", failure = "capacity" };
        Write(Path.Combine(directory, "result.json"), result);
      }
    } catch (Exception error) {
      var native = error as Win32Exception;
      Write(Path.Combine(directory, "diagnostic.json"), new { stage = stage, errorType = error.GetType().Name, code = native == null ? 0 : native.NativeErrorCode });
      throw;
    } finally {
      if (created && !assigned) TerminateProcess(child.Process, 3);
      if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
      if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
      if (input != IntPtr.Zero) CloseHandle(input);
      if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
      if (job != IntPtr.Zero) CloseHandle(job); // kill-on-close also covers helper death.
      if (inhibited) SetThreadExecutionState(CONTINUOUS);
      if (desktop != IntPtr.Zero) { SetThreadDesktop(originalDesktop); CloseDesktop(desktop); }
    }
  }
  static void Stop(string id) {
    IntPtr job = OpenJobObjectW(8, false, JobName(id));
    if (job == IntPtr.Zero) return; // stop file handles the pre-job race; absence never proves retirement.
    try { Check(TerminateJobObject(job, 1)); } finally { CloseHandle(job); }
  }
  static void SelfTest() {
    // Exercise the actual launch primitive suspended, assigned, resumed, and observed empty.
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null); Check(job != IntPtr.Zero);
    ProcessInfo child = new ProcessInfo(); bool created = false, assigned = false;
    try {
      var limits = new Limits(); limits.Flags = KILL_ON_CLOSE;
      Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
      var startup = new Startup(); startup.Size = (uint)Marshal.SizeOf(typeof(Startup));
      string executable = Process.GetCurrentProcess().MainModule.FileName;
      Check(CreateProcessW(executable, new StringBuilder(Quote(executable) + " --probe"), IntPtr.Zero, IntPtr.Zero, false, SUSPENDED | NO_WINDOW, IntPtr.Zero, null, ref startup, out child));
      created = true; Check(AssignProcessToJobObject(job, child.Process)); assigned = true;
      Check(ResumeThread(child.Thread) != 0xffffffff);
      Accounting info;
      do { Thread.Sleep(20); Check(QueryInformationJobObject(job, 1, out info, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)); } while (info.Active != 0);
      uint code; Check(GetExitCodeProcess(child.Process, out code)); Check(code == 0);
      // Claims only this in-process job probe; the scheduler path is qualified per real launch.
      Query(job, false); Console.WriteLine(Json.Serialize(new { jobProbe = true, query = true, power = Power(), scheduler = "untested" }));
    } finally {
      if (created && !assigned) TerminateProcess(child.Process, 3);
      if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
      if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
      CloseHandle(job);
    }
  }
  public static int Main(string[] args) {
    try {
      switch (args[0]) {
        case "--probe": Query(IntPtr.Zero, false); break;
        case "--query":
          IntPtr held = IntPtr.Zero;
          try {
            // The native query is per job. W/V request one sample per admitted tree.
            if (args.Length > 1) held = OpenJobObjectW(4, false, JobName(args[1]));
            Console.WriteLine(Json.Serialize(Query(held, held != IntPtr.Zero)));
          } finally { if (held != IntPtr.Zero) CloseHandle(held); }
          break;
        case "--self-test": SelfTest(); break;
        case "--launch": Launch(args[1]); break;
        case "--worker": Worker(args[1]); break;
        case "--stop": Stop(args[1]); break;
        case "--remove": Scheduler().GetFolder("\\").DeleteTask(TaskName(args[1]), 0); break;
        case "--task-state":
          dynamic task = Scheduler().GetFolder("\\").GetTask(TaskName(args[1]));
          Console.WriteLine(Json.Serialize(new { state = task.State == 4 ? "running" : "unknown", lastExitCode = unchecked((int)Convert.ToInt64(task.LastTaskResult)) }));
          break;
        default: return 1;
      }
      return 0;
    } catch { return 1; }
  }
}
