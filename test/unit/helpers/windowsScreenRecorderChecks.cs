// Test-only entry point compiled beside the real helper. No capture, device,
// user Videos directory, registry change, service change, or permission prompt.
using System;
using System.IO;
using System.Reflection;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Security.AccessControl;
using System.Security.Principal;
using Windows.Foundation;
using Windows.Storage.Streams;
using Windows.Graphics.Capture;
using Windows.Storage;
using Windows.Media.Transcoding;

internal static class WindowsScreenRecorderChecks
{
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    private static extern uint GetShortPathName(string path, System.Text.StringBuilder shortPath, uint capacity);
    private const BindingFlags PrivateStatic = BindingFlags.NonPublic | BindingFlags.Static;
    private const BindingFlags Instance = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
    public static string LatestFolder;
    private static bool pauseCopy;
    private static object Call(string method, params object[] args)
    {
        return typeof(MuseSparkScreenRecord).GetMethod(method, PrivateStatic).Invoke(null, args);
    }
    private static object Construct(string name, params object[] args)
    {
        Type type = typeof(MuseSparkScreenRecord).GetNestedType(name, BindingFlags.NonPublic);
        return Activator.CreateInstance(type, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
            null, args, null);
    }
    private static object Invoke(object instance, string method, params object[] args)
    {
        return instance.GetType().GetMethod(method, Instance).Invoke(instance, args);
    }
    // Only known-folder resolution is replaced in the test compilation. Main's
    // dispatch, owner binding, stdin and CopyLatest are the production methods.
    public static void Latest(string directory, long maximum, long maxAge, object lifetime)
    {
        try { Call("CopyLatest", LatestFolder, directory, maximum, maxAge, lifetime); }
        catch (TargetInvocationException error) { throw error.InnerException ?? error; }
    }
    public static void CopyBarrier(object lifetime)
    {
        if (!pauseCopy) return;
        pauseCopy = false;
        Console.WriteLine("copying"); Console.Out.Flush();
        Stopwatch elapsed = Stopwatch.StartNew();
        while (!(bool)lifetime.GetType().GetProperty("Stopping", Instance).GetValue(lifetime, null) && elapsed.ElapsedMilliseconds < 2000)
            Thread.Sleep(10);
    }
    public static void Main(string[] args)
    {
        try {
            if (args[0] == "--self-test") { Call("Main", (object)args); return; }
            string mode = args[0];
            if (mode == "shortPath") {
                System.Text.StringBuilder shortPath = new System.Text.StringBuilder(32768);
                uint length = GetShortPathName(args[1], shortPath, (uint)shortPath.Capacity);
                if (length == 0 || length >= shortPath.Capacity) throw new IOException();
                Console.WriteLine(shortPath.ToString()); return;
            }
            if (mode == "probe") { Console.WriteLine("exit:" + Call("Main", (object)new string[] { "--probe" })); return; }
            if (mode == "owner") { Thread.Sleep(Timeout.Infinite); return; }
            if (mode == "mainLatest" || mode == "controlledLatest") {
                pauseCopy = mode == "controlledLatest";
                LatestFolder = args[1];
                Console.WriteLine("exit:" + Call("Main", (object)new string[] { "--latest", args[2], args[3], args[4], args[5] })); return;
            }
            if (mode == "accessDenied") { Console.WriteLine(Call("ErrorCode", new System.ComponentModel.Win32Exception(5), false)); return; }
            if (mode == "disposeFailure") {
                IDisposable lifetime = (IDisposable)Construct("Lifetime");
                lifetime.Dispose();
                bool cancelled = (bool)lifetime.GetType().GetProperty("Cancelled", Instance).GetValue(lifetime, null);
                Console.WriteLine(Call("ErrorCode", new System.ComponentModel.Win32Exception(5), cancelled));
                return;
            }
            if (mode == "cancelRace" || mode == "pending" || mode == "latePending" || mode == "pendingEncode") {
                CheckPending(mode, args.Length > 1 ? args[1] : "prepare"); return;
            }
            if (mode == "ownerDeath") {
                using (Process owner = Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "owner") { UseShellExecute = false, CreateNoWindow = true }))
                using (IDisposable lifetime = (IDisposable)Construct("Lifetime")) {
                    Invoke(lifetime, "WatchOwner", owner.Id);
                    // No native work cooperates here: the actual owner watchdog
                    // must force this helper's exit even without a host timer.
                    owner.Kill(); owner.WaitForExit();
                    Console.WriteLine("watching"); Console.Out.Flush();
                    Thread.Sleep(3000);
                    Console.WriteLine("survived");
                }
                return;
            }
            if (mode == "latest" || mode == "lateCopyCancel") {
                using (IDisposable lifetime = (IDisposable)Construct("Lifetime")) {
                    Call("CopyLatest", args[1], args[2], Int64.Parse(args[3]), Int64.Parse(args[4]), lifetime);
                    if (mode == "lateCopyCancel") Invoke(lifetime, "Stop", true);
                    bool complete = (bool)Invoke(lifetime, "Finish", true);
                    if (mode == "lateCopyCancel") Console.WriteLine("finish:" + complete);
                }
            } else if (mode == "private") {
                Call("CreatePrivate", args[1]);
                DirectorySecurity acl = Directory.GetAccessControl(args[1]);
                SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
                if (!acl.AreAccessRulesProtected || !acl.GetOwner(typeof(SecurityIdentifier)).Equals(user)) throw new InvalidOperationException();
                AuthorizationRuleCollection rules = acl.GetAccessRules(true, true, typeof(SecurityIdentifier));
                if (rules.Count != 1 || !rules[0].IdentityReference.Equals(user)) throw new InvalidOperationException();
            } else if (mode == "fileWrite" || mode == "fileAsync" || mode == "fileLength") {
                Call("CreatePrivate", args[1]);
                using (FileStream sink = (FileStream)Construct("BoundedFile", Path.Combine(args[1], "recording.mp4"), 100L)) {
                    if (mode == "fileLength") sink.SetLength(101);
                    else if (mode == "fileAsync") sink.WriteAsync(new byte[101], 0, 101).GetAwaiter().GetResult();
                    else { sink.Write(new byte[100], 0, 100); sink.WriteByte(1); }
                }
            } else if (mode.StartsWith("stream", StringComparison.Ordinal)) {
                MemoryStreamPort memory = new MemoryStreamPort();
                using (IRandomAccessStream sink = (IRandomAccessStream)Construct("BoundedRandomAccessStream", memory, 100L)) {
                    if (mode == "streamSize") sink.Size = 101;
                    else if (mode == "streamSeek") sink.Seek(101);
                    else if (mode == "streamWrite") { sink.Seek(100); if (sink.WriteAsync(new BufferPort(1)) != null) throw new InvalidOperationException(); }
                    else if (mode == "streamOutput") sink.GetOutputStreamAt(101);
                    else if (mode == "streamOutputWrite") { if (sink.GetOutputStreamAt(100).WriteAsync(new BufferPort(1)) != null) throw new InvalidOperationException(); }
                    else if (mode == "streamClone") sink.CloneStream().Size = 101;
                }
            } else if (mode == "constants") {
                Console.WriteLine(typeof(MuseSparkScreenRecord).GetField("MinSeconds", PrivateStatic).GetRawConstantValue() + "," +
                    typeof(MuseSparkScreenRecord).GetField("MaxSeconds", PrivateStatic).GetRawConstantValue() + "," +
                    typeof(MuseSparkScreenRecord).GetField("MaxBytes", PrivateStatic).GetRawConstantValue() + "," +
                    typeof(MuseSparkScreenRecord).GetField("RecentMaxAgeMilliseconds", PrivateStatic).GetRawConstantValue());
                return;
            } else throw new ArgumentException();
            Console.WriteLine("ok");
        } catch (Exception error) {
            while (error is TargetInvocationException && error.InnerException != null) error = error.InnerException;
            Console.WriteLine("error:" + error.GetType().Name);
        }
    }
    private static void CheckPending(string mode, string stage)
    {
        using (IDisposable lifetime = (IDisposable)Construct("Lifetime")) {
            if (mode == "cancelRace") Invoke(lifetime, "StartRecording");
            if (mode == "latePending") Invoke(lifetime, "Stop", true);
            if (mode == "pendingEncode") {
                Invoke(lifetime, "StartRecording");
                PendingTranscode encode = new PendingTranscode();
                Task transcoding = (Task)Invoke(lifetime, "TrackTranscode", encode);
                Invoke(lifetime, "Stop", false);
                if (transcoding.IsCompleted) throw new InvalidOperationException();
                Invoke(lifetime, "Stop", true);
                try { transcoding.GetAwaiter().GetResult(); throw new InvalidOperationException(); }
                catch (OperationCanceledException) { }
                Console.WriteLine("cancelled:" + lifetime.GetType().GetProperty("Cancelled", Instance).GetValue(lifetime, null) + ",closed:" + encode.Closed);
                return;
            }
            Type value = stage == "selection" ? typeof(GraphicsCaptureItem) : stage == "file" ? typeof(StorageFile) :
                stage == "open" ? typeof(IRandomAccessStream) : typeof(PrepareTranscodeResult);
            Type fakeType = typeof(PendingOperation<>).MakeGenericType(value);
            object operation = Activator.CreateInstance(fakeType);
            Task tracked = (Task)lifetime.GetType().GetMethod("TrackOperation", Instance).MakeGenericMethod(value).Invoke(lifetime, new object[] { operation });
            if (mode == "cancelRace") {
                ManualResetEvent entered = new ManualResetEvent(false), release = new ManualResetEvent(false);
                fakeType.GetField("Entered").SetValue(operation, entered);
                fakeType.GetField("Release").SetValue(operation, release);
                Thread cancel = new Thread(delegate() { Invoke(lifetime, "Stop", true); });
                cancel.Start();
                if (!entered.WaitOne(1000)) throw new InvalidOperationException();
                Thread stop = new Thread(delegate() { Invoke(lifetime, "Stop", false); });
                stop.Start(); release.Set(); cancel.Join(); stop.Join();
                entered.Dispose(); release.Dispose();
            } else if (mode != "latePending") Invoke(lifetime, "Stop", false);
            if (!tracked.WaitHandle().WaitOne(1000)) throw new InvalidOperationException();
            try { tracked.GetAwaiter().GetResult(); throw new InvalidOperationException(); }
            catch (OperationCanceledException) { }
            bool cancelled = (bool)lifetime.GetType().GetProperty("Cancelled", Instance).GetValue(lifetime, null);
            bool closed = (bool)fakeType.GetField("Closed").GetValue(operation);
            Console.WriteLine("cancelled:" + cancelled + ",closed:" + closed + ",finish:" + Invoke(lifetime, "Finish", true));
        }
    }
    private static WaitHandle WaitHandle(this Task task) { return ((IAsyncResult)task).AsyncWaitHandle; }
    private sealed class PendingOperation<T> : IAsyncOperation<T>
    {
        public ManualResetEvent Entered = null, Release = null;
        public bool Closed;
        private AsyncOperationCompletedHandler<T> completed;
        public uint Id { get { return 1; } }
        public AsyncStatus Status { get; private set; }
        public Exception ErrorCode { get { return new OperationCanceledException(); } }
        public AsyncOperationCompletedHandler<T> Completed {
            get { return completed; }
            set { completed = value; if (Status == AsyncStatus.Canceled) completed(this, Status); }
        }
        public void Cancel() {
            lock (this) {
                // WinRT cancellation is idempotent and completion fires once,
                // including concurrent Stop/Cancel calls on the same operation.
                if (Status == AsyncStatus.Canceled) return;
                Status = AsyncStatus.Canceled;
            }
            if (Entered != null) { Entered.Set(); Release.WaitOne(); }
            if (completed != null) completed(this, Status);
        }
        public void Close() { Closed = true; }
        public T GetResults() { throw new OperationCanceledException(); }
    }
    private sealed class PendingTranscode : IAsyncActionWithProgress<double>
    {
        public bool Closed;
        public uint Id { get { return 1; } }
        public AsyncStatus Status { get; private set; }
        public Exception ErrorCode { get { return new OperationCanceledException(); } }
        public AsyncActionProgressHandler<double> Progress { get; set; }
        public AsyncActionWithProgressCompletedHandler<double> Completed { get; set; }
        public void Cancel() { Status = AsyncStatus.Canceled; Completed(this, Status); }
        public void Close() { Closed = true; }
        public void GetResults() { throw new OperationCanceledException(); }
    }
    private sealed class BufferPort : IBuffer
    {
        private readonly uint capacity;
        public BufferPort(uint length) { capacity = length; Length = length; }
        public uint Capacity { get { return capacity; } }
        public uint Length { get; set; }
    }
    private sealed class MemoryStreamPort : IRandomAccessStream, IOutputStream
    {
        public bool CanRead { get { return true; } }
        public bool CanWrite { get { return true; } }
        public ulong Position { get; private set; }
        public ulong Size { get; set; }
        public void Seek(ulong position) { Position = position; }
        public IRandomAccessStream CloneStream() { return new MemoryStreamPort(); }
        public IInputStream GetInputStreamAt(ulong position) { return this; }
        public IOutputStream GetOutputStreamAt(ulong position) { Seek(position); return this; }
        public IAsyncOperationWithProgress<IBuffer, uint> ReadAsync(IBuffer buffer, uint count, InputStreamOptions options) { return null; }
        public IAsyncOperationWithProgress<uint, uint> WriteAsync(IBuffer buffer) { Position += buffer.Length; return null; }
        public IAsyncOperation<bool> FlushAsync() { return null; }
        public void Dispose() { }
    }
}
