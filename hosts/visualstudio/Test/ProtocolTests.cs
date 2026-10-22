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
  public sealed class ProtocolTests
  {
    private static readonly SchemaContract Contract = SchemaContract.Load();

    private sealed class FakeHost : IHostServices
    {
      public IReadOnlyCollection<string> Capabilities { get; } = new[] { "lifecycle", "documents", "editor", "tab" };
      public int Calls { get; private set; }
      public Func<string, JObject, CancellationToken, Task<JToken>> Handler { get; set; } = (method, parameters, cancellation) => Task.FromResult<JToken>(new JArray());
      public Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation) { Calls++; return Handler(method, parameters, cancellation); }
    }

    private static JObject Call(string method, JObject? parameters = null, JToken? id = null)
        => new JObject { ["jsonrpc"] = "2.0", ["id"] = id ?? new JValue(1), ["method"] = method, ["params"] = parameters ?? new JObject() };

    private static JObject Initialize(string minimum = "mhp/1.5.0", string maximum = "mhp/1.6.0", string[]? capabilities = null)
        => Call("initialize", new JObject
        {
          ["host"] = new JObject { ["id"] = "visual-studio", ["version"] = "17.14" },
          ["protocolRange"] = new JObject { ["minimum"] = minimum, ["maximumExclusive"] = maximum },
          ["capabilities"] = new JArray(capabilities ?? new[] { "lifecycle", "documents", "editor", "tab" }),
          ["locale"] = "en",
          ["theme"] = new JObject { ["kind"] = "dark", ["tokens"] = new JObject() },
          ["folders"] = new JArray(),
          ["trusted"] = false
        }, new JValue("init"));

    private static JObject Last(StringWriter writer) => SchemaContract.ParseObject(writer.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Last());

    private static Task SendAsync(MhpPeer peer, JObject frame) => peer.ReceiveAsync(frame.ToString(Formatting.None));

    [TestMethod]
    public void FrozenExportIsConsumedWithoutContractChanges()
    {
      Assert.AreEqual("mhp/1.5.0", Contract.Version);
      Assert.AreEqual(78, Contract.Methods.Count);
      Assert.AreEqual(56, ((JArray)(Contract.Export["features"] ?? throw new InvalidOperationException())).Count);
      Assert.IsFalse(Contract.Methods.Properties().Any(p => p.Name.StartsWith("secrets/", StringComparison.Ordinal)));
      Contract.ValidateCall("initialize", Initialize());
    }

    private static async Task ReadyAsync(MhpPeer peer, StringWriter output)
    {
      var initialization = peer.InitializeAsync((JObject)(Initialize()["params"] ?? throw new InvalidOperationException()), CancellationToken.None);
      var request = Last(output);
      Contract.ValidateCall("initialize", request);
      Assert.AreEqual("initialize", request.Value<string>("method"));
      await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = new JObject { ["protocolVersion"] = Contract.Version, ["capabilities"] = new JArray("lifecycle", "tab") } });
      await initialization;
    }

    [TestMethod]
    public async Task EditorInitiatesAndRejectsRuntimeInitialization()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      {
        await SendAsync(peer, Initialize());
        Assert.AreEqual("MHP_WRONG_DIRECTION", Last(output)["error"]?.Value<string>("message"));
        await ReadyAsync(peer, output);
        await Assert.ThrowsExceptionAsync<MhpException>(() => peer.InitializeAsync((JObject)Initialize()["params"]!, CancellationToken.None));
      }
    }

    [DataTestMethod]
    [DataRow("mhp/1.0.0", "mhp/1.2.0")]
    [DataRow("mhp/1.2.0", "mhp/1.5.0")]
    [DataRow("mhp/1.6.0", "mhp/2.0.0")]
    [DataRow("mhp/2.0.0", "mhp/3.0.0")]
    [DataRow("mhp/999999999999999999999999.0.0", "mhp/999999999999999999999999.0.1")]
    public async Task RejectsIncompatibleVersionRanges(string minimum, string maximum)
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      {
        var error = await Assert.ThrowsExceptionAsync<MhpException>(() => peer.InitializeAsync((JObject)Initialize(minimum, maximum)["params"]!, CancellationToken.None));
        Assert.AreEqual("MHP_INCOMPATIBLE_VERSION", error.Message);
        Assert.AreEqual("", output.ToString());
      }
    }

    [TestMethod]
    public async Task RefusesCallsBeforeInitializeAndAfterShutdown()
    {
      var host = new FakeHost();
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, host, output))
      {
        await SendAsync(peer, Call("documents/list"));
        Assert.AreEqual("MHP_NOT_READY", Last(output)["error"]?.Value<string>("message"));
        await ReadyAsync(peer, output);
        var shutdown = peer.RequestAsync("shutdown", new JObject(), CancellationToken.None);
        await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = Last(output)["id"], ["result"] = JValue.CreateNull() });
        await shutdown;
        await SendAsync(peer, Call("documents/list", id: new JValue(3)));
        Assert.AreEqual("MHP_NOT_READY", Last(output)["error"]?.Value<string>("message"));
        Assert.AreEqual(0, host.Calls);
      }
    }

    [TestMethod]
    public async Task RefusesReplayedRequestIds()
    {
      var host = new FakeHost();
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, host, output))
      {
        await ReadyAsync(peer, output);
        await SendAsync(peer, Call("documents/list"));
        await SendAsync(peer, Call("documents/list"));
        Assert.AreEqual("MHP_DUPLICATE_ID", Last(output)["error"]?.Value<string>("message"));
        Assert.AreEqual(1, host.Calls);
      }
    }

    [TestMethod]
    public async Task RejectsWrongDirectionBeforeSideEffects()
    {
      var host = new FakeHost();
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, host, output))
      {
        await ReadyAsync(peer, output);
        var complete = Call("tab/complete", new JObject
        {
          ["uri"] = "file:///C:/repo/a.cs",
          ["position"] = new JObject { ["line"] = 0, ["character"] = 0 },
          ["version"] = 0,
          ["context"] = new JObject { ["prefix"] = "", ["suffix"] = "", ["trigger"] = "invoke" }
        });
        await SendAsync(peer, complete);
        Assert.AreEqual("MHP_WRONG_DIRECTION", Last(output)["error"]?.Value<string>("message"));
        Assert.AreEqual(0, host.Calls);
      }
    }

    [TestMethod]
    public async Task ValidatesHostResultsAndNeverReturnsRawExceptions()
    {
      var host = new FakeHost { Handler = (m, p, c) => Task.FromResult<JToken>(new JObject { ["wrong"] = true }) };
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, host, output))
      {
        await ReadyAsync(peer, output);
        await SendAsync(peer, Call("documents/list"));
        Assert.AreEqual("MHP_INVALID_PARAMS", Last(output)["error"]?.Value<string>("message"));
        host.Handler = (m, p, c) => throw new IOException("private-path-and-account");
        await SendAsync(peer, Call("documents/list", id: new JValue(2)));
        Assert.AreEqual("MHP_HOST_FAILED", Last(output)["error"]?.Value<string>("message"));
        Assert.IsFalse(output.ToString().Contains("private-path-and-account"));
      }
    }

    [TestMethod]
    [Timeout(10000)]
    public async Task CancelsAnInFlightRequestByTypedId()
    {
      var started = new TaskCompletionSource<bool>();
      var host = new FakeHost { Handler = async (m, p, cancellation) => { started.SetResult(true); await Task.Delay(Timeout.Infinite, cancellation); return new JArray(); } };
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, host, output))
      {
        await ReadyAsync(peer, output);
        var request = SendAsync(peer, Call("documents/list", id: new JValue("work")));
        await started.Task;
        await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["method"] = "$/cancelRequest", ["params"] = new JObject { ["id"] = "work" } });
        await request;
        Assert.AreEqual("work", Last(output).Value<string>("id"));
        Assert.AreEqual("MHP_CANCELLED", Last(output)["error"]?.Value<string>("message"));
      }
    }

    [TestMethod]
    public async Task CorrelatesRuntimeResultsAndRejectsWrongIdsAndShapes()
    {
      using (var context = new JoinableTaskContext())
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      {
        await ReadyAsync(peer, output);
        var parameters = new JObject
        {
          ["uri"] = "file:///C:/repo/a.cs",
          ["position"] = new JObject { ["line"] = 0, ["character"] = 0 },
          ["version"] = 0,
          ["context"] = new JObject { ["prefix"] = "", ["suffix"] = "", ["trigger"] = "invoke" }
        };
        var request = context.Factory.RunAsync(() => peer.RequestAsync("tab/complete", parameters, CancellationToken.None));
        var id = Last(output)["id"] ?? throw new InvalidOperationException();
        await Assert.ThrowsExceptionAsync<MhpException>(() => SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = "wrong", ["result"] = new JArray() }));
        Assert.IsFalse(request.IsCompleted);
        await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = new JObject() });
        await Assert.ThrowsExceptionAsync<MhpException>(() => request.JoinAsync());
        var valid = peer.RequestAsync("tab/complete", parameters, CancellationToken.None);
        await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = Last(output)["id"], ["result"] = new JArray() });
        Assert.AreEqual(0, ((JArray)await valid).Count);
      }
    }

    [TestMethod]
    public async Task EnforcesOutboundDirectionAndDisconnectsPendingWork()
    {
      using (var context = new JoinableTaskContext())
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      {
        await ReadyAsync(peer, output);
        await Assert.ThrowsExceptionAsync<MhpException>(() => peer.RequestAsync("documents/list", new JObject(), CancellationToken.None));
        Assert.ThrowsException<MhpException>(() => peer.NotifyAsync("documents/read", new JObject()));
        await peer.NotifyAsync("documents/didClose", new JObject { ["uri"] = "file:///C:/repo/a.cs" });
        Contract.ValidateCall("documents/didClose", Last(output));
        var request = context.Factory.RunAsync(() => peer.RequestAsync("tab/complete", new JObject
        {
          ["uri"] = "file:///C:/repo/a.cs",
          ["position"] = new JObject { ["line"] = 0, ["character"] = 0 },
          ["version"] = 0,
          ["context"] = new JObject { ["prefix"] = "", ["suffix"] = "", ["trigger"] = "invoke" }
        }, CancellationToken.None));
        await peer.RunAsync(new StringReader(""));
        await Assert.ThrowsExceptionAsync<MhpException>(() => request.JoinAsync());
      }
    }

    [TestMethod]
    public async Task BoundsFramesAndRefusesTruncationBatchesAndDuplicateFields()
    {
      await Assert.ThrowsExceptionAsync<MhpException>(() => MhpPeer.ReadFrameAsync(new StringReader(new string('x', SchemaContract.MaximumFrameBytes + 1) + "\n")));
      await Assert.ThrowsExceptionAsync<MhpException>(() => MhpPeer.ReadFrameAsync(new StringReader("{}")));
      Assert.AreEqual("{}", await MhpPeer.ReadFrameAsync(new StringReader("{}\r\n")));
      Assert.ThrowsException<MhpException>(() => SchemaContract.ParseObject("[]"));
      Assert.ThrowsException<JsonReaderException>(() => SchemaContract.ParseObject("{\"id\":1,\"id\":2}"));
      Assert.ThrowsException<MhpException>(() => SchemaContract.ParseObject("{}{}"));
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      {
        await peer.ReceiveAsync("[{\"method\":\"shutdown\"}]");
        Contract.ValidateFailure(Last(output));
        Assert.AreEqual("MHP_PARSE_ERROR", Last(output)["error"]?.Value<string>("message"));
      }
    }

    [TestMethod]
    public void RejectsMalformedCallsAtTheExportBoundary()
    {
      foreach (var capabilities in new[] { new[] { "documents" }, new[] { "lifecycle", "lifecycle" } })
        Assert.ThrowsException<MhpException>(() => Contract.ValidateCall("initialize", Initialize(capabilities: capabilities)));
      var extra = Call("documents/list"); extra["extra"] = true;
      Assert.ThrowsException<MhpException>(() => Contract.ValidateCall("documents/list", extra));
      var notification = Call("documents/didClose", new JObject { ["uri"] = "file:///C:/repo/a.cs" });
      Assert.ThrowsException<MhpException>(() => Contract.ValidateCall("documents/didClose", notification));
      var missingId = Call("documents/list"); missingId.Remove("id");
      Assert.ThrowsException<MhpException>(() => Contract.ValidateCall("documents/list", missingId));
      var unsafeId = Call("documents/list", id: new JValue(9007199254740992L));
      Assert.ThrowsException<MhpException>(() => Contract.ValidateCall("documents/list", unsafeId));
      var terminal = Call("terminal/create", new JObject { ["cwd"] = "file:///C:/repo", ["executable"] = "cmd.exe", ["args"] = new JArray(), ["env"] = new JObject { ["TEST_API_KEY"] = "fixture-marker" } });
      Assert.ThrowsException<MhpException>(() => Contract.ValidateCall("terminal/create", terminal));
      var input = Call("ui/input", new JObject { ["title"] = "t", ["prompt"] = "p", ["password"] = true });
      Assert.ThrowsException<MhpException>(() => Contract.ValidateCall("ui/input", input));
      var failure = new JObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["error"] = new JObject { ["code"] = -32603, ["message"] = "a private account" } };
      Assert.ThrowsException<MhpException>(() => Contract.ValidateFailure(failure));
    }

    [TestMethod]
    public async Task InvalidRequestIdsNeverEscapeIntoAFailureFrame()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      {
        foreach (var id in new JToken[] { new JValue(-1), new JValue(""), new JObject(), new JValue(0.5) })
        {
          await SendAsync(peer, Call("documents/list", id: id));
          Contract.ValidateFailure(Last(output));
          Assert.AreEqual(JTokenType.Null, Last(output)["id"]?.Type);
        }
      }
    }

    [TestMethod]
    public void RefusesNonJsonSyntaxEvenWhenJsonNetAcceptsIt()
    {
      foreach (var json in new[] { "{'a':1}", "{a:1}", "{\"a\":1,}", "{\"a\":[1,]}", "{/*comment*/\"a\":1}", "{\"a\":undefined}", "{\"a\":NaN}", "{\"a\":+1}", "{\"a\":01}", "{\"a\":.1}", "{\"a\":1.}", "{\"a\":1e}", "{\"a\":\"raw\nnewline\"}", "{\"a\":\"\\x41\"}", "{\"a\":\"\\uXX00\"}", "{\"a\":\"unterminated}", "{\"a\" 1}", "{\"a\":truefalse}", "{} {}" })
        Assert.ThrowsException<MhpException>(() => SchemaContract.ParseObject(json), json);
      Assert.AreEqual("😀", SchemaContract.ParseObject("{\"a\":\"\\ud83d\\ude00\"}").Value<string>("a"));
      Assert.ThrowsException<MhpException>(() => SchemaContract.ParseObject("{\"a\":\"\\ud800\"}"));
      Assert.ThrowsException<MhpException>(() => SchemaContract.ParseObject("{\"a\":\"\\udc00\"}"));
      Assert.AreEqual(1.5, SchemaContract.ParseObject("{\"a\":1.5e0}").Value<double>("a"));
    }

    [TestMethod]
    public void UsesEcmaPatternsAndNumericJsonEquality()
    {
      Assert.ThrowsException<MhpException>(() => Contract.ValidateCall("settings/get", Call("settings/get", new JObject { ["key"] = "museSpark.aé" })));
      var failure = new JObject { ["jsonrpc"] = "2.0", ["id"] = 1.0, ["error"] = new JObject { ["code"] = -32603.0, ["message"] = "MHP_INTERNAL_ERROR" } };
      Contract.ValidateFailure(failure);
    }

    [TestMethod]
    public async Task NumericIdsCannotBeReplayedByChangingTheirJsonNumberNotation()
    {
      var host = new FakeHost();
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, host, output))
      {
        await ReadyAsync(peer, output);
        await SendAsync(peer, Call("documents/list", id: new JValue(1.0)));
        await SendAsync(peer, Call("documents/list", id: new JValue(1)));
        Assert.AreEqual("MHP_DUPLICATE_ID", Last(output)["error"]?.Value<string>("message"));
        Assert.AreEqual(1, host.Calls);
      }
    }

    [TestMethod]
    [Timeout(10000)]
    public async Task CancelsOutgoingRequestsAndValidatesTheirLateResponses()
    {
      using (var context = new JoinableTaskContext())
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      using (var cancellation = new CancellationTokenSource())
      {
        await ReadyAsync(peer, output);
        var request = context.Factory.RunAsync(() => peer.RequestAsync("tab/complete", new JObject
        {
          ["uri"] = "file:///C:/repo/a.cs",
          ["position"] = new JObject { ["line"] = 0, ["character"] = 0 },
          ["version"] = 0,
          ["context"] = new JObject { ["prefix"] = "", ["suffix"] = "", ["trigger"] = "invoke" }
        }, cancellation.Token));
        var id = Last(output)["id"] ?? throw new InvalidOperationException();
        cancellation.Cancel();
        await Assert.ThrowsExceptionAsync<TaskCanceledException>(() => request.JoinAsync());
        Assert.AreEqual("$/cancelRequest", Last(output).Value<string>("method"));
        Assert.IsTrue(JToken.DeepEquals(id, Last(output)["params"]?["id"]));
        await SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = new JArray() });
        await Assert.ThrowsExceptionAsync<MhpException>(() => SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = new JObject() }));
        await Assert.ThrowsExceptionAsync<MhpException>(() => SendAsync(peer, new JObject { ["jsonrpc"] = "2.0", ["id"] = "unknown", ["result"] = new JArray() }));
        var before = output.ToString();
        await Assert.ThrowsExceptionAsync<OperationCanceledException>(() => peer.RequestAsync("tab/complete", new JObject(), cancellation.Token));
        Assert.AreEqual(before, output.ToString());
      }
    }

    [TestMethod]
    [Timeout(10000)]
    public async Task InitializationWaitersCompleteCancelAndFailOnDisconnect()
    {
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      {
        var waiting = peer.WaitUntilReadyAsync(CancellationToken.None);
        Assert.IsFalse(waiting.IsCompleted);
        await ReadyAsync(peer, output); await waiting;
        await peer.WaitUntilReadyAsync(CancellationToken.None);
      }
      using (var context = new JoinableTaskContext())
      using (var output = new StringWriter())
      using (var peer = new MhpPeer(Contract, new FakeHost(), output))
      using (var cancellation = new CancellationTokenSource())
      {
        var waiting = context.Factory.RunAsync(() => peer.WaitUntilReadyAsync(cancellation.Token)); cancellation.Cancel();
        await Assert.ThrowsExceptionAsync<TaskCanceledException>(() => waiting.JoinAsync());
        var disconnected = context.Factory.RunAsync(() => peer.WaitUntilReadyAsync(CancellationToken.None));
        await peer.RunAsync(new StringReader(""));
        await Assert.ThrowsExceptionAsync<MhpException>(() => disconnected.JoinAsync());
      }
    }
  }
}
