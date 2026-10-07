using System;
using System.IO;
using MuseSpark.VisualStudio.Protocol;

namespace MuseSpark.VisualStudio.Editor
{
  internal static class DocumentPath
  {
    internal static string Normalize(string path) => Path.GetFullPath(path).Replace('\\', '/');
    internal static bool Equal(string left, string right)
    {
      try { return Path.IsPathRooted(left) && Path.IsPathRooted(right) && string.Equals(Normalize(left), Normalize(right), StringComparison.OrdinalIgnoreCase); }
      // RDT also closes virtual buffers whose moniker is not a filesystem path.
      catch (Exception error) when (error is ArgumentException || error is NotSupportedException || error is PathTooLongException) { return false; }
    }
    internal static string Parse(string source)
    {
      if (!Uri.TryCreate(source, UriKind.Absolute, out var uri) || !uri.IsFile || uri.IsUnc)
        throw new MhpException("invalidParams", "MHP_INVALID_EDITOR_POSITION");
      return uri.LocalPath;
    }
  }
}
