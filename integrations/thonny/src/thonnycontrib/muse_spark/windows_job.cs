// The launcher owns only processes, never a device handle (MIT).
using System;
using System.Runtime.InteropServices;
using System.Text;

internal static class MuseSparkThonnyJob
{
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorking, MaxWorking;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public uint Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public ushort ShowWindow, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo
    {
        public IntPtr Process, Thread;
        public uint ProcessId, ThreadId;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr data, uint size);
    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta,
        bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")]
    private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")]
    private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")]
    private static extern void ExitProcess(uint code);

    private static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            result.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes);
            result.Append(ch);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    private static int Main(string[] args)
    {
        if (args.Length == 0) return 1;
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return 1;
        ProcessInfo process = new ProcessInfo();
        bool owned = false;
        uint exitCode = 1;
        try
        {
            ExtendedLimits limits = new ExtendedLimits();
            limits.Basic.Flags = 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            int size = Marshal.SizeOf(typeof(ExtendedLimits));
            IntPtr data = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limits, data, false);
                if (!SetInformationJobObject(job, 9, data, (uint)size)) return 1;
            }
            finally { Marshal.FreeHGlobal(data); }
            // Own the launcher first: shutdown during CreateProcess/assignment
            // cannot leave an unowned suspended child behind.
            if (!AssignProcessToJobObject(job, GetCurrentProcess())) return 1;
            string app = args[0];
            string command = string.Join(" ", Array.ConvertAll(args, Quote));
            if (app.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) ||
                app.EndsWith(".bat", StringComparison.OrdinalIgnoreCase))
            {
                app = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
                command = Quote(app) + " /d /s /c \"" + command + "\"";
            }
            StartupInfo startup = new StartupInfo();
            startup.Size = (uint)Marshal.SizeOf(typeof(StartupInfo));
            startup.Flags = 0x00000100; // STARTF_USESTDHANDLES: preserve private stdout pipe
            startup.Input = GetStdHandle(-10);
            startup.Output = GetStdHandle(-11);
            startup.Error = GetStdHandle(-12);
            // CREATE_SUSPENDED | CREATE_NO_WINDOW: no runtime byte executes unowned.
            if (!CreateProcess(app, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero,
                true, 0x08000004, IntPtr.Zero, null, ref startup, out process)) return 1;
            // The child inherited the launcher's job atomically at creation.
            owned = true;
            if (ResumeThread(process.Thread) == 0xffffffff) return 1;
            uint code;
            if (WaitForSingleObject(process.Process, 0xffffffff) != 0 ||
                !GetExitCodeProcess(process.Process, out code)) return 1;
            exitCode = code;
            return unchecked((int)code);
        }
        finally
        {
            if (process.Process != IntPtr.Zero && !owned) TerminateProcess(process.Process, 1);
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
            // This launcher belongs to its own job. Explicitly closing the job
            // would kill us before Main can return the child's failure status.
            // ExitProcess preserves that status; OS handle cleanup closes the
            // job and releases every descendant, including after parent exit.
            ExitProcess(exitCode);
        }
    }
}
