import Darwin
import Foundation
import KHUAuthCore

@main
@MainActor
struct KHUAuthHelperCommand {
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        let store = KeychainCredentialStore()

        do {
            guard let command = arguments.first else {
                throw HelperError.invalidArguments
            }

            switch command {
            case "setup":
                try setup(arguments: Array(arguments.dropFirst()), store: store)
            case "status":
                guard arguments.count == 1 else { throw HelperError.invalidArguments }
                let current = try store.status()
                emit(
                    PublicResult(
                        status: current.configured ? "configured" : "not_configured",
                        accessMode: current.accessMode
                    )
                )
            case "open":
                guard arguments.count == 2 else { throw HelperError.invalidArguments }
                let url = try KHUAccessURLPolicy.validate(arguments[1])
                runKHUBrowser(accessURL: url, credentialStore: store)
                emit(PublicResult(status: "browser_closed"))
            case "remove":
                guard arguments == ["remove", "--yes"] else {
                    throw HelperError.invalidArguments
                }
                try store.remove()
                emit(PublicResult(status: "removed"))
            case "help", "--help", "-h":
                printHelp()
            default:
                throw HelperError.invalidArguments
            }
        } catch let error as HelperError {
            emit(.failure(error))
            exit(EXIT_FAILURE)
        } catch {
            emit(.failure(.keychainUnavailable))
            exit(EXIT_FAILURE)
        }
    }

    private static func setup(arguments: [String], store: CredentialStore) throws {
        let mode: AccessMode
        switch arguments {
        case []:
            mode = .unlocked
        case ["--touch-id"]:
            mode = .touchID
        default:
            throw HelperError.invalidArguments
        }

        let account = try SecurePrompt.readAccount()
        var password = try SecurePrompt.readSecret(prompt: "KHU Password: ")
        defer { password.resetBytes(in: 0..<password.count) }
        var confirmation = try SecurePrompt.readSecret(prompt: "Confirm Password: ")
        defer { confirmation.resetBytes(in: 0..<confirmation.count) }

        guard password == confirmation else {
            throw HelperError.passwordMismatch
        }
        try store.replace(account: account, password: password, accessMode: mode)
        emit(PublicResult(status: "stored", accessMode: mode))
    }

    private static func emit(_ result: PublicResult) {
        guard let data = try? result.encodedLine() else {
            return
        }
        FileHandle.standardOutput.write(data)
    }

    private static func printHelp() {
        let help = """
        khu-keychain-helper setup [--touch-id]
        khu-keychain-helper status
        khu-keychain-helper open <KHU access URL>
        khu-keychain-helper remove --yes

        Passwords are accepted only through a secure terminal prompt and are never
        returned on stdout, stderr, MCP results, or command-line arguments.
        """
        FileHandle.standardOutput.write(Data((help + "\n").utf8))
    }
}
