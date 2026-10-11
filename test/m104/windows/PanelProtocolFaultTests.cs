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
  // RVM104PD finding 1: frozen type arrays, unexpected validator failures and per-frame panel faults.
  [TestClass]
  public sealed class PanelProtocolFaultTests
  {
    private static readonly SchemaContract Contract = SchemaContract.Load();

    private sealed class Host : IHostServices
    {
      public Host(params string[] capabilities) { Capabilities = capabilities; }
      public IReadOnlyCollection<string> Capabilities { get; }
      public Func<string, JObject, JToken> Answer { get; set; } = (method, parameters) => JValue.CreateNull();
      public Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation) => Task.FromResult(Answer(method, parameters));
    }

    private static List<JObject> Frames(StringWriter output) => output.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Select(SchemaContract.ParseObject).ToList();
    private static JObject Last(StringWriter output) => Frames(output).Last();
    private static Task SendAsync(MhpPeer peer, JObject frame) => peer.ReceiveAsync(frame.ToString(Formatting.None));

    internal static async Task ReadyAsync(MhpPeer peer, StringWriter output, params string[] capabilities)
    {
      var initialization = peer.InitializeAsync(new JObject
      {
        ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "fixture" },
        ["protocolRange"] = Contract.Export["range"]?.DeepClone(),
        ["capabilities"] = new JArray(capabilities),
        ["locale"] = "en",
        ["theme"] = new JObject { ["kind"] = "dark", ["tokens"] = new JObject() },
        ["folders"] = new JArray(),
        ["trusted"] = false
      }, CancellationToken.None);
      await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = Last(output)["id"], ["result"] = new JObject { ["protocolVersion"] = Contract.Version, ["capabilities"] = new JArray(capabilities) } });
      await initialization;
    }

    private static JObject Elicitation(JToken value, string type = "string") => new JObject
    {
      ["type"] = "agentEvent",
      ["event"] = new JObject
      {
        ["type"] = "elicitationRequested",
        ["elicitationId"] = "fixture",
        ["server"] = "fixture-server",
        ["message"] = "Choose",
        ["fields"] = new JArray(new JObject { ["name"] = "choice", ["type"] = type, ["required"] = false, ["default"] = value })
      }
    };

    private static JObject Notice() => new JObject { ["type"] = "notice", ["level"] = "warning", ["text"] = "fixture" };

    private static JObject Envelope(string surface, long seq, JToken payload, string direction = "toPanel") => new JObject
    {
      ["mhp"] = "1.5",
      ["kind"] = "panel",
      ["surface"] = surface,
      ["direction"] = direction,
      ["seq"] = seq,
      ["payload"] = payload
    };

    private static async Task<PanelChannel> ReadyChannelAsync(MhpPeer peer, string surface, string kind = "chat")
    {
      var channel = new PanelChannel(peer, Contract, surface, "session", kind);
      await channel.OpenAsync();
      await channel.PostAsync(new JObject { ["type"] = kind == "tasks" ? "tasksReady" : "ready" }, CancellationToken.None);
      return channel;
    }

    [TestMethod]
    public void FrozenTypeArraysAcceptEveryNamedTypeAndRefuseOthers()
    {
      foreach (var (value, type) in new (JToken, string)[] { ("text", "string"), (3, "number"), (2.5, "number"), (true, "boolean") })
        Contract.ValidatePayload(Elicitation(value, type), "toPanel", "chat");
      foreach (var value in new JToken[] { new JObject(), new JArray(), JValue.CreateNull() })
        Assert.ThrowsException<MhpException>(() => Contract.ValidatePayload(Elicitation(value), "toPanel", "chat"));
      foreach (var result in new JToken[] { "typed", JValue.CreateNull() })
        Contract.ValidateResult("ui/input", new JObject { ["jsonrpc"] = "2.0", ["id"] = 7, ["result"] = result });
      Assert.ThrowsException<MhpException>(() => Contract.ValidateResult("ui/input", new JObject { ["jsonrpc"] = "2.0", ["id"] = 7, ["result"] = 5 }));
    }

    [TestMethod]
    public void UnexpectedKeywordShapesRefuseOnlyTheirOwnAlternative()
    {
      var unreadable = new JObject { ["$ref"] = new JArray() };
      SchemaContract.Validate("x", new JObject { ["anyOf"] = new JArray(unreadable, new JObject { ["type"] = "string" }) });
      SchemaContract.Validate("x", new JObject { ["oneOf"] = new JArray(new JObject { ["minLength"] = "many" }, new JObject { ["type"] = "string" }) });
      foreach (var schema in new[] { unreadable, new JObject { ["type"] = new JArray() }, new JObject { ["type"] = new JArray("string", "string") }, new JObject { ["type"] = 5 }, new JObject { ["minLength"] = "many" } })
        Assert.ThrowsException<MhpException>(() => SchemaContract.Validate("x", schema), schema.ToString(Formatting.None));
    }

    // RVF104PD finding 3: a malformed type array refuses its alternative whatever the member order.
    [TestMethod]
    public void UnknownTypeNamesRefuseTheirAlternativeInAnyOrder()
    {
      foreach (var names in new[] { new JArray("string", "bogus"), new JArray("bogus", "string") })
      {
        Assert.ThrowsException<MhpException>(() => SchemaContract.Validate("x", new JObject { ["type"] = names }), names.ToString(Formatting.None));
        // Under oneOf only the well-formed alternative may match.
        SchemaContract.Validate("x", new JObject { ["oneOf"] = new JArray(new JObject { ["type"] = names.DeepClone() }, new JObject { ["type"] = "string" }) });
      }
    }

    private sealed class HeldWriter : StringWriter
    {
      public Microsoft.VisualStudio.Threading.AsyncManualResetEvent Release { get; } = new Microsoft.VisualStudio.Threading.AsyncManualResetEvent();
      public bool Holding { get; set; }
      public override async Task WriteLineAsync(string value)
      {
        if (Holding) await Release.WaitAsync().ConfigureAwait(false);
        WriteLine(value);
      }
    }

    // RVF104PD finding 1: the channel is failed before its error frame waits for the writer.
    [TestMethod]
    [Timeout(10000)]
    public async Task AFaultStopsDeliveryBeforeItsErrorIsWritten()
    {
      using (var output = new HeldWriter())
      using (var peer = new MhpPeer(Contract, new Host("lifecycle"), output))
      {
        await ReadyAsync(peer, output, "lifecycle");
        using (var channel = await ReadyChannelAsync(peer, "chat"))
        {
          var delivered = 0; channel.MessageReceived += (sender, payload) => delivered++;
          await SendAsync(peer, Envelope("chat", 1, Notice()));
          output.Holding = true;
          // Overlapping receive tasks, as RunAsync starts them: neither is awaited before the next begins.
          var duplicate = SendAsync(peer, Envelope("chat", 1, Notice()));
          var next = SendAsync(peer, Envelope("chat", 2, Notice()));
          Assert.IsFalse(duplicate.IsCompleted, "the error write must still be held");
          Assert.AreEqual("MHP_PANEL_OUT_OF_ORDER", channel.FaultCode);
          Assert.AreEqual(1, delivered);
          Assert.AreEqual(1L, channel.LastReceivedSequence);
          var refused = await Assert.ThrowsExceptionAsync<MhpException>(() => channel.PostAsync(new JObject { ["type"] = "ready" }, CancellationToken.None));
          Assert.AreEqual("MHP_SURFACE_CLOSED", refused.Message);
          output.Release.Set();
          await Task.WhenAll(duplicate, next);
          var sent = Frames(output);
          Assert.IsTrue(sent.Any(f => f.Value<string>("code") == "MHP_PANEL_OUT_OF_ORDER" && f.Value<long>("seq") == 1));
          Assert.IsTrue(sent.Any(f => f.Value<string>("code") == "MHP_PANEL_UNKNOWN_SURFACE" && f.Value<long>("seq") == 2));
          Assert.AreEqual(1, sent.Count(f => f.Value<string>("event") == "closed"));
          Assert.AreEqual(1, delivered);
        }
      }
    }

    // RVF104PD finding 2: a sequence Json.NET cannot hold as Int64 (or a fraction) is never cast.
    [DataTestMethod]
    [DataRow("9223372036854775808")]
    [DataRow("-99999999999999999999")]
    [DataRow("1.5")]
    public async Task UnrepresentableSequencesCloseTheChannelAndKeepTheLoopHealthy(string sequence)
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new Host("lifecycle"), output))
      {
        var log = new List<string>(); peer.Log = log.Add;
        await ReadyAsync(peer, output, "lifecycle");
        using (var channel = await ReadyChannelAsync(peer, "chat"))
        {
          var delivered = 0; channel.MessageReceived += (sender, payload) => delivered++;
          var before = Frames(output).Count;
          var malformed = "{\"mhp\":\"1.5\",\"kind\":\"panel\",\"surface\":\"chat\",\"direction\":\"toPanel\",\"seq\":" + sequence + ",\"payload\":" + Notice().ToString(Formatting.None) + "}";
          // RunAsync rethrows any faulted receive task when its input ends: completing is the health check.
          await peer.RunAsync(new StringReader(malformed + "\n" + Envelope("chat", 1, Notice()).ToString(Formatting.None) + "\n"));
          Assert.AreEqual("MHP_PANEL_INVALID_ENVELOPE", channel.FaultCode);
          Assert.AreEqual(0, delivered);
          CollectionAssert.DoesNotContain(log, "MHP_PANEL_DELIVERY_FAILED");
          var sent = Frames(output).Skip(before).ToList();
          Assert.AreEqual(3, sent.Count);
          Assert.AreEqual("MHP_PANEL_INVALID_ENVELOPE", sent[0].Value<string>("code"));
          Assert.AreEqual(JTokenType.Null, sent[0]["seq"]?.Type);
          Assert.AreEqual("closed", sent[1].Value<string>("event"));
          Assert.AreEqual("MHP_PANEL_UNKNOWN_SURFACE", sent[2].Value<string>("code"));
        }
      }
    }

    [TestMethod]
    public async Task HostAnswersUiInputWithAStringOrNull()
    {
      var answers = new Queue<JToken>(new JToken[] { "typed", JValue.CreateNull(), 5 });
      var host = new Host("lifecycle", "ui") { Answer = (method, parameters) => answers.Dequeue() };
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, host, output))
      {
        await ReadyAsync(peer, output, "lifecycle", "ui");
        for (var id = 7; id <= 9; id++)
          await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = "ui/input", ["params"] = new JObject { ["title"] = "Title", ["prompt"] = "Prompt" } });
        var replies = Frames(output).Skip(1).ToList();
        Assert.AreEqual("typed", replies[0].Value<string>("result"));
        Assert.AreEqual(JTokenType.Null, replies[1]["result"]?.Type);
        Assert.AreEqual("MHP_INVALID_PARAMS", replies[2]["error"]?.Value<string>("message"));
      }
    }

    [TestMethod]
    public async Task ChatChannelDeliversFrozenElicitationDefaults()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new Host("lifecycle"), output))
      {
        var log = new List<string>(); peer.Log = log.Add;
        await ReadyAsync(peer, output, "lifecycle");
        using (var channel = await ReadyChannelAsync(peer, "chat"))
        {
          var delivered = new List<JToken>(); channel.MessageReceived += (sender, payload) => delivered.Add(payload);
          var defaults = new (JToken, string)[] { ("text", "string"), (3, "number"), (true, "boolean") };
          for (var index = 0; index < defaults.Length; index++)
            await SendAsync(peer, Envelope("chat", index + 1, Elicitation(defaults[index].Item1, defaults[index].Item2)));
          Assert.AreEqual(3, delivered.Count);
          Assert.IsNull(channel.FaultCode);
          CollectionAssert.AreEqual(Array.Empty<string>(), log);
        }
      }
    }

    [TestMethod]
    public async Task AnInvalidFrameClosesOnlyItsChannelAndTheLoopKeepsReading()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new Host("lifecycle"), output))
      {
        var log = new List<string>(); peer.Log = log.Add;
        await ReadyAsync(peer, output, "lifecycle");
        using (var broken = await ReadyChannelAsync(peer, "chat-a"))
        using (var healthy = await ReadyChannelAsync(peer, "chat-b"))
        {
          var faults = new List<string>(); broken.Faulted += (sender, code) => faults.Add(code);
          var delivered = 0; broken.MessageReceived += (sender, payload) => delivered++; healthy.MessageReceived += (sender, payload) => delivered++;
          var before = Frames(output).Count;
          await SendAsync(peer, Envelope("chat-a", 1, Elicitation(new JObject { ["nested"] = true })));
          var sent = Frames(output).Skip(before).ToList();
          Assert.AreEqual(2, sent.Count);
          Assert.AreEqual("panelError", sent[0].Value<string>("kind"));
          Assert.AreEqual("chat-a", sent[0].Value<string>("surface"));
          Assert.AreEqual(1L, sent[0].Value<long>("seq"));
          Assert.AreEqual("MHP_PANEL_INVALID_PAYLOAD", sent[0].Value<string>("code"));
          Assert.AreEqual("closed", sent[1].Value<string>("event"));
          CollectionAssert.AreEqual(new[] { "MHP_PANEL_INVALID_PAYLOAD" }, faults);
          CollectionAssert.Contains(log, "MHP_PANEL_INVALID_PAYLOAD");
          await SendAsync(peer, Envelope("chat-b", 1, Notice()));
          await SendAsync(peer, Envelope("chat-a", 1, Notice()));
          Assert.AreEqual("MHP_PANEL_UNKNOWN_SURFACE", Last(output).Value<string>("code"));
          Assert.AreEqual(1, delivered);
          var refused = await Assert.ThrowsExceptionAsync<MhpException>(() => broken.PostAsync(new JObject { ["type"] = "ready" }, CancellationToken.None));
          Assert.AreEqual("MHP_SURFACE_CLOSED", refused.Message);
        }
      }
    }

    [DataTestMethod]
    [DataRow("before-ready", "MHP_PANEL_NOT_READY")]
    [DataRow("gap", "MHP_PANEL_OUT_OF_ORDER")]
    [DataRow("duplicate", "MHP_PANEL_OUT_OF_ORDER")]
    [DataRow("direction", "MHP_PANEL_WRONG_DIRECTION")]
    [DataRow("cross-surface", "MHP_PANEL_INVALID_PAYLOAD")]
    [DataRow("envelope", "MHP_PANEL_INVALID_ENVELOPE")]
    [DataRow("lifecycle", "MHP_PANEL_INVALID_LIFECYCLE")]
    [DataRow("runtime-refusal", "MHP_PANEL_BACKPRESSURE")]
    public async Task EachProtocolViolationClosesTheChannelWithItsNamedCode(string violation, string code)
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new Host("lifecycle"), output))
      {
        var log = new List<string>(); peer.Log = log.Add;
        await ReadyAsync(peer, output, "lifecycle");
        var kind = violation == "cross-surface" ? "tasks" : "chat";
        PanelChannel channel;
        if (violation == "before-ready") { channel = new PanelChannel(peer, Contract, "surface", "session", kind); await channel.OpenAsync(); }
        else channel = await ReadyChannelAsync(peer, "surface", kind);
        using (channel)
        {
          var delivered = 0; channel.MessageReceived += (sender, payload) => delivered++;
          if (violation == "duplicate") await SendAsync(peer, Envelope("surface", 1, Notice()));
          var before = Frames(output).Count;
          switch (violation)
          {
            case "gap": await SendAsync(peer, Envelope("surface", 2, Notice())); break;
            case "direction": await SendAsync(peer, Envelope("surface", 1, new JObject { ["type"] = "ready" }, "toHost")); break;
            case "envelope": var stale = Envelope("surface", 1, Notice()); stale["mhp"] = "1.2"; await SendAsync(peer, stale); break;
            case "lifecycle": await SendAsync(peer, new JObject { ["mhp"] = "1.5", ["kind"] = "surface", ["surface"] = "surface", ["sessionId"] = "session", ["surfaceKind"] = kind, ["event"] = "opened" }); break;
            case "runtime-refusal": await SendAsync(peer, new JObject { ["mhp"] = "1.5", ["kind"] = "panelError", ["surface"] = "surface", ["seq"] = 3, ["code"] = code }); break;
            default: await SendAsync(peer, Envelope("surface", 1, Notice())); break;
          }
          var sent = Frames(output).Skip(before).ToList();
          Assert.AreEqual(code, channel.FaultCode);
          CollectionAssert.Contains(log, code);
          Assert.AreEqual(violation == "duplicate" ? 1 : 0, delivered);
          // The runtime's own refusal is never echoed back; every local refusal is reported before the close.
          if (violation != "runtime-refusal") { Assert.AreEqual("panelError", sent[0].Value<string>("kind")); Assert.AreEqual(code, sent[0].Value<string>("code")); }
          Assert.AreEqual("closed", sent.Last().Value<string>("event"));
          Assert.AreEqual(violation == "runtime-refusal" ? 1 : 2, sent.Count);
          await SendAsync(peer, Envelope("surface", violation == "duplicate" ? 2 : 1, Notice()));
          Assert.AreEqual("MHP_PANEL_UNKNOWN_SURFACE", Last(output).Value<string>("code"));
          Assert.AreEqual(violation == "duplicate" ? 1 : 0, delivered);
        }
      }
    }

    [TestMethod]
    public async Task PanelFramesWithoutANegotiatedSessionAreLoggedNotThrown()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new Host("lifecycle"), output))
      {
        var log = new List<string>(); peer.Log = log.Add;
        await SendAsync(peer, Envelope("surface", 1, Notice()));
        await SendAsync(peer, Envelope("nobody", 1, Notice()));
        CollectionAssert.AreEqual(new[] { "MHP_NOT_READY", "MHP_NOT_READY" }, log);
        Assert.AreEqual("", output.ToString());
        await ReadyAsync(peer, output, "lifecycle");
        await SendAsync(peer, Envelope("nobody", 4, Notice()));
        var error = Last(output);
        Contract.ValidatePanel(error, "error");
        Assert.AreEqual("nobody", error.Value<string>("surface"));
        Assert.AreEqual(4L, error.Value<long>("seq"));
        Assert.AreEqual("MHP_PANEL_UNKNOWN_SURFACE", error.Value<string>("code"));
      }
    }

    [TestMethod]
    public async Task ASecondChannelCannotBindALiveSurface()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new Host("lifecycle"), output))
      {
        await ReadyAsync(peer, output, "lifecycle");
        using (var first = new PanelChannel(peer, Contract, "surface", "session", "chat"))
        {
          Assert.ThrowsException<MhpException>(() => new PanelChannel(peer, Contract, "surface", "session", "chat"));
          first.Dispose();
          using (new PanelChannel(peer, Contract, "surface", "session", "chat")) { }
        }
      }
    }
  }
}
