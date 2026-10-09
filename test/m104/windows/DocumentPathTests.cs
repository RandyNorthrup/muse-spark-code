using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Editor;
using MuseSpark.VisualStudio.Protocol;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class DocumentPathTests
  {
    [TestMethod]
    public void MatchesWindowsCaseSeparatorsDotSegmentsAndUnicode()
    {
      Assert.IsTrue(DocumentPath.Equal(@"C:\fixture\one\..\Unicode space Ω.ts", "c:/fixture/Unicode space Ω.ts"));
      Assert.AreEqual("C:/fixture/Unicode space Ω.ts", DocumentPath.Normalize(@"C:\fixture\Unicode space Ω.ts"));
      Assert.IsFalse(DocumentPath.Equal(@"C:\fixture\one.ts", @"C:\fixture\two.ts"));
      Assert.IsFalse(DocumentPath.Equal(@"C:\fixture\one.ts", ""));
      Assert.IsFalse(DocumentPath.Equal(@"C:\fixture\one.ts", "<virtual>"));
      Assert.IsFalse(DocumentPath.Equal(@"C:\fixture\one.ts", "C:/fixture/<virtual>"));
      Assert.IsFalse(DocumentPath.Equal(System.IO.Path.Combine(System.Environment.CurrentDirectory, "virtual.cs"), "virtual.cs"));
      Assert.IsTrue(DocumentPath.Equal(DocumentPath.Parse("file:///C:/fixture/Unicode%20space%20%CE%A9.ts"), @"C:\fixture\Unicode space Ω.ts"));
    }

    [TestMethod]
    public void RefusesNonFileRelativeAndNetworkDocumentUris()
    {
      foreach (var uri in new[] { "relative.ts", "https://example.invalid/file.ts", "file://server/share/file.ts" })
        Assert.ThrowsException<MhpException>(() => DocumentPath.Parse(uri));
    }
  }
}
