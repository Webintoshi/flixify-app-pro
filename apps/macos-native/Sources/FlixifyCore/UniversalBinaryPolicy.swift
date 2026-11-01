import Foundation

public enum UniversalBinaryPolicy {
    public static func verify(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize, size > 0, size <= 512 * 1024 * 1024 else { throw FlixifyError.invalidData }
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        guard let header = try handle.read(upToCount: 4096) else { throw FlixifyError.invalidData }
        try validateHeader(header, fileSize: UInt64(size))
    }

    public static func validateHeader(_ data: Data, fileSize: UInt64) throws {
        let bytes = [UInt8](data)
        guard bytes.count >= 8 else { throw FlixifyError.invalidData }
        func integer(_ offset: Int, count: Int, little: Bool) throws -> UInt64 {
            guard offset >= 0, count <= 8, offset + count <= bytes.count else { throw FlixifyError.invalidData }
            let range = Array(bytes[offset..<(offset + count)])
            return (little ? range.reversed().map { $0 } : range).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        }
        let magic = try integer(0, count: 4, little: false)
        let little = magic == 0xbebafeca || magic == 0xbfbafeca
        let wide = magic == 0xcafebabf || magic == 0xbfbafeca
        guard [UInt64(0xcafebabe), 0xbebafeca, 0xcafebabf, 0xbfbafeca].contains(magic) else { throw FlixifyError.invalidData }
        let count = try integer(4, count: 4, little: little), stride = wide ? 32 : 20
        guard (2...8).contains(count), 8 + Int(count) * stride <= bytes.count else { throw FlixifyError.invalidData }
        let tableEnd = UInt64(8 + Int(count) * stride)
        var ranges: [(offset: UInt64, size: UInt64)] = [], architectures = Set<UInt64>()
        for index in 0..<Int(count) {
            let base = 8 + index * stride
            let cpu = try integer(base, count: 4, little: little)
            let offset = try integer(base + 8, count: wide ? 8 : 4, little: little)
            let length = try integer(base + (wide ? 16 : 12), count: wide ? 8 : 4, little: little)
            guard architectures.insert(cpu).inserted, offset >= tableEnd, length > 0, length <= fileSize,
                offset <= fileSize - length, !ranges.contains(where: { offset < $0.offset + $0.size && $0.offset < offset + length }) else { throw FlixifyError.invalidData }
            architectures.insert(cpu); ranges.append((offset, length))
        }
        guard architectures.contains(0x0100000c), architectures.contains(0x01000007) else { throw FlixifyError.invalidData }
    }
}
