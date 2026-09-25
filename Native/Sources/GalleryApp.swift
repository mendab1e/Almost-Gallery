import AppKit
import SwiftUI

@main
struct AlmostGalleryApp: App {
  @StateObject private var model = GalleryModel()

  var body: some Scene {
    WindowGroup("Almost Gallery") {
      GalleryView(model: model)
        .frame(minWidth: 760, minHeight: 560)
    }
    .commands {
      CommandGroup(replacing: .newItem) {
        Button("Open Folder...") { model.chooseFolder() }
          .keyboardShortcut("o")
          .disabled(model.exporting)
      }
      CommandGroup(after: .undoRedo) {
        Button("Undo Order") { model.undo() }
          .keyboardShortcut("z")
          .disabled(model.exporting || model.past.isEmpty)
        Button("Redo Order") { model.redo() }
          .keyboardShortcut("z", modifiers: [.command, .shift])
          .disabled(model.exporting || model.future.isEmpty)
      }
    }
  }
}

private actor ThumbnailPermitPool {
  private var available = 2
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func acquire() async {
    if available > 0 { available -= 1; return }
    await withCheckedContinuation { waiters.append($0) }
  }

  func release() {
    if waiters.isEmpty { available += 1 }
    else { waiters.removeFirst().resume() }
  }
}

@MainActor
final class GalleryModel: ObservableObject {
  @Published var album: URL?
  @Published var photos: [Photo] = []
  @Published var thumbnails: [String: URL] = [:]
  @Published var options = ExportOptions()
  @Published var past: [[Photo]] = []
  @Published var future: [[Photo]] = []
  @Published var exporting = false
  @Published var exportProgress = 0
  @Published var status = "Open a folder to begin"
  @Published var statusIsError = false
  @Published var outputFolder: URL?
  @Published var backupsNeedingCleanup: [URL] = []
  @Published var previewIndex: Int?
  @Published var settingsOpen = false
  @Published var gridSizeIndex = 2
  @Published var selectedPhotoID: String?
  private var savedSignature: String?
  private var albumIdentity: AlbumIdentity?
  private var generation = UUID()
  private let thumbnailPermits = ThumbnailPermitPool()
  let gridSizes: [CGFloat] = [120, 155, 190, 240, 300]

  var exportState: String {
    guard album != nil else { return "Open a folder to begin" }
    guard let savedSignature else { return "Not exported yet" }
    return signature == savedSignature ? "Export up to date" : "Changes since last export"
  }

  var signature: String {
    ([photos.map(\.name).joined(separator: "\0"), options.resize, String(options.quality)]).joined(separator: "\u{1f}")
  }

  var summary: String {
    "\(photos.count) photos · JPEG · \(options.resize) · Quality \(options.quality)"
  }

  func chooseFolder() {
    guard !exporting else { return }
    let panel = NSOpenPanel()
    panel.title = "Choose a photo folder"
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    guard panel.runModal() == .OK, let folder = panel.url else { return }
    do {
      let loaded = try GalleryCore.loadAlbum(folder)
      generation = UUID()
      album = loaded.folder
      albumIdentity = loaded.identity
      photos = loaded.photos
      options = loaded.options
      savedSignature = loaded.savedPhotos.map { names in
        [names.joined(separator: "\0"), options.resize, String(options.quality)].joined(separator: "\u{1f}")
      }
      thumbnails = [:]
      past = []
      future = []
      previewIndex = nil
      outputFolder = nil
      backupsNeedingCleanup = []
      selectedPhotoID = nil
      statusIsError = loaded.warning != nil || photos.isEmpty
      status = loaded.warning ?? (photos.isEmpty ? "No supported photos were found in this folder." :
                                   loaded.savedPhotos == nil ? "\(photos.count) photos ready." : "Saved photo order and ImageMagick options loaded.")
      loadThumbnails()
    } catch {
      report(error)
    }
  }

