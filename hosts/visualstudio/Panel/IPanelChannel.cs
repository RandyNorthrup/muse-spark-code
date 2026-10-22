using System;
using System.Threading;
using System.Threading.Tasks;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
  // Browser implementation is injected; the production channel consumes the schema-validated MHP relay.
  public interface IPanelChannel : IDisposable
  {
    string DocumentBootstrap { get; }
    event EventHandler<JToken>? MessageReceived;
    JToken ParseWebviewMessage(string json);
    JToken ParseRuntimeMessage(JToken message);
    Task PostAsync(JToken message, CancellationToken cancellation);
    Task ReadyAsync();
    Task ReloadAsync();
    Task HiddenAsync();
    Task CloseAsync();
    void SaveState(JToken state);
  }

}
