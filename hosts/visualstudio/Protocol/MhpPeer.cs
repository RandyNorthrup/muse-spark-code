using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Protocol
{
  public interface IHostServices
  {
    IReadOnlyCollection<string> Capabilities { get; }
    Task<JToken> InvokeAsync(string method, JObject parameters, CancellationToken cancellation);
  }

  // One bound surface. The peer validates the envelope; the endpoint owns binding, direction, readiness and sequence.
  public interface IPanelEndpoint
  {
    string SurfaceId { get; }
    // Throws MhpException named by a frozen panelError code when the frame breaks this channel's protocol.
    void Receive(JObject frame);
    // Synchronously detaches and marks the channel failed: no later frame or post is delivered.
    // False when it was already closed. The channel's sequence is no longer shared with the runtime.
    bool Fail(string code);
    // After Fail: sends the closing lifecycle frame and reports the fault, once.
    Task CloseFaultedAsync();
  }

  // Bidirectional NDJSON, correlated ids, sparse capabilities and cancellation.
  public sealed class MhpPeer : IDisposable
  {
    private const int MaximumRequestIds = 100000;
    // Completed inbound ids remembered for replay refusal. In-flight ids are always refused.
    internal const int DefaultRecentRequestIds = 4096;
    private const string PanelInvalidEnvelope = "MHP_PANEL_INVALID_ENVELOPE";
    private const string PanelInvalidPayload = "MHP_PANEL_INVALID_PAYLOAD";
    private const string PanelUnknownSurface = "MHP_PANEL_UNKNOWN_SURFACE";
    private const string PanelInvalidLifecycle = "MHP_PANEL_INVALID_LIFECYCLE";
    private const long MaximumPanelSequence = 9007199254740991;
    private static readonly string[] PanelEnvelopeFields = { "mhp", "kind", "surface", "direction", "seq", "payload" };
    private readonly SchemaContract contract;
    private readonly IHostServices services;
    private readonly TextWriter writer;
    private readonly SemaphoreSlim writeLock = new SemaphoreSlim(1);
    private readonly object stateLock = new object();
    private readonly Dictionary<string, Pending> pending = new Dictionary<string, Pending>(StringComparer.Ordinal);
    private readonly Dictionary<string, string> cancelledRequests = new Dictionary<string, string>(StringComparer.Ordinal);
    private readonly Dictionary<string, CancellationTokenSource> active = new Dictionary<string, CancellationTokenSource>(StringComparer.Ordinal);
    private readonly HashSet<string> recent = new HashSet<string>(StringComparer.Ordinal);
    private readonly Queue<string> recentOrder = new Queue<string>();
    private readonly int recentLimit;
    private readonly int activeLimit;
    private readonly Dictionary<string, IPanelEndpoint> panels = new Dictionary<string, IPanelEndpoint>(StringComparer.Ordinal);
    private readonly HashSet<string> negotiated = new HashSet<string>(StringComparer.Ordinal);
    private readonly List<TaskCompletionSource<bool>> readyWaiters = new List<TaskCompletionSource<bool>>();
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private long nextId;
    private bool initialized;
    private bool initializing;
    private bool stopped;
    // Fixed identifiers only: no frame content, path or account reaches the log.
    public Action<string>? Log { private get; set; }

    private sealed class Pending
    {
      public string Method { get; }
      public TaskCompletionSource<JToken> Completion { get; }
      public bool ReplyReceived { get; set; }
      public Pending(string method, TaskCompletionSource<JToken> completion) { Method = method; Completion = completion; }
    }

    public MhpPeer(SchemaContract contract, IHostServices services, TextWriter writer) : this(contract, services, writer, DefaultRecentRequestIds) { }

    internal MhpPeer(SchemaContract contract, IHostServices services, TextWriter writer, int recentRequestIds)
    {
      if (recentRequestIds < 1) throw new ArgumentOutOfRangeException(nameof(recentRequestIds));
      this.contract = contract;
      this.services = services;
      this.writer = writer;
      recentLimit = recentRequestIds;
      // The runtime holds at most this many requests in flight (frozen panel.limits); more is a flood, not a session.
      activeLimit = contract.Export["panel"]?["limits"]?.Value<int?>("maximumQueuedMessages") ?? throw new MhpException("internalError", "MHP_CONTRACT_ERROR");
      if (!services.Capabilities.Contains("lifecycle")) throw new ArgumentException("MHP_LIFECYCLE_REQUIRED", nameof(services));
    }

    public void AttachPanel(IPanelEndpoint endpoint)
    {
      lock (stateLock)
      {
        if (panels.ContainsKey(endpoint.SurfaceId)) throw new MhpException("invalidParams", "MHP_PANEL_BINDING_MISMATCH");
        panels.Add(endpoint.SurfaceId, endpoint);
      }
    }

    public void DetachPanel(IPanelEndpoint endpoint)
    {
      lock (stateLock) { if (panels.TryGetValue(endpoint.SurfaceId, out var held) && ReferenceEquals(held, endpoint)) panels.Remove(endpoint.SurfaceId); }
    }

    public async Task RunAsync(TextReader reader)
    {
      var work = new List<Task>();
      try
      {
        while (!lifetime.IsCancellationRequested)
        {
          var line = await ReadFrameAsync(reader).ConfigureAwait(false);
          if (line == null) break;
          work.RemoveAll(t => t.IsCompletedSuccessfully());
          work.Add(ReceiveAsync(line));
        }
      }
      finally
      {
        Stop();
        await Task.WhenAll(work).ConfigureAwait(false);
      }
    }

    public static async Task<string?> ReadFrameAsync(TextReader reader)
    {
      var text = new System.Text.StringBuilder();
      var one = new char[1];
      while (await reader.ReadAsync(one, 0, 1).ConfigureAwait(false) != 0)
      {
        if (one[0] == '\n') return text.ToString().TrimEnd('\r');
        text.Append(one[0]);
        if (text.Length > SchemaContract.MaximumFrameChars) throw new MhpException("invalidRequest", "MHP_FRAME_TOO_LARGE");
      }
      if (text.Length != 0) throw new MhpException("parseError", "MHP_TRUNCATED_FRAME");
      return null;
    }

    public async Task ReceiveAsync(string line)
    {
      JObject frame;
      try { frame = SchemaContract.ParseObject(line); }
      catch (Exception error) when (error is JsonException || error is MhpException)
      { await FailAsync(JValue.CreateNull(), new MhpException("parseError", "MHP_PARSE_ERROR")).ConfigureAwait(false); return; }

      if (frame["mhp"] != null) { await ReceivePanelAsync(frame).ConfigureAwait(false); return; }
      if (frame["method"] == null) { ReceiveResult(frame); return; }
      var id = frame["id"] ?? JValue.CreateNull();
      try { SchemaContract.Validate(id, contract.Export["failure"]?["properties"]?["id"] ?? throw new MhpException("internalError", "MHP_CONTRACT_ERROR")); }
      catch (MhpException) { id = JValue.CreateNull(); }
      CancellationTokenSource? cancellation = null;
      var key = IdKey(id);
      try
      {
        var method = frame.Value<string>("method") ?? throw new MhpException("invalidRequest", "MHP_INVALID_REQUEST");
        contract.ValidateCall(method, frame);
        var definition = contract.Method(method);
        if (definition.Value<string>("direction") == "hostToRuntime") throw new MhpException("invalidRequest", "MHP_WRONG_DIRECTION");
        if (method == "$/cancelRequest")
        {
          RequireReady("lifecycle");
          var cancelId = frame["params"]?["id"] ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS");
          lock (stateLock) { if (active.TryGetValue(IdKey(cancelId), out var target)) target.Cancel(); }
          return;
        }
        if (definition.Value<string>("kind") == "notification")
        {
          RequireReady("lifecycle");
          await services.InvokeAsync(method, (JObject)(frame["params"] ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS")), lifetime.Token).ConfigureAwait(false);
          return;
        }
        lock (stateLock)
        {
          // A live id is a duplicate; a recently completed one is a replay. Older ids leave the bounded window.
          if (active.ContainsKey(key) || recent.Contains(key)) throw new MhpException("invalidRequest", "MHP_DUPLICATE_ID");
          if (active.Count >= activeLimit) throw new MhpException("internalError", "MHP_BACKPRESSURE");
          cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
          active.Add(key, cancellation);
        }
        var parameters = frame["params"] as JObject ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS");
        JToken result;
        RequireReady("lifecycle");
        if (!services.Capabilities.Contains(definition.Value<string>("capability") ?? "")) throw new MhpException("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY");
        result = await services.InvokeAsync(method, parameters, cancellation.Token).ConfigureAwait(false);
        cancellation.Token.ThrowIfCancellationRequested();
        var response = new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result };
        contract.ValidateResult(method, response);
        await WriteAsync(response).ConfigureAwait(false);
      }
      catch (OperationCanceledException) { await FailAsync(id, new MhpException("cancelled", "MHP_CANCELLED")).ConfigureAwait(false); }
      catch (MhpException error) { await FailAsync(id, error).ConfigureAwait(false); }
      catch (Exception) { await FailAsync(id, new MhpException("internalError", "MHP_HOST_FAILED")).ConfigureAwait(false); }
      finally
      {
        if (cancellation != null) { lock (stateLock) { active.Remove(key); Remember(key); } cancellation.Dispose(); }
      }
    }

    private void Remember(string key)
    {
      if (!recent.Add(key)) return;
      recentOrder.Enqueue(key);
      while (recentOrder.Count > recentLimit) recent.Remove(recentOrder.Dequeue());
    }

    // Each panel frame is validated alone. A failure closes only the channel it names, with a frozen
    // panelError code, and is logged; it never faults the receive loop or leaves a sequence half-advanced.
    private async Task ReceivePanelAsync(JObject frame)
    {
      try { RequireReady("lifecycle"); }
      catch (MhpException error) { Report(error.Message); return; }
      var surface = Text(frame["surface"]) is string id && id.Length != 0 ? id : null;
      IPanelEndpoint? endpoint = null;
      if (surface != null) lock (stateLock) { panels.TryGetValue(surface, out endpoint); }
      string code;
      try
      {
        switch (Text(frame["kind"]))
        {
          case "panel":
            if (!Valid(frame, "envelope")) { code = HasPanelHeader(frame) ? PanelInvalidPayload : PanelInvalidEnvelope; break; }
            if (endpoint == null) { code = PanelUnknownSurface; break; }
            endpoint.Receive(frame);
            return;
          case "panelError":
            if (!Valid(frame, "error")) { code = PanelInvalidEnvelope; break; }
            // The runtime refused one of this channel's frames: the sequences no longer agree. Never echo it back.
            code = Text(frame["code"]) ?? PanelInvalidEnvelope;
            Report(code);
            if (endpoint == null || !endpoint.Fail(code)) return;
            await CloseFaultedAsync(endpoint).ConfigureAwait(false);
            return;
          case "surface":
            // Lifecycle frames travel editor-to-runtime only; one arriving here cannot be applied to a binding.
            code = PanelInvalidLifecycle;
            break;
          default:
            code = PanelInvalidEnvelope;
            break;
        }
      }
      catch (MhpException error) when (error.Message.StartsWith("MHP_PANEL_", StringComparison.Ordinal)) { code = error.Message; }
      catch (Exception error) when (!(error is OutOfMemoryException))
      {
        // Delivery failed after the frame was admitted; the channel cannot vouch for its next frame.
        Report("MHP_PANEL_DELIVERY_FAILED");
        code = PanelInvalidPayload;
      }
      await FaultPanelAsync(surface, frame["seq"], code, endpoint).ConfigureAwait(false);
    }

    private bool Valid(JObject frame, string kind)
    {
      try { contract.ValidatePanel(frame, kind); return true; }
      catch (MhpException) { return false; }
    }

    // The header the runtime admits before the payload (shared/hostApi/panel.ts): its failure is an envelope error.
    // Reads only through non-throwing checks: the frame has already failed validation.
    private static bool HasPanelHeader(JObject frame) =>
      frame.Count == PanelEnvelopeFields.Length && PanelEnvelopeFields.All(field => frame.Property(field, StringComparison.Ordinal) != null)
      && Text(frame["mhp"]) == "1.5" && Text(frame["surface"]) is string surface && surface.Length != 0
      && (Text(frame["direction"]) == "toHost" || Text(frame["direction"]) == "toPanel")
      && Sequence(frame["seq"]) != null;

    private static string? Text(JToken? token) => token is JValue { Type: JTokenType.String, Value: string text } ? text : null;

    // The frozen panel sequence: an integer from 0 to 2^53 - 1. Json.NET keeps larger integers as BigInteger and
    // fractions as double; neither is converted, so an out-of-range sequence is simply absent (null).
    private static long? Sequence(JToken? token) =>
      token is JValue { Type: JTokenType.Integer, Value: long value } && value >= 0 && value <= MaximumPanelSequence ? value : (long?)null;

    private async Task FaultPanelAsync(string? surface, JToken? seq, string code, IPanelEndpoint? endpoint)
    {
      Report(code);
      // Before the first await: overlapping receive tasks and browser posts already see the failed channel.
      var closing = endpoint?.Fail(code) == true;
      try
      {
        var sequence = Sequence(seq);
        var error = new JObject
        {
          ["mhp"] = "1.5",
          ["kind"] = "panelError",
          ["surface"] = surface,
          ["seq"] = sequence == null ? JValue.CreateNull() : new JValue(sequence.Value),
          ["code"] = code
        };
        await PostPanelAsync(error).ConfigureAwait(false);
      }
      catch (Exception failure) when (!(failure is OutOfMemoryException)) { Report("MHP_PANEL_ERROR_UNSENT"); }
      finally
      {
        // The channel closes even when its error frame could not be built or written.
        if (closing && endpoint != null) await CloseFaultedAsync(endpoint).ConfigureAwait(false);
      }
    }

    private async Task CloseFaultedAsync(IPanelEndpoint endpoint)
    {
      try { await endpoint.CloseFaultedAsync().ConfigureAwait(false); }
      catch (Exception failure) when (!(failure is OutOfMemoryException)) { Report("MHP_PANEL_CLOSE_UNSENT"); }
    }

    private void Report(string identifier)
    {
      try { Log?.Invoke(identifier); }
      catch (Exception error) when (!(error is OutOfMemoryException)) { /* A failing log sink must not stop the protocol. */ }
    }

    public async Task InitializeAsync(JObject parameters, CancellationToken cancellation)
    {
      contract.ValidateCall("initialize", Call("initialize", parameters, new JValue("initialize")));
      lock (stateLock)
      {
        if (initialized || initializing || stopped) throw new MhpException("invalidRequest", "MHP_ALREADY_INITIALIZED");
        var range = parameters["protocolRange"] ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS");
        if (CompareVersion(range.Value<string>("minimum") ?? "", contract.Version) > 0 || CompareVersion(contract.Version, range.Value<string>("maximumExclusive") ?? "") >= 0)
          throw new MhpException("incompatibleVersion", "MHP_INCOMPATIBLE_VERSION");
        var offered = parameters["capabilities"] as JArray ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS");
        if (!new HashSet<string>(offered.Values<string>().OfType<string>()).SetEquals(services.Capabilities)) throw new MhpException("invalidParams", "MHP_CAPABILITY_MISMATCH");
        initializing = true;
      }
      try { await RequestAsync("initialize", parameters, cancellation).ConfigureAwait(false); }
      catch { Stop(); throw; }
      finally { lock (stateLock) { initializing = false; } }
    }

    private static int CompareVersion(string left, string right)
    {
      var a = left.Substring("mhp/".Length).Split('.');
      var b = right.Substring("mhp/".Length).Split('.');
      for (var i = 0; i < a.Length; i++) { var comparison = BigInteger.Parse(a[i], System.Globalization.CultureInfo.InvariantCulture).CompareTo(BigInteger.Parse(b[i], System.Globalization.CultureInfo.InvariantCulture)); if (comparison != 0) return comparison; }
      return 0;
    }

    private void RequireReady(string capability)
    {
      lock (stateLock)
      {
        if (!initialized || stopped) throw new MhpException("invalidRequest", "MHP_NOT_READY");
        if (!negotiated.Contains(capability)) throw new MhpException("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY");
      }
    }

    public async Task WaitUntilReadyAsync(CancellationToken cancellation)
    {
      var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
      lock (stateLock)
      {
        if (stopped) throw new MhpException("cancelled", "MHP_DISCONNECTED");
        if (initialized) return;
        readyWaiters.Add(completion);
      }
      try { using (cancellation.Register(() => completion.TrySetCanceled())) await completion.Task.ConfigureAwait(false); }
      finally { lock (stateLock) { readyWaiters.Remove(completion); } }
    }

    private void ReceiveResult(JObject frame)
    {
      var id = frame["id"] ?? throw new MhpException("invalidRequest", "MHP_INVALID_RESPONSE");
      lock (stateLock)
      {
        if (!pending.TryGetValue(IdKey(id), out var request))
        {
          if (!cancelledRequests.TryGetValue(IdKey(id), out var cancelledMethod)) throw new MhpException("invalidRequest", "MHP_UNKNOWN_RESPONSE_ID");
          if (frame["error"] != null) contract.ValidateFailure(frame); else contract.ValidateResult(cancelledMethod, frame);
          cancelledRequests.Remove(IdKey(id));
          return;
        }
        if (request.ReplyReceived || (request.Completion.Task.IsCompleted && !request.Completion.Task.IsCanceled)) throw new MhpException("invalidRequest", "MHP_DUPLICATE_RESPONSE");
        try
        {
          if (frame["error"] != null) contract.ValidateFailure(frame);
          else contract.ValidateResult(request.Method, frame);
          request.ReplyReceived = true;
          // Cancellation can be waiting for its notification write while a valid reply arrives.
          if (request.Completion.Task.IsCanceled) return;
          if (frame["error"] != null) request.Completion.TrySetException(new MhpException("internalError", frame["error"]?.Value<string>("message") ?? "MHP_RUNTIME_FAILED"));
          else
          {
            if (request.Method == "initialize")
            {
              if (stopped) throw new MhpException("cancelled", "MHP_DISCONNECTED");
              foreach (var capability in frame["result"]?["capabilities"]?.Values<string>().OfType<string>() ?? Enumerable.Empty<string>()) negotiated.Add(capability);
              initialized = true;
              foreach (var waiter in readyWaiters) waiter.TrySetResult(true);
            }
            request.Completion.TrySetResult(frame["result"] ?? JValue.CreateNull());
          }
        }
        catch (MhpException error) { if (request.Completion.Task.IsCanceled) throw; request.Completion.TrySetException(error); }
      }
    }

    public async Task<JToken> RequestAsync(string method, JObject parameters, CancellationToken cancellation)
    {
      cancellation.ThrowIfCancellationRequested();
      var definition = contract.Method(method);
      if (method != "initialize") RequireReady(definition.Value<string>("capability") ?? "");
      else { lock (stateLock) { if (!initializing || stopped) throw new MhpException("invalidRequest", "MHP_NOT_READY"); } }
      if (definition.Value<string>("direction") == "runtimeToHost" || definition.Value<string>("kind") != "request") throw new MhpException("invalidRequest", "MHP_WRONG_DIRECTION");
      var id = new JValue("vs:" + Interlocked.Increment(ref nextId).ToString(System.Globalization.CultureInfo.InvariantCulture));
      var frame = Call(method, parameters, id);
      contract.ValidateCall(method, frame);
      var completion = new TaskCompletionSource<JToken>(TaskCreationOptions.RunContinuationsAsynchronously);
      var request = new Pending(method, completion);
      var wasCancelled = false;
      lock (stateLock) { pending.Add(IdKey(id), request); }
      try
      {
        await WriteAsync(frame).ConfigureAwait(false);
        using (cancellation.Register(() => completion.TrySetCanceled()))
        {
          try { var result = await completion.Task.ConfigureAwait(false); if (method == "shutdown") Stop(); return result; }
          catch (OperationCanceledException) { wasCancelled = true; if (method != "initialize") await NotifyAsync("$/cancelRequest", new JObject { ["id"] = id }).ConfigureAwait(false); throw; }
        }
      }
      finally { lock (stateLock) { pending.Remove(IdKey(id)); if (wasCancelled && !request.ReplyReceived && cancelledRequests.Count < MaximumRequestIds) cancelledRequests.Add(IdKey(id), method); } }
    }

    public Task NotifyAsync(string method, JObject parameters)
    {
      var definition = contract.Method(method);
      RequireReady("lifecycle");
      if (!services.Capabilities.Contains(definition.Value<string>("capability") ?? "")) throw new MhpException("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY");
      if (definition.Value<string>("direction") == "runtimeToHost" || definition.Value<string>("kind") != "notification") throw new MhpException("invalidRequest", "MHP_WRONG_DIRECTION");
      var frame = Call(method, parameters, null);
      contract.ValidateCall(method, frame);
      return WriteAsync(frame);
    }

    public Task PostPanelAsync(JObject frame)
    {
      RequireReady("lifecycle");
      var kind = frame.Value<string>("kind");
      contract.ValidatePanel(frame, kind == "panel" ? "envelope" : kind == "panelError" ? "error" : "lifecycle");
      return WriteAsync(frame);
    }

    private static JObject Call(string method, JObject parameters, JToken? id)
    {
      var frame = new JObject { ["jsonrpc"] = "2.0", ["method"] = method, ["params"] = parameters };
      if (id != null) frame["id"] = id;
      return frame;
    }

    private Task FailAsync(JToken id, MhpException error)
    {
      var frame = new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JObject { ["code"] = contract.Export["errorCodes"]?[error.CodeKey], ["message"] = error.Message } };
      contract.ValidateFailure(frame);
      return WriteAsync(frame);
    }

    private async Task WriteAsync(JObject frame)
    {
      var text = frame.ToString(Formatting.None);
      if (System.Text.Encoding.UTF8.GetByteCount(text) > SchemaContract.MaximumFrameChars) throw new MhpException("internalError", "MHP_FRAME_TOO_LARGE");
      await writeLock.WaitAsync().ConfigureAwait(false);
      try { await writer.WriteLineAsync(text).ConfigureAwait(false); await writer.FlushAsync().ConfigureAwait(false); }
      finally { writeLock.Release(); }
    }

    private static string IdKey(JToken id) => id.Type == JTokenType.Integer || id.Type == JTokenType.Float
        ? "number:" + id.Value<long>().ToString(System.Globalization.CultureInfo.InvariantCulture)
        : id.Type + ":" + id.ToString(Formatting.None);
    private void Stop()
    {
      lock (stateLock) { stopped = true; foreach (var request in pending.Values) request.Completion.TrySetException(new MhpException("cancelled", "MHP_DISCONNECTED")); foreach (var waiter in readyWaiters) waiter.TrySetException(new MhpException("cancelled", "MHP_DISCONNECTED")); }
      lifetime.Cancel();
    }
    public void Dispose() { Stop(); lifetime.Dispose(); writeLock.Dispose(); }
  }

  internal static class TaskStatusExtensions
  {
    internal static bool IsCompletedSuccessfully(this Task task) => task.Status == TaskStatus.RanToCompletion;
  }
}
