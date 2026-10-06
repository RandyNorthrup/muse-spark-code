// M105 R2. C# 5 / inbox .NET Framework and Windows WinRT metadata only.
// Windows.Graphics.Capture supplies surfaces; MediaTranscoder's Media
// Foundation pipeline encodes H.264/AAC into the bounded private MP4 sink.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Media.Core;
using Windows.Media.MediaProperties;
using Windows.Media.Transcoding;
using Windows.Foundation;
using Windows.Storage;
using Windows.Storage.Streams;
using FileAttributes = System.IO.FileAttributes;

internal sealed class MuseSparkScreenRecord : Form
{
    private const int MinSeconds = 10, MaxSeconds = 600;
    private const long MaxBytes = 1024L * 1024 * 1024;
    private const int FrameBuffers = 2, FramesPerSecond = 30, AudioFrames = 480;
    private const uint VideoBitrate = 4000000, AudioBitrate = 128000;
    private const int SampleRate = 48000, Channels = 2, Bits = 16;
    private const int PollMilliseconds = 10, ParentPollMilliseconds = 100;
    private const long RecentMaxAgeMilliseconds = 10L * 60 * 1000;
    private readonly object gate = new object();
    private readonly string directory;
    private readonly long byteLimit;
    private readonly int maxSeconds, parent;
    private readonly bool microphone, systemAudio;
    private readonly Label clock = new Label();
    private readonly Stopwatch elapsed = new Stopwatch();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private volatile bool stopping, cancelled, finished;
    private bool ownsDirectory;
    private Direct3D11CaptureFrame pending;
    private TimeSpan? videoStart;
    private Exception failure;
    private long audioPosition;
    private volatile IAsyncInfo pendingOperation;

    private MuseSparkScreenRecord(string[] args)
    {
        directory = args[1]; byteLimit = ParseLimit(args[2], MaxBytes);
        parent = Int32.Parse(args[3], CultureInfo.InvariantCulture);
        maxSeconds = Int32.Parse(args[4], CultureInfo.InvariantCulture);
        if (maxSeconds < MinSeconds || maxSeconds > MaxSeconds || parent <= 0)
            throw new ArgumentException();
        microphone = Boolean.Parse(args[5]); systemAudio = Boolean.Parse(args[6]);
        Text = args[7]; Width = 320; Height = 130; TopMost = true;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        clock.Dock = DockStyle.Top; clock.Height = 32; clock.TextAlign = System.Drawing.ContentAlignment.MiddleCenter;
        Button stop = new Button(); stop.Text = args[8]; stop.Dock = DockStyle.Fill;
        stop.Click += delegate { Stop(false); };
        Controls.Add(stop); Controls.Add(clock);
        FormClosing += delegate(object sender, FormClosingEventArgs closing) { if (!finished) { closing.Cancel = true; Stop(true); } };
        timer.Interval = ParentPollMilliseconds;
        timer.Tick += delegate {
            clock.Text = Math.Max(0, maxSeconds - (int)elapsed.Elapsed.TotalSeconds).ToString(CultureInfo.CurrentCulture);
            if (elapsed.IsRunning && elapsed.Elapsed.TotalSeconds >= maxSeconds) Stop(false);
            try { using (Process owner = Process.GetProcessById(parent)) { if (owner.HasExited) Stop(true); } }
            catch (ArgumentException) { Stop(true); }
        };
        Shown += async delegate {
            bool success = false;
            try {
                timer.Start(); SystemEvents.PowerModeChanged += PowerChanged;
                Thread controls = new Thread(delegate() {
                    string command;
                    while ((command = Console.ReadLine()) != null) {
                        if (command == "stop") Stop(false); else Stop(true);
                    }
                    Stop(true);
                });
                controls.IsBackground = true; controls.Start();
                await Record(); success = !cancelled && failure == null;
            }
            catch (Exception error) { failure = error; }
            finally {
                finished = true;
                timer.Stop(); timer.Dispose();
                SystemEvents.PowerModeChanged -= PowerChanged;
                if (!success && ownsDirectory) RemovePrivate(directory);
                Emit(success ? "complete" : "error", success ? null : ErrorCode(failure, cancelled));
                Environment.ExitCode = success ? 0 : 1;
                Close();
            }
        };
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try {
            if (args.Length == 1 && args[0] == "--self-test") {
                Console.WriteLine("muse-spark-screen-record-ready"); return 0;
            }
            if (args.Length == 1 && args[0] == "--probe") {
                if (!GraphicsCaptureSession.IsSupported()) return 1;
                MediaEncodingProfile.CreateMp4(VideoEncodingQuality.Auto);
                Console.WriteLine("muse-spark-screen-record-ready"); return 0;
            }
            if (args.Length == 5 && args[0] == "--latest") {
                Latest(args[1], ParseLimit(args[2], MaxBytes), ParseLimit(args[4], RecentMaxAgeMilliseconds));
                Emit("complete", null); return 0;
            }
            if (args.Length != 9 || args[0] != "--record") throw new ArgumentException();
            using (MuseSparkScreenRecord form = new MuseSparkScreenRecord(args)) Application.Run(form);
            return Environment.ExitCode;
        } catch (Exception error) {
            Emit("error", ErrorCode(error, false)); return 1;
        }
    }

