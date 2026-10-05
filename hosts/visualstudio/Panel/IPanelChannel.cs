using System;
using System.Threading;
using System.Threading.Tasks;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Panel
{
    // Lane B/D bind this seam once the UI relay and embedded bridge are frozen.
    // It is deliberately not encoded as an invented MHP method or frame.
    public interface IPanelChannel : IDisposable
    {
        string DocumentBootstrap { get; }
        event EventHandler<JToken> MessageReceived;
        JToken ParseWebviewMessage(string json);
        JToken ParseRuntimeMessage(JToken message);
        Task PostAsync(JToken message, CancellationToken cancellation);
    }

    public interface IPanelChannelFactory
    {
        Task<IPanelChannel> CreateAsync(MhpPeer editorServices, string surfaceId, CancellationToken cancellation);
    }
}
