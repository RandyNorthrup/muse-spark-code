using System;
using System.Linq;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Editor;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class EditPlanTests
  {
    private static JObject Position(long line, long character) => new JObject { ["line"] = line, ["character"] = character };
    private static JObject Edit(long start, long end, string text = "replacement") => new JObject
    {
      ["range"] = new JObject { ["start"] = Position(0, start), ["end"] = Position(0, end) },
      ["newText"] = text
    };
    private static JObject Parameters(params JObject[] edits) => new JObject { ["expectedVersion"] = 1, ["undoLabel"] = "fixture-undo", ["edits"] = new JArray(edits) };

    [TestMethod]
    public void RefusesStaleOrDirtyBuffersBeforeMutation()
    {
      var parameters = Parameters(Edit(0, 1));
      var stale = Assert.ThrowsException<MhpException>(() => EditPlan.Create("abc", 2, false, parameters));
      Assert.AreEqual("versionConflict", stale.CodeKey);
      var dirty = Assert.ThrowsException<MhpException>(() => EditPlan.Create("abc", 1, true, parameters));
      Assert.AreEqual("dirtyBuffer", dirty.CodeKey);
    }

    [TestMethod]
    public void RefusesReversedOverlappingDuplicateAndOutOfBoundsRanges()
    {
      foreach (var edits in new[]
      {
                new[] { Edit(2, 1) }, new[] { Edit(0, 2), Edit(1, 3) }, new[] { Edit(0, 0), Edit(0, 0) },
                new[] { Edit(0, 4) }, new[] { Edit(-1, 0) }, new[] { Edit(0, long.MaxValue) }
            }) Assert.ThrowsException<MhpException>(() => EditPlan.Create("abc", 1, false, Parameters(edits)));
      Assert.ThrowsException<MhpException>(() => EditPlan.Offset("abc", Position(1, 0)));
      Assert.ThrowsException<MhpException>(() => EditPlan.Create("abc", 1, false, Parameters()));
      var noUndo = Parameters(Edit(0, 1)); noUndo["undoLabel"] = "";
      Assert.ThrowsException<MhpException>(() => EditPlan.Create("abc", 1, false, noUndo));
    }

    [TestMethod]
    public void UsesUtf16AndCrLfPositionsAndSortsEditsAgainstOneSnapshot()
    {
      var text = "a😀b\r\nsecond\n";
      Assert.AreEqual(3, EditPlan.Offset(text, Position(0, 3)));
      Assert.AreEqual(6, EditPlan.Offset(text, Position(1, 0)));
      Assert.AreEqual(13, EditPlan.Offset(text, Position(2, 0)));
      Assert.ThrowsException<MhpException>(() => EditPlan.Offset(text, Position(0, 5)));
      var plan = EditPlan.Create("abcdef", 1, false, Parameters(Edit(4, 6, "Z"), Edit(0, 2, "X")));
      var result = "abcdef";
      foreach (var replacement in plan.Reverse()) result = result.Remove(replacement.Start, replacement.Length).Insert(replacement.Start, replacement.Text);
      Assert.AreEqual("XcdZ", result);
      Assert.AreEqual(0, plan[0].Start);
      Assert.AreEqual(4, plan[1].Start);
      Assert.AreEqual(1, EditPlan.Position(text, 6).Value<int>("line"));
      Assert.AreEqual(0, EditPlan.Position(text, 6).Value<int>("character"));
    }
  }
}
