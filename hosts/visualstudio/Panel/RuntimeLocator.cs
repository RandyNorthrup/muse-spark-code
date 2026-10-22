using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using MuseSpark.VisualStudio.Protocol;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class RuntimeLocation
  {
    public string Node { get; }
    public string Entry { get; }
    public string Helper { get; }
    public RuntimeLocation(string node, string entry, string helper) { Node = node; Entry = entry; Helper = helper; }
  }

  public static class RuntimeLocator
  {
    private const int MinimumNodeMajor = 22;
    private const int ProbeTimeoutMs = 5000;
    private const int MaximumVersionLength = 128;

    // No pin manifest is present in this baseline. Discover only installed Node;
    // downloading or trusting an unverified bundled Node is lane I's follow-up.
    public static RuntimeLocation Find(string assets, string searchPath, string roaming, Func<string, string?>? probe = null)
    {
      var directories = searchPath.Split(Path.PathSeparator).Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p.Trim('"')).Where(Path.IsPathRooted).ToArray();
      var node = directories.Select(p => Path.Combine(p, "node.exe")).Where(File.Exists).FirstOrDefault(p => IsSupportedVersion((probe ?? Probe)(p)));
      if (node == null) throw new InvalidOperationException("MHP_NODE_22_REQUIRED");
      var packages = new[] { Path.Combine(assets, "runtime", "package"), Path.Combine(roaming, "npm", "node_modules", "muse-spark-code-acp") }
          .Concat(directories.Select(p => Path.Combine(p, "node_modules", "muse-spark-code-acp")));
      var entry = packages.Select(PackageEntry).FirstOrDefault(p => p != null) ?? throw new InvalidOperationException("MHP_ACP_PANEL_PACKAGE_REQUIRED");
      var helper = Path.Combine(assets, "runtime", "muse-panel-job.exe");
      if (!File.Exists(helper)) throw new InvalidOperationException("MHP_JOB_HELPER_NOT_INSTALLED");
      return new RuntimeLocation(node, entry, helper);
    }

    private static string? PackageEntry(string directory)
    {
      var manifest = Path.Combine(directory, "package.json");
      if (!File.Exists(manifest)) return null;
      try
      {
        var package = SchemaContract.ParseObject(File.ReadAllText(manifest));
        if (package.Value<string>("name") != "muse-spark-code-acp" || package["bin"]?.Value<string>("muse-spark-code-acp") != "dist/acp.js") return null;
        var entry = Path.Combine(directory, "dist", "acp.js");
        return File.Exists(entry) ? entry : null;
      }
      catch (Exception error) when (error is IOException || error is Newtonsoft.Json.JsonException || error is MhpException) { return null; }
    }

    public static bool IsSupportedVersion(string? version)
    {
      if (version == null || version.Length > MaximumVersionLength) return false;
      var match = Regex.Match(version, "^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
      return match.Success && int.TryParse(match.Groups[1].Value, out var major) && major >= MinimumNodeMajor;
    }

    private static string? Probe(string node)
    {
      var info = new ProcessStartInfo(node, "--version") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
      AssetPolicy.SanitizeEnvironment(info);
      using (var process = new Process { StartInfo = info })
      {
        try
        {
          if (!process.Start()) return null;
          if (!process.WaitForExit(ProbeTimeoutMs)) { process.Kill(); return null; }
          var buffer = new char[MaximumVersionLength + 1];
          var length = process.StandardOutput.Read(buffer, 0, buffer.Length);
          if (process.ExitCode != 0 || length > MaximumVersionLength) return null;
          return new string(buffer, 0, length).TrimEnd('\r', '\n');
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception || error is IOException || error is InvalidOperationException) { return null; }
      }
    }
  }
}
