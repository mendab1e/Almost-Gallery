import Foundation

@main
struct GalleryCoreChecks {
  static func main() throws {
    try savedOrderAndMalformedManifest()
    try exportSuccessAndRollback()
    try replacedAlbumIsRejected()
    try pathValidationAndThumbnailIdentity()
    check(GalleryCore.outputName(2, total: 3) == "002.jpg", "three-digit output name")
    check(GalleryCore.outputName(1000, total: 1001) == "1000.jpg", "expanded output name")
    print("Gallery core checks passed")
  }

  static func check(_ condition: Bool, _ message: String) {
    if !condition { fatalError(message) }
  }

  static func album() throws -> URL {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
  }

  static func touch(_ name: String, in folder: URL, contents: String = "source") throws -> URL {
    let url = folder.appendingPathComponent(name)
    try Data(contents.utf8).write(to: url)
    return url
  }

  static func savedOrderAndMalformedManifest() throws {
    let folder = try album()
    defer { try? FileManager.default.removeItem(at: folder) }
    _ = try touch("photo10.JPG", in: folder)
    _ = try touch("photo2.heic", in: folder)
    _ = try touch("photo1.png", in: folder)
    let manifestURL = folder.appendingPathComponent(GalleryCore.manifestName)
    let manifest = ExportManifest(version: 1, imageMagick: ExportOptions(resize: "3000x2000>", quality: 73),
                                  photos: ["photo10.JPG", "gone.jpg", "photo1.png"])
    try JSONEncoder().encode(manifest).write(to: manifestURL)
    let restored = try GalleryCore.loadAlbum(folder)
    check(restored.photos.map(\.name) == ["photo10.JPG", "photo1.png", "photo2.heic"], "saved order")
    check(restored.options == manifest.imageMagick, "saved options")
    try Data("broken".utf8).write(to: manifestURL)
    let malformed = try GalleryCore.loadAlbum(folder)
    check(malformed.warning != nil && malformed.photos.count == 3, "malformed manifest recovery")
  }

  static func exportSuccessAndRollback() throws {
    let folder = try album()
    defer { try? FileManager.default.removeItem(at: folder) }
    let first = try touch("a.jpg", in: folder)
    let second = try touch("b.png", in: folder)
    let photos = [Photo(url: second), Photo(url: first)]
    let identity = try GalleryCore.albumIdentity(folder)
    let legacyStaging = folder.appendingPathComponent(".almost_gallery_output_staging")
    try FileManager.default.createDirectory(at: legacyStaging, withIntermediateDirectories: false)
    let marker = try touch("keep.txt", in: legacyStaging)
    let convert: (String, [String]) throws -> Void = { _, args in
      try Data(args[0].utf8).write(to: URL(fileURLWithPath: args.last!))
    }
    let firstResult = try GalleryCore.export(folder: folder, photos: photos, options: ExportOptions(), magick: "unused",
                                             expectedAlbumIdentity: identity, convert: convert)
    let output = firstResult.output
    check(firstResult.backupsNeedingCleanup.isEmpty, "no backup after first export")
    check(try String(contentsOf: marker, encoding: .utf8) == "source", "preexisting staging preserved")
    check(try String(contentsOf: output.appendingPathComponent("000.jpg"), encoding: .utf8) == second.path, "first export order")
    check(try String(contentsOf: output.appendingPathComponent("001.jpg"), encoding: .utf8) == first.path, "second export order")
    let manifestURL = folder.appendingPathComponent(GalleryCore.manifestName)
    let saved = try Data(contentsOf: manifestURL)
    let manifest = try JSONDecoder().decode(ExportManifest.self, from: saved)
    check(manifest.version == 1 && manifest.photos == ["b.png", "a.jpg"], "manifest content")
    do {
      _ = try GalleryCore.export(folder: folder, photos: photos, options: ExportOptions(), magick: "unused",
                                 expectedAlbumIdentity: identity, convert: { _, _ in
        throw GalleryError(message: "conversion failed")
      })
      fatalError("export should fail")
    } catch {}
    check(try Data(contentsOf: manifestURL) == saved, "manifest rollback")
    check(try String(contentsOf: output.appendingPathComponent("000.jpg"), encoding: .utf8) == second.path, "output rollback")
    let entries = try FileManager.default.contentsOfDirectory(atPath: folder.path)
    check(!entries.contains { $0.hasPrefix(".almost_gallery_output_staging-") }, "unique staging cleanup")

    do {
      _ = try GalleryCore.export(folder: folder, photos: photos, options: ExportOptions(), magick: "unused",
                                 expectedAlbumIdentity: identity, convert: convert,
                                 installManifest: { temporary, destination in
                                   try FileManager.default.copyItem(at: temporary, to: destination)
                                   throw GalleryError(message: "commit failed")
                                 })
      fatalError("manifest commit should fail")
    } catch {}
    check(try Data(contentsOf: manifestURL) == saved, "manifest restored after commit failure")
    check(try String(contentsOf: output.appendingPathComponent("000.jpg"), encoding: .utf8) == second.path,
          "output restored after commit failure")

    let withCleanupFailure = try GalleryCore.export(folder: folder, photos: photos, options: ExportOptions(),
                                                    magick: "unused", expectedAlbumIdentity: identity, convert: convert,
                                                    removeBackup: { _ in throw GalleryError(message: "cleanup failed") })
    check(withCleanupFailure.backupsNeedingCleanup.count == 2, "cleanup failure reported")
    check(withCleanupFailure.backupsNeedingCleanup.allSatisfy { FileManager.default.fileExists(atPath: $0.path) },
          "unremoved backups retained for recovery")
    let next = try GalleryCore.export(folder: folder, photos: photos, options: ExportOptions(), magick: "unused",
                                      expectedAlbumIdentity: identity, convert: convert)
    check(next.backupsNeedingCleanup.isEmpty, "later export works despite old backups")
  }

