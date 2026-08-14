import Darwin
import Foundation

public enum KHUAccessURLPolicy {
    private static let proxyHosts = Set([
        "openlink.khu.ac.kr",
        "webgate.khu.ac.kr",
    ])

    public static func validate(_ rawValue: String) throws -> URL {
        guard
            rawValue.count <= 4_096,
            let components = URLComponents(string: rawValue),
            components.scheme?.lowercased() == "https",
            components.user == nil,
            components.password == nil,
            components.port == nil || components.port == 443,
            let host = components.host?.lowercased(),
            proxyHosts.contains(host),
            components.path == "/link.n2s",
            components.fragment == nil,
            let targetValue = components.queryItems?.first(where: { $0.name == "url" })?.value,
            isSafePublicTarget(targetValue)
        else {
            throw HelperError.invalidAccessURL
        }

        let urlItems = components.queryItems?.filter { $0.name == "url" } ?? []
        guard urlItems.count == 1, let url = components.url else {
            throw HelperError.invalidAccessURL
        }
        return url
    }

    public static func isSafeDownloadURL(_ rawValue: String) -> Bool {
        guard let components = URLComponents(string: rawValue) else { return false }
        if let host = components.host?.lowercased(), proxyHosts.contains(host) {
            return (try? validate(rawValue)) != nil
        }
        return isSafePublicTarget(rawValue)
    }

    private static func isSafePublicTarget(_ rawValue: String) -> Bool {
        guard
            rawValue.count <= 4_096,
            let target = URLComponents(string: rawValue),
            let scheme = target.scheme?.lowercased(),
            scheme == "https" || scheme == "http",
            target.user == nil,
            target.password == nil,
            let host = target.host?.lowercased(),
            !host.isEmpty,
            !isPrivateHost(host),
            !proxyHosts.contains(host)
        else {
            return false
        }
        return true
    }

    private static func isPrivateHost(_ host: String) -> Bool {
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") ||
            host.hasSuffix(".internal") || host.hasSuffix(".invalid") ||
            host.hasSuffix(".test") || host.hasSuffix(".home.arpa") {
            return true
        }

        if host.contains(":") {
            return true
        }

        var address = in_addr()
        return host.withCString { inet_aton($0, &address) } != 0
    }
}
