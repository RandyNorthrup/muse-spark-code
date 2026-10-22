import SwiftUI
import WebKit

struct PanelWebView: NSViewRepresentable {
  @ObservedObject var model: PanelModel
  func makeCoordinator() -> Coordinator { Coordinator(model: model) }
  func makeNSView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = context.coordinator
    view.isInspectable = false
    model.webView = view
    return view
  }
  func updateNSView(_ view: WKWebView, context: Context) {
    context.coordinator.load(view)
  }
  @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
    let model: PanelModel
    var loadedOrigin: URL?
    var loadedGeneration: UUID?
    init(model: PanelModel) { self.model = model }
    func load(_ view: WKWebView) {
      let model = model
      if !model.connected {
        loadedOrigin = nil
        loadedGeneration = nil
        return
      }
      guard let launch = model.launch, loadedGeneration != model.launchGeneration else {
        return
      }
      let generation = model.launchGeneration
      loadedOrigin = launch.origin
      loadedGeneration = generation
      view.load(URLRequest(url: launch.url, cachePolicy: .reloadIgnoringLocalCacheData))
      // The page removes the fragment before exchange; retain only credential-free origin natively.
      DispatchQueue.main.async { if model.launchGeneration == generation { model.launch = nil } }
    }
    func webView(
      _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
      decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
      if !model.connected && navigationAction.request.url?.absoluteString == "about:blank" {
        decisionHandler(.allow)
        return
      }
      guard let url = navigationAction.request.url, let origin = loadedOrigin,
        LaunchLink.sameOrigin(url, origin: origin)
      else {
        decisionHandler(.cancel)
        return
      }
      decisionHandler(.allow)
    }
    func webView(
      _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
      withError error: Error
    ) {
      model.error = UI_TEXT.companionLaunchFailed
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      model.stop()
      model.error = UI_TEXT.companionLaunchFailed
    }
  }
}