  func move(_ sourceID: String, to targetID: String, after: Bool = false) {
    guard !exporting, sourceID != targetID,
          let source = photos.first(where: { $0.id == sourceID }),
          photos.contains(where: { $0.id == targetID }) else { return }
    var changed = photos.filter { $0.id != sourceID }
    guard let targetIndex = changed.firstIndex(where: { $0.id == targetID }) else { return }
    changed.insert(source, at: targetIndex + (after ? 1 : 0))
    commit(changed)
  }

  func moveSelected(_ direction: Int) {
    guard let selectedPhotoID, let index = photos.firstIndex(where: { $0.id == selectedPhotoID }),
          photos.indices.contains(index + direction) else { return }
    var changed = photos
    changed.swapAt(index, index + direction)
    commit(changed)
  }

  private func commit(_ changed: [Photo]) {
    guard changed != photos else { return }
    past.append(photos)
    photos = changed
    future = []
    status = "Photo order updated."
    statusIsError = false
  }

  func undo() {
    guard !exporting, let previous = past.popLast() else { return }
    future.insert(photos, at: 0)
    photos = previous
  }

  func redo() {
    guard !exporting, !future.isEmpty else { return }
    past.append(photos)
    photos = future.removeFirst()
  }

  func applyOptions(_ value: ExportOptions) throws {
    guard !exporting else { return }
    options = try value.validated()
    status = "Export settings updated."
    statusIsError = false
  }

  func export() {
    guard !exporting, let album, let albumIdentity, !photos.isEmpty else { return }
    let photos = self.photos
    let options = self.options
    let signature = self.signature
    exporting = true
    exportProgress = 0
    status = "Preparing \(photos.count) photos..."
    statusIsError = false
    Task.detached(priority: .userInitiated) {
      do {
        let magick = try GalleryCore.cachedMagickPath()
        let result = try GalleryCore.export(folder: album, photos: photos, options: options, magick: magick,
                                            expectedAlbumIdentity: albumIdentity) { current, _ in
          Task { @MainActor in
            if self.exporting {
              self.exportProgress = current
              self.status = "Processing photo \(current) of \(photos.count)..."
            }
          }
        }
        await MainActor.run {
          self.outputFolder = result.output
          self.savedSignature = signature
          self.backupsNeedingCleanup = (self.backupsNeedingCleanup + result.backupsNeedingCleanup)
            .filter { FileManager.default.fileExists(atPath: $0.path) }
          if self.backupsNeedingCleanup.isEmpty {
            self.status = "\(photos.count) photos exported. Originals unchanged."
          } else {
            self.status = "\(photos.count) photos exported. \(self.backupsNeedingCleanup.count) old backup(s) remain. Review and delete them in Finder."
          }
          self.statusIsError = !self.backupsNeedingCleanup.isEmpty
          self.exporting = false
        }
      } catch {
        await MainActor.run {
          self.report(error)
          self.exporting = false
        }
      }
    }
  }

  func revealOutput() {
    guard let outputFolder else { return }
    NSWorkspace.shared.activateFileViewerSelecting([outputFolder])
  }

  func revealBackups() {
    guard !backupsNeedingCleanup.isEmpty else { return }
    NSWorkspace.shared.activateFileViewerSelecting(backupsNeedingCleanup)
  }

  private func loadThumbnails() {
    guard let album else { return }
    let token = generation
    let photos = self.photos
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("AlmostGallery/thumbnails")
    Task.detached(priority: .utility) {
      guard let magick = try? GalleryCore.cachedMagickPath() else {
        await MainActor.run { if self.generation == token { self.status = "ImageMagick was not found. Install it with: brew install imagemagick"; self.statusIsError = true } }
        return
      }
      await withTaskGroup(of: Void.self) { group in
        for worker in 0..<min(2, photos.count) {
          group.addTask {
            for index in stride(from: worker, to: photos.count, by: 2) {
              guard await self.generation == token else { break }
              await self.thumbnailPermits.acquire()
              guard await self.generation == token else {
                await self.thumbnailPermits.release()
                break
              }
              let photo = photos[index]
              let url = try? GalleryCore.thumbnailOrOriginal(photo: photo, folder: album, cache: cache, magick: magick)
              await self.thumbnailPermits.release()
              if let url {
                await MainActor.run { if self.generation == token { self.thumbnails[photo.id] = url } }
              }
            }
          }
        }
      }
    }
  }

