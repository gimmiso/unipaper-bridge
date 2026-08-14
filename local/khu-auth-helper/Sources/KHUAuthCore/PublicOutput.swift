import Foundation

public struct PublicResult: Codable, Equatable {
    public let status: String
    public let credentialExposed: Bool
    public let accessMode: AccessMode?
    public let code: String?

    enum CodingKeys: String, CodingKey {
        case status
        case credentialExposed = "credential_exposed"
        case accessMode = "access_mode"
        case code
    }

    public init(
        status: String,
        accessMode: AccessMode? = nil,
        code: String? = nil
    ) {
        self.status = status
        self.credentialExposed = false
        self.accessMode = accessMode
        self.code = code
    }

    public static func failure(_ error: HelperError) -> PublicResult {
        PublicResult(status: "error", code: error.publicCode)
    }

    public func encodedLine() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(self)
        data.append(0x0A)
        return data
    }
}