  static func replacedAlbumIsRejected() throws {
    let folder = try album()
    let replacement = try album()
    let moved = folder.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
    defer {
      try? FileManager.default.removeItem(at: folder)
      try? FileManager.default.removeItem(at: moved)
      try? FileManager.default.removeItem(at: replacement)
    }
    _ = try touch("a.jpg", in: folder)
    _ = try touch("a.jpg", in: replacement)
    let loaded = try GalleryCore.loadAlbum(folder)
    let convert: (String, [String]) throws -> Void = { _, args in
      try Data("converted".utf8).write(to: URL(fileURLWithPath: args.last!))
    }
    try FileManager.default.moveItem(at: folder, to: moved)
    try FileManager.default.createSymbolicLink(at: folder, withDestinationURL: replacement)
    do {
      _ = try GalleryCore.export(folder: loaded.folder, photos: loaded.photos, options: loaded.options,
                                 magick: "unused", expectedAlbumIdentity: loaded.identity, convert: convert)
      fatalError("symlink replacement accepted")
    } catch {}
    check(!FileManager.default.fileExists(atPath: replacement.appendingPathComponent("output").path),
          "symlink replacement untouched")
    try FileManager.default.removeItem(at: folder)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    _ = try touch("a.jpg", in: folder)
    do {
      _ = try GalleryCore.export(folder: loaded.folder, photos: loaded.photos, options: loaded.options,
                                 magick: "unused", expectedAlbumIdentity: loaded.identity, convert: convert)
      fatalError("different folder at same path accepted")
    } catch {}
    check(!FileManager.default.fileExists(atPath: folder.appendingPathComponent("output").path),
          "different folder untouched")
  }

  static func pathValidationAndThumbnailIdentity() throws {
    let folder = try album()
    let outside = try album()
    defer { try? FileManager.default.removeItem(at: folder); try? FileManager.default.removeItem(at: outside) }
    let source = try touch("a.jpg", in: outside)
    let link = folder.appendingPathComponent("link.jpg")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: source)
    do { try GalleryCore.validatePhotos(folder: folder, photos: [Photo(url: source)]); fatalError("outside path accepted") } catch {}
    do { try GalleryCore.validatePhotos(folder: folder, photos: [Photo(url: link)]); fatalError("symlink accepted") } catch {}
    let local = try touch("local.jpg", in: folder)
    let cache = folder.appendingPathComponent("cache")
    let before = try GalleryCore.thumbnailURL(for: Photo(url: local), cache: cache)
    try Data("larger source".utf8).write(to: local)
    let after = try GalleryCore.thumbnailURL(for: Photo(url: local), cache: cache)
    check(before != after, "thumbnail invalidation")
    var conversions = 0
    let fakeConversion: (String, [String]) throws -> Void = { _, args in
      conversions += 1
      try Data("thumbnail".utf8).write(to: URL(fileURLWithPath: args.last!))
    }
    let first = try GalleryCore.thumbnailOrOriginal(photo: Photo(url: local), folder: folder, cache: cache,
                                                    magick: "unused", convert: fakeConversion)
    let second = try GalleryCore.thumbnailOrOriginal(photo: Photo(url: local), folder: folder, cache: cache,
                                                     magick: "unused", convert: fakeConversion)
    check(first == second && conversions == 1, "thumbnail cache reuse")
    try Data("another changed source".utf8).write(to: local)
    let third = try GalleryCore.thumbnailOrOriginal(photo: Photo(url: local), folder: folder, cache: cache,
                                                    magick: "unused", convert: fakeConversion)
    check(third != first && conversions == 2, "thumbnail regeneration")
    try Data("one more change".utf8).write(to: local)
    let fallback = try GalleryCore.thumbnailOrOriginal(photo: Photo(url: local), folder: folder, cache: cache,
                                                       magick: "unused", convert: { _, _ in throw GalleryError(message: "failed") })
    check(fallback == local, "thumbnail conversion fallback")
    do {
      _ = try GalleryCore.thumbnailOrOriginal(photo: Photo(url: link), folder: folder, cache: cache,
                                              magick: "unused", convert: fakeConversion)
      fatalError("thumbnail symlink accepted")
    } catch {}
  }
}
