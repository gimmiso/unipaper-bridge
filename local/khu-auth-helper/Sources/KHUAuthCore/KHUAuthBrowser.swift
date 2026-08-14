import AppKit
import Foundation
import WebKit

@MainActor
public final class KHUAuthBrowser: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let accessURL: URL
    private let credentialStore: CredentialStore
    private let downloadDestination: URL?
    private var credentialAttempted = false
    private var automaticPdfPages = Set<String>()
    private(set) var downloadCompleted = false
    private var window: NSWindow?
    private var webView: WKWebView?
    private var statusLabel: NSTextField?

    public init(
        accessURL: URL,
        credentialStore: CredentialStore,
        downloadDestination: URL? = nil
    ) {
        self.accessURL = accessURL
        self.credentialStore = credentialStore
        self.downloadDestination = downloadDestination
    }

    public func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        installMainMenu()

        let frame = NSRect(x: 0, y: 0, width: 1_180, height: 820)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "UniPaper · KHU"
        window.center()
        window.delegate = self

        let container = NSView(frame: frame)
        container.autoresizingMask = [.width, .height]

        let statusLabel = NSTextField(labelWithString: "기존 로그인 세션을 확인하고 있습니다…")
        statusLabel.frame = NSRect(x: 16, y: frame.height - 42, width: frame.width - 32, height: 24)
        statusLabel.autoresizingMask = [.width, .minYMargin]
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.textColor = .secondaryLabelColor

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        let webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: frame.width, height: frame.height - 52),
            configuration: configuration
        )
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self

        container.addSubview(webView)
        container.addSubview(statusLabel)
        window.contentView = container

        self.window = window
        self.webView = webView
        self.statusLabel = statusLabel

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: accessURL, cachePolicy: .reloadRevalidatingCacheData))
    }

    public func windowWillClose(_ notification: Notification) {
        NSApp.stop(nil)
    }

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        statusLabel?.stringValue = "페이지를 여는 중…"
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        guard let url = webView.url else {
            statusLabel?.stringValue = "페이지 주소를 확인할 수 없습니다. 창에서 직접 로그인해 주세요."
            return
        }

        if isKHULoginPage(url) {
            fillLoginIfNeeded(in: webView)
        } else if downloadDestination != nil {
            statusLabel?.stringValue = "이 논문의 PDF 1편을 자동으로 찾고 있습니다…"
            attemptAutomaticPdf(in: webView, pageURL: url)
        } else {
            statusLabel?.stringValue = "브라우저 세션을 사용 중입니다. 필요한 경우 페이지 안내에 따라 진행하세요."
        }
    }

    public func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation?,
        withError error: Error
    ) {
        statusLabel?.stringValue = "페이지를 열지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요."
    }

    public func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation?,
        withError error: Error
    ) {
        statusLabel?.stringValue = "페이지에 연결하지 못했습니다. 주소와 네트워크를 확인하세요."
    }

    public func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let requestURL = navigationAction.request.url {
            webView.load(URLRequest(url: requestURL))
        }
        return nil
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if downloadDestination != nil && navigationAction.shouldPerformDownload {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        guard downloadDestination != nil else {
            decisionHandler(.allow)
            return
        }
        let mimeType = navigationResponse.response.mimeType?.lowercased() ?? ""
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?
            .lowercased() ?? ""
        if mimeType == "application/pdf" || disposition.contains(".pdf") {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    public func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload
    ) {
        prepare(download)
    }

    public func webView(
        _ webView: WKWebView,
        navigationResponse: WKNavigationResponse,
        didBecome download: WKDownload
    ) {
        prepare(download)
    }

    public func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        guard let destination = downloadDestination else {
            completionHandler(nil)
            return
        }
        try? FileManager.default.removeItem(at: destination)
        completionHandler(destination)
    }

    public func downloadDidFinish(_ download: WKDownload) {
        guard let destination = downloadDestination, isValidPdf(destination) else {
            statusLabel?.stringValue = "받은 파일이 PDF가 아닙니다. 다른 PDF 버튼을 눌러 주세요."
            return
        }
        downloadCompleted = true
        statusLabel?.stringValue = "PDF 1편을 안전한 임시 폴더에 저장했습니다."
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.window?.close()
        }
    }

    public func download(
        _ download: WKDownload,
        didFailWithError error: Error,
        resumeData: Data?
    ) {
        if let destination = downloadDestination {
            try? FileManager.default.removeItem(at: destination)
        }
        statusLabel?.stringValue = "PDF 저장을 완료하지 못했습니다. 페이지의 PDF 버튼을 다시 눌러 주세요."
    }

    private func isKHULoginPage(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" &&
            url.host?.lowercased() == "lib.khu.ac.kr" &&
            (url.path == "/login" || url.path.hasPrefix("/login/"))
    }

    private func prepare(_ download: WKDownload) {
        guard
            let source = download.originalRequest?.url?.absoluteString,
            KHUAccessURLPolicy.isSafeDownloadURL(source)
        else {
            download.cancel { _ in }
            statusLabel?.stringValue = "안전하지 않은 PDF 주소는 저장하지 않았습니다."
            return
        }
        download.delegate = self
        statusLabel?.stringValue = "PDF 1편을 이 Mac의 임시 폴더에 저장하고 있습니다…"
    }

    private func isValidPdf(_ url: URL) -> Bool {
        guard
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
            let size = attributes[.size] as? NSNumber,
            size.int64Value >= 5,
            size.int64Value <= 100 * 1024 * 1024,
            let handle = try? FileHandle(forReadingFrom: url)
        else { return false }
        defer { try? handle.close() }
        let header = try? handle.read(upToCount: 5)
        return header == Data("%PDF-".utf8)
    }

    private func attemptAutomaticPdf(in webView: WKWebView, pageURL: URL) {
        let pageKey = pageURL.absoluteString
        guard automaticPdfPages.insert(pageKey).inserted else {
            statusLabel?.stringValue = "자동으로 찾지 못하면 이 페이지의 PDF 버튼을 한 번 눌러 주세요."
            return
        }

        let script = #"""
        (() => {
          const candidates = [];
          const meta = document.querySelector('meta[name="citation_pdf_url" i]');
          if (meta?.content) {
            try {
              candidates.push({ href: new URL(meta.content, location.href).href, score: 1000 });
            } catch {}
          }
          const elements = Array.from(document.querySelectorAll('a[href]'));
          for (const element of elements) {
            const href = element.href;
            const label = [
              element.textContent,
              element.getAttribute('aria-label'),
              element.getAttribute('title'),
              href
            ].filter(Boolean).join(' ').toLowerCase();
            let score = 0;
            if (/download\s*(full\s*text\s*)?pdf|pdf\s*download|pdf\s*다운로드/.test(label)) score += 500;
            if (/view\s*(full\s*text\s*)?pdf|full\s*text\s*pdf|원문\s*보기/.test(label)) score += 420;
            if (/\bpdf\b/.test(label)) score += 250;
            if (href && /(?:\.pdf(?:[?#]|$)|\/pdf(?:[/?#]|$)|pdfdownload)/i.test(href)) score += 300;
            if (element.hasAttribute('download')) score += 250;
            if (/supplement|supporting|appendix|dataset|citation/.test(label)) score -= 700;
            if (score > 0) candidates.push({ href, score });
          }
          candidates.sort((a, b) => b.score - a.score);
          const best = candidates[0];
          return best?.href ?? null;
        })();
        """#

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self, weak webView] in
            guard let self, let webView, webView.url == pageURL else { return }
            webView.evaluateJavaScript(script) { [weak self, weak webView] result, _ in
                guard
                    let href = result as? String,
                    KHUAccessURLPolicy.isSafeDownloadURL(href),
                    let candidateURL = URL(string: href)
                else {
                    self?.statusLabel?.stringValue =
                        "자동으로 찾지 못했습니다. 이 페이지의 PDF 버튼을 한 번 눌러 주세요."
                    return
                }
                webView?.load(URLRequest(url: candidateURL))
            }
        }
    }

    private func fillLoginIfNeeded(in webView: WKWebView) {
        guard !credentialAttempted else {
            statusLabel?.stringValue = "자동 로그인이 완료되지 않았습니다. 페이지 안내를 확인해 주세요."
            return
        }
        credentialAttempted = true
        statusLabel?.stringValue = "이 Mac의 Keychain에서 로그인 정보를 사용하고 있습니다…"

        var credential: StoredCredential
        do {
            credential = try credentialStore.load(reason: "경희대학교 도서관 로그인에 저장된 정보를 사용합니다.")
        } catch HelperError.notConfigured {
            statusLabel?.stringValue = "저장된 로그인 정보가 없습니다. 창에서 직접 로그인하거나 setup을 실행하세요."
            return
        } catch {
            statusLabel?.stringValue = "Keychain 접근이 승인되지 않았습니다. 창에서 직접 로그인할 수 있습니다."
            return
        }
        defer { credential.clear() }

        guard let password = String(data: credential.password, encoding: .utf8) else {
            statusLabel?.stringValue = "저장된 로그인 정보를 읽을 수 없습니다. setup을 다시 실행하세요."
            return
        }

        let script = #"""
        const idField = document.querySelector('#id');
        const passwordField = document.querySelector('#password');
        const form = document.querySelector('#login');
        if (!(idField instanceof HTMLInputElement) ||
            !(passwordField instanceof HTMLInputElement) ||
            !(form instanceof HTMLFormElement)) {
          return 'missing-form';
        }
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        ).set;
        valueSetter.call(idField, account);
        valueSetter.call(passwordField, password);
        for (const field of [idField, passwordField]) {
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.querySelector('button[type="submit"]')?.click();
        }
        return 'submitted';
        """#

        webView.callAsyncJavaScript(
            script,
            arguments: [
                "account": credential.account,
                "password": password,
            ],
            in: nil,
            in: .page
        ) { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success(let value) where value as? String == "submitted":
                    self?.statusLabel?.stringValue = "로그인 요청을 보냈습니다. 페이지가 열릴 때까지 기다려 주세요."
                case .success:
                    self?.statusLabel?.stringValue = "로그인 양식이 변경되었습니다. 창에서 직접 로그인해 주세요."
                case .failure:
                    self?.statusLabel?.stringValue = "자동 로그인을 완료하지 못했습니다. 창에서 직접 로그인해 주세요."
                }
            }
        }
    }

    private func installMainMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)

        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "UniPaper · KHU 종료",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu
        NSApp.mainMenu = mainMenu
    }
}

@MainActor
public func runKHUBrowser(
    accessURL: URL,
    credentialStore: CredentialStore,
    downloadDestination: URL? = nil
) -> Bool {
    let application = NSApplication.shared
    let delegate = KHUAuthBrowser(
        accessURL: accessURL,
        credentialStore: credentialStore,
        downloadDestination: downloadDestination
    )
    application.delegate = delegate
    application.run()
    let completed = delegate.downloadCompleted
    withExtendedLifetime(delegate) {}
    return completed
}
