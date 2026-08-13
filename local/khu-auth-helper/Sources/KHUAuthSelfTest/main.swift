import Foundation
import KHUAuthCore

private struct TestFailure: Error {
    let message: String
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw TestFailure(message: message) }
}

private func requireInvalidURL(_ rawValue: String) throws {
    do {
        _ = try KHUAccessURLPolicy.validate(rawValue)
        throw TestFailure(message: "Expected URL rejection")
    } catch HelperError.invalidAccessURL {
        return
    }
}

@main
struct KHUAuthSelfTest {
    static func main() throws {
        let secret = "never-emit-this-secret"
        let account = "2025999999"
        let publicOutput = String(
            decoding: try PublicResult(status: "stored", accessMode: .unlocked).encodedLine(),
            as: UTF8.self
        )
        try require(!publicOutput.contains(secret), "Public output contained a secret")
        try require(!publicOutput.contains(account), "Public output contained an account")
        try require(!publicOutput.contains("password"), "Public output contained a password field")
        try require(!publicOutput.contains("account"), "Public output contained an account field")
        try require(
            publicOutput.contains("\"credential_exposed\":false"),
            "Public output omitted the credential boundary"
        )

        let failureOutput = String(
            decoding: try PublicResult.failure(.keychainUnavailable).encodedLine(),
            as: UTF8.self
        )
        try require(
            failureOutput ==
                "{\"code\":\"keychain_unavailable\",\"credential_exposed\":false,\"status\":\"error\"}\n",
            "Failure output was not allowlisted"
        )

        let validURL = try KHUAccessURLPolicy.validate(
            "https://openlink.khu.ac.kr/link.n2s?url=https://doi.org/10.1000/example"
        )
        try require(validURL.host == "openlink.khu.ac.kr", "Reviewed proxy URL was rejected")
        try requireInvalidURL(
            "https://openlink.khu.ac.kr/link.n2s?url=http://127.0.0.1/admin"
        )
        try requireInvalidURL(
            "https://openlink.khu.ac.kr/link.n2s?url=http://2130706433/admin"
        )
        try requireInvalidURL(
            "https://openlink.khu.ac.kr/link.n2s?url=https://webgate.khu.ac.kr/link.n2s"
        )

        if ProcessInfo.processInfo.environment["KHU_KEYCHAIN_INTEGRATION"] == "1" {
            let service = "com.gimmiso.unipaper.khu.test.\(UUID().uuidString)"
            let store = KeychainCredentialStore(service: service)
            defer { try? store.remove() }
            let password = Data("temporary-integration-secret".utf8)
            try store.replace(
                account: "integration-test",
                password: password,
                accessMode: .unlocked
            )
            let currentStatus = try store.status()
            try require(
                currentStatus == CredentialStatus(configured: true, accessMode: .unlocked),
                "Keychain status did not match"
            )
            var loaded = try store.load(reason: "UniPaper Keychain integration test")
            defer { loaded.clear() }
            try require(loaded.account == "integration-test", "Keychain account did not match")
            try require(loaded.password == password, "Keychain password did not match")
        }

        print("KHU helper security self-test passed (5 checks).")
    }
}
