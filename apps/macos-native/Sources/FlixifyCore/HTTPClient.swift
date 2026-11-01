import Foundation

struct HTTPResult: Sendable {
    let data: Data
    let status: Int
}

private final class PendingResponse {
    let continuation: CheckedContinuation<HTTPResult, Error>
    var data = Data()
    var status = 0
    var failure: FlixifyError?
    init(_ continuation: CheckedContinuation<HTTPResult, Error>) { self.continuation = continuation }
}

private final class BoundedDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    weak var owner: HTTPClient?
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        completionHandler(owner?.receive(response, task: dataTask) == true ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) { owner?.receive(data, task: dataTask) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { owner?.complete(task, error: error) }
}

final class HTTPClient: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: [Int: PendingResponse] = [:]
    private let delegate = BoundedDelegate()
    private var session: URLSession!
    let maximumBytes = 20 * 1024 * 1024

    init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.urlCache = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 15
        configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.httpMaximumConnectionsPerHost = 3
        delegate.owner = self
        session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }

    func request(url: URL, method: String = "GET", body: [String: Any]? = nil, token: String? = nil) async throws -> HTTPResult {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.scheme == "https", parts.host != nil, parts.user == nil, parts.password == nil, parts.fragment == nil else { throw FlixifyError.invalidData }
        var request = URLRequest(url: url); request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body = body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        request.setValue("native", forHTTPHeaderField: "X-Flixify-Client-Runtime")
        let task = session.dataTask(with: request)
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock(); pending[task.taskIdentifier] = PendingResponse(continuation); lock.unlock()
                task.resume()
                if Task.isCancelled { task.cancel() }
            }
        }, onCancel: { task.cancel() })
    }
    fileprivate func receive(_ response: URLResponse, task: URLSessionDataTask) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard let value = pending[task.taskIdentifier], let response = response as? HTTPURLResponse, response.url == task.originalRequest?.url else { return false }
        value.status = response.statusCode
        guard response.expectedContentLength <= Int64(maximumBytes) else { value.failure = .limit; return false }
        return true
    }
    fileprivate func receive(_ data: Data, task: URLSessionDataTask) {
        lock.lock()
        guard let value = pending[task.taskIdentifier] else { lock.unlock(); return }
        if data.count > maximumBytes - value.data.count { value.failure = .limit; lock.unlock(); task.cancel(); return }
        value.data.append(data); lock.unlock()
    }
    fileprivate func complete(_ task: URLSessionTask, error: Error?) {
        lock.lock(); let value = pending.removeValue(forKey: task.taskIdentifier); lock.unlock()
        guard let value = value else { return }
        if let failure = value.failure { value.continuation.resume(throwing: failure) }
        else if error != nil { value.continuation.resume(throwing: FlixifyError.network) }
        else if value.status == 0 { value.continuation.resume(throwing: FlixifyError.network) }
        else { value.continuation.resume(returning: HTTPResult(data: value.data, status: value.status)) }
    }
}
