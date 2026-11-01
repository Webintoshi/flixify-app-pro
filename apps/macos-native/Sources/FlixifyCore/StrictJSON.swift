import Foundation

enum StrictJSON {
    private struct Frame { let object: Bool; var expectingKey: Bool; var keys: Set<String> }
    static func validate(_ data: Data, uniqueKeys: Bool = false) throws {
        let bytes = [UInt8](data); var stack: [Frame] = [], index = 0
        while index < bytes.count {
            switch bytes[index] {
            case 34:
                let start = index; index += 1; var escaped = false
                while index < bytes.count {
                    if escaped { escaped = false }
                    else if bytes[index] == 92 { escaped = true }
                    else if bytes[index] == 34 { break }
                    index += 1
                }
                guard index < bytes.count else { throw FlixifyError.invalidData }
                if uniqueKeys, !stack.isEmpty, stack[stack.count - 1].object, stack[stack.count - 1].expectingKey {
                    guard let key = try? JSONDecoder().decode(String.self, from: Data(bytes[start...index])), stack[stack.count - 1].keys.insert(key).inserted else { throw FlixifyError.invalidData }
                    stack[stack.count - 1].expectingKey = false
                }
            case 123: stack.append(Frame(object: true, expectingKey: true, keys: []))
            case 91: stack.append(Frame(object: false, expectingKey: false, keys: []))
            case 125, 93: guard !stack.isEmpty else { throw FlixifyError.invalidData }; stack.removeLast()
            case 44: if !stack.isEmpty && stack[stack.count - 1].object { stack[stack.count - 1].expectingKey = true }
            default: break
            }
            guard stack.count <= 64 else { throw FlixifyError.invalidData }; index += 1
        }
        guard stack.isEmpty else { throw FlixifyError.invalidData }
    }
}
