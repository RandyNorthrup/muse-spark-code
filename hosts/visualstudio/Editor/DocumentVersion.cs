using Microsoft.VisualStudio.Text;

namespace MuseSpark.VisualStudio.Editor
{
  // The version the runtime sees: 1 when this window first saw the buffer, one more for each change after that.
  // A snapshot's own number depends on how the editor loaded the file, so it never crosses the wire.
  internal static class DocumentVersion
  {
    private sealed class FirstSeen
    {
      public int Number { get; }
      public FirstSeen(int number) { Number = number; }
    }

    public static long Of(ITextBuffer buffer) => Of(buffer.CurrentSnapshot);

    public static long Of(ITextSnapshot snapshot)
    {
      var seen = snapshot.TextBuffer.Properties.GetOrCreateSingletonProperty(() => new FirstSeen(snapshot.Version.VersionNumber));
      return snapshot.Version.VersionNumber - seen.Number + 1L;
    }
  }
}
