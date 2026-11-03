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
  public sealed class PanelCarrierTests
  {
    // These tests run the real peer and the real channel on the frozen contract. The host services are never
    // asked for anything: RejectsServiceAdmission... proves the peer refuses before reaching them.
    private sealed class Host : IHostServices
    {
      public IReadOnlyCollection<string> Capabilities { get; } = new[] { "lifecycle", "documents" };
      public int Calls { get; private set; }
      public Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation) { Calls++; throw new InvalidOperationException("MHP_UNEXPECTED_SERVICE_CALL"); }
    }

    // The runtime's real answer, captured 2026-11-02 from this tree's dist/acp.js panel --stdio
    // (Windows 11, a scratch home, no credential, no model call; docs/certification/cc-m104gw.md has the probe).
    private const string RecordedInitializeAnswer = "{\"jsonrpc\":\"2.0\",\"id\":\"vs:1\",\"result\":{\"protocolVersion\":\"mhp/1.6.0\",\"capabilities\":[\"lifecycle\",\"settings\",\"storage\"]}}";

    internal static JObject InitializeParameters(string minimum = "mhp/1.6.0", string maximum = "mhp/1.7.0") => new JObject
    {
      ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "17.14" },
      ["protocolRange"] = new JObject { ["minimum"] = minimum, ["maximumExclusive"] = maximum },
      ["capabilities"] = new JArray("lifecycle", "documents"),
      ["locale"] = "en",
      ["theme"] = new JObject { ["kind"] = "dark", ["tokens"] = new JObject() },
      ["folders"] = new JArray(),
      ["trusted"] = false
    };

    private static async Task HandshakeAsync(MhpPeer peer)
    {
      var started = peer.InitializeAsync(InitializeParameters(), CancellationToken.None);
      await peer.ReceiveAsync(RecordedInitializeAnswer);
      await started;
    }

    private static JObject Envelope(string surface, long seq, string direction = "toPanel", string type = "focusInput") => new JObject
    {
      ["mhp"] = "1.6",
      ["kind"] = "panel",
      ["surface"] = surface,
      ["seq"] = seq,
      ["direction"] = direction,
      ["payload"] = new JObject { ["type"] = type }
    };
    private static JObject[] Frames(StringWriter writer) => writer.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Select(SchemaContract.ParseObject).ToArray();
    private static JObject Last(StringWriter writer) => Frames(writer).Last();
    private static Task SendAsync(MhpPeer peer, JObject frame) => peer.ReceiveAsync(frame.ToString(Formatting.None));

    private sealed class ObservedReader : TextReader
    {
      public int Reads { get; private set; }
      public Microsoft.VisualStudio.Threading.AsyncManualResetEvent End { get; } = new Microsoft.VisualStudio.Threading.AsyncManualResetEvent();
      public override async Task<int> ReadAsync(char[] buffer, int index, int count) { Reads++; await End.WaitAsync().ConfigureAwait(false); return 0; }
    }

    [TestMethod]
    public async Task PausesThePeerBeforeReadingAnotherFrameAtCapacity()
    {
      using (var output = new WriterTests.BlockedWriter())
      using (var reader = new ObservedReader())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        output.Drain.Set(); await HandshakeAsync(peer); output.Drain.Reset();
        var writes = Enumerable.Range(0, 128).Select(i => peer.PostPanelAsync(Envelope("surface", i + 1))).ToArray();
        var reading = peer.RunAsync(reader);
        try { Assert.AreEqual(0, reader.Reads); Assert.IsFalse(reading.IsCompleted); }
        finally { output.Drain.Set(); reader.End.Set(); }
        // EOF may close the peer before every queued write is dispatched.
        try { await Task.WhenAll(writes); } catch (MhpException) { }
        await reading;
        Assert.AreEqual(1, reader.Reads);
      }
    }

    [TestMethod]
    public async Task RefusesMalformedCarrierKindsAndUnboundSurfacesWithTypedFeedback()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        await HandshakeAsync(peer);
        await SendAsync(peer, Envelope("unbound", 1)); Assert.AreEqual("MHP_PANEL_UNKNOWN_SURFACE", Last(output).Value<string>("code"));
        var malformed = Envelope("unbound", 1); malformed["kind"] = new JObject();
        await SendAsync(peer, malformed); Assert.AreEqual("MHP_PANEL_INVALID_ENVELOPE", Last(output).Value<string>("code"));
        SchemaContract.Validate(Last(output), peer.Contract.Export["panel"]?["error"] ?? throw new InvalidOperationException());
        await SendAsync(peer, new JObject { ["mhp"] = "1.6", ["kind"] = "surface" });
        Assert.AreEqual("MHP_PANEL_WRONG_DIRECTION", Last(output).Value<string>("code"));
        var refusal = new JObject { ["mhp"] = "1.6", ["kind"] = "panelError", ["surface"] = null, ["seq"] = null, ["code"] = "MHP_PANEL_INVALID_ENVELOPE" };
        var before = output.ToString(); await SendAsync(peer, refusal); Assert.AreEqual(before, output.ToString());
        refusal["extra"] = true;
        await Assert.ThrowsExceptionAsync<MhpException>(() => SendAsync(peer, refusal));
      }
    }

    [TestMethod]
    public async Task OffersTheHandshakeOnlyWithinARangeHoldingTheCurrentVersion()
    {
      foreach (var range in new[] { ("mhp/1.6.0", "mhp/1.7.0"), ("mhp/1.0.0", "mhp/2.0.0") })
      {
        using (var output = new StringWriter())
        using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
        {
          var started = peer.InitializeAsync(InitializeParameters(range.Item1, range.Item2), CancellationToken.None);
          await peer.ReceiveAsync(RecordedInitializeAnswer);
          await started;
          Assert.AreEqual("mhp/1.6.0", peer.ProtocolVersion);
          await peer.PostPanelAsync(Envelope("s", 1));
        }
      }
      foreach (var range in new[] { ("mhp/1.0.0", "mhp/1.6.0"), ("mhp/1.7.0", "mhp/2.0.0"), ("mhp/1.0.0", "mhp/1.2.0") })
      {
        using (var output = new StringWriter())
        using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
        {
          var refused = await Assert.ThrowsExceptionAsync<MhpException>(() => peer.InitializeAsync(InitializeParameters(range.Item1, range.Item2), CancellationToken.None));
          Assert.AreEqual("MHP_INCOMPATIBLE_VERSION", refused.Message);
          Assert.AreEqual("", output.ToString());
          await Assert.ThrowsExceptionAsync<MhpException>(() => peer.PostPanelAsync(Envelope("s", 1)));
        }
      }
    }

    [TestMethod]
    public async Task BindsReadyReloadHiddenAndCloseToOneSession()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        await HandshakeAsync(peer);
        using (var channel = new PanelChannel(peer, "surface", "conversation", "chat"))
        {
          await channel.OpenAsync();
          Assert.AreEqual("opened", Last(output).Value<string>("event"));
          Assert.AreEqual("conversation", Last(output).Value<string>("sessionId"));
          // Nothing but the kind's own ready opens the channel for the page's messages.
          await Assert.ThrowsExceptionAsync<MhpException>(() => channel.PostAsync(new JObject { ["type"] = "focusInput" }, CancellationToken.None));
          await channel.PostAsync(new JObject { ["type"] = "ready" }, CancellationToken.None);
          var frames = Frames(output);
          Assert.AreEqual("ready", frames[frames.Length - 2].Value<string>("event"));
          Assert.AreEqual(1, Last(output).Value<int>("seq"));
          Assert.AreEqual("ready", Last(output)["payload"]?.Value<string>("type"));
          await channel.ReloadAsync();
          Assert.AreEqual("ready", Last(output)["stateRequest"]?.Value<string>("type"));
          // The reload frame carried the state request: the page's ready reopens the surface and is not sent twice.
          await channel.PostAsync(new JObject { ["type"] = "ready" }, CancellationToken.None);
          Assert.AreEqual("ready", Last(output).Value<string>("event"));
          await channel.HiddenAsync();
          Assert.AreEqual("hidden", Last(output).Value<string>("event"));
          var received = 0; channel.MessageReceived += (_, __) => received++;
          await SendAsync(peer, Envelope(channel.SurfaceId, 1)); Assert.AreEqual(1, received);
          await channel.CloseAsync();
          Assert.AreEqual("closed", Last(output).Value<string>("event"));
          Assert.AreEqual(0, Last(output).Value<int>("droppedMessages"));
          await SendAsync(peer, Envelope(channel.SurfaceId, 2));
          Assert.AreEqual("MHP_PANEL_UNKNOWN_SURFACE", Last(output).Value<string>("code"));
          Assert.AreEqual(1, received);
        }
      }
    }

    [TestMethod]
    public async Task ARefusedFrameClosesOnlyItsOwnChannelWithItsFrozenCodeBeforeDelivery()
    {
      var contract = SchemaContract.Load(true);
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(contract, new Host(), output))
      {
        await HandshakeAsync(peer);
        var bad = new (Func<string, JObject> Frame, string Code)[]
        {
          (surface => Envelope(surface, 2), "MHP_PANEL_OUT_OF_ORDER"),
          (surface => Envelope(surface, 1, "toHost", "tasksReady"), "MHP_PANEL_WRONG_DIRECTION"),
          (surface => Envelope(surface, 1), "MHP_PANEL_INVALID_PAYLOAD"),
          (surface => { var frame = Envelope(surface, 1); frame["extra"] = true; return frame; }, "MHP_PANEL_INVALID_ENVELOPE"),
        };
        for (var i = 0; i < bad.Length; i++)
        {
          using (var neighbour = new PanelChannel(peer, "neighbour-" + i, "session", "chat"))
          using (var channel = new PanelChannel(peer, "surface-" + i, "session", "tasks"))
          {
            await channel.OpenAsync(); await channel.PostAsync(new JObject { ["type"] = "tasksReady" }, CancellationToken.None);
            await neighbour.OpenAsync(); await neighbour.PostAsync(new JObject { ["type"] = "ready" }, CancellationToken.None);
            var received = 0; channel.MessageReceived += (_, __) => received++;
            await SendAsync(peer, bad[i].Frame(channel.SurfaceId));
            var frames = Frames(output);
            Assert.AreEqual(bad[i].Code, frames[frames.Length - 2].Value<string>("code"), bad[i].Code);
            Assert.AreEqual("closed", frames.Last().Value<string>("event"));
            Assert.AreEqual(bad[i].Code, channel.FaultCode);
            Assert.AreEqual(0, received);
            Assert.IsNull(neighbour.FaultCode);
            var delivered = 0; neighbour.MessageReceived += (_, __) => delivered++;
            await SendAsync(peer, Envelope(neighbour.SurfaceId, 1));
            Assert.AreEqual(1, delivered);
          }
        }
      }
    }

    [TestMethod]
    public async Task ClosingCountsExactlyThePendingSurfaceFrames()
    {
      using (var output = new WriterTests.BlockedWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        output.Drain.Set(); await HandshakeAsync(peer);
        using (var channel = new PanelChannel(peer, "surface", "session", "chat"))
        {
          await channel.OpenAsync(); output.Drain.Reset();
          var first = peer.PostPanelAsync(Envelope(channel.SurfaceId, 1));
          var second = peer.PostPanelAsync(Envelope(channel.SurfaceId, 2));
          var third = peer.PostPanelAsync(Envelope(channel.SurfaceId, 3));
          var closing = channel.CloseAsync(); output.Drain.Set();
          await first; await closing;
          Assert.IsTrue(second.IsFaulted && third.IsFaulted);
          Assert.AreEqual("MHP_PANEL_DROPPED", second.Exception?.GetBaseException().Message);
          Assert.AreEqual("MHP_PANEL_DROPPED", third.Exception?.GetBaseException().Message);
          Assert.AreEqual(2, Last(output).Value<int>("droppedMessages"));
        }
      }
    }

    [TestMethod]
    public async Task ThePageSpeaksOnlyTheFrozenVocabularyOfItsSurface()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        await HandshakeAsync(peer);
        using (var channel = new PanelChannel(peer, "surface", "session", "chat"))
        {
          Assert.AreEqual("ready", channel.ParseWebviewMessage("{\"type\":\"ready\"}").Value<string>("type"));
          foreach (var invalid in new[] { "{\"bridge\":\"subscribed\"}", "{\"type\":\"tasksReady\"}", "{\"type\":\"ready\",\"extra\":true}", "[]" }) Assert.ThrowsException<MhpException>(() => channel.ParseWebviewMessage(invalid));
          Assert.AreEqual("focusInput", channel.ParseRuntimeMessage(new JObject { ["type"] = "focusInput" }).Value<string>("type"));
          Assert.ThrowsException<MhpException>(() => channel.ParseRuntimeMessage(new JObject { ["type"] = "ready" }));
        }
      }
    }

    [TestMethod]
    public async Task ServesTheRuntimesRequestsOnWhatThisHostOfferedNotOnWhatTheRuntimeOffersBack()
    {
      using (var output = new StringWriter())
      {
        var host = new Host();
        using (var peer = new MhpPeer(SchemaContract.Load(true), host, output))
        {
          await HandshakeAsync(peer);
          // The runtime's answer names lifecycle, settings and storage; this host offered documents and reaches it.
          await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = "runtime-1", ["method"] = "documents/list", ["params"] = new JObject() });
          Assert.AreEqual(1, host.Calls);
          Assert.AreEqual("MHP_HOST_FAILED", Last(output)["error"]?.Value<string>("message"));
          // Not offered: refused by name, and the host is never asked.
          await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = "runtime-2", ["method"] = "ui/notify", ["params"] = new JObject { ["severity"] = "error", ["message"] = "fixture" } });
          Assert.AreEqual(1, host.Calls);
          Assert.AreEqual("MHP_UNSUPPORTED_CAPABILITY", Last(output)["error"]?.Value<string>("message"));
        }
      }
    }

    [TestMethod]
    public async Task AdmitsTheThemeFrameOnEverySurfaceKindAndRefusesAMalformedOne()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        await HandshakeAsync(peer);
        // The runtime's real first frame, captured with the handshake above.
        var theme = JObject.Parse("{\"type\":\"theme\",\"theme\":{\"kind\":\"dark\",\"tokens\":{}}}");
        foreach (var kind in new[] { "chat", "tasks" })
          using (var channel = new PanelChannel(peer, "surface-" + kind, "session", kind))
          {
            Assert.AreEqual("theme", channel.ParseRuntimeMessage(theme).Value<string>("type"));
            Assert.ThrowsException<MhpException>(() => channel.ParseRuntimeMessage(JObject.Parse("{\"type\":\"theme\",\"theme\":{}}")));
          }
      }
    }

    [TestMethod]
    public async Task AdmitsTheRuntimesFirstFramesWhileItsReadyIsStillBeingWritten()
    {
      using (var output = new WriterTests.BlockedWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        output.Drain.Set(); await HandshakeAsync(peer);
        using (var channel = new PanelChannel(peer, "surface", "session", "chat"))
        {
          await channel.OpenAsync();
          var received = 0; channel.MessageReceived += (_, __) => received++;
          output.Drain.Reset();
          // The real page's ready: the runtime answers it before this write returns here.
          var posting = channel.PostAsync(new JObject { ["type"] = "ready" }, CancellationToken.None);
          var answering = SendAsync(peer, Envelope(channel.SurfaceId, 1));
          // Read before the writer drains: a refusal here queues its own error frame behind the blocked write.
          try
          {
            Assert.AreEqual(1, received);
            Assert.IsNull(channel.FaultCode);
          }
          finally { output.Drain.Set(); }
          await answering;
          await posting;
        }
      }
    }

    [TestMethod]
    public void ExportAllowsAnyAbsoluteExternalUriAndRefusesARelativeOne()
    {
      var contract = SchemaContract.Load(true);
      foreach (var uri in new[] { "https://example.com/", "file:///C:/private", "javascript:alert(1)", "mailto:person@example.com" })
        contract.ValidateCall("ui/openExternal", new JObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = "ui/openExternal", ["params"] = new JObject { ["uri"] = uri } });
      Assert.ThrowsException<MhpException>(() => SchemaContract.Validate(new JValue("relative/path"), contract.Method("ui/openExternal")["call"]?["properties"]?["params"]?["properties"]?["uri"] ?? throw new InvalidOperationException()));
    }

    [TestMethod]
    public async Task RejectsServiceAdmissionBeforeEditorSideEffectsWhileTheWriterIsFull()
    {
      using (var output = new WriterTests.BlockedWriter())
      {
        var host = new Host();
        using (var peer = new MhpPeer(SchemaContract.Load(true), host, output))
        {
          output.Drain.Set(); await HandshakeAsync(peer); output.Drain.Reset();
          var large = Envelope("surface", 1, "toHost");
          large["payload"] = new JObject { ["type"] = "sendMessage", ["localId"] = "fixture", ["text"] = new string('é', 7000000), ["attachmentIds"] = new JArray() };
          var first = peer.PostPanelAsync(large); var second = peer.PostPanelAsync(large);
          var request = SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = 2, ["method"] = "documents/list", ["params"] = new JObject() });
          output.Drain.Set(); await first; await second; await request;
          Assert.AreEqual(0, host.Calls);
          Assert.AreEqual("MHP_PANEL_BACKPRESSURE", Last(output)["error"]?.Value<string>("message"));
        }
      }
    }

    [TestMethod]
    public void ValidatesTheCompleteExportedPanelEnvelopeAndLifecycleUnions()
    {
      var contract = SchemaContract.Load(true);
      foreach (var invalid in new[] { "{}", "{\"mhp\":\"1.1\",\"kind\":\"panel\",\"surface\":\"s\",\"direction\":\"toPanel\",\"seq\":1,\"payload\":{\"type\":\"focusInput\"},\"extra\":true}" })
        Assert.ThrowsException<MhpException>(() => SchemaContract.Validate(JObject.Parse(invalid), contract.Export["panel"]?["envelope"] ?? throw new InvalidOperationException()));
      Assert.ThrowsException<MhpException>(() => SchemaContract.Validate(new JObject(), contract.Export["panel"]?["lifecycle"] ?? throw new InvalidOperationException()));
    }

    [TestMethod]
    public async Task EnforcesUtf8RawLineCapsIncludingUnknownFieldsBeforeParsing()
    {
      var exact = new string('é', SchemaContract.MaximumFrameBytes / 2);
      Assert.AreEqual(exact, await MhpPeer.ReadFrameAsync(new StringReader(exact + "\r\n")));
      await Assert.ThrowsExceptionAsync<MhpException>(() => MhpPeer.ReadFrameAsync(new StringReader(exact + "x\n")));
      Assert.ThrowsException<MhpException>(() => SchemaContract.ParseObject("{\"unknown\":\"" + exact + "\"}"));
      SchemaContract.Validate(new JObject { ["nested"] = new JArray(1, new JObject { ["ok"] = true }) }, SchemaContract.Load(true).Export["embeddedBridge"]?["setState"]?["state"] ?? throw new InvalidOperationException());
      Assert.ThrowsException<MhpException>(() => SchemaContract.Validate(new JObject { ["nested"] = new JArray(1, new JValue(DateTime.UtcNow)) }, SchemaContract.Load(true).Export["embeddedBridge"]?["setState"]?["state"] ?? throw new InvalidOperationException()));
    }
  }
}
