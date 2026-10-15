import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking  // Linux only; iOS has URLSession in Foundation
#endif

/// A minimal client for the CMS's GraphQL API (README: "GraphQL API for apps"). No dependencies:
/// copy this file into an Xcode project.
///
///     let cms = VigorCMS(baseURL: URL(string: "https://cms.example.com")!)
///     try await cms.logIn(email: email, password: password)
///     try await cms.verify(code: codeFromAuthenticatorApp)
///     let imageID = try await cms.uploadImage(jpeg, filename: "ring.jpg", mimeType: "image/jpeg", alt: "Sapphire ring")
///     let product: CreatedProduct = try await cms.graphQL(createProductMutation, variables: [...])
///
/// Every request after login sends the JWT in the `Authorization` header and the cookie that the
/// two-factor check returns. This client handles that cookie itself instead of URLSession's
/// cookie storage, so it behaves the same everywhere and a stale cookie is never sent.
actor VigorCMS {
  struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  let baseURL: URL
  private let session: URLSession
  /// The JWT from the last login or refresh. It expires after 2 hours; call `refreshToken()` before.
  private(set) var token: String?
  /// `payload-2fa=…`, the proof that this login session entered its two-factor code
  private var twoFactorCookie: String?

  init(baseURL: URL, session: URLSession = URLSession(configuration: .default)) {
    self.baseURL = baseURL
    self.session = session
  }

  /// Step 1 of 2: email and password. Then ask for the code from the authenticator app.
  /// Logging in, refreshing and logging out use the REST API, which the two-factor check always
  /// lets through, so an old session can't block a new login.
  func logIn(email: String, password: String) async throws {
    struct Result: Decodable { let token: String }
    token = nil
    twoFactorCookie = nil
    var request = makeRequest(path: "api/users/login")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "email": email, "password": password,
    ])
    token = try JSONDecoder().decode(Result.self, from: try await send(request).data).token
  }

  /// Step 2 of 2: the 6-digit code from the authenticator app, or a backup code. Until this
  /// succeeds, every other request fails with "Two-factor authentication required.".
  func verify(code: String) async throws {
    var request = makeRequest(path: "api/users/2fa/verify")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
    let (_, response) = try await send(request)

    let headers = response.allHeaderFields as? [String: String] ?? [:]
    let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: request.url!)
    guard let cookie = cookies.first(where: { $0.name == "payload-2fa" }) else {
      throw APIError(message: "The CMS accepted the code but returned no two-factor cookie.")
    }
    twoFactorCookie = "\(cookie.name)=\(cookie.value)"
  }

  /// Replaces the token with a new one that is valid for another 2 hours. The two-factor check
  /// stays valid for 12 hours after `verify(code:)`; after that, log in again.
  func refreshToken() async throws {
    struct Result: Decodable { let refreshedToken: String }
    let request = makeRequest(path: "api/users/refresh-token")
    token = try JSONDecoder().decode(Result.self, from: try await send(request).data).refreshedToken
  }

  /// Ends the session on the server; the next `logIn` asks for a new two-factor code.
  func logOut() async throws {
    _ = try await send(makeRequest(path: "api/users/logout"))
    token = nil
    twoFactorCookie = nil
  }

  /// Runs a GraphQL query or mutation and decodes its `data`. Variables can be strings, numbers,
  /// booleans, arrays and nested dictionaries.
  func graphQL<T: Decodable & Sendable>(
    _ query: String, variables: [String: any Sendable] = [:]
  ) async throws -> T {
    var request = makeRequest(path: "api/graphql")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "query": query, "variables": variables,
    ])

    let response = try JSONDecoder().decode(
      GraphQLResponse<T>.self, from: try await send(request).data)
    if let errors = response.errors, !errors.isEmpty {
      throw APIError(message: errors.map(\.message).joined(separator: "\n"))
    }
    guard let data = response.data else {
      throw APIError(message: "The CMS returned no data.")
    }
    return data
  }

  /// Uploads a photo to Media and returns its ID, e.g. for a product's `image`. GraphQL can't
  /// upload files, so this uses the REST API. `alt` describes the photo for screen readers.
  func uploadImage(_ data: Data, filename: String, mimeType: String, alt: String) async throws
    -> String
  {
    struct Result: Decodable {
      struct Doc: Decodable { let id: String }
      let doc: Doc
    }

    let boundary = "Boundary-\(UUID().uuidString)"
    var body = Data()
    func append(_ string: String) { body.append(Data(string.utf8)) }

    append("--\(boundary)\r\nContent-Disposition: form-data; name=\"_payload\"\r\n\r\n")
    body.append(try JSONSerialization.data(withJSONObject: ["alt": alt]))
    append("\r\n--\(boundary)\r\n")
    append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
    append("Content-Type: \(mimeType)\r\n\r\n")
    body.append(data)
    append("\r\n--\(boundary)--\r\n")

    var request = makeRequest(path: "api/media")
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    request.httpBody = body

    return try JSONDecoder().decode(Result.self, from: try await send(request).data).doc.id
  }

  private func makeRequest(path: String) -> URLRequest {
    var request = URLRequest(url: baseURL.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.httpShouldHandleCookies = false
    if let token {
      request.setValue("JWT \(token)", forHTTPHeaderField: "Authorization")
    }
    if let twoFactorCookie {
      request.setValue(twoFactorCookie, forHTTPHeaderField: "Cookie")
    }
    return request
  }

  /// Sends the request and returns the response, or throws the CMS's error message.
  private func send(_ request: URLRequest) async throws -> (data: Data, response: HTTPURLResponse) {
    let (data, urlResponse) = try await session.data(for: request)
    guard let response = urlResponse as? HTTPURLResponse else {
      throw APIError(message: "No response from the CMS.")
    }
    let status = response.statusCode

    guard (200..<300).contains(status) else {
      struct Failure: Decodable {
        struct Message: Decodable { let message: String }
        let errors: [Message]?
      }
      let messages = (try? JSONDecoder().decode(Failure.self, from: data))?.errors?.map(\.message)
      throw APIError(message: messages?.joined(separator: "\n") ?? "HTTP \(status)")
    }
    return (data, response)
  }
}

/// GraphQL's answer: `data`, or `errors` with a message for each problem
private struct GraphQLResponse<T: Decodable>: Decodable {
  struct GraphQLError: Decodable { let message: String }
  let data: T?
  let errors: [GraphQLError]?
}
