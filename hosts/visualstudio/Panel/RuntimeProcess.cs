using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Threading;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class RuntimeProcess : IDisposable
  {
    private readonly Process process;
    private readonly JoinableTask stderr;
    private readonly JoinableTask reading;
    private readonly JoinableTaskFactory taskFactory;
    private readonly NamedPipeServerStream control;
    public MhpPeer Peer { get; }
    private bool disposed;

    public RuntimeProcess(string node, string entry, string workspace, IHostServices host, JoinableTaskFactory taskFactory, string? helperPath = null)
    {
      this.taskFactory = taskFactory;
      var info = AssetPolicy.RuntimeStartInfo(node, entry, workspace);
      var helper = helperPath ?? Path.Combine(Path.GetDirectoryName(node) ?? throw new InvalidOperationException("MHP_RUNTIME_NOT_INSTALLED"), "muse-panel-job.exe");
      if (!File.Exists(helper)) throw new InvalidOperationException("MHP_JOB_HELPER_NOT_INSTALLED");
      var pipe = "MuseSparkPanel-" + Guid.NewGuid().ToString("N");
      var random = new byte[32];
      using (var generator = RandomNumberGenerator.Create()) generator.GetBytes(random);
      var nonce = Convert.ToBase64String(random);
      var security = new PipeSecurity();
      security.SetAccessRuleProtection(true, false);
      security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("MHP_PIPE_OWNER_UNAVAILABLE"), PipeAccessRights.FullControl, AccessControlType.Allow));
      control = new NamedPipeServerStream(pipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 128, 128, security);
      var environment = new JObject();
      foreach (var key in info.EnvironmentVariables.Keys.Cast<string>()) environment[key] = info.EnvironmentVariables[key];
      var config = new JObject
      {
        ["file"] = node,
        ["args"] = new JArray(entry, "panel", "--stdio", "--host", "visual-studio"),
        ["cwd"] = workspace,
        ["env"] = environment,
        ["parentPid"] = Process.GetCurrentProcess().Id,
        ["isVerbatim"] = false,
        ["controlPipe"] = pipe,
        ["controlNonce"] = nonce
      };
      info.FileName = helper; info.Arguments = "";
      info.EnvironmentVariables["MUSE_SPARK_MCP_JOB_CONFIG"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(config.ToString(Formatting.None)));
      process = new Process { StartInfo = info };
      try { if (!process.Start()) throw new InvalidOperationException("MHP_RUNTIME_START_FAILED"); }
      catch { process.Dispose(); control.Dispose(); throw; }
      process.StandardInput.AutoFlush = true;
      Peer = new MhpPeer(SchemaContract.Load(true), host, process.StandardInput);
      stderr = taskFactory.RunAsync(() => DrainAsync(process.StandardError));
      reading = taskFactory.RunAsync(async () =>
      {
        try { await ConfirmOwnerAsync(nonce).ConfigureAwait(false); await ReadAsync().ConfigureAwait(false); }
        finally { control.Dispose(); if (!process.HasExited) process.Kill(); }
      });
    }

    private async Task ConfirmOwnerAsync(string nonce)
    {
      using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
      {
        await control.WaitForConnectionAsync(deadline.Token).ConfigureAwait(false);
        using (var reader = new StreamReader(control, Encoding.UTF8, false, 128, true))
        using (var writer = new StreamWriter(control, new UTF8Encoding(false), 128, true) { AutoFlush = true, NewLine = "\n" })
        {
          var response = await reader.ReadLineAsync().WithCancellation(deadline.Token).ConfigureAwait(false);
          if (response != "READY " + nonce) throw new InvalidOperationException("MHP_JOB_OWNER_REFUSED");
          await writer.WriteLineAsync("GO " + nonce).ConfigureAwait(false);
        }
      }
    }

    private async Task ReadAsync()
    {
      try { await Peer.RunAsync(process.StandardOutput).ConfigureAwait(false); }
      finally { if (!process.HasExited) process.Kill(); }
    }

    private static async Task DrainAsync(TextReader reader)
    {
      // Stderr may contain a path or account. Drain it without retaining or logging it.
      var buffer = new char[4096];
      try { while (await reader.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false) != 0) Array.Clear(buffer, 0, buffer.Length); }
      finally { Array.Clear(buffer, 0, buffer.Length); }
    }

    public async Task CloseAsync()
    {
      if (disposed) return;
      disposed = true;
      process.StandardInput.Close();
      control.Dispose();
      if (!process.HasExited) process.Kill();
      try { await reading.JoinAsync(); }
      finally { try { await stderr.JoinAsync(); } finally { Peer.Dispose(); process.Dispose(); } }
    }

    public void Dispose() => taskFactory.Run(CloseAsync);
  }
}
