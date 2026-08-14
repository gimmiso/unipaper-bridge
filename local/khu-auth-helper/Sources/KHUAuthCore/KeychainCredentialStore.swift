import Foundation
import LocalAuthentication
import Security

public final class KeychainCredentialStore: CredentialStore {
    public static let defaultService = "com.gimmiso.unipaper.khu"

    private enum Backend {
        case dataProtection
        case loginKeychain
    }

    private let service: String

    public init(service: String = KeychainCredentialStore.defaultService) {
        self.service = service
    }

    public func replace(account: String, password: Data, accessMode: AccessMode) throws {
        guard !account.isEmpty, !password.isEmpty else {
            throw HelperError.invalidPassword
        }

        let attributes = try newItemAttributes(
            account: account,
            password: password,
            accessMode: accessMode
        )
        try removeAllIfPresent()

        let dataProtectionStatus = add(attributes, backend: .dataProtection)
        if dataProtectionStatus == errSecSuccess {
            return
        }
        guard shouldUseLoginKeychain(after: dataProtectionStatus) else {
            throw mapStatus(dataProtectionStatus)
        }

        var fallbackAttributes = attributes
        if accessMode == .unlocked {
            fallbackAttributes[Key.accessible] = kSecAttrAccessibleWhenUnlocked
        }
        let fallbackStatus = add(fallbackAttributes, backend: .loginKeychain)
        guard fallbackStatus == errSecSuccess else {
            throw mapStatus(fallbackStatus)
        }
    }

    public func status() throws -> CredentialStatus {
        for backend in [Backend.dataProtection, .loginKeychain] {
            var query = baseQuery(backend: backend)
            query[Key.returnAttributes] = true
            query[Key.matchLimit] = kSecMatchLimitOne

            var item: CFTypeRef?
            let result = SecItemCopyMatching(query as CFDictionary, &item)
            if result == errSecItemNotFound || shouldUseLoginKeychain(after: result) {
                continue
            }
            guard result == errSecSuccess, let attributes = item as? [String: Any] else {
                throw mapStatus(result)
            }
            return CredentialStatus(
                configured: true,
                accessMode: decodeAccessMode(attributes[Key.generic])
            )
        }
        return CredentialStatus(configured: false, accessMode: nil)
    }

    public func load(reason: String) throws -> StoredCredential {
        let context = LAContext()
        context.localizedReason = reason

        for backend in [Backend.dataProtection, .loginKeychain] {
            var query = baseQuery(backend: backend)
            query[Key.returnAttributes] = true
            query[Key.returnData] = true
            query[Key.matchLimit] = kSecMatchLimitOne
            query[Key.authenticationContext] = context

            var item: CFTypeRef?
            let result = SecItemCopyMatching(query as CFDictionary, &item)
            if result == errSecItemNotFound || shouldUseLoginKeychain(after: result) {
                continue
            }
            guard result == errSecSuccess else {
                throw mapStatus(result)
            }
            guard
                let attributes = item as? [String: Any],
                let account = attributes[Key.account] as? String,
                let password = attributes[Key.valueData] as? Data
            else {
                throw HelperError.keychainUnavailable
            }
            return StoredCredential(account: account, password: password)
        }
        throw HelperError.notConfigured
    }

    public func remove() throws {
        try removeAllIfPresent()
    }

    private func newItemAttributes(
        account: String,
        password: Data,
        accessMode: AccessMode
    ) throws -> [String: Any] {
        var attributes = [String: Any]()
        attributes[Key.account] = account
        attributes[Key.valueData] = password
        attributes[Key.synchronizable] = false
        attributes[Key.generic] = Data(accessMode.rawValue.utf8)

        switch accessMode {
        case .unlocked:
            attributes[Key.accessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        case .touchID:
            var accessError: Unmanaged<CFError>?
            let flags = SecAccessControlCreateFlags.biometryCurrentSet
            let protection: CFTypeRef = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard let accessControl = SecAccessControlCreateWithFlags(
                nil,
                protection,
                flags,
                &accessError
            ) else {
                throw HelperError.biometricUnavailable
            }
            attributes[Key.accessControl] = accessControl
        }
        return attributes
    }

    private func add(_ attributes: [String: Any], backend: Backend) -> OSStatus {
        var query = baseQuery(backend: backend)
        for (key, value) in attributes {
            query[key] = value
        }
        return SecItemAdd(query as CFDictionary, nil)
    }

    private func removeAllIfPresent() throws {
        for backend in [Backend.dataProtection, .loginKeychain] {
            let result = SecItemDelete(baseQuery(backend: backend) as CFDictionary)
            guard
                result == errSecSuccess ||
                result == errSecItemNotFound ||
                shouldUseLoginKeychain(after: result)
            else {
                throw mapStatus(result)
            }
        }
    }

    private func baseQuery(backend: Backend) -> [String: Any] {
        var query = [String: Any]()
        query[Key.itemClass] = kSecClassGenericPassword
        query[Key.service] = service
        if backend == .dataProtection {
            query[Key.dataProtectionKeychain] = true
        }
        return query
    }

    private func decodeAccessMode(_ value: Any?) -> AccessMode {
        guard
            let data = value as? Data,
            let rawValue = String(data: data, encoding: .utf8),
            let mode = AccessMode(rawValue: rawValue)
        else {
            return .unlocked
        }
        return mode
    }

    private func shouldUseLoginKeychain(after status: OSStatus) -> Bool {
        status == errSecMissingEntitlement || status == errSecNotAvailable || status == errSecParam
    }

    private func mapStatus(_ status: OSStatus) -> HelperError {
        if status == errSecItemNotFound { return .notConfigured }
        if status == errSecUserCanceled || status == errSecAuthFailed ||
            status == errSecInteractionNotAllowed {
            return .authenticationCancelled
        }
        return .keychainUnavailable
    }
}

private enum Key {
    static let itemClass = kSecClass as String
    static let service = kSecAttrService as String
    static let account = kSecAttrAccount as String
    static let valueData = kSecValueData as String
    static let synchronizable = kSecAttrSynchronizable as String
    static let generic = kSecAttrGeneric as String
    static let accessible = kSecAttrAccessible as String
    static let accessControl = kSecAttrAccessControl as String
    static let returnAttributes = kSecReturnAttributes as String
    static let returnData = kSecReturnData as String
    static let matchLimit = kSecMatchLimit as String
    static let authenticationContext = kSecUseAuthenticationContext as String
    static let dataProtectionKeychain = kSecUseDataProtectionKeychain as String
}
