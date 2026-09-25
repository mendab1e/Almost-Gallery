import Foundation
import CryptoKit

struct GalleryError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

struct ExportOptions: Codable, Equatable {
  var resize = "2000x2000"
  var quality = 85

  func validated() throws -> Self {
    let expression = try NSRegularExpression(pattern: "^[0-9]+x[0-9]+[><^!]?$", options: [])
    let range = NSRange(resize.startIndex..<resize.endIndex, in: resize)
    guard expression.firstMatch(in: resize, range: range) != nil else {
      throw GalleryError(message: "Resize must look like 2000x2000 (optional suffix: >, <, ^, or !).")
    }
    guard (1...100).contains(quality) else {
      throw GalleryError(message: "Quality must be a whole number from 1 to 100.")
    }
    return self
  }
}

struct ExportManifest: Codable {
  let version: Int
  let imageMagick: ExportOptions
  let photos: [String]
}

struct Photo: Identifiable, Equatable {
  let url: URL
  var id: String { url.path }
  var name: String { url.lastPathComponent }
}

struct LoadedAlbum {
  let folder: URL
  let identity: AlbumIdentity
  let photos: [Photo]
  let options: ExportOptions
  let savedPhotos: [String]?
  let warning: String?
}

struct AlbumIdentity: Equatable {
  let volume: UInt64
  let file: UInt64
}

struct ExportResult {
  let output: URL
  let backupsNeedingCleanup: [URL]
}

enum GalleryCore {
  static let manifestName = "almost_gallery_output.json"
  static let supportedExtensions: Set<String> = ["jpg", "jpeg", "png", "webp", "tif", "tiff", "heic", "heif"]
  private static let magickLock = NSLock()
  private static var discoveredMagick: String?

  static func cachedMagickPath() throws -> String {
    magickLock.lock()
    defer { magickLock.unlock() }
    if let discoveredMagick { return discoveredMagick }
    let path = try magickPath()
    discoveredMagick = path
    return path
  }

  static func outputName(_ index: Int, total: Int) -> String {
    let width = max(3, String(max(0, total - 1)).count)
    return String(format: "%0*d.jpg", width, index)
  }

