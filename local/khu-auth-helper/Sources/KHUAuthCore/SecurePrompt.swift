import Darwin
import Foundation

public enum SecurePrompt {
    public static func readAccount(prompt: String = "KHU ID: ") throws -> String {
        FileHandle.standardError.write(Data(prompt.utf8))
        guard let value = readLine(strippingNewline: true) else {
            throw HelperError.invalidAccount
        }
        let account = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            !account.isEmpty,
            account.count <= 128,
            !account.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else {
            throw HelperError.invalidAccount
        }
        return account
    }

    public static func readSecret(prompt: String) throws -> Data {
        var buffer = [CChar](repeating: 0, count: 1_025)
        defer {
            buffer.withUnsafeMutableBytes { bytes in
                if let baseAddress = bytes.baseAddress {
                    bzero(baseAddress, bytes.count)
                }
            }
        }

        let result = buffer.withUnsafeMutableBufferPointer { pointer in
            readpassphrase(
                prompt,
                pointer.baseAddress,
                pointer.count,
                RPP_ECHO_OFF | RPP_REQUIRE_TTY
            )
        }
        guard result != nil else {
            throw HelperError.invalidPassword
        }

        let byteCount = buffer.prefix { $0 != 0 }.count
        guard byteCount > 0, byteCount < buffer.count - 1 else {
            throw HelperError.invalidPassword
        }
        return buffer.withUnsafeBytes { bytes in
            Data(bytes.prefix(byteCount))
        }
    }
}
