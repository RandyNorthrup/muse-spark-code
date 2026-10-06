using System;
using System.Threading;
using System.Threading.Tasks;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  // The reviewed MHP envelope is the only relay; native validation uses its frozen export.
  public sealed class PanelChannel : IPanelChannel
  {
    private readonly MhpPeer peer;
    private readonly SchemaContract contract;
    private readonly JObject binding;
    private readonly SemaphoreSlim sending = new SemaphoreSlim(1);
    private long outgoing;
    private long incoming;
    private bool ready;
    private bool disposed;
    public string SurfaceId => binding.Value<string>("surface") ?? throw Invalid();
    public string SurfaceKind => binding.Value<string>("surfaceKind") ?? throw Invalid();
    public event EventHandler<JToken>? MessageReceived;

    public const string Bootstrap = @"(() => {
      const listeners = new Set();
      const key = 'muse-panel-state';
      const host = Object.freeze({
        postMessage(payload) { window.chrome.webview.postMessage(payload); },
        onMessage(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        getState() { const saved = sessionStorage.getItem(key); return saved === null ? undefined : JSON.parse(saved); },
        setState(value) { sessionStorage.setItem(key, JSON.stringify(value)); }
      });
      Object.defineProperty(window, 'museHost', { value: host, configurable: false });
      window.chrome.webview.addEventListener('message', event => {
        for (const listener of listeners) listener(event.data);
      });
      window.addEventListener('pagehide', () => listeners.clear(), { once: true });
    })();";
    public string DocumentBootstrap => Bootstrap;

    public PanelChannel(MhpPeer peer, SchemaContract contract, string surface, string session, string kind)
    {
      this.peer = peer; this.contract = contract;
      binding = new JObject { ["surface"] = surface, ["sessionId"] = session, ["surfaceKind"] = kind };
      contract.ValidatePanel(binding, "binding");
      peer.PanelReceived += Receive;
    }

    public Task OpenAsync() => LifecycleAsync("opened");
    public Task ReloadAsync()
    {
      ready = false;
      var frame = LifecycleFrame("reloaded");
      frame["stateRequest"] = SurfaceKind == "whatsNew" ? JValue.CreateNull() : new JObject { ["type"] = SurfaceKind == "tasks" ? "tasksReady" : "ready" };
      return peer.PostPanelAsync(frame);
    }

    public JToken ParseWebviewMessage(string json)
    {
      var payload = SchemaContract.ParseObject(json);
      contract.ValidatePayload(payload, "toHost", SurfaceKind);
      return payload;
    }
    public JToken ParseRuntimeMessage(JToken message)
    {
      contract.ValidatePayload(message, "toPanel", SurfaceKind);
      return message;
    }

    public async Task PostAsync(JToken message, CancellationToken cancellation)
    {
      contract.ValidatePayload(message, "toHost", SurfaceKind);
      await sending.WaitAsync(cancellation).ConfigureAwait(false);
      try
      {
        if (disposed) throw new MhpException("cancelled", "MHP_SURFACE_CLOSED");
        cancellation.ThrowIfCancellationRequested();
        if (!ready)
        {
          if (message.Value<string>("type") != (SurfaceKind == "tasks" ? "tasksReady" : "ready")) throw Invalid();
          await LifecycleAsync("ready").ConfigureAwait(false);
          ready = true;
        }
        var envelope = new JObject
        {
          ["mhp"] = "1.2",
          ["kind"] = "panel",
          ["direction"] = "toHost",
          ["surface"] = SurfaceId,
          ["seq"] = outgoing + 1,
          ["payload"] = message
        };
        await peer.PostPanelAsync(envelope).ConfigureAwait(false);
        outgoing++;
      }
      finally { sending.Release(); }
    }

    private void Receive(object sender, JObject frame)
    {
      if (disposed || frame.Value<string>("surface") != SurfaceId) return;
      if (frame.Value<string>("kind") == "panelError") throw new MhpException("invalidRequest", frame.Value<string>("code") ?? "MHP_PANEL_INVALID_ENVELOPE");
      if (frame.Value<string>("kind") != "panel") return;
      contract.ValidatePanel(frame, "envelope");
      if (!ready || frame.Value<string>("direction") != "toPanel" || frame.Value<long>("seq") != incoming + 1) throw Invalid();
      var payload = ParseRuntimeMessage(frame["payload"] ?? throw Invalid());
      incoming++;
      MessageReceived?.Invoke(this, payload);
    }

    private JObject LifecycleFrame(string value)
    {
      var frame = (JObject)binding.DeepClone();
      frame["mhp"] = "1.2"; frame["kind"] = "surface"; frame["event"] = value;
      return frame;
    }
    private Task LifecycleAsync(string value) => peer.PostPanelAsync(LifecycleFrame(value));
    public async Task CloseAsync()
    {
      await sending.WaitAsync().ConfigureAwait(false);
      try
      {
        if (disposed) return;
        disposed = true;
        peer.PanelReceived -= Receive;
        var frame = LifecycleFrame("closed"); frame["droppedMessages"] = 0;
        await peer.PostPanelAsync(frame).ConfigureAwait(false);
      }
      finally { sending.Release(); }
    }
    public void Dispose() { disposed = true; peer.PanelReceived -= Receive; }
    private static MhpException Invalid() => new MhpException("invalidParams", "MHP_PANEL_INVALID_PAYLOAD");
  }
}
