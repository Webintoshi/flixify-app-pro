import Foundation

public enum FirebaseClientConfiguration {
    public static func valid(_ data: Data, bundleID: String) -> Bool {
        guard data.count <= 16_384,
            let config = try? PropertyListSerialization.propertyList(from:data,format:nil) as? [String:Any],
            config["BUNDLE_ID"] as? String == bundleID else { return false }
        let patterns = ["GOOGLE_APP_ID":"^1:[0-9]+:ios:[0-9a-f]+$", "API_KEY":"^AIza[0-9A-Za-z_-]{35}$", "PROJECT_ID":"^[a-z][a-z0-9-]{4,28}[a-z0-9]$", "GCM_SENDER_ID":"^[0-9]{6,20}$"]
        return patterns.allSatisfy { key,pattern in (config[key] as? String)?.range(of:pattern,options:.regularExpression) != nil }
    }
}
