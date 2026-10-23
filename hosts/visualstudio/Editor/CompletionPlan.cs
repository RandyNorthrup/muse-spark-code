using System;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Editor
{
  public static class CompletionPlan
  {
    public static Replacement Create(string text, int version, int caret, int requestedVersion, int requestedCaret, JObject item, string undoLabel)
    {
      if (caret != requestedCaret) throw new MhpException("versionConflict", "MHP_COMPLETION_MOVED");
      var planned = EditPlan.Create(text, version, false, new JObject
      {
        ["expectedVersion"] = requestedVersion,
        ["undoLabel"] = undoLabel,
        ["edits"] = new JArray(new JObject { ["range"] = item["range"], ["newText"] = item["text"] })
      });
      var replacement = planned[0];
      if (replacement.Start > caret || replacement.Start + replacement.Length < caret || replacement.Text.Length == 0)
        throw new MhpException("invalidParams", "MHP_COMPLETION_RANGE_INVALID");
      return replacement;
    }
  }
}
