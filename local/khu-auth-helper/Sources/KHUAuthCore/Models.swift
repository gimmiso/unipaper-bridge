import Foundation

public enum AccessMode: String, Codable, Equatable {
    case unlocked
    case touchID = "touch-id"
}

public struct CredentialStatus: Equatable {
    public let configured: Bool
    public let accessMode: AccessMode?

    public init(configured: Bool, accessMode: AccessMode?) {
        self.configured = configured
        self.accessMode = accessMode
    }
}

public struct StoredCredential {
    public let account: String
    public private(set) var password: Data

    public init(account: String, password: Data) {
        self.account = account
        self.password = password
    }

    public mutating func clear() {
        password.resetBytes(in: 0..<password.count)
        password.removeAll(keepingCapacity: false)
    }
}

public protocol CredentialStore {
    func replace(account: String, password: Data, accessMode: AccessMode) throws
    func status() throws -> CredentialStatus
    func load(reason: String) throws -> StoredCredential
    func remove() throws
}

public enum HelperError: Error, Equatable {
    case invalidArguments
    case invalidAccount
    case invalidPassword
    case passwordMismatch
    case invalidAccessURL
    case unsupportedPlatform
    case notConfigured
    case authenticationCancelled
    case keychainUnavailable
    case biometricUnavailable
    case browserLaunchFailed

    public var publicCode: String {
        switch self {
        case .invalidArguments: return "invalid_arguments"
        case .invalidAccount: return "invalid_account"
        case .invalidPassword: return "invalid_password"
        case .passwordMismatch: return "password_mismatch"
        case .invalidAccessURL: return "invalid_access_url"
        case .unsupportedPlatform: return "unsupported_platform"
        case .notConfigured: return "not_configured"
        case .authenticationCancelled: return "authentication_cancelled"
        case .keychainUnavailable: return "keychain_unavailable"
        case .biometricUnavailable: return "biometric_unavailable"
        case .browserLaunchFailed: return "browser_launch_failed"
        }
    }
}
