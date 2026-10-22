using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class MhpPanelChannel : IPanelChannel
  {
    private readonly MhpPeer peer;
    private readonly JObject binding;
    private readonly string script;
    private readonly Action<string> warning;
    private readonly object gate = new object();
    private long outgoing = 1;
    private long incoming = 1;
    private bool ready;
    private bool closed;
    private bool reloaded;
    private JToken? savedState;
    public event EventHandler<JToken>? MessageReceived;
    public string Surface => binding.Value<string>("surface") ?? throw Invalid();
    public string SessionId => binding.Value<string>("sessionId") ?? throw Invalid();
    private string Kind => binding.Value<string>("surfaceKind") ?? throw Invalid();

    public MhpPanelChannel(MhpPeer peer, string sessionId, string kind, string script, Action<string> warning)
    {
      this.peer = peer; this.script = script; this.warning = warning;
      binding = new JObject { ["surface"] = Guid.NewGuid().ToString("N"), ["sessionId"] = sessionId, ["surfaceKind"] = kind };
      SchemaContract.Validate(binding, Schema("binding"));
      if (peer.PanelReceiverAsync != null) throw new InvalidOperationException("MHP_PANEL_RECEIVER_ALREADY_BOUND");
      peer.PanelReceiverAsync = ReceiveAsync;
      peer.PanelSurface = Surface;
    }

    public string DocumentBootstrap
    {
      get
      {
        lock (gate)
        {
          var configuration = new JObject { ["binding"] = binding.DeepClone(), ["outgoing"] = outgoing, ["incoming"] = incoming, ["reloaded"] = reloaded };
          if (savedState != null) configuration["state"] = savedState.DeepClone();
          return script + "\nMuseVisualStudio.install(window," + configuration.ToString(Formatting.None) + ");";
        }
      }
    }

    private JToken Schema(string key) => peer.Contract.Export["panel"]?[key] ?? throw Invalid();
    private static MhpException Invalid() => new MhpException("invalidParams", "MHP_PANEL_INVALID_PAYLOAD");
    private JObject Lifecycle(string name)
    {
      var frame = binding.DeepClone() as JObject ?? throw Invalid();
      frame["mhp"] = "1.1"; frame["kind"] = "surface"; frame["event"] = name;
      return frame;
    }
    public Task OpenAsync() => peer.WritePanelAsync(Lifecycle("opened"));

    public Task ReadyAsync()
    {
      lock (gate)
      {
        if (closed) throw new MhpException("invalidRequest", "MHP_PANEL_UNKNOWN_SURFACE");
        var write = peer.WritePanelAsync(Lifecycle("ready"));
        ready = true; return write;
      }
    }

    public Task ReloadAsync()
    {
      lock (gate)
      {
        if (closed) throw new MhpException("invalidRequest", "MHP_PANEL_UNKNOWN_SURFACE");
        var frame = Lifecycle("reloaded");
        frame["stateRequest"] = Kind == "whatsNew" ? JValue.CreateNull() : new JObject { ["type"] = Kind == "tasks" ? "tasksReady" : Kind == "usage" ? "readUsage" : "ready" };
        var write = peer.WritePanelAsync(frame);
        ready = false; reloaded = true; return write;
      }
    }

    public Task HiddenAsync() => peer.WritePanelAsync(Lifecycle("hidden"));

    public Task CloseAsync()
    {
      lock (gate)
      {
        if (closed) return Task.CompletedTask;
        var dropped = peer.DropPanel(Surface);
        closed = true; ready = false; savedState = null;
        if (dropped != 0) warning("MHP_PANEL_DROPPED " + dropped.ToString(System.Globalization.CultureInfo.InvariantCulture));
        var frame = Lifecycle("closed"); frame["droppedMessages"] = dropped;
        return peer.WritePanelAsync(frame);
      }
    }

    public void SaveState(JToken state)
    {
      SchemaContract.Validate(state, peer.Contract.Export["embeddedBridge"]?["setState"]?["state"] ?? throw Invalid());
      lock (gate) { if (closed) throw Invalid(); savedState = state.DeepClone(); }
    }

    public JToken ParseWebviewMessage(string json)
    {
      var frame = SchemaContract.ParseObject(json);
      if (frame["bridge"] != null)
      {
        if (frame["bridge"]?.Type != JTokenType.String) throw Invalid();
        var properties = new JObject { ["bridge"] = new JObject { ["const"] = frame.Value<string>("bridge") == "state" ? "state" : "subscribed" } };
        var required = new JArray("bridge");
        if (frame.Value<string>("bridge") == "state")
        {
          SchemaContract.Validate(frame["state"] ?? throw Invalid(), peer.Contract.Export["embeddedBridge"]?["setState"]?["state"] ?? throw Invalid());
          properties["state"] = new JObject(); required.Add("state");
        }
        SchemaContract.Validate(frame, new JObject { ["type"] = "object", ["properties"] = properties, ["required"] = required, ["additionalProperties"] = false });
        return frame;
      }
      lock (gate) { ValidateEnvelope(frame, "toHost", outgoing); }
      return frame;
    }

    public JToken ParseRuntimeMessage(JToken message)
    {
      SchemaContract.Validate(message, Schema("envelope"));
      return message;
    }

    private void ValidateEnvelope(JToken frame, string direction, long sequence)
    {
      var variants = Schema("envelope")["oneOf"] as JArray ?? throw Invalid();
      var receivedDirection = frame["direction"]?.Type == JTokenType.String ? frame.Value<string>("direction") : null;
      var shape = variants.FirstOrDefault(v => v["properties"]?["direction"]?.Value<string>("const") == receivedDirection)?.DeepClone() as JObject;
      if (shape == null) throw new MhpException("invalidParams", "MHP_PANEL_INVALID_ENVELOPE");
      if (!(shape["properties"] is JObject properties)) throw Invalid();
      properties["payload"] = new JObject();
      try { SchemaContract.Validate(frame, shape); }
      catch (MhpException) { throw new MhpException("invalidParams", "MHP_PANEL_INVALID_ENVELOPE"); }
      if (System.Text.Encoding.UTF8.GetByteCount(frame.ToString(Formatting.None)) > SchemaContract.MaximumFrameBytes) throw new MhpException("invalidParams", "MHP_PANEL_TOO_LARGE");
      if (closed || frame.Value<string>("surface") != Surface) throw new MhpException("invalidRequest", "MHP_PANEL_UNKNOWN_SURFACE");
      if (frame.Value<string>("direction") != direction) throw new MhpException("invalidRequest", "MHP_PANEL_WRONG_DIRECTION");
      if (frame.Value<long>("seq") != sequence) throw new MhpException("invalidRequest", "MHP_PANEL_OUT_OF_ORDER");
      if (!ready) throw new MhpException("invalidRequest", "MHP_PANEL_NOT_READY");
      var payload = frame["payload"] ?? throw Invalid();
      var vocabulary = variants.First(v => v["properties"]?["direction"]?.Value<string>("const") == direction)["properties"]?["payload"]?["anyOf"] as JArray ?? throw Invalid();
      var chosen = Kind == "tasks" ? vocabulary[1] : Kind == "whatsNew" && direction == "toHost" ? vocabulary[2] : vocabulary[0];
      if (Kind == "whatsNew" && direction == "toPanel") throw Invalid();
      SchemaContract.Validate(payload, chosen);
    }

    public Task PostAsync(JToken message, CancellationToken cancellation)
    {
      cancellation.ThrowIfCancellationRequested();
      lock (gate)
      {
        ValidateEnvelope(message, "toHost", outgoing);
        if (!(message is JObject frame)) throw Invalid();
        var write = peer.WritePanelAsync(frame); outgoing++; return write;
      }
    }

    public Task ReceiveAsync(JObject frame)
    {
      try
      {
        lock (gate)
        {
          if (frame["kind"]?.Type == JTokenType.String && frame.Value<string>("kind") == "panelError")
          {
            SchemaContract.Validate(frame, Schema("error")); warning(frame.Value<string>("code") ?? throw Invalid()); return Task.CompletedTask;
          }
          ValidateEnvelope(frame, "toPanel", incoming);
          incoming++;
        }
        MessageReceived?.Invoke(this, frame); return Task.CompletedTask;
      }
      catch (MhpException error)
      {
        var surface = frame["surface"]?.Type == JTokenType.String && !string.IsNullOrEmpty(frame.Value<string>("surface")) ? frame["surface"] : JValue.CreateNull();
        var seq = frame["seq"]?.Type == JTokenType.Integer && frame.Value<double>("seq") >= 0 && frame.Value<double>("seq") <= 9007199254740991 ? frame["seq"] : JValue.CreateNull();
        var refusal = new JObject { ["mhp"] = "1.1", ["kind"] = "panelError", ["surface"] = surface, ["seq"] = seq, ["code"] = error.Message.StartsWith("MHP_PANEL_", StringComparison.Ordinal) ? error.Message : "MHP_PANEL_INVALID_PAYLOAD" };
        return peer.WritePanelAsync(refusal);
      }
    }

    public void Dispose() { lock (gate) { closed = true; ready = false; savedState = null; } if (peer.PanelSurface == Surface) peer.PanelSurface = null; peer.PanelReceiverAsync = null; }
  }
}
