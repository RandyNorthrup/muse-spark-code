using System;
using System.IO;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Panel;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class RuntimeLocatorTests
  {
    [TestMethod]
    public void RequiresInstalledNode22AndTheActualAcpPackageEntry()
    {
      var root = Path.Combine(Path.GetTempPath(), "MuseSparkLocator-" + Guid.NewGuid().ToString("N"));
      Directory.CreateDirectory(root);
      try
      {
        foreach (var version in new[] { "v21.10.0", "v20.0.0", "v022.0.0", "22.0.0", "v22.0.0-extra", "bad" }) Assert.IsFalse(RuntimeLocator.IsSupportedVersion(version));
        Assert.IsTrue(RuntimeLocator.IsSupportedVersion("v22.0.0")); Assert.IsTrue(RuntimeLocator.IsSupportedVersion("v24.9.0"));
        File.WriteAllText(Path.Combine(root, "node.exe"), "fixture");
        var error = Assert.ThrowsException<InvalidOperationException>(() => RuntimeLocator.Find(root, root, root, _ => "v21.0.0")); Assert.AreEqual("MHP_NODE_22_REQUIRED", error.Message);
        error = Assert.ThrowsException<InvalidOperationException>(() => RuntimeLocator.Find(root, root, root, _ => "v22.0.0")); Assert.AreEqual("MHP_ACP_PANEL_PACKAGE_REQUIRED", error.Message);
        var package = Path.Combine(root, "npm", "node_modules", "muse-spark-code-acp"); Directory.CreateDirectory(Path.Combine(package, "dist"));
        File.WriteAllText(Path.Combine(package, "package.json"), "{\"name\":\"muse-spark-code-acp\",\"bin\":{\"muse-spark-code-acp\":\"dist/acp.js\"}}");
        File.WriteAllText(Path.Combine(package, "dist", "acp.js"), "fixture");
        error = Assert.ThrowsException<InvalidOperationException>(() => RuntimeLocator.Find(root, root, root, _ => "v22.0.0")); Assert.AreEqual("MHP_JOB_HELPER_NOT_INSTALLED", error.Message);
        Directory.CreateDirectory(Path.Combine(root, "runtime")); File.WriteAllText(Path.Combine(root, "runtime", "muse-panel-job.exe"), "fixture");
        var location = RuntimeLocator.Find(root, "relative;" + root, root, _ => "v22.0.0");
        Assert.AreEqual(Path.Combine(root, "node.exe"), location.Node); Assert.AreEqual(Path.Combine(package, "dist", "acp.js"), location.Entry);
        Assert.AreEqual(Path.Combine(root, "runtime", "muse-panel-job.exe"), location.Helper);
        File.WriteAllText(Path.Combine(package, "package.json"), "{\"name\":\"other\",\"bin\":{\"muse-spark-code-acp\":\"dist/acp.js\"}}");
        Assert.ThrowsException<InvalidOperationException>(() => RuntimeLocator.Find(root, root, root, _ => "v22.0.0"));
      }
      finally { Directory.Delete(root, true); }
    }
  }
}
