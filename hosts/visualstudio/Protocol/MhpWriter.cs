using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Protocol
{
  // One bounded FIFO for services, lifecycle and panel frames, including the active write.
  public sealed class MhpWriter
  {
    private readonly TextWriter output;
    private readonly int maximumMessages;
    private readonly int maximumBytes;
    private readonly object gate = new object();
    private readonly LinkedList<Write> queue = new LinkedList<Write>();
    private int messages;
    private int bytes;
    private bool running;
    private bool stopped;
    private sealed class Write
    {
      public string Text { get; }
      public string? Surface { get; }
      public int Bytes { get; }
      public TaskCompletionSource<bool> Completion { get; }
      public Write(string text, string? surface, TaskCompletionSource<bool> completion) { Text = text; Surface = surface; Bytes = Encoding.UTF8.GetByteCount(text); Completion = completion; }
    }

    public MhpWriter(TextWriter output, SchemaContract contract)
    {
      this.output = output;
      var limits = contract.Export["panel"]?["limits"] ?? SchemaContract.Load(true).Export["panel"]?["limits"] ?? throw new InvalidOperationException("MHP_CONTRACT_ERROR");
      maximumMessages = limits.Value<int>("maximumQueuedMessages"); maximumBytes = limits.Value<int>("maximumQueuedBytes");
    }

    public Task EnqueueAsync(JObject frame)
    {
      var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
      var item = new Write(frame.ToString(Formatting.None), frame.Value<string>("surface"), completion);
      if (item.Bytes > SchemaContract.MaximumFrameBytes) throw new MhpException("invalidParams", "MHP_PANEL_TOO_LARGE");
      lock (gate)
      {
        if (stopped) throw new MhpException("cancelled", "MHP_DISCONNECTED");
        if (messages + 1 > maximumMessages || bytes + item.Bytes > maximumBytes) throw new MhpException("internalError", "MHP_PANEL_BACKPRESSURE");
        queue.AddLast(item); messages++; bytes += item.Bytes;
        if (!running) { running = true; _ = DrainAsync(); }
      }
      return completion.Task;
    }

    public int Drop(string surface)
    {
      var dropped = 0;
      lock (gate)
      {
        var node = queue.First;
        while (node != null)
        {
          var next = node.Next;
          if (node.Value.Surface == surface)
          {
            queue.Remove(node); Release(node.Value); dropped++;
            node.Value.Completion.TrySetException(new MhpException("cancelled", "MHP_PANEL_DROPPED"));
          }
          node = next;
        }
      }
      return dropped;
    }

    private void Release(Write item) { messages--; bytes -= item.Bytes; }

    private async Task DrainAsync()
    {
      while (true)
      {
        Write item;
        lock (gate)
        {
          if (queue.First == null) { running = false; return; }
          item = queue.First.Value; queue.RemoveFirst();
        }
        try
        {
          await output.WriteLineAsync(item.Text).ConfigureAwait(false);
          await output.FlushAsync().ConfigureAwait(false);
          item.Completion.TrySetResult(true);
        }
        catch (Exception)
        {
          item.Completion.TrySetException(new MhpException("cancelled", "MHP_DISCONNECTED"));
          Stop();
        }
        finally { lock (gate) { Release(item); } }
      }
    }

    public void Stop()
    {
      lock (gate)
      {
        stopped = true;
        foreach (var item in queue) { Release(item); item.Completion.TrySetException(new MhpException("cancelled", "MHP_DISCONNECTED")); }
        queue.Clear();
      }
    }
  }
}
