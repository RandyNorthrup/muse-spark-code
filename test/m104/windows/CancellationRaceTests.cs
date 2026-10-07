using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.VisualStudio.Threading;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class CancellationRaceTests
  {
    private sealed class Host : IHostServices
    {
      public IReadOnlyCollection<string> Capabilities => new[] { "lifecycle" };
      public Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation) => throw new InvalidOperationException();
    }
    private sealed class HeldCancelWriter : StringWriter
    {
      public AsyncManualResetEvent CancelStarted { get; } = new AsyncManualResetEvent();
      public AsyncManualResetEvent Release { get; } = new AsyncManualResetEvent();
      public override async Task WriteLineAsync(string value)
      {
        base.WriteLine(value);
        if (SchemaContract.ParseObject(value).Value<string>("method") != "$/cancelRequest") return;
        CancelStarted.Set(); await Release.WaitAsync().ConfigureAwait(false);
      }
    }
    private static JObject Last(StringWriter output) => SchemaContract.ParseObject(output.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Last());
    private static JObject Reply(JToken id, bool failure = false) => failure
      ? new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JObject { ["code"] = -32800, ["message"] = "MHP_CANCELLED" } }
      : new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = new JArray() };

    [DataTestMethod]
    [DataRow(false)]
    [DataRow(true)]
    [Timeout(5000)]
    public async Task ConsumesOnlyOneLateReplyWhileCancellationNotificationIsStillWriting(bool failure)
    {
      using (var output = new HeldCancelWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(), new Host(), output))
      using (var cancellation = new CancellationTokenSource())
      {
        var initialize = peer.InitializeAsync(new JObject
        {
          ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "fixture" },
          ["protocolRange"] = SchemaContract.Load().Export["range"]?.DeepClone(),
          ["capabilities"] = new JArray("lifecycle"),
          ["locale"] = "en",
          ["theme"] = new JObject { ["kind"] = "dark", ["tokens"] = new JObject() },
          ["folders"] = new JArray(),
          ["trusted"] = false
        }, CancellationToken.None);
        await peer.ReceiveAsync(new JObject { ["jsonrpc"] = "2.0", ["id"] = Last(output)["id"], ["result"] = new JObject { ["protocolVersion"] = "mhp/1.2.0", ["capabilities"] = new JArray("lifecycle", "tab") } }.ToString(Formatting.None));
        await initialize;
        var parameters = new JObject { ["uri"] = "file:///C:/fixture/a.cs", ["position"] = new JObject { ["line"] = 0, ["character"] = 0 }, ["version"] = 0, ["context"] = new JObject { ["prefix"] = "", ["suffix"] = "", ["trigger"] = "invoke" } };
        var request = peer.RequestAsync("tab/complete", parameters, cancellation.Token);
        var id = Last(output)["id"] ?? throw new InvalidOperationException();
        cancellation.Cancel(); await output.CancelStarted.WaitAsync().ConfigureAwait(false);
        var unrelated = peer.RequestAsync("tab/complete", parameters, CancellationToken.None);
        try
        {
          await peer.ReceiveAsync(Reply(id, failure).ToString(Formatting.None));
          await Assert.ThrowsExceptionAsync<MhpException>(() => peer.ReceiveAsync(Reply(id, failure).ToString(Formatting.None)));
        }
        finally { output.Release.Set(); }
        try { await request; Assert.Fail("M104_CANCELLED_REQUEST_SUCCEEDED"); }
        catch (TaskCanceledException) { }
        var otherId = Last(output)["id"] ?? throw new InvalidOperationException();
        await peer.ReceiveAsync(Reply(otherId).ToString(Formatting.None));
        Assert.AreEqual(0, ((JArray)await unrelated).Count);
        await Assert.ThrowsExceptionAsync<MhpException>(() => peer.ReceiveAsync(Reply(id).ToString(Formatting.None)));
      }
    }
  }
}
