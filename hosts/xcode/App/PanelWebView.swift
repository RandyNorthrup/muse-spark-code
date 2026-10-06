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
    if !model.connected {
      context.coordinator.loadedOrigin = nil
      return
    }
    guard let launch = model.launch, context.coordinator.loadedOrigin != launch.origin else {
      return
    }
    context.coordinator.loadedOrigin = launch.origin
    view.load(URLRequest(url: launch.url, cachePolicy: .reloadIgnoringLocalCacheData))
    // The page removes the fragment before exchange; retain only credential-free origin natively.
    DispatchQueue.main.async { model.launch = nil }
  }
  @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
    let model: PanelModel
    var loadedOrigin: URL?
    init(model: PanelModel) { self.model = model }
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
