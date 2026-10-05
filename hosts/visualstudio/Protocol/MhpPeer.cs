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

  // Bidirectional NDJSON, correlated ids, sparse capabilities and cancellation.
  public sealed class MhpPeer : IDisposable
  {
    private const int MaximumRequestIds = 100000;
    private readonly SchemaContract contract;
    private readonly IHostServices services;
    private readonly MhpWriter writer;
    public SchemaContract Contract => contract;
    public string? ProtocolVersion { get; private set; }
    public Func<JObject, Task>? PanelReceiverAsync { get; set; }
    private readonly object stateLock = new object();
    private readonly Dictionary<string, Pending> pending = new Dictionary<string, Pending>(StringComparer.Ordinal);
    private readonly Dictionary<string, string> cancelledRequests = new Dictionary<string, string>(StringComparer.Ordinal);
    private readonly Dictionary<string, CancellationTokenSource> active = new Dictionary<string, CancellationTokenSource>(StringComparer.Ordinal);
    private readonly HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
    private readonly HashSet<string> negotiated = new HashSet<string>(StringComparer.Ordinal);
    private readonly List<TaskCompletionSource<bool>> readyWaiters = new List<TaskCompletionSource<bool>>();
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private long nextId;
    private bool initialized;
    private bool stopped;

    private sealed class Pending
    {
      public string Method { get; }
      public TaskCompletionSource<JToken> Completion { get; }
      public Pending(string method, TaskCompletionSource<JToken> completion) { Method = method; Completion = completion; }
    }

    public MhpPeer(SchemaContract contract, IHostServices services, TextWriter writer)
    {
      this.contract = contract;
      this.services = services;
      this.writer = new MhpWriter(writer, contract);
      if (!services.Capabilities.Contains("lifecycle")) throw new ArgumentException("MHP_LIFECYCLE_REQUIRED", nameof(services));
    }

    public async Task RunAsync(TextReader reader)
    {
      var work = new List<Task>();
      try
      {
        while (!lifetime.IsCancellationRequested)
        {
          await writer.WaitForCapacityAsync(lifetime.Token).ConfigureAwait(false);
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
        writer.Stop();
      }
    }

    public static async Task<string?> ReadFrameAsync(TextReader reader)
    {
      var text = new System.Text.StringBuilder();
      var one = new char[1];
      var bytes = 0;
      var highSurrogate = false;
      while (await reader.ReadAsync(one, 0, 1).ConfigureAwait(false) != 0)
      {
        if (one[0] == '\n') return text.ToString().TrimEnd('\r');
        text.Append(one[0]);
        var c = one[0];
        bytes += c <= 0x7f ? 1 : c <= 0x7ff ? 2 : char.IsLowSurrogate(c) && highSurrogate ? 1 : 3;
        highSurrogate = char.IsHighSurrogate(c);
        if (bytes > SchemaContract.MaximumFrameBytes + 1 || (bytes > SchemaContract.MaximumFrameBytes && c != '\r')) throw new MhpException("invalidRequest", "MHP_PANEL_TOO_LARGE");
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

      if (frame["mhp"] != null)
      {
        if (ProtocolVersion != "mhp/1.1.0") throw new MhpException("incompatibleVersion", "MHP_INCOMPATIBLE_VERSION");
        var kind = frame["kind"]?.Type == JTokenType.String ? frame.Value<string>("kind") : null;
        if (kind != "panel" && kind != "panelError" || PanelReceiverAsync == null)
        {
          if (kind == "panelError") { SchemaContract.Validate(frame, contract.Export["panel"]?["error"] ?? throw new MhpException("internalError", "MHP_CONTRACT_ERROR")); return; }
          var code = kind == "surface" ? "MHP_PANEL_WRONG_DIRECTION" : kind == "panel" ? "MHP_PANEL_UNKNOWN_SURFACE" : "MHP_PANEL_INVALID_ENVELOPE";
          await WritePanelAsync(new JObject { ["mhp"] = "1.1", ["kind"] = "panelError", ["surface"] = null, ["seq"] = null, ["code"] = code }).ConfigureAwait(false);
          return;
        }
        await PanelReceiverAsync(frame).ConfigureAwait(false); return;
      }
      if (frame["method"] == null) { ReceiveResult(frame); return; }
      var id = frame["id"] ?? JValue.CreateNull();
      try { SchemaContract.Validate(id, contract.Export["failure"]?["properties"]?["id"] ?? throw new MhpException("internalError", "MHP_CONTRACT_ERROR")); }
      catch (MhpException) { id = JValue.CreateNull(); }
      CancellationTokenSource? cancellation = null;
      MhpWriter.ResponseReservation? reservation = null;
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
        lock (stateLock)
        {
          if (seen.Count >= MaximumRequestIds || !seen.Add(key)) throw new MhpException("invalidRequest", "MHP_DUPLICATE_ID");
          cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
          active.Add(key, cancellation);
        }
        var parameters = frame["params"] as JObject ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS");
        JToken result;
        if (method == "initialize") result = Initialize(parameters);
        else
        {
          RequireReady(definition.Value<string>("capability") ?? throw new MhpException("internalError", "MHP_CONTRACT_ERROR"));
          if (method == "shutdown") result = JValue.CreateNull();
          else
          {
            reservation = writer.ReserveResponse();
            result = await services.InvokeAsync(method, parameters, cancellation.Token).ConfigureAwait(false);
          }
        }
        cancellation.Token.ThrowIfCancellationRequested();
        var response = new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result };
        contract.ValidateResult(method, response);
        await writer.EnqueueAsync(response, reservation).ConfigureAwait(false);
        if (method == "initialize") { lock (stateLock) { foreach (var waiter in readyWaiters) waiter.TrySetResult(true); } }
        if (method == "shutdown") Stop();
      }
      catch (OperationCanceledException) { await FailAsync(id, new MhpException("cancelled", "MHP_CANCELLED"), reservation).ConfigureAwait(false); }
      catch (MhpException error) { await FailAsync(id, error, reservation).ConfigureAwait(false); }
      catch (Exception) { await FailAsync(id, new MhpException("internalError", "MHP_HOST_FAILED"), reservation).ConfigureAwait(false); }
      finally
      {
        reservation?.Dispose();
        if (cancellation != null) { lock (stateLock) { active.Remove(key); } cancellation.Dispose(); }
      }
    }

    private JToken Initialize(JObject parameters)
    {
      lock (stateLock)
      {
        if (initialized || stopped) throw new MhpException("invalidRequest", "MHP_ALREADY_INITIALIZED");
        var range = parameters["protocolRange"] ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS");
        var minimum = range.Value<string>("minimum") ?? "";
        var maximum = range.Value<string>("maximumExclusive") ?? "";
        var versions = contract.Version == "mhp/1.1.0" && CompareVersion(maximum, "mhp/1.2.0") <= 0 ? new[] { "mhp/1.1.0", "mhp/1.0.0" } : new[] { "mhp/1.0.0" };
        ProtocolVersion = versions.FirstOrDefault(v => CompareVersion(minimum, v) <= 0 && CompareVersion(v, maximum) < 0) ?? throw new MhpException("incompatibleVersion", "MHP_INCOMPATIBLE_VERSION");
        var offered = parameters["capabilities"] as JArray ?? throw new MhpException("invalidParams", "MHP_INVALID_PARAMS");
        foreach (var capability in services.Capabilities) if (offered.Values<string>().Contains(capability)) negotiated.Add(capability);
        initialized = true;
        return new JObject { ["protocolVersion"] = ProtocolVersion, ["capabilities"] = new JArray(negotiated.OrderBy(c => c, StringComparer.Ordinal)) };
      }
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
          return;
        }
        try
        {
          if (frame["error"] != null) { contract.ValidateFailure(frame); request.Completion.TrySetException(new MhpException("internalError", frame["error"]?.Value<string>("message") ?? "MHP_RUNTIME_FAILED")); }
          else { contract.ValidateResult(request.Method, frame); request.Completion.TrySetResult(frame["result"] ?? JValue.CreateNull()); }
        }
        catch (MhpException error) { request.Completion.TrySetException(error); }
      }
    }

    public async Task<JToken> RequestAsync(string method, JObject parameters, CancellationToken cancellation)
    {
      cancellation.ThrowIfCancellationRequested();
      var definition = contract.Method(method);
      RequireReady(definition.Value<string>("capability") ?? "");
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
          try { return await completion.Task.ConfigureAwait(false); }
          catch (OperationCanceledException) { wasCancelled = true; await NotifyAsync("$/cancelRequest", new JObject { ["id"] = id }).ConfigureAwait(false); throw; }
        }
      }
      finally { lock (stateLock) { pending.Remove(IdKey(id)); if (wasCancelled && cancelledRequests.Count < MaximumRequestIds) cancelledRequests.Add(IdKey(id), method); } }
    }

    public Task NotifyAsync(string method, JObject parameters)
    {
      var definition = contract.Method(method);
      RequireReady(definition.Value<string>("capability") ?? "");
      if (definition.Value<string>("direction") == "runtimeToHost" || definition.Value<string>("kind") != "notification") throw new MhpException("invalidRequest", "MHP_WRONG_DIRECTION");
      var frame = Call(method, parameters, null);
      contract.ValidateCall(method, frame);
      return WriteAsync(frame);
    }

    private static JObject Call(string method, JObject parameters, JToken? id)
    {
      var frame = new JObject { ["jsonrpc"] = "2.0", ["method"] = method, ["params"] = parameters };
      if (id != null) frame["id"] = id;
      return frame;
    }

    private Task FailAsync(JToken id, MhpException error, MhpWriter.ResponseReservation? reservation = null)
    {
      var frame = new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JObject { ["code"] = contract.Export["errorCodes"]?[error.CodeKey], ["message"] = error.Message } };
      contract.ValidateFailure(frame);
      return writer.EnqueueAsync(frame, reservation);
    }

    public Task WritePanelAsync(JObject frame)
    {
      RequireReady("lifecycle");
      if (ProtocolVersion != "mhp/1.1.0") throw new MhpException("incompatibleVersion", "MHP_INCOMPATIBLE_VERSION");
      var kind = frame.Value<string>("kind");
      var schema = kind == "surface" ? "lifecycle" : kind == "panelError" ? "error" : kind == "panel" ? "envelope" : throw new MhpException("invalidParams", "MHP_PANEL_INVALID_ENVELOPE");
      SchemaContract.Validate(frame, contract.Export["panel"]?[schema] ?? throw new MhpException("internalError", "MHP_CONTRACT_ERROR"));
      return WriteAsync(frame);
    }

    public int DropPanel(string surface) => writer.Drop(surface);
    private Task WriteAsync(JObject frame) => writer.EnqueueAsync(frame);

    private static string IdKey(JToken id) => id.Type == JTokenType.Integer || id.Type == JTokenType.Float
        ? "number:" + id.Value<long>().ToString(System.Globalization.CultureInfo.InvariantCulture)
        : id.Type + ":" + id.ToString(Formatting.None);
    private void Stop()
    {
      lock (stateLock) { stopped = true; foreach (var request in pending.Values) request.Completion.TrySetException(new MhpException("cancelled", "MHP_DISCONNECTED")); foreach (var waiter in readyWaiters) waiter.TrySetException(new MhpException("cancelled", "MHP_DISCONNECTED")); }
      lifetime.Cancel();
    }
    public void Dispose() { Stop(); writer.Stop(); lifetime.Dispose(); }
  }

  internal static class TaskStatusExtensions
  {
    internal static bool IsCompletedSuccessfully(this Task task) => task.Status == TaskStatus.RanToCompletion;
  }
}
