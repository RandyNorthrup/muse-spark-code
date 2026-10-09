using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Editor;

namespace MuseSpark.VisualStudio.Test
{
  // RVM104PD finding 2: real files in a private folder on this PC, named every way Windows allows.
  [TestClass]
  public sealed class DocumentIdentityTests
  {
    private sealed class Document
    {
      public Document(string path) { Path = path; }
      public string Path { get; }
    }

    private static string root = "";
    private static string folder = "";
    private static string file = "";
    private static string junction = "";
    private static string? otherRoot;
    private static string? otherJunction;
    private static string? sameNameElsewhere;

    [ClassInitialize]
    public static void CreateFiles(TestContext context)
    {
      root = Path.Combine(Path.GetTempPath(), "m104pd-identity-" + Guid.NewGuid().ToString("N"));
      folder = Path.Combine(root, "Long Declared Folder");
      Directory.CreateDirectory(folder);
      file = Path.Combine(folder, "Calls file.cs");
      File.WriteAllText(file, "class Calls {}");
      junction = Path.Combine(root, "linked");
      Junction(junction, folder);
      var own = Path.GetPathRoot(root);
      foreach (var drive in DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady && !string.Equals(d.Name, own, StringComparison.OrdinalIgnoreCase)))
      {
        try
        {
          var candidate = Path.Combine(drive.Name, "m104pd-identity-" + Guid.NewGuid().ToString("N"));
          Directory.CreateDirectory(candidate);
          otherRoot = candidate;
          break;
        }
        catch (Exception error) when (error is IOException || error is UnauthorizedAccessException) { /* Next drive. */ }
      }
      if (otherRoot == null) return;
      sameNameElsewhere = Path.Combine(otherRoot, "Calls file.cs");
      File.WriteAllText(sameNameElsewhere, "class Calls {}");
      otherJunction = Path.Combine(root, "other-drive");
      Junction(otherJunction, otherRoot);
    }

    [ClassCleanup]
    public static void RemoveFiles()
    {
      // Junctions first, without recursion, so their targets are never walked twice.
      foreach (var link in new[] { otherJunction, junction }) if (link != null && Directory.Exists(link)) Directory.Delete(link);
      if (Directory.Exists(root)) Directory.Delete(root, true);
      if (otherRoot != null && Directory.Exists(otherRoot)) Directory.Delete(otherRoot, true);
    }

    private static void Junction(string link, string target)
    {
      var start = new ProcessStartInfo("cmd.exe", "/d /c mklink /J \"" + link + "\" \"" + target + "\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
      using (var process = Process.Start(start) ?? throw new InvalidOperationException("M104_MKLINK_UNAVAILABLE"))
      {
        process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0 || !Directory.Exists(link)) throw new InvalidOperationException("M104_JUNCTION_REFUSED");
      }
    }

    private static string Short(string path)
    {
      var buffer = new StringBuilder(1024);
      var length = GetShortPathNameW(path, buffer, buffer.Capacity);
      if (length == 0 || length >= buffer.Capacity) throw new InvalidOperationException("M104_SHORT_NAME_UNAVAILABLE");
      return buffer.ToString();
    }

    private static string Share(string path) => @"\\localhost\" + path.Substring(0, 1) + "$" + path.Substring(2);

