using System;
using System.Collections.Generic;
using System.Text;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MuseSpark.VisualStudio.Panel;
using MuseSpark.VisualStudio.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class WindowsPanelInboxTests
  {
    private static JObject Payload(string text) => new JObject { ["type"] = "notice", ["level"] = "warning", ["text"] = text };
    private static PanelInbox Inbox(List<string> output) => new PanelInbox(value =>
    {
      SchemaContract.Load().ValidatePayload(value, "toPanel", "chat");
      return value;
    }, output.Add);

    [TestMethod]
    public void CountsUtf8BytesBeforeAdmissionAndNeverPostsAnOversizePayload()
    {
      var output = new List<string>(); var inbox = Inbox(output);
      var text = Payload(new string('Ω', SchemaContract.MaximumFrameChars / 2));
      Assert.IsTrue(text.ToString(Formatting.None).Length < SchemaContract.MaximumFrameChars);
      Assert.ThrowsException<MhpException>(() => inbox.Receive(text));
      inbox.Loaded(true); Assert.AreEqual(0, output.Count);
    }

    [TestMethod]
    public void BoundsAggregateBytesAndReturnsCapacityAfterDrainOrFailure()
    {
      var output = new List<string>(); var inbox = Inbox(output);
      var payload = Payload(new string('Ω', SchemaContract.MaximumFrameChars / 2 - 100));
      Assert.IsTrue(Encoding.UTF8.GetByteCount(payload.ToString(Formatting.None)) < SchemaContract.MaximumFrameChars);
      inbox.Receive(payload); inbox.Receive(payload);
      Assert.ThrowsException<MhpException>(() => inbox.Receive(payload));
      inbox.Loaded(true); Assert.AreEqual(2, output.Count);
      inbox.Navigating(); inbox.Receive(payload); inbox.Loaded(false);
      inbox.Receive(payload); inbox.Receive(payload); inbox.Loaded(true);
      Assert.AreEqual(4, output.Count);
      inbox.Clear(); inbox.Receive(Payload("after clear")); inbox.Loaded(true);
      Assert.AreEqual(5, output.Count);
    }
  }
}
