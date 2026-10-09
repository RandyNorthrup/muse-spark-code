using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  // RVM104PD finding 3: live ids for duplicates, a bounded window for replays, no lifetime ceiling.
  [TestClass]
  public sealed class RequestIdWindowTests
  {
    private static readonly SchemaContract Contract = SchemaContract.Load();

    private sealed class Host : IHostServices
    {
      public IReadOnlyCollection<string> Capabilities { get; } = new[] { "lifecycle", "documents" };
      public int Calls;
      public Func<CancellationToken, Task>? Hold { get; set; }
      public async Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation)
      {
        Interlocked.Increment(ref Calls);
        if (Hold != null) await Hold(cancellation).ConfigureAwait(false);
        return new JArray();
      }
    }

    // Writing the replies is not under test; a sink keeps a 100,001-request session cheap.
    private sealed class LastLineWriter : TextWriter
    {
      public string Last { get; private set; } = "";
      public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;
      public override Task WriteLineAsync(string value) { Last = value; return Task.CompletedTask; }
      public override Task FlushAsync() => Task.CompletedTask;
    }

    private static Task SendAsync(MhpPeer peer, JToken id) => peer.ReceiveAsync(new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = "documents/list", ["params"] = new JObject() }.ToString(Formatting.None));
    private static string? Error(LastLineWriter output) => SchemaContract.ParseObject(output.Last)["error"]?.Value<string>("message");

    private static async Task ReadyAsync(MhpPeer peer, LastLineWriter output)
    {
      var initialization = peer.InitializeAsync(new JObject
      {
        ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "fixture" },
        ["protocolRange"] = Contract.Export["range"]?.DeepClone(),
        ["capabilities"] = new JArray("lifecycle", "documents"),
        ["locale"] = "en",
        ["theme"] = new JObject { ["kind"] = "dark", ["tokens"] = new JObject() },
        ["folders"] = new JArray(),
        ["trusted"] = false
      }, CancellationToken.None);
      var id = SchemaContract.ParseObject(output.Last)["id"];
      await peer.ReceiveAsync(new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = new JObject { ["protocolVersion"] = Contract.Version, ["capabilities"] = new JArray("lifecycle", "documents") } }.ToString(Formatting.None));
      await initialization;
    }

    [TestMethod]
    [Timeout(120000)]
    public async Task ALongSessionNeverReachesARequestIdCeiling()
    {
      var host = new Host();
      using (var output = new LastLineWriter())
      using (var peer = new MhpPeer(Contract, host, output))
      {
        await ReadyAsync(peer, output);
        // One past the former lifetime ceiling of 100,000 distinct ids.
        const int requests = 100001;
        for (var index = 0; index < requests; index++)
        {
          await SendAsync(peer, "runtime-" + index.ToString(System.Globalization.CultureInfo.InvariantCulture));
          if (Error(output) is string error) Assert.Fail(index + ": " + error);
        }
        Assert.AreEqual(requests, host.Calls);
      }
    }

    [TestMethod]
    public async Task ReplaysInsideTheWindowAreRefusedAndTheWindowStaysBounded()
    {
      var host = new Host();
      using (var output = new LastLineWriter())
      using (var peer = new MhpPeer(Contract, host, output, 4))
      {
        await ReadyAsync(peer, output);
        foreach (var id in new[] { "a", "b", "c", "d" }) await SendAsync(peer, id);
        await SendAsync(peer, "a");
        Assert.AreEqual("MHP_DUPLICATE_ID", Error(output));
        await SendAsync(peer, 1);
        await SendAsync(peer, 1.0);
        Assert.AreEqual("MHP_DUPLICATE_ID", Error(output));
        Assert.AreEqual(5, host.Calls);
        // Four newer ids push "a" out of the four-entry window: memory stays bounded, at the cost of older replays.
        foreach (var id in new[] { "e", "f", "g" }) await SendAsync(peer, id);
        await SendAsync(peer, "a");
        Assert.IsNull(Error(output));
        Assert.AreEqual(9, host.Calls);
      }
    }

    [TestMethod]
    [Timeout(10000)]
    public async Task ALiveIdIsADuplicateAndInFlightWorkIsBounded()
    {
      var release = new Microsoft.VisualStudio.Threading.AsyncManualResetEvent();
      var host = new Host();
      using (var output = new LastLineWriter())
      using (var peer = new MhpPeer(Contract, host, output, 4))
      {
        await ReadyAsync(peer, output);
        host.Hold = cancellation => release.WaitAsync();
        var limit = Contract.Export["panel"]?["limits"]?.Value<int>("maximumQueuedMessages") ?? throw new InvalidOperationException();
        var live = Enumerable.Range(0, limit).Select(index => SendAsync(peer, "live-" + index.ToString(System.Globalization.CultureInfo.InvariantCulture))).ToList();
        await SendAsync(peer, "live-0");
        Assert.AreEqual("MHP_DUPLICATE_ID", Error(output));
        await SendAsync(peer, "one-too-many");
        Assert.AreEqual("MHP_BACKPRESSURE", Error(output));
        Assert.AreEqual(limit, host.Calls);
        release.Set();
        await Task.WhenAll(live);
        await SendAsync(peer, "after");
        Assert.IsNull(Error(output));
        await SendAsync(peer, "after");
        Assert.AreEqual("MHP_DUPLICATE_ID", Error(output));
      }
    }
  }
}
