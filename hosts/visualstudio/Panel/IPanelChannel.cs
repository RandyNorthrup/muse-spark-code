using System;
using System.Threading;
using System.Threading.Tasks;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  // The WebView2 adapter talks to the schema-validated MHP 1.5 relay.
  public interface IPanelChannel : IDisposable
  {
    string DocumentBootstrap { get; }
    event EventHandler<JToken>? MessageReceived;
    JToken ParseWebviewMessage(string json);
    JToken ParseRuntimeMessage(JToken message);
    Task PostAsync(JToken message, CancellationToken cancellation);
  }

}
