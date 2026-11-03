using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.VisualStudio.Threading;
using MuseSpark.VisualStudio.Panel;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  // This tree's real runtime (dist/acp.js panel --stdio) through the real Windows job helper the VSIX ships:
  // the handshake, a settings round trip over the live pipe, and a process tree that ends with the host.
  // A scratch home keeps the runtime off the person's settings; no credential and no model call is involved.
  [TestClass]
  public sealed class RuntimeProcessTests
  {
    private sealed class HandshakeOnlyHost : IHostServices
    {
      public IReadOnlyCollection<string> Capabilities { get; } = new[] { "lifecycle" };
      public Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation) => throw new MhpException("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY");
    }

    private static readonly string[] ScratchVariables = { "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP" };

    private static string RepositoryRoot()
    {
      for (var directory = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory); directory != null; directory = directory.Parent)
        if (File.Exists(Path.Combine(directory.FullName, "test", "hostApi", "scenarios", "contract.json"))) return directory.FullName;
      throw new InvalidOperationException("MHP_CONFORMANCE_NO_RUNTIME");
    }

    private static string Node() =>
      (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator).Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => Path.Combine(p.Trim('"'), "node.exe")).First(File.Exists);

    private static void Descendants(int parent, List<int> found)
    {
      using (var query = new ManagementObjectSearcher("SELECT ProcessId FROM Win32_Process WHERE ParentProcessId = " + parent))
      using (var children = query.Get())
        foreach (var child in children.Cast<ManagementObject>())
        {
          var id = Convert.ToInt32(child["ProcessId"], System.Globalization.CultureInfo.InvariantCulture);
          found.Add(id);
          Descendants(id, found);
        }
    }

    private static bool Alive(int id)
    {
      try { using (var process = Process.GetProcessById(id)) return !process.HasExited; }
      catch (ArgumentException) { return false; }
    }

    [TestMethod]
    public async Task ThisTreesRuntimeAnswersOverTheJobHelperAndItsTreeEndsWithTheHost()
    {
      var root = RepositoryRoot();
      var entry = Path.Combine(root, "dist", "acp.js");
      var helper = Path.Combine(root, "hosts", "visualstudio", "assets", "runtime", "muse-panel-job.exe");
      Assert.IsTrue(File.Exists(entry), "MHP_CONFORMANCE_NO_RUNTIME: run node scripts/build.mjs --production");
      Assert.IsTrue(File.Exists(helper), "MHP_JOB_HELPER_NOT_INSTALLED: run node hosts/visualstudio/build-assets.mjs");
      var scratch = Path.Combine(Path.GetTempPath(), "muse-vs-runtime-" + Guid.NewGuid().ToString("N"));
      var workspace = Directory.CreateDirectory(Path.Combine(scratch, "workspace")).FullName;
      var home = Directory.CreateDirectory(Path.Combine(scratch, "home")).FullName;
      var saved = ScratchVariables.ToDictionary(name => name, Environment.GetEnvironmentVariable);
      var context = new JoinableTaskContext();
      RuntimeProcess? runtime = null;
      try
      {
        foreach (var name in ScratchVariables) Environment.SetEnvironmentVariable(name, home);
        runtime = new RuntimeProcess(Node(), entry, workspace, new HandshakeOnlyHost(), context.Factory, helper);
        foreach (var name in ScratchVariables) Environment.SetEnvironmentVariable(name, saved[name]);
        using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(120)))
        {
          var parameters = PanelCarrierTests.InitializeParameters();
          parameters["capabilities"] = new JArray("lifecycle");
          parameters["folders"] = new JArray(new JObject { ["uri"] = new Uri(workspace + Path.DirectorySeparatorChar).AbsoluteUri, ["name"] = "workspace" });
          await runtime.Peer.InitializeAsync(parameters, deadline.Token);
          Assert.AreEqual("mhp/1.6.0", runtime.Peer.ProtocolVersion);
          await runtime.Peer.RequestAsync("settings/update", new JObject { ["key"] = "museSpark.schedulePauseAfterFailures", ["value"] = 5, ["scope"] = "user" }, deadline.Token);
          var read = await runtime.Peer.RequestAsync("settings/get", new JObject { ["key"] = "museSpark.schedulePauseAfterFailures" }, deadline.Token);
          Assert.AreEqual(5, read.Value<int>("value"));
        }
        // The settings file lands in the scratch home, never in the person's own data folder.
        Assert.IsTrue(Directory.GetFiles(home, "settings.json", SearchOption.AllDirectories).Length == 1);
        var tree = new List<int>();
        Descendants(runtime.ProcessId, tree);
        Assert.IsTrue(tree.Count >= 1, "the helper holds the node child");
        var ids = tree.Concat(new[] { runtime.ProcessId }).ToArray();
        await runtime.CloseAsync();
        var settled = Stopwatch.StartNew();
        while (ids.Any(Alive) && settled.Elapsed < TimeSpan.FromSeconds(15)) await Task.Delay(100);
        Assert.IsFalse(ids.Any(Alive), "a process of the runtime's tree outlived the host");
      }
      finally
      {
        foreach (var name in ScratchVariables) Environment.SetEnvironmentVariable(name, saved[name]);
        runtime?.Dispose();
        context.Dispose();
        // The runtime's tree is gone; a straggler handle must not fail the verdict above.
        try { Directory.Delete(scratch, true); } catch (IOException) { }
      }
    }
  }
}
