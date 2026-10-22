using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  public static class AssetPolicy
  {
    public const string VirtualHost = "muse-panel.invalid";
    public const string Origin = "https://" + VirtualHost;
    private static readonly HashSet<string> CredentialNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "ANTHROPIC_AUTH_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
            "AZURE_OPENAI_AD_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "GITLAB_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS",
            "NPM_TOKEN", "NODE_AUTH_TOKEN", "OPENAI_ACCESS_TOKEN", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN",
            "CODEX_ACCESS_TOKEN", "MUSE_ACCESS_TOKEN", "META_ACCESS_TOKEN", "VSCE_PAT", "OVSX_PAT",
            "OPENAI_KEY", "ANTHROPIC_KEY", "META_KEY"
        };

    public static bool IsAssetUri(string source)
    {
      return Uri.TryCreate(source, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps &&
          uri.Host.Equals(VirtualHost, StringComparison.OrdinalIgnoreCase) && uri.Port == 443 && uri.UserInfo.Length == 0;
    }

    public static ProcessStartInfo RuntimeStartInfo(string node, string entry, string cwd)
    {
      if (!Path.IsPathRooted(node) || !Path.IsPathRooted(entry) || !File.Exists(node) || !File.Exists(entry))
        throw new InvalidOperationException("MHP_RUNTIME_NOT_INSTALLED");
      var info = new ProcessStartInfo(node, Quote(entry) + " panel --stdio --host visual-studio")
      {
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        WorkingDirectory = cwd,
        StandardOutputEncoding = new System.Text.UTF8Encoding(false, true),
        StandardErrorEncoding = new System.Text.UTF8Encoding(false, true)
      };
      // A shell, runtime helper or model process never inherits an IDE credential.
      foreach (var key in info.EnvironmentVariables.Keys.Cast<string>().ToArray())
        if (key.EndsWith("_API_KEY", StringComparison.OrdinalIgnoreCase) || CredentialNames.Contains(key)) info.EnvironmentVariables.Remove(key);
      foreach (var key in new[] { "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "DOTNET_STARTUP_HOOKS", "COR_ENABLE_PROFILING", "COR_PROFILER", "CORECLR_ENABLE_PROFILING", "CORECLR_PROFILER" })
        info.EnvironmentVariables.Remove(key);
      return info;
    }

    // Windows CommandLineToArgvW quoting, never a cmd.exe or PowerShell string.
    public static string Quote(string value)
    {
      var result = new System.Text.StringBuilder("\"");
      var slashes = 0;
      foreach (var character in value)
      {
        if (character == '\\') { slashes++; continue; }
        if (character == '"') result.Append('\\', slashes * 2 + 1);
        else result.Append('\\', slashes);
        result.Append(character);
        slashes = 0;
      }
      return result.Append('\\', slashes * 2).Append('"').ToString();
    }
  }
}
