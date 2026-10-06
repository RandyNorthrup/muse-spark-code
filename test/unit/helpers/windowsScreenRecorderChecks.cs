// Test-only entry point compiled beside the real helper. No capture, device,
// user Videos directory, registry change, service change, or permission prompt.
using System;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using Windows.Foundation;
using Windows.Storage.Streams;

internal static class WindowsScreenRecorderChecks
{
    private const BindingFlags PrivateStatic = BindingFlags.NonPublic | BindingFlags.Static;
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
    public static void Main(string[] args)
    {
        try {
            if (args[0] == "--self-test") { Call("Main", (object)args); return; }
            string mode = args[0];
            if (mode == "latest") {
                Call("CopyLatest", args[1], args[2], Int64.Parse(args[3]), Int64.Parse(args[4]));
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