  private func report(_ error: Error) {
    status = error.localizedDescription
    statusIsError = true
  }
}

struct GalleryView: View {
  @ObservedObject var model: GalleryModel
  @State private var targetID: String?
  @State private var cardWidths: [String: CGFloat] = [:]
  private let accent = Color(nsColor: .controlAccentColor)

  var body: some View {
    VStack(spacing: 0) {
      toolbar
      Divider()
      if model.album == nil { emptyState } else { workspace }
      Divider()
      footer
    }
    .background(Color(nsColor: .windowBackgroundColor))
    .sheet(isPresented: $model.settingsOpen) { SettingsView(model: model) }
    .sheet(item: Binding(
      get: { model.previewIndex.map { PreviewSelection(index: $0) } },
      set: { model.previewIndex = $0?.index }
    )) { _ in PreviewView(model: model) }
  }

  private var toolbar: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 2) {
        Text("ALMOST GALLERY").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
        Text(model.album?.lastPathComponent ?? "Almost Gallery").font(.system(size: 22, weight: .medium, design: .serif))
          .lineLimit(1).help(model.album?.path ?? "Almost Gallery")
      }
      Spacer(minLength: 12)
      Button { model.undo() } label: { Image(systemName: "arrow.uturn.backward") }
        .help("Undo order").disabled(model.exporting || model.past.isEmpty)
      Button { model.redo() } label: { Image(systemName: "arrow.uturn.forward") }
        .help("Redo order").disabled(model.exporting || model.future.isEmpty)
      Button("Open folder") { model.chooseFolder() }.disabled(model.exporting)
      Button("Preview") { model.previewIndex = 0 }.disabled(model.photos.isEmpty)
      Button("Export") { model.export() }.buttonStyle(.borderedProminent).tint(accent)
        .disabled(model.exporting || model.photos.isEmpty)
    }
    .padding(.horizontal, 24).frame(height: 78)
  }

  private var emptyState: some View {
    VStack(spacing: 12) {
      Image(systemName: "photo.on.rectangle.angled").font(.system(size: 42)).foregroundStyle(accent)
      Text("Arrange photos for your gallery").font(.system(size: 24, design: .serif))
      Text("Choose an album folder to begin.").foregroundStyle(.secondary)
      Button("Open folder") { model.chooseFolder() }.buttonStyle(.borderedProminent).tint(accent).padding(.top, 8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var workspace: some View {
    VStack(spacing: 0) {
      HStack {
        Text("\(model.photos.count) photo\(model.photos.count == 1 ? "" : "s")").font(.headline)
        Spacer()
        Button { model.moveSelected(-1) } label: { Image(systemName: "arrow.left") }
          .help("Move selected photo left").keyboardShortcut(.leftArrow, modifiers: [.option])
          .disabled(model.exporting || model.selectedPhotoID == nil)
        Button { model.moveSelected(1) } label: { Image(systemName: "arrow.right") }
          .help("Move selected photo right").keyboardShortcut(.rightArrow, modifiers: [.option])
          .disabled(model.exporting || model.selectedPhotoID == nil)
        Divider().frame(height: 18)
        Button { model.gridSizeIndex = max(0, model.gridSizeIndex - 1) } label: { Image(systemName: "minus") }
          .help("Smaller thumbnails").disabled(model.gridSizeIndex == 0)
        Text("Thumbnail size").font(.caption).foregroundStyle(.secondary)
        Button { model.gridSizeIndex = min(model.gridSizes.count - 1, model.gridSizeIndex + 1) } label: { Image(systemName: "plus") }
          .help("Larger thumbnails").disabled(model.gridSizeIndex == model.gridSizes.count - 1)
      }.padding(.horizontal, 24).padding(.vertical, 14)
      ScrollView {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: model.gridSizes[model.gridSizeIndex]), spacing: 16)], spacing: 16) {
          ForEach(Array(model.photos.enumerated()), id: \.element.id) { index, photo in
            photoCard(photo, index: index)
          }
        }.padding(.horizontal, 24).padding(.bottom, 24)
      }
    }
  }

  private func photoCard(_ photo: Photo, index: Int) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      ZStack {
        Rectangle().fill(Color(nsColor: .controlBackgroundColor))
        if let url = model.thumbnails[photo.id], let image = NSImage(contentsOf: url) {
          Image(nsImage: image).resizable().scaledToFit().padding(4)
        } else { ProgressView().controlSize(.small) }
      }
      .aspectRatio(4/3, contentMode: .fit)
      .clipShape(RoundedRectangle(cornerRadius: 4))
      .contentShape(Rectangle())
      .onTapGesture { model.selectedPhotoID = photo.id; model.previewIndex = index }
      HStack(spacing: 8) {
        Text(GalleryCore.outputName(index, total: model.photos.count).replacingOccurrences(of: ".jpg", with: ""))
          .font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(accent)
        Text(photo.name).font(.caption).lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary)
      }.contentShape(Rectangle()).onTapGesture { model.selectedPhotoID = photo.id }
    }
    .padding(3)
    .background(GeometryReader { geometry in
      Color.clear
        .onAppear { cardWidths[photo.id] = geometry.size.width }
        .onChange(of: geometry.size.width) { cardWidths[photo.id] = $0 }
    })
    .overlay(RoundedRectangle(cornerRadius: 4).stroke(model.selectedPhotoID == photo.id ? accent :
      targetID == photo.id ? Color.accentColor : .clear, lineWidth: 2))
    .draggable(photo.id)
    .dropDestination(for: String.self) { sources, location in
      guard !model.exporting, let source = sources.first else { return false }
      let after = location.x >= (cardWidths[photo.id] ?? model.gridSizes[model.gridSizeIndex]) / 2
      model.move(source, to: photo.id, after: after)
      return true
    } isTargeted: { targeted in
      targetID = targeted ? photo.id : nil
    }
  }

  private var footer: some View {
    HStack(alignment: .center, spacing: 16) {
      VStack(alignment: .leading, spacing: 3) {
        Text(model.summary).font(.caption)
        Text(model.exportState).font(.caption2).foregroundStyle(.secondary)
        Text(model.status).font(.caption2).foregroundStyle(model.statusIsError ? Color.red : Color.primary)
          .lineLimit(2)
        if model.exporting {
          ProgressView(value: Double(model.exportProgress), total: Double(max(1, model.photos.count)))
            .frame(maxWidth: 420)
        }
      }
      Spacer()
      if model.outputFolder != nil { Button("Show in Finder") { model.revealOutput() } }
      if !model.backupsNeedingCleanup.isEmpty { Button("Show backups in Finder") { model.revealBackups() } }
      Button("Export settings") { model.settingsOpen = true }.disabled(model.exporting)
    }.padding(.horizontal, 24).padding(.vertical, 12).frame(minHeight: 76)
  }
}

