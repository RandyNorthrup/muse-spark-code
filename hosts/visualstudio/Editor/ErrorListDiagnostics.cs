using System;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Editor
{
  public static class ErrorListDiagnostics
  {
    public static JArray Read(IVsTaskList list, string? onlyUri)
    {
      ThreadHelper.ThrowIfNotOnUIThread();
      ErrorHandler.ThrowOnFailure(list.EnumTaskItems(out var enumerator));
      var result = new JArray();
      var items = new IVsTaskItem[1];
      var fetched = new uint[1];
      while (enumerator.Next(1, items, fetched) == VSConstants.S_OK && fetched[0] != 0)
      {
        var item = items[0];
        if (!(item is IVsErrorItem error) || item.Document(out var path) != VSConstants.S_OK || string.IsNullOrEmpty(path)) continue;
        if (item.Line(out var line) != VSConstants.S_OK || item.Column(out var column) != VSConstants.S_OK || line < 0 || column < 0) continue;
        ErrorHandler.ThrowOnFailure(item.get_Text(out var message));
        ErrorHandler.ThrowOnFailure(error.GetCategory(out var category));
        var uri = new Uri(path).AbsoluteUri;
        if (onlyUri != null && !uri.Equals(onlyUri, StringComparison.OrdinalIgnoreCase)) continue;
        var severity = category == (uint)__VSERRORCATEGORY.EC_ERROR ? "error" : category == (uint)__VSERRORCATEGORY.EC_WARNING ? "warning" : "information";
        var position = new JObject { ["line"] = line, ["character"] = column };
        result.Add(new JObject
        {
          ["uri"] = uri,
          ["range"] = new JObject { ["start"] = position, ["end"] = position.DeepClone() },
          ["severity"] = severity,
          ["message"] = message,
          ["source"] = "visual-studio"
        });
      }
      return result;
    }
  }
}
