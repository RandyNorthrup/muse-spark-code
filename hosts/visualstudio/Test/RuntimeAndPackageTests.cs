using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.VisualStudio.Threading;
using MuseSpark.VisualStudio.Panel;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class RuntimeAndPackageTests
  {
    internal static string PluginRoot()
    {
      var directory = new DirectoryInfo(AppContext.BaseDirectory);
      while (directory != null)
      {
        if (File.Exists(Path.Combine(directory.FullName, "MuseSpark.VisualStudio.csproj"))) return directory.FullName;
        directory = directory.Parent;
      }
      throw new InvalidOperationException("PLUGIN_ROOT_MISSING");
    }

    private sealed class FakeHost : IHostServices
    {
      public IReadOnlyCollection<string> Capabilities { get; } = new[] { "lifecycle", "documents" };
      public Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation)
      {
        Assert.AreEqual("documents/list", method);
        return Task.FromResult<JToken>(new JArray());
      }
    }

    [TestMethod]
    [Timeout(30000)]
    public async Task LaunchesFakeRuntimeThroughAJobAndKillsItsDescendant()
    {
      var root = PluginRoot();
      var stage = Path.Combine(root, "..", "..", "temp", "visualstudio-job-drill");
      Directory.CreateDirectory(stage);
      var node = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator).Select(p => Path.Combine(p.Trim('"'), "node.exe")).First(File.Exists);
      File.Copy(Path.Combine(root, "assets", "runtime", "muse-panel-job.exe"), Path.Combine(stage, "muse-panel-job.exe"), true);
      File.Copy(node, Path.Combine(stage, "node.exe"), true);
      var marker = Path.Combine(stage, Guid.NewGuid().ToString("N"));
      var savedMarker = Environment.GetEnvironmentVariable("MUSE_SPARK_TEST_RESULT_PATH");
      var savedKey = Environment.GetEnvironmentVariable("M104_FIXTURE_API_KEY");
      int childId = 0;
      try
      {
        Environment.SetEnvironmentVariable("MUSE_SPARK_TEST_RESULT_PATH", marker);
        Environment.SetEnvironmentVariable("M104_FIXTURE_API_KEY", "fixture-marker");
        using (var context = new JoinableTaskContext())
        using (var runtime = new RuntimeProcess(Path.Combine(stage, "node.exe"), Path.Combine(root, "Test", "fake-runtime.mjs"), stage, new FakeHost(), context.Factory))
        {
          using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10))) await runtime.Peer.InitializeAsync(new JObject
          {
            ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "fixture" },
            ["protocolRange"] = SchemaContract.Load().Export["range"]?.DeepClone(),
            ["capabilities"] = new JArray("lifecycle", "documents"),
            ["locale"] = "en",
            ["theme"] = new JObject { ["kind"] = "dark", ["tokens"] = new JObject() },
            ["folders"] = new JArray(),
            ["trusted"] = false
          }, deadline.Token);
          for (var attempt = 0; attempt < 100 && (!File.Exists(marker) || !File.Exists(marker + ".pid")); attempt++) await Task.Delay(50);
          Assert.IsTrue(File.Exists(marker), "Fake runtime did not complete its MHP exchange.");
          Assert.IsTrue(File.Exists(marker + ".pid"), "Fake runtime did not create its descendant.");
          SchemaContract.Load().ValidateResult("documents/list", SchemaContract.ParseObject(File.ReadAllText(marker)));
          childId = int.Parse(File.ReadAllText(marker + ".pid"), System.Globalization.CultureInfo.InvariantCulture);
          Assert.IsTrue(IsRunning(childId), "The fake descendant exited before shutdown was tested.");
          using (var channel = new MhpPanelChannel(runtime.Peer, "fixture-session", "chat", "script", _ => { }))
          {
            var received = new ConcurrentQueue<JToken>(); channel.MessageReceived += (_, frame) => received.Enqueue(frame);
            await channel.OpenAsync(); await channel.ReadyAsync();
            for (var attempt = 0; attempt < 100 && received.Count < 1; attempt++) await Task.Delay(50);
            Assert.AreEqual(1, received.Count);
            await channel.PostAsync(new JObject { ["mhp"] = "1.1", ["kind"] = "panel", ["surface"] = channel.Surface, ["direction"] = "toHost", ["seq"] = 1, ["payload"] = new JObject { ["type"] = "ready" } }, CancellationToken.None);
            for (var attempt = 0; attempt < 100 && !File.Exists(marker + ".panel"); attempt++) await Task.Delay(50);
            Assert.AreEqual(1, SchemaContract.ParseObject(File.ReadAllText(marker + ".panel")).Value<int>("seq"));
            await channel.ReloadAsync(); await channel.ReadyAsync();
            for (var attempt = 0; attempt < 100 && received.Count < 2; attempt++) await Task.Delay(50);
            Assert.AreEqual(2, received.Count); Assert.AreEqual(2, received.Last().Value<int>("seq"));
            await channel.CloseAsync();
            for (var attempt = 0; attempt < 100 && !File.Exists(marker + ".closed"); attempt++) await Task.Delay(50);
            var lifecycle = JArray.Parse(File.ReadAllText(marker + ".closed"));
            CollectionAssert.AreEqual(new[] { "opened", "ready", "reloaded", "ready", "closed" }, lifecycle.Select(frame => frame.Value<string>("event")).ToArray());
            Assert.AreEqual("fixture-session", lifecycle.Last().Value<string>("sessionId"));
          }
          await runtime.CloseAsync();
        }
        for (var attempt = 0; attempt < 100 && IsRunning(childId); attempt++) await Task.Delay(50);
        Assert.IsFalse(IsRunning(childId), "The runtime job left its descendant alive.");
      }
      finally
      {
        Environment.SetEnvironmentVariable("MUSE_SPARK_TEST_RESULT_PATH", savedMarker);
        Environment.SetEnvironmentVariable("M104_FIXTURE_API_KEY", savedKey);
        if (childId != 0 && IsRunning(childId)) { using (var orphan = Process.GetProcessById(childId)) orphan.Kill(); }
      }
    }

    private static bool IsRunning(int id)
    {
      try { using (var process = Process.GetProcessById(id)) return !process.HasExited; }
      catch (ArgumentException) { return false; }
    }

    [TestMethod]
    public void VsixContainsThePanelAllLanguagesAndTheExactContract()
    {
      var root = PluginRoot();
      using (var archive = ZipFile.OpenRead(Path.Combine(root, "bin", "Release", "net48", "MuseSpark.VisualStudio.vsix")))
      {
        var names = archive.Entries.Select(e => e.FullName).ToArray();
        foreach (var required in new[] { "MuseSpark.VisualStudio.dll", "MuseSpark.VisualStudio.pkgdef", "assets/webview/main.js", "assets/webview/main.css", "assets/webview/portable/main.js", "assets/webview/portable/main.css", "assets/embedded-bridge.js", "assets/runtime/muse-panel-job.exe", "assets/mhp-v1.1.schema.json", "assets/mhp-v1.schema.json", "LICENSE.txt", "icon.png", "assets/licenses/microsoft.web.webview2/1.0.4258.31/LICENSE.txt", "assets/licenses/system.text.encodings.web/9.0.0/LICENSE.TXT" })
          Assert.IsTrue(names.Contains(required), required);
        Assert.IsTrue(names.Any(n => n.EndsWith("WebView2Loader.dll", StringComparison.Ordinal)));
        Assert.IsFalse(names.Any(n => n.Contains("fake-runtime") || n.Contains("Test.dll")));
        var locales = new[] { "en", "zh-cn", "zh-tw", "ja", "ko", "de", "fr", "es", "pt-br", "ru", "it", "tr", "pl", "cs", "hu" };
        foreach (var locale in locales)
        {
          using (var reader = new StreamReader((archive.GetEntry("assets/webview/index." + locale + ".html") ?? throw new InvalidOperationException()).Open()))
          {
            var html = reader.ReadToEnd();
            StringAssert.Contains(html, "data-host=\"embedded\"");
            StringAssert.Contains(html, "default-src 'none'");
            StringAssert.Contains(html, "base-uri 'none'");
            StringAssert.Contains(html, "script-src 'nonce-");
            Assert.IsFalse(html.Contains("unsafe-inline") || html.Contains("unsafe-eval"));
          }
          Assert.IsTrue(names.Contains("assets/l10n/ui." + locale + ".json"));
          Assert.IsTrue(names.Contains("assets/l10n/package.nls." + locale + ".json"));
        }
        using (var reader = new StreamReader((archive.GetEntry("assets/mhp-v1.schema.json") ?? throw new InvalidOperationException()).Open()))
          Assert.IsTrue(JToken.DeepEquals(SchemaContract.ParseObject(reader.ReadToEnd()), SchemaContract.Load().Export));
        using (var reader = new StreamReader((archive.GetEntry("assets/mhp-v1.1.schema.json") ?? throw new InvalidOperationException()).Open()))
          Assert.IsTrue(JToken.DeepEquals(SchemaContract.ParseObject(reader.ReadToEnd()), SchemaContract.Load(true).Export));
      }
    }

    [TestMethod]
    public void UiTextUsesTheInstalledLocaleAndTheExistingKeys()
    {
      var saved = System.Globalization.CultureInfo.CurrentUICulture;
      try
      {
        System.Globalization.CultureInfo.CurrentUICulture = System.Globalization.CultureInfo.GetCultureInfo("de-DE");
        var text = new UiText(Path.Combine(PluginRoot(), "assets"));
        Assert.AreEqual("de", text.Locale);
        Assert.AreNotEqual("Insert at cursor", text["insertCode"]);
        StringAssert.Contains(text.Manifest("displayName"), "Muse Spark");
        System.Globalization.CultureInfo.CurrentUICulture = System.Globalization.CultureInfo.GetCultureInfo("pt-BR");
        Assert.AreEqual("pt-br", new UiText(Path.Combine(PluginRoot(), "assets")).Locale);
      }
      finally { System.Globalization.CultureInfo.CurrentUICulture = saved; }
    }
  }
}
