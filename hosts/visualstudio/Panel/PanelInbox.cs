using System;
using System.Collections.Generic;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class PanelInbox
  {
    public const int MaximumWaitingMessages = 128;
    private readonly Queue<JToken> waiting = new Queue<JToken>();
    private readonly Func<JToken, JToken> parse;
    private readonly Action<string> post;
    private bool ready;
    public PanelInbox(Func<JToken, JToken> parse, Action<string> post) { this.parse = parse; this.post = post; }

    public void Receive(JToken message)
    {
      var parsed = parse(message);
      if (parsed.ToString(Formatting.None).Length > SchemaContract.MaximumFrameChars) throw new MhpException("invalidParams", "MHP_FRAME_TOO_LARGE");
      if (ready) post(parsed.ToString(Formatting.None));
      else
      {
        if (waiting.Count >= MaximumWaitingMessages) throw new MhpException("internalError", "MHP_PANEL_QUEUE_FULL");
        waiting.Enqueue(parsed.DeepClone());
      }
    }

    public void Loaded(bool success)
    {
      ready = success;
      if (!success) { waiting.Clear(); return; }
      while (waiting.Count != 0) post(waiting.Dequeue().ToString(Formatting.None));
    }
    public void Navigating() { ready = false; }
    public void Clear() { ready = false; waiting.Clear(); }
  }
}
