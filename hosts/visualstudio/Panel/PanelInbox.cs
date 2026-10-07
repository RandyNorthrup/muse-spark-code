using System;
using System.Collections.Generic;
using System.Text;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class PanelInbox
  {
    public const int MaximumWaitingMessages = 128;
    public const int MaximumWaitingBytes = 33554432;
    private readonly Queue<string> waiting = new Queue<string>();
    private readonly Func<JToken, JToken> parse;
    private readonly Action<string> post;
    private bool ready;
    private int waitingBytes;
    public PanelInbox(Func<JToken, JToken> parse, Action<string> post) { this.parse = parse; this.post = post; }

    public void Receive(JToken message)
    {
      var parsed = parse(message);
      var json = parsed.ToString(Formatting.None);
      var bytes = Encoding.UTF8.GetByteCount(json);
      if (bytes > SchemaContract.MaximumFrameChars) throw new MhpException("invalidParams", "MHP_FRAME_TOO_LARGE");
      if (ready) post(json);
      else
      {
        if (waiting.Count >= MaximumWaitingMessages || bytes > MaximumWaitingBytes - waitingBytes) throw new MhpException("internalError", "MHP_PANEL_QUEUE_FULL");
        waiting.Enqueue(json);
        waitingBytes += bytes;
      }
    }

    public void Loaded(bool success)
    {
      ready = success;
      if (!success) { Clear(); return; }
      while (waiting.Count != 0)
      {
        var json = waiting.Dequeue();
        waitingBytes -= Encoding.UTF8.GetByteCount(json);
        post(json);
      }
    }
    public void Navigating() { ready = false; }
    public void Clear() { ready = false; waiting.Clear(); waitingBytes = 0; }
  }
}
