using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Panel;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class ThemeBootstrapTests
  {
    private static JObject Theme(string kind, string value = "#123456") => new JObject { ["kind"] = kind, ["tokens"] = new JObject { ["--muse-editorBackground"] = value, ["--muse-foreground"] = "#abcdef" } };

    [TestMethod]
    public void ExecutesAllFourActualBootstrapScriptsBeforeAndAfterDomReady()
    {
      var scripts = new JObject();
      foreach (var pair in new[] { ("dark", "dark"), ("light", "light"), ("highContrastDark", "hc-dark"), ("highContrastLight", "hc-light") })
        scripts[pair.Item2] = PanelChannel.ThemeBootstrap(SchemaContract.Load(), Theme(pair.Item1));
      var root = RuntimeAndPackageTests.PluginRoot();
      var node = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator).Select(path => Path.Combine(path.Trim('"'), "node.exe")).First(File.Exists);
      var fixture = Path.GetFullPath(Path.Combine(root, "..", "..", "test", "m104", "windows", "bootstrapFixture.mjs"));
      var start = AssetPolicy.RuntimeStartInfo(node, fixture, Path.GetDirectoryName(fixture) ?? throw new InvalidOperationException());
      start.Arguments = AssetPolicy.Quote(fixture);
      using (var process = Process.Start(start) ?? throw new InvalidOperationException())
      {
        try
        {
          process.StandardInput.Write(scripts.ToString(Formatting.None)); process.StandardInput.Close();
          Assert.IsTrue(process.WaitForExit(5000), "M104_THEME_FIXTURE_TIMEOUT");
          Assert.AreEqual(0, process.ExitCode, process.StandardError.ReadToEnd());
          StringAssert.Contains(process.StandardOutput.ReadToEnd(), "M104_THEME_BOOTSTRAP_OK");
        }
        finally { if (!process.HasExited) process.Kill(); }
      }
    }

    [TestMethod]
    public void RefusesUnknownKindsTokensAndCssInjectionBeforeReturningAScript()
    {
      Assert.ThrowsException<MhpException>(() => PanelChannel.ThemeBootstrap(SchemaContract.Load(), Theme("invented")));
      var wrong = Theme("dark"); wrong["tokens"]!["--other-background"] = "#ffffff";
      Assert.ThrowsException<MhpException>(() => PanelChannel.ThemeBootstrap(SchemaContract.Load(), wrong));
      foreach (var value in new[] { "red; color: blue", "url(https://example.invalid)", "</style>", "@import 'x'" })
        Assert.ThrowsException<MhpException>(() => PanelChannel.ThemeBootstrap(SchemaContract.Load(), Theme("dark", value)));
    }
  }
}
