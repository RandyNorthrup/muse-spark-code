using System.Collections.Generic;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Panel;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class PanelInboxTests
  {
    [TestMethod]
    public void ValidatesBeforePostingAndQueuesUntilTheDocumentLoads()
    {
      var posted = new List<string>();
      var parsed = 0;
      var inbox = new PanelInbox(message => { parsed++; if (message.Value<string>("type") != "fixture") throw new MhpException("invalidParams", "FIXTURE_INVALID"); return message; }, posted.Add);
      var message = new JObject { ["type"] = "fixture", ["sequence"] = 1 };
      inbox.Receive(message); message["sequence"] = 2;
      Assert.AreEqual(0, posted.Count);
      inbox.Loaded(true);
      Assert.AreEqual(1, SchemaContract.ParseObject(posted[0]).Value<int>("sequence"));
      inbox.Receive(message);
      Assert.AreEqual(2, SchemaContract.ParseObject(posted[1]).Value<int>("sequence"));
      Assert.ThrowsException<MhpException>(() => inbox.Receive(new JObject { ["type"] = "malformed" }));
      Assert.AreEqual(2, posted.Count);
      Assert.AreEqual(3, parsed);
    }

    [TestMethod]
    public void BoundsThePanelQueueAndDropsAFailedOrDisposedDocument()
    {
      var posted = new List<string>();
      var inbox = new PanelInbox(message => message, posted.Add);
      for (var count = 0; count < PanelInbox.MaximumWaitingMessages; count++) inbox.Receive(new JObject());
      Assert.ThrowsException<MhpException>(() => inbox.Receive(new JObject()));
      inbox.Loaded(false); inbox.Loaded(true);
      Assert.AreEqual(0, posted.Count);
      inbox.Navigating(); inbox.Receive(new JObject());
      Assert.AreEqual(0, posted.Count);
      inbox.Loaded(true); Assert.AreEqual(1, posted.Count);
      inbox.Navigating(); inbox.Receive(new JObject()); inbox.Clear(); inbox.Loaded(true);
      Assert.AreEqual(1, posted.Count);
      Assert.ThrowsException<MhpException>(() => inbox.Receive(new JObject { ["text"] = new string('x', SchemaContract.MaximumFrameChars) }));
    }
  }
}
