// .NET Framework / C# 5. No native Node module; compiled lazily by JobBuild.
// Binary serial data is stdout. Status words are stderr; exceptions stay private.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.IO.Ports;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Collections.Concurrent;

public static class MuseSparkSerial
{
    private const int MutexPollMs = 100;

    private static void Ready(string word)
    {
        Console.Error.WriteLine(word);
        Console.Error.Flush();
    }

    private static void Mutex(string file)
    {
        var input = Console.OpenStandardInput();
        var owner = new Thread(delegate()
        {
            while (input.ReadByte() != -1) { }
            Environment.Exit(0); // Also ends a helper still waiting for the file lock.
        });
        owner.IsBackground = true;
        owner.Start();
        FileStream stream = null;
        while (stream == null)
        {
            try { stream = new FileStream(file, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) { Thread.Sleep(MutexPollMs); }
        }
        using (stream)
        {
            Ready("lease-ready");
            Thread.Sleep(Timeout.Infinite);
        }
    }

    private static void Pipe(string name, string id, int timeout, int maxChars)
    {
        if (timeout <= 0 || maxChars <= 0) throw new ArgumentException();
        var sid = WindowsIdentity.GetCurrent().User;
        if (sid == null) throw new InvalidOperationException();
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
        var json = new JavaScriptSerializer();
        var answers = new BlockingCollection<string>();
        var activeReply = new object();
        var input = new Thread(delegate()
        {
            string answer;
            while ((answer = Console.ReadLine()) != null) answers.Add(answer);
            // Let an acknowledged Stop reach its client before normal owner teardown.
            lock (activeReply) { Environment.Exit(0); }
        });
        input.IsBackground = true;
        input.Start();
        Ready("lease-ready");
        while (true)
        {
            using (var pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous, maxChars, maxChars, security))
            {
                Ready("pipe-ready");
                pipe.WaitForConnection();
                using (var deadline = new Timer(delegate(object state)
                {
                    try { pipe.Dispose(); } catch (IOException) { }
                }, null, timeout, Timeout.Infinite))
                {
                    // A probing client may disconnect without requesting Stop.
                    try
                    {
                        string line;
                        using (var reader = new StreamReader(pipe, System.Text.Encoding.UTF8, false, maxChars, true))
                        {
                            var chars = new List<char>();
                            int value;
                            while ((value = reader.Read()) != -1 && value != '\n')
                            {
                                if (chars.Count >= maxChars) throw new InvalidDataException();
                                chars.Add((char)value);
                            }
                            if (value == -1) continue;
                            line = new string(chars.ToArray());
                        }
                        var request = json.Deserialize<Dictionary<string, string>>(line);
                        if (request == null || request.Count != 2 || request["command"] != "stop" || request["id"] != id) continue;
                        lock (activeReply)
                        {
                            var callId = Guid.NewGuid().ToString();
                            Console.Out.WriteLine("stop:" + callId);
                            Console.Out.Flush();
                            string answer = "timeout:" + callId;
                            var waiting = Stopwatch.StartNew();
                            while (waiting.ElapsedMilliseconds < timeout)
                            {
                                string received;
                                int remaining = timeout - (int)waiting.ElapsedMilliseconds;
                                if (remaining <= 0 || !answers.TryTake(out received, remaining)) break;
                                // A late reply to an earlier Stop never settles this one.
                                if (received == "stopped:" + callId || received == "failed:" + callId ||
                                    received == "cancelled:" + callId || received == "cancel-failed:" + callId)
                                {
                                    answer = received;
                                    break;
                                }
                            }
                            using (var writer = new StreamWriter(pipe))
                            {
                                string reply = answer == "stopped:" + callId ? "{\"stopped\":true}" :
                                    answer == "failed:" + callId ? "{\"stopped\":false}" :
                                    answer == "cancelled:" + callId ? "{\"cancelled\":true}" :
                                    answer == "cancel-failed:" + callId ? "{\"cancelled\":false}" : "{\"timedOut\":true}";
                                writer.WriteLine(reply);
                                writer.Flush();
                            }
                        }
                    }
                    catch (IOException) { }
                    catch (ArgumentException) { }
                    catch (KeyNotFoundException) { }
                    catch (ObjectDisposedException) { }
                    catch (InvalidOperationException) { }
                }
            }
        }
    }

    private static void Serial(string[] args)
    {
        int baud = Int32.Parse(args[2]);
        int duration = Int32.Parse(args[3]);
        int maximum = Int32.Parse(args[4]);
        int chunk = Int32.Parse(args[5]);
        int poll = Int32.Parse(args[6]);
        if (Math.Min(Math.Min(baud, duration), Math.Min(maximum, Math.Min(chunk, poll))) <= 0)
            throw new ArgumentException();
        using (var port = new SerialPort(args[1], baud, Parity.None, 8, StopBits.One))
        {
            port.DtrEnable = args[7] == "1";
            port.RtsEnable = args[8] == "1";
            port.ReadTimeout = poll;
            port.WriteTimeout = poll;
            port.Open(); // Windows refuses a port held by another process.
            int stopped = 0;
            int failed = 0;
            var input = Console.OpenStandardInput();
            var writer = new Thread(delegate()
            {
                try
                {
                    var buffer = new byte[chunk];
                    int total = 0;
                    while (Interlocked.CompareExchange(ref stopped, 0, 0) == 0)
                    {
                        int count = input.Read(buffer, 0, buffer.Length);
                        if (count == 0) break;
                        total += count;
                        if (total > maximum) throw new InvalidDataException();
                        port.Write(buffer, 0, count);
                    }
                }
                catch { Interlocked.Exchange(ref failed, 1); }
                finally { Interlocked.Exchange(ref stopped, 1); }
            });
            writer.IsBackground = true;
            writer.Start();
            Ready("serial-ready");
            var watch = Stopwatch.StartNew();
            var output = Console.OpenStandardOutput();
            var bytes = new byte[chunk];
            int remaining = maximum;
            while (remaining > 0 && watch.ElapsedMilliseconds < duration && Interlocked.CompareExchange(ref stopped, 0, 0) == 0)
            {
                try
                {
                    int count = port.Read(bytes, 0, Math.Min(chunk, remaining));
                    output.Write(bytes, 0, count);
                    output.Flush();
                    remaining -= count;
                }
                catch (TimeoutException) { }
            }
            Interlocked.Exchange(ref stopped, 1);
            if (failed != 0) throw new IOException();
        }
    }

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 2 && args[0] == "mutex") Mutex(args[1]);
            else if (args.Length == 5 && args[0] == "pipe") Pipe(args[1], args[2], Int32.Parse(args[3]), Int32.Parse(args[4]));
            else if (args.Length == 9 && args[0] == "serial") Serial(args);
            else throw new ArgumentException();
            return 0;
        }
        catch (UnauthorizedAccessException)
        {
            Ready(args.Length == 9 && args[0] == "serial" ? "serial-busy" : "serial-unavailable");
            return 1;
        }
        catch { Ready("serial-unavailable"); return 1; }
    }
}
