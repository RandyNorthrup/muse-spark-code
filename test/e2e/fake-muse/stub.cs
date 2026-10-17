// The Windows face of the fake Muse Code CLI used by the process-level e2e
// tests (test/e2e). Node refuses to spawn a .cmd without a shell and the
// extension never uses one, so on Windows the resolver needs a real
// executable: this program runs serve.mjs (beside it) with the Node the tests
// run under, hands it the same arguments and standard streams, and exits with
// its exit code. Compiled at test time by the C# compiler that ships with the
// .NET Framework on every Windows machine (see test/e2e/fakeMuse.ts).

using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class Stub
{
    private const int MissingNodeExitCode = 3;

    private static int Main(string[] args)
    {
        string node = Environment.GetEnvironmentVariable("MUSE_FAKE_NODE");
        if (string.IsNullOrEmpty(node))
        {
            Console.Error.WriteLine("fake muse stub: MUSE_FAKE_NODE is not set");
            return MissingNodeExitCode;
        }
        string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "serve.mjs");
        var line = new StringBuilder(Quote(script));
        foreach (string argument in args)
        {
            line.Append(' ').Append(Quote(argument));
        }
        // No redirection: the child inherits this process's stdin, stdout and
        // stderr, so the extension talks to serve.mjs directly.
        var start = new ProcessStartInfo(node, line.ToString()) { UseShellExecute = false };
        using (Process child = Process.Start(start))
        {
            child.WaitForExit();
            return child.ExitCode;
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
