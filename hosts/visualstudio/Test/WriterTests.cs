using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Threading;
using Microsoft.VisualStudio.Threading;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class WriterTests
  {
    internal sealed class BlockedWriter : StringWriter
    {
      public AsyncManualResetEvent Drain { get; } = new AsyncManualResetEvent();
      public override async Task WriteLineAsync(string value) { await Drain.WaitAsync().ConfigureAwait(false); await base.WriteLineAsync(value).ConfigureAwait(false); }
    }
    [TestMethod]
    public async Task CountsActiveWritesAndBoundsMessagesUntilDrainWithoutDuplicating()
    {
      using (var output = new BlockedWriter())
      {
        var writer = new MhpWriter(output, SchemaContract.Load(true)); var writes = new Task[128];
        try
        {
          for (var i = 0; i < writes.Length; i++) writes[i] = writer.EnqueueAsync(new JObject { ["n"] = i });
          Assert.ThrowsException<MhpException>(() => writer.EnqueueAsync(new JObject { ["n"] = 128 }));
          Assert.AreEqual("", output.ToString());
        }
        finally { output.Drain.Set(); }
        await Task.WhenAll(writes);
        var lines = output.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries); Assert.AreEqual(128, lines.Length);
        for (var i = 0; i < lines.Length; i++) Assert.AreEqual(i, SchemaContract.ParseObject(lines[i]).Value<int>("n"));
      }
    }
    [TestMethod]
    public async Task PausesUpstreamReadsAtCapacityAndReleasesReservationsOnCompletion()
    {
      using (var output = new StringWriter())
      {
        var writer = new MhpWriter(output, SchemaContract.Load(true));
        using (var first = writer.ReserveResponse())
        using (var second = writer.ReserveResponse())
        {
          var waiting = writer.WaitForCapacityAsync(CancellationToken.None);
          Assert.IsFalse(waiting.IsCompleted);
          Assert.ThrowsException<MhpException>(() => writer.ReserveResponse());
          await writer.EnqueueAsync(new JObject { ["result"] = null }, first);
          Assert.IsTrue(waiting.IsCompleted);
          await waiting;
        }
        using (var first = writer.ReserveResponse())
        using (var second = writer.ReserveResponse()) Assert.IsFalse(writer.WaitForCapacityAsync(CancellationToken.None).IsCompleted);
        Assert.IsTrue(writer.WaitForCapacityAsync(CancellationToken.None).IsCompleted);
      }
    }

    [TestMethod]
    public async Task BoundsQueuedUtf8BytesAndCountsOnlyUnwrittenSurfaceDrops()
    {
      using (var output = new BlockedWriter())
      {
        var writer = new MhpWriter(output, SchemaContract.Load(true));
        var first = writer.EnqueueAsync(new JObject { ["surface"] = "keep", ["text"] = new string('é', 8000000) });
        var second = writer.EnqueueAsync(new JObject { ["surface"] = "drop", ["text"] = new string('é', 8000000) });
        try
        {
          Assert.ThrowsException<MhpException>(() => writer.EnqueueAsync(new JObject { ["text"] = new string('é', 1000000) }));
          Assert.AreEqual(1, writer.Drop("drop"));
          Assert.IsTrue(second.IsFaulted); Assert.AreEqual("MHP_PANEL_DROPPED", second.Exception?.GetBaseException().Message);
          Assert.AreEqual(0, writer.Drop("keep"));
        }
        finally { output.Drain.Set(); }
        await first;
        Assert.AreEqual(0, writer.Drop("keep"));
        Assert.IsFalse(output.ToString().Contains("drop"));
        await writer.EnqueueAsync(new JObject { ["text"] = "resumed" });
        StringAssert.Contains(output.ToString(), "resumed");
      }
    }
  }
}