    private static long ParseLimit(string text, long maximum)
    {
        long value = Int64.Parse(text, CultureInfo.InvariantCulture);
        if (value <= 0 || value > maximum) throw new ArgumentException();
        return value;
    }

    private static void Emit(string type, string code)
    {
        Console.WriteLine("{\"type\":\"" + type + "\"" + (code == null ? "" : ",\"code\":\"" + code + "\"") + "}");
        Console.Out.Flush();
    }

    private static string ErrorCode(Exception error, bool cancelled)
    {
        if (cancelled || error is OperationCanceledException) return "cancelled";
        if (error is UnauthorizedAccessException || (error != null && error.HResult == unchecked((int)0x80070005))) return "permission";
        if (error is FileNotFoundException) return "noRecent";
        if (error is RecordingLimitException) return "limit";
        return "unavailable";
    }

    private void Stop(bool cancel)
    {
        // Stop while the OS picker is open cancels the selection; during the
        // recording it ends the media source and lets the MP4 sink finalize.
        cancel |= !elapsed.IsRunning;
        cancelled |= cancel; stopping = true;
        IAsyncInfo operation = pendingOperation;
        if (cancel && operation != null) { try { operation.Cancel(); } catch (COMException) { } }
        lock (gate) Monitor.PulseAll(gate);
    }
    private void PowerChanged(object sender, PowerModeChangedEventArgs args)
    {
        if (args.Mode == PowerModes.Suspend) Stop(true);
    }

