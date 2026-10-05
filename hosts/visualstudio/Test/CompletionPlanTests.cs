using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Editor;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class CompletionPlanTests
  {
    private static JObject Item(int start, int end, string text = "complete") => new JObject
    {
      ["id"] = "fixture",
      ["text"] = text,
      ["range"] = new JObject { ["start"] = new JObject { ["line"] = 0, ["character"] = start }, ["end"] = new JObject { ["line"] = 0, ["character"] = end } }
    };
    [TestMethod]
    public void RefusesAStaleMovedInvisibleOrUnrelatedCompletion()
    {
      Assert.ThrowsException<MhpException>(() => CompletionPlan.Create("abc", 2, 1, 1, 1, Item(0, 1), "fixture"));
      Assert.ThrowsException<MhpException>(() => CompletionPlan.Create("abc", 1, 2, 1, 1, Item(0, 2), "fixture"));
      Assert.ThrowsException<MhpException>(() => CompletionPlan.Create("abc", 1, 1, 1, 1, Item(2, 3), "fixture"));
      Assert.ThrowsException<MhpException>(() => CompletionPlan.Create("abc", 1, 2, 1, 2, Item(0, 1), "fixture"));
      Assert.ThrowsException<MhpException>(() => CompletionPlan.Create("abc", 1, 1, 1, 1, Item(1, 1, ""), "fixture"));
      Assert.ThrowsException<MhpException>(() => CompletionPlan.Create("abc", 1, 1, 1, 1, Item(2, 1), "fixture"));
    }
    [TestMethod]
    public void PlansAnExplicitUserAcceptanceAgainstTheCapturedSnapshot()
    {
      var replacement = CompletionPlan.Create("abc", 1, 2, 1, 2, Item(0, 2, "accept"), "fixture");
      Assert.AreEqual(0, replacement.Start); Assert.AreEqual(2, replacement.Length); Assert.AreEqual("accept", replacement.Text);
    }
  }
}
