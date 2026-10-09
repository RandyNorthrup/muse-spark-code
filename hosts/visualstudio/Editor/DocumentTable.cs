using System;
using System.Collections.Generic;
using System.Linq;

namespace MuseSpark.VisualStudio.Editor
{
  // Tracked editor buffers, keyed by the buffer itself. A path finds a buffer by file identity, so a second
  // spelling of an open file reuses its buffer; the last unlock releases exactly the buffer the RDT held.
  internal sealed class DocumentTable<TBuffer, TDocument> where TBuffer : class where TDocument : class
  {
    private readonly Dictionary<TBuffer, TDocument> tracked = new Dictionary<TBuffer, TDocument>();
    private readonly Func<TDocument, string> pathOf;

    public DocumentTable(Func<TDocument, string> pathOf) { this.pathOf = pathOf; }

    public IReadOnlyCollection<TDocument> Documents => tracked.Values;

    public bool Track(TBuffer buffer, TDocument document)
    {
      if (tracked.ContainsKey(buffer)) return false;
      tracked.Add(buffer, document);
      return true;
    }

    public TDocument? Get(TBuffer buffer) => tracked.TryGetValue(buffer, out var document) ? document : null;

    // Null when no tracked buffer holds this file (or the path names no file on disk).
    public TDocument? Find(string path)
    {
      var identity = DocumentPath.Identity(path);
      if (identity == null) return null;
      return tracked.Values.FirstOrDefault(document => string.Equals(DocumentPath.Identity(pathOf(document)), identity, StringComparison.OrdinalIgnoreCase));
    }

    // The held buffer decides; its moniker is consulted only when the RDT exposes no text buffer.
    public TDocument? Untrack(TBuffer? held, string moniker)
    {
      if (held != null)
      {
        var exact = Get(held);
        if (exact != null) tracked.Remove(held);
        return exact;
      }
      var buffer = tracked.FirstOrDefault(entry => DocumentPath.Equal(pathOf(entry.Value), moniker)).Key;
      if (buffer == null) return null;
      var document = tracked[buffer];
      tracked.Remove(buffer);
      return document;
    }

    public void Clear() => tracked.Clear();
  }
}
