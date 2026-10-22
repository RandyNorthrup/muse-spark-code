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
    private sealed class Host : IHostServices
    {
      public IReadOnlyCollection<string> Capabilities { get; } = new[] { "lifecycle", "documents" };
      public int Calls { get; private set; }
      public Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation) { Calls++; return Task.FromResult<JToken>(new JArray()); }
    }
    internal static JObject Initialize(string minimum = "mhp/1.5.0", string maximum = "mhp/1.6.0") => new JObject
    {
      ["jsonrpc"] = "2.0",
      ["id"] = "init",
      ["method"] = "initialize",
      ["params"] = new JObject
      {
        ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "17.14" },
        ["protocolRange"] = new JObject { ["minimum"] = minimum, ["maximumExclusive"] = maximum },
        ["capabilities"] = new JArray("lifecycle", "documents"),
        ["locale"] = "en",
        ["theme"] = new JObject { ["kind"] = "dark", ["tokens"] = new JObject() },
        ["folders"] = new JArray(),
        ["trusted"] = false
      }
    };
    private static JObject Envelope(string surface, long seq, string direction = "toPanel", string type = "focusInput") => new JObject
    {
      ["mhp"] = "1.5",
      ["kind"] = "panel",
      ["surface"] = surface,
      ["seq"] = seq,
      ["direction"] = direction,
      ["payload"] = new JObject { ["type"] = type }
    };
    private static JObject Last(StringWriter writer) => SchemaContract.ParseObject(writer.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Last());
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
        output.Drain.Set(); await SendAsync(peer, Initialize()); output.Drain.Reset();
        var writes = Enumerable.Range(0, 128).Select(i => peer.WritePanelAsync(Envelope("surface", i + 1))).ToArray();
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
        await SendAsync(peer, Initialize());
        await SendAsync(peer, Envelope("unbound", 1)); Assert.AreEqual("MHP_PANEL_UNKNOWN_SURFACE", Last(output).Value<string>("code"));
        var malformed = Envelope("unbound", 1); malformed["kind"] = new JObject();
        await SendAsync(peer, malformed); Assert.AreEqual("MHP_PANEL_INVALID_ENVELOPE", Last(output).Value<string>("code"));
        SchemaContract.Validate(Last(output), peer.Contract.Export["panel"]?["error"] ?? throw new InvalidOperationException());
        await SendAsync(peer, new JObject { ["mhp"] = "1.5", ["kind"] = "surface" });
        Assert.AreEqual("MHP_PANEL_WRONG_DIRECTION", Last(output).Value<string>("code"));
        var refusal = new JObject { ["mhp"] = "1.5", ["kind"] = "panelError", ["surface"] = null, ["seq"] = null, ["code"] = "MHP_PANEL_INVALID_ENVELOPE" };
        var before = output.ToString(); await SendAsync(peer, refusal); Assert.AreEqual(before, output.ToString());
        refusal["extra"] = true;
        await Assert.ThrowsExceptionAsync<MhpException>(() => SendAsync(peer, refusal));
      }
    }

    [TestMethod]
    public async Task SelectsCurrentVersionOnlyWithinAnExplicitOffer()
    {
      foreach (var range in new[] { ("mhp/1.5.0", "mhp/1.6.0"), ("mhp/1.0.0", "mhp/2.0.0") })
      {
        using (var output = new StringWriter())
        using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
        {
          await SendAsync(peer, Initialize(range.Item1, range.Item2));
          Assert.AreEqual("mhp/1.5.0", Last(output)["result"]?.Value<string>("protocolVersion"));
          await peer.WritePanelAsync(Envelope("s", 1));
        }
      }
      foreach (var range in new[] { ("mhp/1.0.0", "mhp/1.5.0"), ("mhp/1.6.0", "mhp/2.0.0"), ("mhp/1.0.0", "mhp/1.2.0") })
      {
        using (var output = new StringWriter())
        using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
        {
          await SendAsync(peer, Initialize(range.Item1, range.Item2));
          Assert.AreEqual("MHP_INCOMPATIBLE_VERSION", Last(output)["error"]?.Value<string>("message"));
          await Assert.ThrowsExceptionAsync<MhpException>(() => peer.WritePanelAsync(Envelope("s", 1)));
        }
      }
    }

    [TestMethod]
    public async Task BindsReadyReloadHiddenAndCloseToOneSessionAndNeverReusesIds()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        await SendAsync(peer, Initialize());
        string surface;
        using (var channel = new MhpPanelChannel(peer, "conversation", "chat", "script", _ => { }))
        {
          surface = channel.Surface; await channel.OpenAsync();
          Assert.AreEqual("opened", Last(output).Value<string>("event"));
          Assert.AreEqual("conversation", Last(output).Value<string>("sessionId"));
          await Assert.ThrowsExceptionAsync<MhpException>(() => channel.PostAsync(Envelope(surface, 1, "toHost", "ready"), CancellationToken.None));
          await channel.ReadyAsync(); await channel.PostAsync(Envelope(surface, 1, "toHost", "ready"), CancellationToken.None);
          channel.SaveState(JObject.Parse("{\"history\":[1,{\"text\":\"saved\"}]}"));
          await channel.ReloadAsync();
          Assert.AreEqual("ready", Last(output)["stateRequest"]?.Value<string>("type"));
          StringAssert.Contains(channel.DocumentBootstrap, "\"outgoing\":2");
          StringAssert.Contains(channel.DocumentBootstrap, "saved");
          await channel.ReceiveAsync(Envelope(surface, 1));
          Assert.AreEqual("MHP_PANEL_NOT_READY", Last(output).Value<string>("code"));
          await channel.ReadyAsync(); await channel.HiddenAsync();
          var received = 0; channel.MessageReceived += (_, __) => received++;
          await channel.ReceiveAsync(Envelope(surface, 1)); Assert.AreEqual(1, received);
          await channel.CloseAsync();
          Assert.AreEqual(0, Last(output).Value<int>("droppedMessages"));
          Assert.IsFalse(channel.DocumentBootstrap.Contains("saved"));
          await channel.ReceiveAsync(Envelope(surface, 2));
          Assert.AreEqual("MHP_PANEL_UNKNOWN_SURFACE", Last(output).Value<string>("code"));
          Assert.AreEqual(1, received);
        }
        using (var next = new MhpPanelChannel(peer, "other-conversation", "chat", "script", _ => { })) Assert.AreNotEqual(surface, next.Surface);
      }
    }

    [TestMethod]
    public async Task RefusesForeignDirectionsSequencesAndKindsBeforeDeliveryOrAdvancing()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        await SendAsync(peer, Initialize());
        using (var channel = new MhpPanelChannel(peer, "session", "tasks", "script", _ => { }))
        {
          await channel.OpenAsync(); await channel.ReadyAsync(); var received = 0; channel.MessageReceived += (_, __) => received++;
          var badFrames = new[] { Envelope("foreign", 1), Envelope(channel.Surface, 2), Envelope(channel.Surface, 1, "toHost", "tasksReady"), Envelope(channel.Surface, 1) };
          var codes = new[] { "MHP_PANEL_UNKNOWN_SURFACE", "MHP_PANEL_OUT_OF_ORDER", "MHP_PANEL_WRONG_DIRECTION", "MHP_PANEL_INVALID_PAYLOAD" };
          for (var i = 0; i < badFrames.Length; i++)
          {
            await SendAsync(peer, badFrames[i]); Assert.AreEqual(codes[i], Last(output).Value<string>("code")); Assert.AreEqual(0, received);
          }
          var malformed = Envelope(channel.Surface, 1); malformed["extra"] = true;
          await SendAsync(peer, malformed); Assert.AreEqual("MHP_PANEL_INVALID_ENVELOPE", Last(output).Value<string>("code"));
          malformed = Envelope("", -1); await SendAsync(peer, malformed);
          SchemaContract.Validate(Last(output), peer.Contract.Export["panel"]?["error"] ?? throw new InvalidOperationException());
          Assert.AreEqual(JTokenType.Null, Last(output)["surface"]?.Type); Assert.AreEqual(JTokenType.Null, Last(output)["seq"]?.Type);
          Assert.AreEqual(0, received);
          malformed = Envelope(channel.Surface, 1); malformed["direction"] = new JObject();
          await SendAsync(peer, malformed); Assert.AreEqual("MHP_PANEL_INVALID_ENVELOPE", Last(output).Value<string>("code"));
          var valid = Envelope(channel.Surface, 1);
          valid["payload"] = JObject.Parse("{\"type\":\"tasksState\",\"conversation\":\"session\",\"items\":[],\"ended\":false,\"canMoveToWindow\":true}");
          await SendAsync(peer, valid); Assert.AreEqual(1, received);
          await SendAsync(peer, valid); Assert.AreEqual("MHP_PANEL_OUT_OF_ORDER", Last(output).Value<string>("code")); Assert.AreEqual(1, received);
          await channel.ReloadAsync(); Assert.AreEqual("tasksReady", Last(output)["stateRequest"]?.Value<string>("type"));
        }
      }
    }

    [TestMethod]
    public async Task ClosingReportsAndWarnsForExactlyThePendingSurfaceFrames()
    {
      using (var output = new WriterTests.BlockedWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        output.Drain.Set(); await SendAsync(peer, Initialize());
        var warnings = new List<string>();
        using (var channel = new MhpPanelChannel(peer, "session", "chat", "script", warnings.Add))
        {
          await channel.OpenAsync(); await channel.ReadyAsync(); output.Drain.Reset();
          var first = channel.PostAsync(Envelope(channel.Surface, 1, "toHost", "ready"), CancellationToken.None);
          var second = channel.PostAsync(Envelope(channel.Surface, 2, "toHost", "ready"), CancellationToken.None);
          var third = channel.PostAsync(Envelope(channel.Surface, 3, "toHost", "ready"), CancellationToken.None);
          var closing = channel.CloseAsync(); output.Drain.Set();
          await first; await closing;
          Assert.IsTrue(second.IsFaulted && third.IsFaulted);
          Assert.AreEqual("MHP_PANEL_DROPPED", second.Exception?.GetBaseException().Message);
          Assert.AreEqual("MHP_PANEL_DROPPED", third.Exception?.GetBaseException().Message);
          Assert.AreEqual(2, Last(output).Value<int>("droppedMessages"));
          CollectionAssert.AreEqual(new[] { "MHP_PANEL_DROPPED 2" }, warnings);
        }
      }
    }

    [TestMethod]
    public async Task ValidatesNativeBrowserControlsStateAndPrivateDrainNeverEntersMhp()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(SchemaContract.Load(true), new Host(), output))
      {
        await SendAsync(peer, Initialize());
        using (var channel = new MhpPanelChannel(peer, "session", "chat", "script", _ => { }))
        {
          channel.ParseWebviewMessage("{\"bridge\":\"subscribed\"}");
          channel.ParseWebviewMessage("{\"bridge\":\"state\",\"state\":[1,{\"a\":null}]}");
          foreach (var invalid in new[] { "{\"bridge\":\"subscribed\",\"extra\":true}", "{\"bridge\":\"drained\"}", "{\"bridge\":\"state\"}", "{\"bridge\":{}}" }) Assert.ThrowsException<MhpException>(() => channel.ParseWebviewMessage(invalid));
          Assert.ThrowsException<MhpException>(() => channel.SaveState(new JValue(DateTime.UtcNow)));
          Assert.IsFalse(output.ToString().Contains("bridge"));
        }
      }
    }

    [TestMethod]
    public void ExportActuallyAllowsAllAbsoluteExternalUrisWhileTheHostOffersNoUiGroup()
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
          output.Drain.Set(); await SendAsync(peer, Initialize()); output.Drain.Reset();
          var large = Envelope("surface", 1, "toHost");
          large["payload"] = new JObject { ["type"] = "sendMessage", ["localId"] = "fixture", ["text"] = new string('é', 7000000), ["attachmentIds"] = new JArray() };
          var first = peer.WritePanelAsync(large); var second = peer.WritePanelAsync(large);
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