    // (document, another spelling of it, a different file that must stay distinct)
    private static (string, string, string) Spelling(string name)
    {
      switch (name)
      {
        case "extended": return (file, @"\\?\" + file, Elsewhere());
        case "extendedUnc":
          if (!Directory.Exists(Share(folder))) Assert.Inconclusive("The administrative share \\\\localhost\\" + file.Substring(0, 1) + "$ is unavailable here.");
          return (Share(file), @"\\?\UNC\" + Share(file).Substring(2), Elsewhere());
        case "dotSegments": return (file, Path.Combine(folder, ".", "nested", "..", "Calls file.cs").Replace(Path.DirectorySeparatorChar, '/'), Elsewhere());
        case "shortName":
          var alias = Short(file);
          if (string.Equals(alias, file, StringComparison.OrdinalIgnoreCase)) Assert.Inconclusive("This volume generates no 8.3 aliases.");
          return (file, alias, Elsewhere());
        case "junction": return (file, Path.Combine(junction, "Calls file.cs"), Elsewhere());
        case "otherDrive": return (Elsewhere(), Path.Combine(otherJunction ?? "", "Calls file.cs"), file);
        default: throw new ArgumentOutOfRangeException(nameof(name));
      }
    }

    private static string Elsewhere() => sameNameElsewhere ?? throw new AssertInconclusiveException("No second writable fixed drive here.");

    [DataTestMethod]
    [DataRow("extended")]
    [DataRow("extendedUnc")]
    [DataRow("dotSegments")]
    [DataRow("shortName")]
    [DataRow("junction")]
    [DataRow("otherDrive")]
    public void EverySpellingOfARealFileHasOneIdentity(string name)
    {
      var (document, spelling, decoy) = Spelling(name);
      Assert.AreNotEqual(document, spelling);
      Assert.IsTrue(DocumentPath.Equal(document, spelling), name);
      Assert.IsTrue(DocumentPath.Equal(spelling, document), name);
      Assert.IsFalse(DocumentPath.Equal(spelling, decoy), name);
    }

    // Only the file index sees through a share: the final path keeps \\localhost\C$, the volume and index do not.
    [TestMethod]
    public void AnAdministrativeShareNamesTheSameLocalFile()
    {
      if (!Directory.Exists(Share(folder))) Assert.Inconclusive("The administrative share is unavailable here.");
      Assert.IsTrue(DocumentPath.Equal(Share(file), file));
      Assert.IsTrue(DocumentPath.Equal(@"\\?\UNC\" + Share(file).Substring(2), Short(file)));
      Assert.IsFalse(DocumentPath.Equal(Share(file), Path.Combine(folder, "other.cs")));
    }

    [TestMethod]
    public void MissingFilesResolveThroughTheirExistingAncestors()
    {
      Assert.IsTrue(DocumentPath.Equal(Path.Combine(junction, "new.cs"), Path.Combine(folder, "new.cs")));
      Assert.IsTrue(DocumentPath.Equal(Path.Combine(Short(folder), "new.cs"), @"\\?\" + Path.Combine(folder, "new.cs")));
      Assert.IsFalse(DocumentPath.Equal(Path.Combine(junction, "new.cs"), Path.Combine(folder, "other.cs")));
      Assert.IsFalse(DocumentPath.Equal(Path.Combine(junction, "new.cs"), "new.cs"));
    }

    [TestMethod]
    public void ATrackedBufferIsFoundByEverySpellingSoNoSecondIsOpened()
    {
      var table = new DocumentTable<object, Document>(document => document.Path);
      var held = new Document(Path.Combine(junction, "Calls file.cs"));
      Assert.IsTrue(table.Track(new object(), held));
      foreach (var spelling in new[] { file, @"\\?\" + file, Short(file), Path.Combine(folder, "..", "Long Declared Folder", "Calls file.cs"), file.ToUpperInvariant() })
        Assert.AreSame(held, table.Find(spelling), spelling);
      Assert.IsNull(table.Find(Path.Combine(folder, "other.cs")));
      Assert.IsNull(table.Find("<virtual>"));
      if (sameNameElsewhere != null) Assert.IsNull(table.Find(sameNameElsewhere));
    }

    [TestMethod]
    public void TheLastUnlockUntracksTheBufferItHolds()
    {
      var table = new DocumentTable<object, Document>(document => document.Path);
      var first = new object();
      var second = new object();
      var calls = new Document(Path.Combine(junction, "Calls file.cs"));
      var other = new Document(Path.Combine(folder, "other.cs"));
      table.Track(first, calls);
      table.Track(second, other);
      // The RDT's moniker may be any spelling; the held buffer decides.
      Assert.AreSame(calls, table.Untrack(first, Short(file)));
      CollectionAssert.AreEqual(new[] { other }, table.Documents.ToArray());
      table.Track(first, calls);
      Assert.AreSame(other, table.Untrack(second, file));
      CollectionAssert.AreEqual(new[] { calls }, table.Documents.ToArray());
      Assert.IsNull(table.Untrack(new object(), file));
      // Without a text buffer, the moniker's identity names the buffer.
      Assert.AreSame(calls, table.Untrack(null, @"\\?\" + file));
      Assert.AreEqual(0, table.Documents.Count);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetShortPathNameW(string longPath, StringBuilder shortPath, int length);
  }
}
