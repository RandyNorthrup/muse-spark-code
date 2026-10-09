using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.VisualStudio.Threading;
using MuseSpark.VisualStudio.Panel;
using Newtonsoft.Json.Linq;

namespace MuseSpark.VisualStudio.Test
{
  [TestClass]
  public sealed class NativeUiTests
  {
    private static Task OnStaAsync(Action<JoinableTaskContext> work)
    {
      var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
      var thread = new Thread(() =>
      {
        try { using (var context = new JoinableTaskContext()) work(context); completion.SetResult(true); }
        catch (Exception error) { completion.SetException(error); }
      });
      thread.SetApartmentState(ApartmentState.STA); thread.IsBackground = true; thread.Start();
      return completion.Task;
    }
    private static T[] Children<T>(DependencyObject parent) where T : DependencyObject
    {
      var children = Enumerable.Range(0, VisualTreeHelper.GetChildrenCount(parent)).Select(i => VisualTreeHelper.GetChild(parent, i)).ToArray();
      return children.OfType<T>().Concat(children.SelectMany(Children<T>)).ToArray();
    }
    private static Func<Exception?> Inspect(string title, Action<Window> inspect)
    {
      Exception? failure = null;
      RoutedEventHandler loaded = (sender, args) =>
      {
        if (sender is Window window && window.Title == title)
        {
          try { inspect(window); }
          catch (Exception error) { failure = error; window.Close(); }
        }
      };
      EventManager.RegisterClassHandler(typeof(Window), FrameworkElement.LoadedEvent, loaded);
      // A unique title scopes the observer to this fixture's window.
      return () => failure;
    }
    private static UiText Text() => new UiText(Path.Combine(RuntimeAndPackageTests.PluginRoot(), "assets"));

    [TestMethod]
    // A real STA window pumps Win32 messages and can wait on the desktop scheduler.
    [Timeout(10000)]
    public async Task PricedConsentShowsExactChoicesOnceAndReturnsTheOpaqueDenyId()
    {
      await OnStaAsync(context =>
      {
        var title = Guid.NewGuid().ToString("N");
        using (var ui = new NativeUi(context.Factory, Text(), identifier => Assert.Fail(identifier)))
        {
          var prompts = 0;
          var timer = Inspect(title, window =>
          {
            prompts++;
            Assert.IsTrue(Children<TextBlock>(window).Any(block => block.Text.Contains("$0.01") && block.Text.Contains("$1.00")));
            var buttons = Children<Button>(window);
            Assert.IsFalse(buttons.Any(button => button.IsDefault));
            CollectionAssert.AreEquivalent(new[] { "Allow once", "Allow always in this workspace", "Deny", Text()["questionCancel"] }, buttons.Select(button => button.Content?.ToString()).ToArray());
            buttons.Single(button => button.Content?.ToString() == "Deny").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
          });
          try
          {
            var result = context.Factory.Run(() => ui.InvokeAsync("ui/confirm", new JObject
            {
              ["title"] = title,
              ["message"] = "Fixture search: $0.01 per use, shared daily budget $1.00",
              ["choices"] = new JArray(new JObject { ["id"] = 1, ["title"] = "Allow once" }, new JObject { ["id"] = "always", ["title"] = "Allow always in this workspace" }, new JObject { ["id"] = "1", ["title"] = "Deny" })
            }, CancellationToken.None));
            Assert.AreEqual(JTokenType.String, result.Type); Assert.AreEqual("1", result.Value<string>()); Assert.AreEqual(1, prompts);
          }
          finally { if (timer() is Exception failure) throw failure; }
        }
      });
    }

    [TestMethod]
    // Native window creation and cancellation use the STA desktop message pump.
    [Timeout(10000)]
    public async Task CancellingAnActiveDialogClosesItWithoutGrantingConsent()
    {
      await OnStaAsync(context =>
      {
        var title = Guid.NewGuid().ToString("N");
        using (var cancellation = new CancellationTokenSource())
        using (var ui = new NativeUi(context.Factory, Text(), identifier => Assert.Fail(identifier)))
        {
          var timer = Inspect(title, window => cancellation.Cancel());
          try
          {
            Assert.ThrowsException<OperationCanceledException>(() => context.Factory.Run(() => ui.InvokeAsync("ui/confirm", new JObject
            {
              ["title"] = title,
              ["message"] = "Fixture priced consent",
              ["choices"] = new JArray(new JObject { ["id"] = "allow", ["title"] = "Allow once" })
            }, cancellation.Token)));
          }
          finally { if (timer() is Exception failure) throw failure; }
        }
      });
    }

    [TestMethod]
    // Real status windows require the native STA desktop message pump.
    [Timeout(10000)]
    public async Task StatusIdsRetainTheirJsonTypeAndDisposeClosesEveryWindow()
    {
      await OnStaAsync(context =>
      {
        var numericTitle = Guid.NewGuid().ToString("N");
        var stringTitle = Guid.NewGuid().ToString("N");
        Window? numeric = null; Window? textId = null;
        var first = Inspect(numericTitle, window => numeric = window);
        var second = Inspect(stringTitle, window => textId = window);
        using (var ui = new NativeUi(context.Factory, Text(), identifier => Assert.Fail(identifier)))
        {
          context.Factory.Run(() => ui.InvokeAsync("ui/status", new JObject { ["id"] = 1, ["text"] = numericTitle, ["visible"] = true }, CancellationToken.None));
          context.Factory.Run(() => ui.InvokeAsync("ui/status", new JObject { ["id"] = "1", ["text"] = stringTitle, ["visible"] = true }, CancellationToken.None));
          Assert.IsTrue(numeric?.IsVisible == true); Assert.IsTrue(textId?.IsVisible == true);
          context.Factory.Run(() => ui.InvokeAsync("ui/status", new JObject { ["id"] = 1.0, ["text"] = numericTitle, ["visible"] = false }, CancellationToken.None));
          Assert.IsFalse(numeric?.IsVisible == true); Assert.IsTrue(textId?.IsVisible == true);
        }
        Assert.IsFalse(textId?.IsVisible == true);
        if (first() is Exception failure) throw failure;
        if (second() is Exception other) throw other;
      });
    }
  }
}
