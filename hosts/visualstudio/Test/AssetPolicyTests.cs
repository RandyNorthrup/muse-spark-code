using System;
using System.IO;
using System.Linq;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Panel;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class AssetPolicyTests
  {
    [TestMethod]
    public void BlocksEveryRemoteNavigationAndCredentialOrigin()
    {
      Assert.IsTrue(AssetPolicy.IsAssetUri("https://muse-panel.invalid/index.html"));
      foreach (var source in new[] { "http://muse-panel.invalid/", "https://muse-panel.invalid.evil/", "https://user@muse-panel.invalid/", "https://muse-panel.invalid:444/", "file:///C:/private", "javascript:alert(1)", "https://example.com/", "about:blank" })
        Assert.IsFalse(AssetPolicy.IsAssetUri(source), source);
    }

    [TestMethod]
    public void LaunchesWithoutShellOrCredentialEnvironmentAndQuotesWindowsPaths()
    {
      var keyNames = new[] { "TEST_API_KEY", "GH_TOKEN", "NODE_OPTIONS", "NODE_PATH", "GOOGLE_APPLICATION_CREDENTIALS" };
      var old = keyNames.ToDictionary(k => k, Environment.GetEnvironmentVariable);
      try
      {
        foreach (var name in keyNames) Environment.SetEnvironmentVariable(name, "fixture-marker");
        var info = AssetPolicy.RuntimeStartInfo(typeof(object).Assembly.Location, typeof(object).Assembly.Location, Path.GetTempPath());
        Assert.IsFalse(info.UseShellExecute);
        Assert.IsTrue(info.CreateNoWindow);
        Assert.IsTrue(info.RedirectStandardInput && info.RedirectStandardOutput && info.RedirectStandardError);
        StringAssert.EndsWith(info.Arguments, " panel --stdio --host visual-studio");
        foreach (var name in keyNames) Assert.IsNull(info.EnvironmentVariables[name], name);
        Assert.IsFalse(info.EnvironmentVariables.Values.Cast<string>().Contains("fixture-marker"));
        Assert.AreEqual("\"C:\\space dir\\\\\"", AssetPolicy.Quote("C:\\space dir\\"));
        Assert.AreEqual("\"a\\\"b\"", AssetPolicy.Quote("a\"b"));
        Assert.ThrowsException<InvalidOperationException>(() => AssetPolicy.RuntimeStartInfo("node.exe", "runtime.js", Path.GetTempPath()));
      }
      finally { foreach (var name in keyNames) Environment.SetEnvironmentVariable(name, old[name]); }
    }
  }
}