  static func loadAlbum(_ folder: URL, fileManager: FileManager = .default) throws -> LoadedAlbum {
    let directory = folder.standardizedFileURL.resolvingSymlinksInPath()
    let identity = try albumIdentity(directory, fileManager: fileManager)
    let entries = try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    var photos = entries.filter { url in
      guard supportedExtensions.contains(url.pathExtension.lowercased()),
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]) else { return false }
      return values.isRegularFile == true && values.isSymbolicLink != true
    }.map(Photo.init)
    photos.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }

    let manifestURL = directory.appendingPathComponent(manifestName)
    guard fileManager.fileExists(atPath: manifestURL.path) else {
      return LoadedAlbum(folder: directory, identity: identity, photos: photos, options: ExportOptions(), savedPhotos: nil, warning: nil)
    }
    do {
      let manifest = try JSONDecoder().decode(ExportManifest.self, from: Data(contentsOf: manifestURL))
      guard manifest.version == 1 else { throw GalleryError(message: "The saved export file has an unsupported format.") }
      let options = try manifest.imageMagick.validated()
      let positions = Dictionary(manifest.photos.enumerated().map { ($0.element, $0.offset) }, uniquingKeysWith: { first, _ in first })
      photos.sort { left, right in
        switch (positions[left.name], positions[right.name]) {
        case let (l?, r?): return l < r
        case (_?, nil): return true
        case (nil, _?): return false
        default: return left.name.localizedStandardCompare(right.name) == .orderedAscending
        }
      }
      return LoadedAlbum(folder: directory, identity: identity, photos: photos, options: options, savedPhotos: manifest.photos, warning: nil)
    } catch {
      return LoadedAlbum(folder: directory, identity: identity, photos: photos, options: ExportOptions(), savedPhotos: nil,
                         warning: "Could not load \(manifestName): \(error.localizedDescription)")
    }
  }

  static func albumIdentity(_ folder: URL, fileManager: FileManager = .default) throws -> AlbumIdentity {
    let directory = folder.standardizedFileURL
    guard directory.resolvingSymlinksInPath() == directory,
          let values = try? directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
          values.isDirectory == true, values.isSymbolicLink != true,
          let attributes = try? fileManager.attributesOfItem(atPath: directory.path),
          let volume = attributes[.systemNumber] as? NSNumber,
          let file = attributes[.systemFileNumber] as? NSNumber else {
      throw GalleryError(message: "The selected album is missing or has changed. Open it again.")
    }
    return AlbumIdentity(volume: volume.uint64Value, file: file.uint64Value)
  }

  static func validatePhotos(folder: URL, photos: [Photo], expectedAlbumIdentity: AlbumIdentity? = nil,
                             fileManager: FileManager = .default) throws {
    let album = folder.standardizedFileURL
    let currentIdentity = try albumIdentity(album, fileManager: fileManager)
    guard expectedAlbumIdentity == nil || currentIdentity == expectedAlbumIdentity else {
      throw GalleryError(message: "The selected album has changed. Open it again before exporting.")
    }
    var seen = Set<String>()
    guard !photos.isEmpty else { throw GalleryError(message: "Open a folder containing photos before exporting.") }
    for photo in photos {
      let source = photo.url.standardizedFileURL
      guard source.deletingLastPathComponent() == folder.standardizedFileURL,
            supportedExtensions.contains(source.pathExtension.lowercased()),
            seen.insert(source.path).inserted,
            let values = try? source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
            values.isRegularFile == true, values.isSymbolicLink != true,
            source.resolvingSymlinksInPath() == source else {
        throw GalleryError(message: "The photo list contains an invalid file.")
      }
    }
  }

  static func magickPath(environment: [String: String] = ProcessInfo.processInfo.environment) throws -> String {
    let paths = [environment["ALMOST_GALLERY_MAGICK"], "/opt/homebrew/bin/magick", "/usr/local/bin/magick", "/usr/bin/magick"]
      .compactMap { $0 } + (environment["PATH"] ?? "").split(separator: ":").map { "\($0)/magick" }
    if let path = paths.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) { return path }
    throw GalleryError(message: "ImageMagick was not found. Install it with: brew install imagemagick")
  }

  static func runMagick(_ executable: String, _ arguments: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    let errorURL = FileManager.default.temporaryDirectory.appendingPathComponent("almost-gallery-magick-\(UUID().uuidString).log")
    try Data().write(to: errorURL)
    defer { try? FileManager.default.removeItem(at: errorURL) }
    let errorHandle = try FileHandle(forWritingTo: errorURL)
    defer { try? errorHandle.close() }
    process.standardError = errorHandle
    try process.run()
    process.waitUntilExit()
    try errorHandle.close()
    let detail = try String(contentsOf: errorURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    guard process.terminationStatus == 0 else {
      throw GalleryError(message: detail.isEmpty ? "ImageMagick exited with code \(process.terminationStatus)." : detail)
    }
  }

  static func thumbnailURL(for photo: Photo, cache: URL) throws -> URL {
    let attributes = try FileManager.default.attributesOfItem(atPath: photo.url.path)
    let size = attributes[.size] as? NSNumber ?? 0
    let modified = (attributes[.modificationDate] as? Date ?? .distantPast).timeIntervalSince1970
    let identity = "\(photo.url.standardizedFileURL.path)\0\(size)\0\(modified)"
    let hash = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    return cache.appendingPathComponent("\(hash).jpg")
  }

  static func makeThumbnail(photo: Photo, cache: URL, magick: String,
                            convert: ((String, [String]) throws -> Void)? = nil) throws -> URL {
    let fm = FileManager.default
    try fm.createDirectory(at: cache, withIntermediateDirectories: true)
    let destination = try thumbnailURL(for: photo, cache: cache)
    if fm.fileExists(atPath: destination.path) { return destination }
    let temporary = cache.appendingPathComponent("\(UUID().uuidString).tmp.jpg")
    defer { try? fm.removeItem(at: temporary) }
    try (convert ?? runMagick)(magick, ["-limit", "thread", "1", photo.url.path, "-auto-orient", "-thumbnail", "640x640>",
                                     "-background", "#e8e6e0", "-alpha", "remove", "-alpha", "off", "-strip", "-quality", "72", temporary.path])
    try fm.moveItem(at: temporary, to: destination)
    return destination
  }

  static func thumbnailOrOriginal(photo: Photo, folder: URL, cache: URL, magick: String,
                                  convert: ((String, [String]) throws -> Void)? = nil) throws -> URL {
    try validatePhotos(folder: folder, photos: [photo])
    return (try? makeThumbnail(photo: photo, cache: cache, magick: magick, convert: convert)) ?? photo.url
  }

  static func export(folder: URL, photos: [Photo], options: ExportOptions, magick: String,
                     expectedAlbumIdentity: AlbumIdentity,
                     progress: (Int, Int) -> Void = { _, _ in },
                     convert: ((String, [String]) throws -> Void)? = nil,
                     removeBackup: ((URL) throws -> Void)? = nil,
                     installManifest: ((URL, URL) throws -> Void)? = nil) throws -> ExportResult {
    let fm = FileManager.default
    let options = try options.validated()
    try validatePhotos(folder: folder, photos: photos, expectedAlbumIdentity: expectedAlbumIdentity)
    let transaction = UUID().uuidString
    let staging = folder.appendingPathComponent(".almost_gallery_output_staging-\(transaction)")
    let backup = folder.appendingPathComponent(".almost_gallery_output_backup-\(transaction)")
    let output = folder.appendingPathComponent("output")
    let manifest = folder.appendingPathComponent(manifestName)
    let manifestBackup = folder.appendingPathComponent(".\(manifestName).backup-\(transaction)")
    for oldBackup in [".almost_gallery_output_backup", ".\(manifestName).backup"] {
      guard !fm.fileExists(atPath: folder.appendingPathComponent(oldBackup).path) else {
        throw GalleryError(message: "A previous export backup exists (\(oldBackup)). Recover it before exporting again.")
      }
    }
    try fm.createDirectory(at: staging, withIntermediateDirectories: false)
    defer { try? fm.removeItem(at: staging) }
    for (index, photo) in photos.enumerated() {
      try (convert ?? runMagick)(magick, [photo.url.path, "-auto-orient", "-resize", options.resize,
                                     "-quality", String(options.quality), staging.appendingPathComponent(outputName(index, total: photos.count)).path])
      progress(index + 1, photos.count)
    }
    let data = try JSONEncoder.prettyManifest.encode(ExportManifest(version: 1, imageMagick: options, photos: photos.map(\.name)))
    let temporaryManifest = folder.appendingPathComponent(".\(manifestName).\(transaction).tmp")
    defer { try? fm.removeItem(at: temporaryManifest) }
    try data.write(to: temporaryManifest, options: .atomic)
    let hadOutput = fm.fileExists(atPath: output.path)
    if hadOutput { try fm.moveItem(at: output, to: backup) }
    var installedOutput = false
    var movedManifest = false
    do {
      try fm.moveItem(at: staging, to: output)
      installedOutput = true
      let hadManifest = fm.fileExists(atPath: manifest.path)
      if hadManifest { try fm.moveItem(at: manifest, to: manifestBackup); movedManifest = true }
      if let installManifest { try installManifest(temporaryManifest, manifest) }
      else { try fm.moveItem(at: temporaryManifest, to: manifest) }
    } catch {
      var rollbackFailures: [String] = []
      if movedManifest {
        do {
          if fm.fileExists(atPath: manifest.path) { try fm.removeItem(at: manifest) }
          try fm.moveItem(at: manifestBackup, to: manifest)
        }
        catch { rollbackFailures.append("manifest: \(error.localizedDescription)") }
      }
      if installedOutput {
        do { try fm.removeItem(at: output) }
        catch { rollbackFailures.append("new output: \(error.localizedDescription)") }
      }
      if hadOutput {
        do { try fm.moveItem(at: backup, to: output) }
        catch { rollbackFailures.append("previous output: \(error.localizedDescription)") }
      }
      if !rollbackFailures.isEmpty {
        throw GalleryError(message: "Export failed and recovery was incomplete. Inspect the backup files in the album: \(rollbackFailures.joined(separator: "; "))")
      }
      throw error
    }
    let cleanup = removeBackup ?? { try fm.removeItem(at: $0) }
    var backupsNeedingCleanup: [URL] = []
    for old in [hadOutput ? backup : nil, movedManifest ? manifestBackup : nil].compactMap({ $0 }) {
      do { try cleanup(old) }
      catch { backupsNeedingCleanup.append(old) }
    }
    return ExportResult(output: output, backupsNeedingCleanup: backupsNeedingCleanup)
  }
}

private extension JSONEncoder {
  static var prettyManifest: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return encoder
  }
}
