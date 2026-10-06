using System;
using System.Collections.Generic;
using System.Linq;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Editor
{
  public sealed class Replacement
  {
    public int Start { get; }
    public int Length { get; }
    public string Text { get; }
    public Replacement(int start, int length, string text) { Start = start; Length = length; Text = text; }
  }

  public static class EditPlan
  {
    // Every precondition is checked against one snapshot before CreateEdit.
    public static IReadOnlyList<Replacement> Create(string text, long version, bool dirty, JObject parameters)
    {
      if (parameters.Value<long>("expectedVersion") != version) throw new MhpException("versionConflict", "MHP_VERSION_CONFLICT");
      if (dirty) throw new MhpException("dirtyBuffer", "MHP_DIRTY_BUFFER");
      if (string.IsNullOrWhiteSpace(parameters.Value<string>("undoLabel"))) throw new MhpException("invalidParams", "MHP_UNDO_LABEL_REQUIRED");
      var edits = parameters["edits"] as JArray ?? throw Invalid();
      if (edits.Count == 0) throw Invalid();
      var result = new List<Replacement>();
      foreach (var edit in edits)
      {
        var range = edit["range"] ?? throw Invalid();
        var start = Offset(text, range["start"] ?? throw Invalid());
        var end = Offset(text, range["end"] ?? throw Invalid());
        if (end < start) throw Invalid();
        result.Add(new Replacement(start, end - start, edit.Value<string>("newText") ?? throw Invalid()));
      }
      var ordered = result.OrderBy(r => r.Start).ToArray();
      for (var i = 1; i < ordered.Length; i++)
        if (ordered[i].Start < ordered[i - 1].Start + ordered[i - 1].Length || ordered[i].Start == ordered[i - 1].Start) throw Invalid();
      return ordered;
    }

    public static int Offset(string text, JToken position)
    {
      var line = position.Value<long>("line");
      var character = position.Value<long>("character");
      if (line < 0 || character < 0) throw Invalid();
      var start = 0;
      for (long current = 0; current < line; current++)
      {
        var end = text.IndexOf('\n', start);
        if (end < 0) throw Invalid();
        start = end + 1;
      }
      var lineEnd = text.IndexOf('\n', start);
      if (lineEnd < 0) lineEnd = text.Length;
      if (lineEnd > start && text[lineEnd - 1] == '\r') lineEnd--;
      if (character > lineEnd - start) throw Invalid();
      return start + checked((int)character);
    }

    public static JObject Position(string text, int offset)
    {
      if (offset < 0 || offset > text.Length) throw Invalid();
      var line = 0;
      var start = 0;
      for (var i = 0; i < offset; i++) if (text[i] == '\n') { line++; start = i + 1; }
      return new JObject { ["line"] = line, ["character"] = offset - start };
    }

    private static MhpException Invalid() => new MhpException("invalidParams", "MHP_INVALID_EDIT");
  }
}