private struct PreviewSelection: Identifiable {
  let index: Int
  var id: Int { index }
}

struct PreviewView: View {
  @ObservedObject var model: GalleryModel
  var body: some View {
    VStack(spacing: 0) {
      HStack {
        if let index = model.previewIndex, model.photos.indices.contains(index) {
          VStack(alignment: .leading) {
            Text(model.photos[index].name).font(.headline)
            Text("\(index + 1) of \(model.photos.count)").font(.caption).foregroundStyle(.secondary)
          }
        }
        Spacer()
        Button { model.previewIndex = nil } label: { Image(systemName: "xmark") }.help("Close preview")
          .keyboardShortcut(.cancelAction)
      }.padding()
      Divider()
      HStack {
        Button { navigate(-1) } label: { Image(systemName: "chevron.left") }
          .keyboardShortcut(.leftArrow, modifiers: [])
          .disabled((model.previewIndex ?? 0) == 0).help("Previous photo")
        Spacer()
        if let index = model.previewIndex, model.photos.indices.contains(index),
           let image = NSImage(contentsOf: model.photos[index].url) {
          Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        Spacer()
        Button { navigate(1) } label: { Image(systemName: "chevron.right") }
          .keyboardShortcut(.rightArrow, modifiers: [])
          .disabled((model.previewIndex ?? 0) >= model.photos.count - 1).help("Next photo")
      }.padding()
    }
    .frame(minWidth: 680, minHeight: 500)
    .background(Color(nsColor: .windowBackgroundColor))
  }

  private func navigate(_ direction: Int) {
    guard let index = model.previewIndex else { return }
    model.previewIndex = max(0, min(model.photos.count - 1, index + direction))
  }
}

struct SettingsView: View {
  @ObservedObject var model: GalleryModel
  @Environment(\.dismiss) private var dismiss
  @State private var width = "2000"
  @State private var height = "2000"
  @State private var sizing = ""
  @State private var advanced = false
  @State private var resize = "2000x2000"
  @State private var quality = "85"
  @State private var error = ""
  private let sizes = ["": "Fit within", ">": "Only shrink", "<": "Only enlarge", "^": "Cover dimensions", "!": "Exact dimensions"]

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Export settings").font(.system(size: 25, design: .serif))
      Toggle("Advanced ImageMagick syntax", isOn: $advanced)
      if advanced {
        TextField("Resize geometry", text: $resize)
        Text("Example: 2000x2000> resizes only larger photos.").font(.caption).foregroundStyle(.secondary)
      } else {
        HStack {
          TextField("Width (px)", text: $width)
          TextField("Height (px)", text: $height)
        }
        Picker("Sizing", selection: $sizing) {
          ForEach(["", ">", "<", "^", "!"], id: \.self) { key in Text(sizes[key]!).tag(key) }
        }
        Text("Cover preserves proportions and may exceed one dimension without cropping.")
          .font(.caption).foregroundStyle(.secondary)
      }
      TextField("JPEG quality", text: $quality)
      if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red) }
      HStack {
        Button("Reset defaults") { load(ExportOptions()) }
        Spacer()
        Button("Cancel") { dismiss() }
        Button("Apply settings") { apply() }.buttonStyle(.borderedProminent)
      }
    }
    .padding(24).frame(width: 460)
    .onAppear { load(model.options) }
  }

  private func load(_ options: ExportOptions) {
    resize = options.resize
    quality = String(options.quality)
    let pattern = try! NSRegularExpression(pattern: "^([0-9]+)x([0-9]+)([><^!]?)$")
    let range = NSRange(options.resize.startIndex..<options.resize.endIndex, in: options.resize)
    if let match = pattern.firstMatch(in: options.resize, range: range),
       let w = Range(match.range(at: 1), in: options.resize),
       let h = Range(match.range(at: 2), in: options.resize),
       let s = Range(match.range(at: 3), in: options.resize) {
      width = String(options.resize[w]); height = String(options.resize[h]); sizing = String(options.resize[s])
      advanced = false
    } else { advanced = true }
    error = ""
  }

  private func apply() {
    guard let quality = Int(quality) else { error = "Quality must be a whole number from 1 to 100."; return }
    let value = ExportOptions(resize: advanced ? resize.trimmingCharacters(in: .whitespaces) : "\(width)x\(height)\(sizing)", quality: quality)
    do { try model.applyOptions(value); dismiss() }
    catch { self.error = error.localizedDescription }
  }
}
