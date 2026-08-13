import AppKit
import Foundation
import WebKit

@MainActor
public final class KHUAuthBrowser: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let accessURL: URL
    private let credentialStore: CredentialStore
    private var credentialAttempted = false
    private var window: NSWindow?
    private var webView: WKWebView?
    private var statusLabel: NSTextField?

    public init(accessURL: URL, credentialStore: CredentialStore) {
        self.accessURL = accessURL
        self.credentialStore = credentialStore
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
        NSApp.terminate(nil)
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

    private func isKHULoginPage(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" &&
            url.host?.lowercased() == "lib.khu.ac.kr" &&
            (url.path == "/login" || url.path.hasPrefix("/login/"))
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
public func runKHUBrowser(accessURL: URL, credentialStore: CredentialStore) {
    let application = NSApplication.shared
    let delegate = KHUAuthBrowser(accessURL: accessURL, credentialStore: credentialStore)
    application.delegate = delegate
    application.run()
    withExtendedLifetime(delegate) {}
}