    private async Task Record()
    {
        if (!GraphicsCaptureSession.IsSupported()) throw new NotSupportedException();
        CreatePrivate(directory);
        ownsDirectory = true;
        if (cancelled) throw new OperationCanceledException();
        GraphicsCapturePicker picker = new GraphicsCapturePicker();
        ((IInitializeWithWindow)(object)picker).Initialize(Handle);
        IAsyncOperation<GraphicsCaptureItem> selection = picker.PickSingleItemAsync();
        pendingOperation = selection;
        GraphicsCaptureItem item = await Await(selection);
        pendingOperation = null;
        if (item == null || cancelled) throw new OperationCanceledException();
        int width = item.Size.Width, height = item.Size.Height;
        if (width < 2 || height < 2) throw new NotSupportedException();
        using (IDirect3DDevice device = CreateDevice())
        using (Direct3D11CaptureFramePool pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, FrameBuffers, item.Size))
        using (GraphicsCaptureSession session = pool.CreateCaptureSession(item))
        using (Wasapi mic = microphone ? new Wasapi(false) : null)
        using (Wasapi system = systemAudio ? new Wasapi(true) : null) {
            string destination = Path.Combine(directory, "recording.mp4");
            using (FileStream created = new FileStream(destination, FileMode.CreateNew)) { }
            StorageFile sink = await Await(StorageFile.GetFileFromPathAsync(destination));
            using (IRandomAccessStream output = new BoundedRandomAccessStream(await Await(sink.OpenAsync(FileAccessMode.ReadWrite)), byteLimit)) {
            // The OS capture border stays enabled. The visible Stop window is
            // already present before StartCapture or either audio Start call.
            item.Closed += delegate { Stop(false); };
            pool.FrameArrived += delegate {
                Direct3D11CaptureFrame frame = pool.TryGetNextFrame();
                if (frame == null) return;
                lock (gate) {
                    if (stopping || frame.ContentSize.Width != width || frame.ContentSize.Height != height) {
                        frame.Dispose(); if (!stopping) Stop(true); return;
                    }
                    if (pending != null) pending.Dispose();
                    pending = frame; Monitor.PulseAll(gate);
                }
            };
            VideoEncodingProperties input = VideoEncodingProperties.CreateUncompressed(MediaEncodingSubtypes.Bgra8, (uint)width, (uint)height);
            input.FrameRate.Numerator = FramesPerSecond; input.FrameRate.Denominator = 1;
            input.PixelAspectRatio.Numerator = 1; input.PixelAspectRatio.Denominator = 1;
            VideoStreamDescriptor video = new VideoStreamDescriptor(input);
            AudioStreamDescriptor audio = microphone || systemAudio ? new AudioStreamDescriptor(AudioEncodingProperties.CreatePcm(SampleRate, Channels, Bits)) : null;
            MediaStreamSource source = audio == null ? new MediaStreamSource(video) : new MediaStreamSource(video, audio);
            source.BufferTime = TimeSpan.Zero; source.IsLive = true;
            source.Starting += delegate(MediaStreamSource sender, MediaStreamSourceStartingEventArgs args) { args.Request.SetActualStartPosition(TimeSpan.Zero); };
            source.SampleRequested += delegate(MediaStreamSource sender, MediaStreamSourceSampleRequestedEventArgs args) {
                MediaStreamSourceSampleRequestDeferral deferral = args.Request.GetDeferral();
                Task.Run(delegate {
                    try {
                        args.Request.Sample = args.Request.StreamDescriptor == video ? VideoSample() : AudioSample(mic, system);
                    } catch (Exception error) { failure = error; Stop(true); source.NotifyError(MediaStreamSourceErrorStatus.Other); }
                    finally { deferral.Complete(); }
                });
            };
            MediaEncodingProfile profile = MediaEncodingProfile.CreateMp4(VideoEncodingQuality.Auto);
            profile.Video.Width = (uint)(width - width % 2); profile.Video.Height = (uint)(height - height % 2);
            profile.Video.Bitrate = VideoBitrate;
            profile.Video.PixelAspectRatio.Numerator = 1; profile.Video.PixelAspectRatio.Denominator = 1;
            profile.Video.FrameRate.Numerator = FramesPerSecond; profile.Video.FrameRate.Denominator = 1;
            if (audio == null) profile.Audio = null;
            else { profile.Audio.SampleRate = SampleRate; profile.Audio.ChannelCount = Channels; profile.Audio.Bitrate = AudioBitrate; }
            MediaTranscoder transcoder = new MediaTranscoder(); transcoder.HardwareAccelerationEnabled = true;
            PrepareTranscodeResult prepared = await Await(transcoder.PrepareMediaStreamSourceTranscodeAsync(source, output, profile));
            if (!prepared.CanTranscode) throw new NotSupportedException();
            {
                if (cancelled) throw new OperationCanceledException();
                elapsed.Start(); session.StartCapture();
                if (mic != null) mic.Start(); if (system != null) system.Start();
                Emit("recording", null);
                IAsyncActionWithProgress<double> encode = prepared.TranscodeAsync();
                pendingOperation = encode;
                try { await Await(encode); }
                finally {
                    pendingOperation = null;
                    Stop(false); timer.Stop();
                    lock (gate) { if (pending != null) { pending.Dispose(); pending = null; } }
                }
            }
            }
        }
    }

    private MediaStreamSample VideoSample()
    {
        Direct3D11CaptureFrame frame;
        lock (gate) {
            while (pending == null && !stopping) Monitor.Wait(gate, ParentPollMilliseconds);
            if (stopping) return null;
            frame = pending; pending = null;
        }
        TimeSpan stamp = frame.SystemRelativeTime;
        if (!videoStart.HasValue) videoStart = stamp;
        TimeSpan relative = stamp - videoStart.Value;
        if (relative.TotalSeconds >= maxSeconds) { frame.Dispose(); Stop(false); return null; }
        MediaStreamSample sample = MediaStreamSample.CreateFromDirect3D11Surface(frame.Surface, relative);
        sample.Duration = TimeSpan.FromSeconds(Math.Min(1.0 / FramesPerSecond, maxSeconds - relative.TotalSeconds));
        sample.Processed += delegate { frame.Dispose(); };
        return sample;
    }

    private MediaStreamSample AudioSample(Wasapi mic, Wasapi system)
    {
        double seconds = (double)audioPosition / SampleRate;
        while (!stopping && seconds > elapsed.Elapsed.TotalSeconds) Thread.Sleep(PollMilliseconds);
        if (stopping || seconds >= maxSeconds) return null;
        short[] left = mic == null ? null : mic.Read(AudioFrames);
        short[] right = system == null ? null : system.Read(AudioFrames);
        byte[] pcm = new byte[AudioFrames * Channels * Bits / 8];
        for (int index = 0; index < AudioFrames * Channels; index++) {
            int value = (left == null ? 0 : left[index]) + (right == null ? 0 : right[index]);
            if (left != null && right != null) value /= 2;
            short sample = (short)Math.Max(Int16.MinValue, Math.Min(Int16.MaxValue, value));
            pcm[index * 2] = (byte)sample; pcm[index * 2 + 1] = (byte)(sample >> 8);
        }
        IBuffer buffer;
        using (DataWriter writer = new DataWriter()) { writer.WriteBytes(pcm); buffer = writer.DetachBuffer(); }
        MediaStreamSample result = MediaStreamSample.CreateFromBuffer(buffer, TimeSpan.FromSeconds(seconds));
        result.Duration = TimeSpan.FromSeconds((double)AudioFrames / SampleRate);
        audioPosition += AudioFrames;
        return result;
    }

    private static IDirect3DDevice CreateDevice()
    {
        IntPtr device = IntPtr.Zero, context = IntPtr.Zero, dxgi = IntPtr.Zero, inspectable = IntPtr.Zero;
        try {
            int level;
            Marshal.ThrowExceptionForHR(D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out level, out context));
            Guid iid = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, ref iid, out dxgi));
            Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out inspectable));
            return (IDirect3DDevice)Marshal.GetObjectForIUnknown(inspectable);
        } finally {
            if (inspectable != IntPtr.Zero) Marshal.Release(inspectable);
            if (dxgi != IntPtr.Zero) Marshal.Release(dxgi);
            if (context != IntPtr.Zero) Marshal.Release(context);
            if (device != IntPtr.Zero) Marshal.Release(device);
        }
    }

    // CreateDirectory receives the protected descriptor at creation, not a
    // chmod-equivalent after the first frames have already reached the disk.
    private static void CreatePrivate(string directory)
    {
        if (!Path.IsPathRooted(directory) || !String.Equals(Path.GetFullPath(directory), directory.Replace('/', '\\'), StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(directory).StartsWith("muse-spark-screen-", StringComparison.Ordinal)) throw new ArgumentException();
        DirectorySecurity security = new DirectorySecurity();
        SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
        security.SetOwner(user); security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(user, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        byte[] descriptor = security.GetSecurityDescriptorBinaryForm();
        GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try {
            SecurityAttributes attributes = new SecurityAttributes();
            attributes.Length = Marshal.SizeOf(typeof(SecurityAttributes)); attributes.Descriptor = pinned.AddrOfPinnedObject();
            if (!CreateDirectory(directory, ref attributes)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally { pinned.Free(); }
    }
    private static void RemovePrivate(string directory)
    {
        // Called only for the unique directory this invocation created.
        if (Directory.Exists(directory)) {
            File.Delete(Path.Combine(directory, "recording.mp4"));
            Directory.Delete(directory, false);
        }
    }

    private static void Latest(string directory, long maximum, long maxAge)
    {
        IntPtr value;
        Guid videos = new Guid("18989b1d-99b5-455b-841c-ab7c74e4ddfc");
        Marshal.ThrowExceptionForHR(SHGetKnownFolderPath(ref videos, 0, IntPtr.Zero, out value));
        string folder;
        try { folder = Path.Combine(Marshal.PtrToStringUni(value), "Screen Recordings"); }
        finally { Marshal.FreeCoTaskMem(value); }
        CopyLatest(folder, directory, maximum, maxAge);
    }
    private static void CopyLatest(string folder, string directory, long maximum, long maxAge)
    {
        if (!Directory.Exists(folder) || (File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0) throw new FileNotFoundException();
        FileInfo newest = null;
        foreach (string file in Directory.EnumerateFiles(folder, "*", SearchOption.TopDirectoryOnly)) {
            FileInfo candidate = new FileInfo(file);
            double age = (DateTime.UtcNow - candidate.LastWriteTimeUtc).TotalMilliseconds;
            if (!String.Equals(candidate.Extension, ".mp4", StringComparison.OrdinalIgnoreCase) ||
                (candidate.Attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0 ||
                age < 0 || age > maxAge) continue;
            if (newest == null || candidate.LastWriteTimeUtc > newest.LastWriteTimeUtc) newest = candidate;
        }
        if (newest == null) throw new FileNotFoundException();
        // OPEN_REPARSE_POINT binds the read to this file, even if a link was
        // swapped into the selected name after enumeration. Sharing forbids
        // writes/deletes until the bounded private copy has finished.
        using (SafeFileHandle handle = CreateFile(newest.FullName, 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            ByHandleFileInformation info;
            if (!GetFileInformationByHandle(handle, out info) || (info.Attributes & 0x400) != 0) throw new IOException();
            StringBuilder heldPath = new StringBuilder(32768);
            uint heldLength = GetFinalPathNameByHandle(handle, heldPath, (uint)heldPath.Capacity, 0);
            if (heldLength == 0 || heldLength >= heldPath.Capacity ||
                !String.Equals(heldPath.ToString(), "\\\\?\\" + Path.GetFullPath(newest.FullName), StringComparison.OrdinalIgnoreCase)) throw new IOException();
            long written = ((long)info.WriteHigh << 32) | info.WriteLow;
            double age = (DateTime.UtcNow - DateTime.FromFileTimeUtc(written)).TotalMilliseconds;
            if (age < 0 || age > maxAge) throw new FileNotFoundException();
            using (FileStream source = new FileStream(handle, FileAccess.Read)) {
                if (source.Length <= 0 || source.Length > maximum) throw new RecordingLimitException();
                CreatePrivate(directory);
                try {
                    using (BoundedFile sink = new BoundedFile(Path.Combine(directory, "recording.mp4"), maximum)) source.CopyTo(sink);
                } catch { RemovePrivate(directory); throw; }
            }
        }
    }

    private sealed class RecordingLimitException : IOException { }
    // Avoid System.Runtime.WindowsRuntime's SDK-union Windows.winmd reference:
    // these adapters use only the split metadata installed with Windows.
    private static Task<T> Await<T>(IAsyncOperation<T> operation)
    {
        TaskCompletionSource<T> result = new TaskCompletionSource<T>();
        operation.Completed = delegate(IAsyncOperation<T> op, AsyncStatus status) {
            try { result.SetResult(op.GetResults()); } catch (Exception error) { result.SetException(error); }
            finally { op.Close(); }
        };
        return result.Task;
    }
    private static Task Await(IAsyncActionWithProgress<double> operation)
    {
        TaskCompletionSource<bool> result = new TaskCompletionSource<bool>();
        operation.Completed = delegate(IAsyncActionWithProgress<double> op, AsyncStatus status) {
            try { op.GetResults(); result.SetResult(true); } catch (Exception error) { result.SetException(error); }
            finally { op.Close(); }
        };
        return result.Task;
    }
    private sealed class BoundedRandomAccessStream : IRandomAccessStream
    {
        private readonly IRandomAccessStream inner;
        private readonly long maximum;
        public BoundedRandomAccessStream(IRandomAccessStream inner, long maximum) { this.inner = inner; this.maximum = maximum; }
        public bool CanRead { get { return inner.CanRead; } }
        public bool CanWrite { get { return inner.CanWrite; } }
        public ulong Position { get { return inner.Position; } }
        public ulong Size { get { return inner.Size; } set { Admit(value, 0); inner.Size = value; } }
        private void Admit(ulong position, uint count) { if (position > (ulong)maximum || count > (ulong)maximum - position) throw new RecordingLimitException(); }
        public void Seek(ulong position) { Admit(position, 0); inner.Seek(position); }
        public IRandomAccessStream CloneStream() { return new BoundedRandomAccessStream(inner.CloneStream(), maximum); }
        public IInputStream GetInputStreamAt(ulong position) { return inner.GetInputStreamAt(position); }
        public IOutputStream GetOutputStreamAt(ulong position) { Admit(position, 0); return new BoundedOutput(inner.GetOutputStreamAt(position), position, (ulong)maximum); }
        public IAsyncOperationWithProgress<IBuffer, uint> ReadAsync(IBuffer buffer, uint count, InputStreamOptions options) { return inner.ReadAsync(buffer, count, options); }
        public IAsyncOperationWithProgress<uint, uint> WriteAsync(IBuffer buffer) { Admit(Position, buffer.Length); return inner.WriteAsync(buffer); }
        public IAsyncOperation<bool> FlushAsync() { return inner.FlushAsync(); }
        public void Dispose() { inner.Dispose(); }
    }
    private sealed class BoundedOutput : IOutputStream
    {
        private readonly IOutputStream inner;
        private readonly ulong maximum;
        private ulong position;
        public BoundedOutput(IOutputStream inner, ulong position, ulong maximum) { this.inner = inner; this.position = position; this.maximum = maximum; }
        public IAsyncOperationWithProgress<uint, uint> WriteAsync(IBuffer buffer) {
            if (position > maximum || buffer.Length > maximum - position) throw new RecordingLimitException();
            position += buffer.Length; return inner.WriteAsync(buffer);
        }
        public IAsyncOperation<bool> FlushAsync() { return inner.FlushAsync(); }
        public void Dispose() { inner.Dispose(); }
    }
    private sealed class BoundedFile : FileStream
    {
        private readonly long maximum;
        public BoundedFile(string file, long maximum) : base(file, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read) { this.maximum = maximum; }
        private void Admit(long count) { if (Position > maximum - count) throw new RecordingLimitException(); }
        public override void Write(byte[] buffer, int offset, int count) { Admit(count); base.Write(buffer, offset, count); }
        public override void WriteByte(byte value) { Admit(1); base.WriteByte(value); }
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken token) { Admit(count); return base.WriteAsync(buffer, offset, count, token); }
        public override void SetLength(long value) { if (value > maximum) throw new RecordingLimitException(); base.SetLength(value); }
    }

    // WASAPI's shared-mode conversion supplies the same PCM format for the
    // explicitly selected microphone and/or render loopback device. No device
    // is opened for an unchecked option. Silence packets become zero samples.
    private sealed class Wasapi : IDisposable
    {
        private IAudioClient client;
        private IAudioCaptureClient capture;
        private readonly Queue<short> queue = new Queue<short>();
        public Wasapi(bool loopback)
        {
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice device = null;
            try {
                Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(loopback ? 0 : 1, 0, out device));
                Guid iid = typeof(IAudioClient).GUID; object value;
                Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out value)); client = (IAudioClient)value;
                WaveFormat format = new WaveFormat();
                format.Tag = 1; format.Channels = Channels; format.SamplesPerSecond = SampleRate;
                format.Bits = Bits; format.BlockAlign = Channels * Bits / 8; format.BytesPerSecond = (uint)(SampleRate * format.BlockAlign);
                Guid session = Guid.Empty;
                Marshal.ThrowExceptionForHR(client.Initialize(0, 0x88000000U | (loopback ? 0x00020000U : 0), 1000000, 0, ref format, ref session));
                iid = typeof(IAudioCaptureClient).GUID;
                Marshal.ThrowExceptionForHR(client.GetService(ref iid, out value)); capture = (IAudioCaptureClient)value;
            } catch { Dispose(); throw; }
            finally { if (device != null) Marshal.ReleaseComObject(device); Marshal.ReleaseComObject(enumerator); }
        }
        public void Start() { Marshal.ThrowExceptionForHR(client.Start()); }
        public short[] Read(int frames)
        {
            uint packet;
            Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out packet));
            while (packet != 0) {
                IntPtr data; uint count, flags; ulong position, qpc;
                Marshal.ThrowExceptionForHR(capture.GetBuffer(out data, out count, out flags, out position, out qpc));
                try {
                    if (count > SampleRate || queue.Count > SampleRate * Channels) throw new RecordingLimitException();
                    short[] samples = new short[count * Channels];
                    if ((flags & 2) == 0) Marshal.Copy(data, samples, 0, samples.Length);
                    foreach (short sample in samples) queue.Enqueue(sample);
                } finally { Marshal.ThrowExceptionForHR(capture.ReleaseBuffer(count)); }
                Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out packet));
            }
            short[] result = new short[frames * Channels];
            for (int index = 0; index < result.Length && queue.Count != 0; index++) result[index] = queue.Dequeue();
            return result;
        }
        public void Dispose()
        {
            if (client != null) { client.Stop(); }
            if (capture != null) { Marshal.ReleaseComObject(capture); capture = null; }
            if (client != null) { Marshal.ReleaseComObject(client); client = null; }
        }
    }

    [ComImport, Guid("3e68d4bd-7135-4d10-8018-9fb6d9f33fa1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IInitializeWithWindow { void Initialize(IntPtr window); }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
    [StructLayout(LayoutKind.Sequential)] private struct ByHandleFileInformation {
        public uint Attributes, CreateLow, CreateHigh, AccessLow, AccessHigh, WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential, Pack = 2)] private struct WaveFormat {
        public ushort Tag, Channels; public uint SamplesPerSecond, BytesPerSecond; public ushort BlockAlign, Bits, Extra;
    }
    [ComImport, Guid("bcde0395-e52f-467c-8e3d-c4579291692e")] private class MMDeviceEnumerator { }
    [ComImport, Guid("a95664d2-9614-4f35-a746-de8db63617e6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    }
    [ComImport, Guid("d666063f-1587-4e43-81f1-b948e807363f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value); }
    [ComImport, Guid("1cb9ad4c-dbfa-4c32-b178-c2f568a703b2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient {
        [PreserveSig] int Initialize(int mode, uint flags, long duration, long period, ref WaveFormat format, ref Guid session);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int mode, ref WaveFormat format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long normal, out long minimum);
        [PreserveSig] int Start(); [PreserveSig] int Stop(); [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }
    [ComImport, Guid("c8adbd64-e71e-48a0-a4de-185c395cd317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong position, out ulong qpc);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }
    [DllImport("d3d11.dll")] private static extern int D3D11CreateDevice(IntPtr adapter, int type, IntPtr software, uint flags, IntPtr levels, uint count, uint sdk, out IntPtr device, out int level, out IntPtr context);
    [DllImport("d3d11.dll")] private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr device, out IntPtr result);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateDirectory(string path, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out ByHandleFileInformation info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint capacity, uint flags);
    [DllImport("shell32.dll")] private static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, IntPtr token, out IntPtr value);
}
