using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Panel;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class PanelChannelTests
  {
    [TestMethod]
    public async Task PresentationRelayUsesItsOwnReadyReloadAndPayloadVocabulary()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(), new Host(), output))
      {
        await ReadyAsync(peer, output);
        foreach (var kind in new[] { "plans", "manager", "roles", "traffic", "diff", "walkthrough" })
          using (var channel = new PanelChannel(peer, SchemaContract.Load(), "surface", "session", kind))
          {
            Assert.ThrowsException<MhpException>(() => channel.ParseWebviewMessage("{\"type\":\"ready\"}"));
            Assert.ThrowsException<MhpException>(() => channel.ParseRuntimeMessage(new JObject { ["type"] = "notice", ["level"] = "warning", ["text"] = "fixture" }));
            await channel.OpenAsync();
            await channel.PostAsync(channel.ParseWebviewMessage("{\"type\":\"presentationReady\"}"), CancellationToken.None);
            Assert.AreEqual("1.5", Last(output).Value<string>("mhp"));
            await channel.ReloadAsync();
            Assert.AreEqual("presentationReady", Last(output)["stateRequest"]?.Value<string>("type"));
            SchemaContract.Load().ValidatePanel(Last(output), "lifecycle");
          }
        using (var chat = new PanelChannel(peer, SchemaContract.Load(), "chat", "session", "chat"))
          Assert.ThrowsException<MhpException>(() => chat.ParseWebviewMessage("{\"type\":\"presentationReady\"}"));
      }
    }

    [TestMethod]
    public void RefusesReplacedPanelWireVersionBeforeDelivery()
    {
      var frame = Envelope(1); frame["mhp"] = "1.2";
      Assert.ThrowsException<MhpException>(() => SchemaContract.Load().ValidatePanel(frame, "envelope"));
    }

    [TestMethod]
    public void FrozenPanelDiscriminatorsRejectUnknownChatVariants()
    {
      var contract = SchemaContract.Load();
      Assert.ThrowsException<MhpException>(() => contract.ValidatePayload(new JObject { ["type"] = "invented" }, "toHost", "chat"));
      var invalid = Envelope(1); invalid["payload"] = new JObject { ["type"] = "invented" };
      Assert.ThrowsException<MhpException>(() => contract.ValidatePanel(invalid, "envelope"));
    }
    private sealed class Host : IHostServices
    {
      public IReadOnlyCollection<string> Capabilities => new[] { "lifecycle" };
      public Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation) => throw new InvalidOperationException();
    }
    private static JObject Last(StringWriter output) => SchemaContract.ParseObject(output.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Last());
    private static async Task ReadyAsync(MhpPeer peer, StringWriter output)
    {
      var initialization = peer.InitializeAsync(new JObject
      {
        ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "17.14" },
        ["protocolRange"] = SchemaContract.Load().Export["range"]?.DeepClone(),
        ["capabilities"] = new JArray("lifecycle"),
        ["locale"] = "de",
        ["theme"] = new JObject { ["kind"] = "highContrastDark", ["tokens"] = new JObject { ["--muse-bg"] = "#000000" } },
        ["folders"] = new JArray(new JObject { ["uri"] = "file:///C:/repo/", ["name"] = "repo" }),
        ["trusted"] = false
      }, CancellationToken.None);
      var result = new JObject { ["jsonrpc"] = "2.0", ["id"] = Last(output)["id"], ["result"] = new JObject { ["protocolVersion"] = "mhp/1.5.0", ["capabilities"] = new JArray("lifecycle", "settings", "storage") } };
      await peer.ReceiveAsync(result.ToString(Formatting.None));
      await initialization;
    }
    private static JObject Envelope(long sequence, string surface = "surface", string direction = "toPanel") => new JObject
    {
      ["mhp"] = "1.5",
      ["kind"] = "panel",
      ["surface"] = surface,
      ["direction"] = direction,
      ["seq"] = sequence,
      ["payload"] = new JObject { ["type"] = "notice", ["level"] = "warning", ["text"] = "fixture" }
    };

    [TestMethod]
    public async Task RelaysValidatedPayloadsWithImmutableBindingAndIndependentSequences()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(), new Host(), output))
      {
        await ReadyAsync(peer, output);
        using (var channel = new PanelChannel(peer, SchemaContract.Load(), "surface", "session", "chat"))
        {
          await channel.OpenAsync();
          Assert.AreEqual("opened", Last(output).Value<string>("event"));
          await channel.PostAsync(channel.ParseWebviewMessage("{\"type\":\"ready\"}"), CancellationToken.None);
          Assert.AreEqual(1L, Last(output).Value<long>("seq"));
          JToken? delivered = null;
          channel.MessageReceived += (sender, payload) => delivered = payload;
          await peer.ReceiveAsync(Envelope(1).ToString(Formatting.None));
          Assert.AreEqual("fixture", delivered?.Value<string>("text"));
          await channel.ReloadAsync();
          // A runtime response dispatched before reload can arrive before the new page's ready.
          await peer.ReceiveAsync(Envelope(2).ToString(Formatting.None));
          await channel.PostAsync(channel.ParseWebviewMessage("{\"type\":\"ready\"}"), CancellationToken.None);
          Assert.AreEqual(2L, Last(output).Value<long>("seq"));
          await peer.ReceiveAsync(Envelope(3).ToString(Formatting.None));
          await channel.CloseAsync();
          await Assert.ThrowsExceptionAsync<MhpException>(() => channel.ReloadAsync());
          Assert.AreEqual("closed", Last(output).Value<string>("event"));
          await Assert.ThrowsExceptionAsync<MhpException>(() => channel.PostAsync(new JObject { ["type"] = "ready" }, CancellationToken.None));
        }
      }
    }

    // Out-of-order, wrong-direction, unready and unknown-surface frames: PanelProtocolFaultTests (each closes its channel).

    [TestMethod]
    public async Task RejectsCrossSurfacePayloadsMalformedJsonAndCancelledPosts()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(), new Host(), output))
      using (var cancellation = new CancellationTokenSource())
      {
        await ReadyAsync(peer, output);
        using (var channel = new PanelChannel(peer, SchemaContract.Load(), "tasks", "session", "tasks"))
        {
          Assert.ThrowsException<MhpException>(() => channel.ParseWebviewMessage("{\"type\":\"ready\"}"));
          Assert.ThrowsException<MhpException>(() => channel.ParseWebviewMessage("{\"type\":\"invented\"}"));
          Assert.ThrowsException<MhpException>(() => channel.ParseRuntimeMessage(Envelope(1)["payload"]!));
          Assert.ThrowsException<JsonReaderException>(() => channel.ParseWebviewMessage("{\"type\":\"tasksReady\",\"type\":\"tasksReady\"}"));
          cancellation.Cancel();
          var before = output.ToString();
          await Assert.ThrowsExceptionAsync<TaskCanceledException>(() => channel.PostAsync(new JObject { ["type"] = "tasksReady" }, cancellation.Token));
          Assert.AreEqual(before, output.ToString());
          await channel.OpenAsync();
          await channel.PostAsync(new JObject { ["type"] = "tasksReady" }, CancellationToken.None);
          Assert.AreEqual("tasksReady", Last(output)["payload"]?.Value<string>("type"));
        }
      }
    }
  }
}
