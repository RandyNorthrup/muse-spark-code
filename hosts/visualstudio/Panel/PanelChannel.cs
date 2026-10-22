using System;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  // The reviewed MHP envelope is the only relay; native validation uses its frozen export.
  public sealed class PanelChannel : IPanelChannel, IPanelEndpoint
  {
    private readonly MhpPeer peer;
    private readonly SchemaContract contract;
    private readonly JObject binding;
    private readonly string themeScript;
    private readonly SemaphoreSlim sending = new SemaphoreSlim(1);
    private readonly object closing = new object();
    private long outgoing;
    private long incoming;
    private bool ready;
    private bool hasBeenReady;
    // Read by the receive loop and by browser posts; set once, under `closing`.
    private volatile bool disposed;
    private bool closeOwed;
    public string SurfaceId => binding.Value<string>("surface") ?? throw Invalid();
    public string SurfaceKind => binding.Value<string>("surfaceKind") ?? throw Invalid();
    private string ReadyType => SurfaceKind == "tasks" ? "tasksReady" : SchemaContract.IsPresentationSurface(SurfaceKind) ? "presentationReady" : SurfaceKind == "usage" ? "readUsage" : "ready";
    public event EventHandler<JToken>? MessageReceived;
    // Raised once when a protocol error closed this channel, with the frozen panelError code.
    public event EventHandler<string>? Faulted;
    public string? FaultCode { get; private set; }
    internal long LastReceivedSequence => Interlocked.Read(ref incoming);

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
    public string DocumentBootstrap => Bootstrap + themeScript;

    public PanelChannel(MhpPeer peer, SchemaContract contract, string surface, string session, string kind, JObject? theme = null)
    {
      this.peer = peer; this.contract = contract;
      binding = new JObject { ["surface"] = surface, ["sessionId"] = session, ["surfaceKind"] = kind };
      contract.ValidatePanel(binding, "binding");
      themeScript = theme == null ? "" : ThemeBootstrap(contract, theme);
      peer.AttachPanel(this);
    }

    public static string ThemeBootstrap(SchemaContract contract, JObject theme)
    {
      SchemaContract.Validate(theme, contract.Method("initialize")["call"]?["properties"]?["params"]?["properties"]?["theme"] ?? throw Invalid());
      var kind = theme.Value<string>("kind") ?? throw Invalid();
      var cssKind = kind == "highContrastLight" ? "hc-light" : kind == "highContrastDark" ? "hc-dark" : kind;
      var tokens = new JObject();
      foreach (var property in (theme["tokens"] as JObject ?? throw Invalid()).Properties())
      {
        var value = property.Value.Value<string>() ?? throw Invalid();
        if (Regex.IsMatch(value, @"[;{}<>@]|url\s*\(", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1))) throw Invalid();
        var name = Regex.Replace(property.Name.Replace("--muse-", "--ms-"), "[A-Z]", match => "-" + match.Value.ToLowerInvariant());
        tokens[name] = value;
      }
      var data = new JObject { ["kind"] = cssKind, ["tokens"] = tokens }.ToString(Formatting.None);
      // The script is installed by WebView2 before document creation, not as HTML.
      return "(() => { const theme = " + data + @"; const apply = () => {
        document.documentElement.dataset.theme = theme.kind;
        for (const [name, value] of Object.entries(theme.tokens)) document.documentElement.style.setProperty(name, value);
      }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true }); else apply(); })();";
    }

    public Task OpenAsync() => LifecycleAsync("opened");
    public async Task ReloadAsync()
    {
      await sending.WaitAsync().ConfigureAwait(false);
      try
      {
        if (disposed) throw new MhpException("cancelled", "MHP_SURFACE_CLOSED");
        ready = false;
        var frame = LifecycleFrame("reloaded");
        frame["stateRequest"] = SurfaceKind == "whatsNew" ? JValue.CreateNull() : new JObject { ["type"] = ReadyType };
        await peer.PostPanelAsync(frame).ConfigureAwait(false);
      }
      finally { sending.Release(); }
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
          if (message.Value<string>("type") != ReadyType) throw Invalid();
          await LifecycleAsync("ready").ConfigureAwait(false);
          ready = true;
          hasBeenReady = true;
        }
        var envelope = new JObject
        {
          ["mhp"] = "1.5",
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

    // The peer has validated the envelope. Each refusal names its frozen panelError code; nothing advances on refusal.
    public void Receive(JObject frame)
    {
      if (disposed || frame.Value<string>("surface") != SurfaceId) throw Refused("MHP_PANEL_UNKNOWN_SURFACE");
      if (frame.Value<string>("kind") != "panel") throw Refused("MHP_PANEL_INVALID_ENVELOPE");
      if (frame.Value<string>("direction") != "toPanel") throw Refused("MHP_PANEL_WRONG_DIRECTION");
      if (frame.Value<long>("seq") != incoming + 1) throw Refused("MHP_PANEL_OUT_OF_ORDER");
      // Replies already in flight may enter the bounded inbox during reload.
      if (!hasBeenReady) throw Refused("MHP_PANEL_NOT_READY");
      JToken payload;
      try { payload = ParseRuntimeMessage(frame["payload"] ?? throw Invalid()); }
      catch (MhpException) { throw Refused("MHP_PANEL_INVALID_PAYLOAD"); }
      incoming++;
      MessageReceived?.Invoke(this, payload);
    }

    // Synchronous, before any write: overlapping receives find no endpoint, browser posts find a closed channel.
    public bool Fail(string code)
    {
      peer.DetachPanel(this);
      lock (closing)
      {
        if (disposed) return false;
        disposed = true;
        FaultCode = code;
        closeOwed = true;
      }
      return true;
    }

    public async Task CloseFaultedAsync()
    {
      string? code = null;
      await sending.WaitAsync().ConfigureAwait(false);
      try
      {
        lock (closing)
        {
          if (closeOwed) code = FaultCode;
          closeOwed = false;
        }
        if (code == null) return;
        ready = false;
        var frame = LifecycleFrame("closed"); frame["droppedMessages"] = 0;
        await peer.PostPanelAsync(frame).ConfigureAwait(false);
      }
      finally
      {
        sending.Release();
        // Outside the send lock: a subscriber may dispose the view, and with it this channel.
        if (code != null) Faulted?.Invoke(this, code);
      }
    }

    private JObject LifecycleFrame(string value)
    {
      var frame = (JObject)binding.DeepClone();
      frame["mhp"] = "1.5"; frame["kind"] = "surface"; frame["event"] = value;
      return frame;
    }
    private Task LifecycleAsync(string value) => peer.PostPanelAsync(LifecycleFrame(value));
    public async Task CloseAsync()
    {
      await sending.WaitAsync().ConfigureAwait(false);
      try
      {
        lock (closing)
        {
          if (disposed) return;
          disposed = true;
        }
        peer.DetachPanel(this);
        var frame = LifecycleFrame("closed"); frame["droppedMessages"] = 0;
        await peer.PostPanelAsync(frame).ConfigureAwait(false);
      }
      finally { sending.Release(); }
    }
    public void Dispose()
    {
      lock (closing) { disposed = true; }
      peer.DetachPanel(this);
    }
    private static MhpException Invalid() => new MhpException("invalidParams", "MHP_PANEL_INVALID_PAYLOAD");
    private static MhpException Refused(string code) => new MhpException("invalidRequest", code);
  }
}
