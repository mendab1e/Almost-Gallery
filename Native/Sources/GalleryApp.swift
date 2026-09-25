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
    .defaultSize(width: 1000, height: 720)
    .windowToolbarStyle(.unified)
    .commands {
      CommandGroup(after: .importExport) {
        Button("Export Photos") { model.export() }
          .keyboardShortcut("e", modifiers: [.command, .shift])
          .disabled(model.exporting || model.photos.isEmpty)
      }
      CommandGroup(replacing: .newItem) {
        Button("Open Folder…") { model.chooseFolder() }
          .keyboardShortcut("o")
          .disabled(model.exporting)
      }
      CommandGroup(replacing: .undoRedo) {
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
      if model.album == nil { emptyState } else { workspace }
      Divider()
      footer
    }
    .background(Color(nsColor: .windowBackgroundColor))
    .navigationTitle(model.album?.lastPathComponent ?? "Almost Gallery")
    .navigationSubtitle(model.album == nil ? "" : model.exportState)
    .toolbar { toolbar }
    .sheet(isPresented: $model.settingsOpen) { SettingsView(model: model) }
    .sheet(item: Binding(
      get: { model.previewIndex.map { PreviewSelection(index: $0) } },
      set: { model.previewIndex = $0?.index }
    )) { _ in PreviewView(model: model) }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .navigation) {
      Button { model.chooseFolder() } label: { Label("Open Folder…", systemImage: "folder") }
        .help("Open Folder (⌘O)").disabled(model.exporting)
    }
    ToolbarItemGroup {
      Button { model.undo() } label: { Label("Undo Order", systemImage: "arrow.uturn.backward") }
        .help("Undo Order (⌘Z)").disabled(model.exporting || model.past.isEmpty)
      Button { model.redo() } label: { Label("Redo Order", systemImage: "arrow.uturn.forward") }
        .help("Redo Order (⇧⌘Z)").disabled(model.exporting || model.future.isEmpty)
    }
    ToolbarItemGroup(placement: .primaryAction) {
      Button {
        model.previewIndex = model.photos.firstIndex { $0.id == model.selectedPhotoID } ?? 0
      } label: { Label("Preview", systemImage: "eye") }
        .help("Preview Selected Photo").disabled(model.photos.isEmpty)
      Button { model.settingsOpen = true } label: { Label("Export Settings…", systemImage: "slider.horizontal.3") }
        .help("Export Settings").disabled(model.exporting)
      Button { model.export() } label: { Label("Export", systemImage: "square.and.arrow.up") }
        .help("Export Photos (⇧⌘E)").disabled(model.exporting || model.photos.isEmpty)
    }
  }

  private var emptyState: some View {
    VStack(spacing: 12) {
      Image(systemName: "photo.on.rectangle.angled").font(.system(size: 48, weight: .light)).foregroundStyle(.secondary)
      Text("Arrange photos for your gallery").font(.title2.weight(.semibold))
      Text("Choose an album folder to begin.").foregroundStyle(.secondary)
      Button("Open Folder…") { model.chooseFolder() }.buttonStyle(.borderedProminent).tint(accent).padding(.top, 8)
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
        Image(systemName: "photo").foregroundStyle(.secondary)
        Slider(value: Binding(
          get: { Double(model.gridSizeIndex) },
          set: { model.gridSizeIndex = Int($0) }
        ), in: 0...Double(model.gridSizes.count - 1), step: 1)
          .frame(width: 100)
          .accessibilityLabel("Thumbnail Size")
          .help("Thumbnail Size")
        Image(systemName: "photo.fill").foregroundStyle(.secondary)
      }
      .controlSize(.small)
      .padding(.horizontal, 20).padding(.vertical, 10)
      Divider()
      if model.photos.isEmpty {
        VStack(spacing: 10) {
          Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary)
          Text("No Photos").font(.title2.weight(.semibold))
          Text("Choose a folder containing supported images.").foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ScrollView {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: model.gridSizes[model.gridSizeIndex]), spacing: 16)], spacing: 16) {
            ForEach(Array(model.photos.enumerated()), id: \.element.id) { index, photo in
              photoCard(photo, index: index)
            }
          }.padding(20)
        }
        .background(Color(nsColor: .textBackgroundColor))
      }
    }
  }

  private func photoCard(_ photo: Photo, index: Int) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      ZStack {
        Rectangle().fill(Color(nsColor: .controlBackgroundColor))
        if let url = model.thumbnails[photo.id], let image = NSImage(contentsOf: url) {
          Image(nsImage: image).resizable().scaledToFit().padding(4)
        } else { ProgressView().controlSize(.small) }
      }
      .aspectRatio(4/3, contentMode: .fit)
      .clipShape(RoundedRectangle(cornerRadius: 4))
      .contentShape(Rectangle())
      HStack(spacing: 8) {
        Text(GalleryCore.outputName(index, total: model.photos.count).replacingOccurrences(of: ".jpg", with: ""))
          .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
        Text(photo.name).font(.caption).lineLimit(1).truncationMode(.middle)
      }.padding(.horizontal, 4).padding(.bottom, 4)
    }
    .padding(5)
    .background(model.selectedPhotoID == photo.id ? accent.opacity(0.15) : Color.clear,
                in: RoundedRectangle(cornerRadius: 6))
    .contentShape(Rectangle())
    .gesture(
      TapGesture(count: 2)
        .onEnded { model.selectedPhotoID = photo.id; model.previewIndex = index }
        .exclusively(before: TapGesture().onEnded { model.selectedPhotoID = photo.id })
    )
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(model.selectedPhotoID == photo.id ? .isSelected : [])
    .contextMenu {
      Button("Preview") { model.selectedPhotoID = photo.id; model.previewIndex = index }
      Button("Move Earlier") { model.selectedPhotoID = photo.id; model.moveSelected(-1) }
        .disabled(model.exporting || index == 0)
      Button("Move Later") { model.selectedPhotoID = photo.id; model.moveSelected(1) }
        .disabled(model.exporting || index == model.photos.count - 1)
    }
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
        Text(model.status).font(.caption).foregroundStyle(model.statusIsError ? Color.red : Color.primary)
          .lineLimit(2)
        if model.exporting {
          ProgressView(value: Double(model.exportProgress), total: Double(max(1, model.photos.count)))
            .frame(maxWidth: 420)
        }
      }
      Spacer()
      if model.outputFolder != nil { Button("Show in Finder") { model.revealOutput() } }
      if !model.backupsNeedingCleanup.isEmpty { Button("Show Backups in Finder") { model.revealBackups() } }
      Text(model.album == nil ? "Almost Gallery" : model.summary)
        .font(.caption).foregroundStyle(.secondary)
    }.controlSize(.small).padding(.horizontal, 20).padding(.vertical, 10)
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
        Button("Done") { model.previewIndex = nil }.help("Close preview")
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
    VStack(spacing: 0) {
      HStack {
        Text("Export Settings").font(.headline)
        Spacer()
      }.padding(20)
      Divider()
      Form {
        Section("Image Size") {
          Toggle("Advanced ImageMagick syntax", isOn: $advanced)
          if advanced {
            TextField("Resize geometry", text: $resize)
            Text("Example: 2000x2000> resizes only larger photos.")
              .font(.caption).foregroundStyle(.secondary)
          } else {
            TextField("Width (px)", text: $width)
            TextField("Height (px)", text: $height)
            Picker("Sizing", selection: $sizing) {
              ForEach(["", ">", "<", "^", "!"], id: \.self) { key in Text(sizes[key]!).tag(key) }
            }
            Text("Cover preserves proportions and may exceed one dimension without cropping.")
              .font(.caption).foregroundStyle(.secondary)
          }
        }
        Section("JPEG") {
          TextField("Quality (1–100)", text: $quality)
        }
        if !error.isEmpty {
          Text(error).font(.caption).foregroundStyle(.red)
        }
      }
      .formStyle(.grouped)
      Divider()
      HStack {
        Button("Restore Defaults") { load(ExportOptions()) }
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("Apply") { apply() }.keyboardShortcut(.defaultAction)
      }.padding(20)
    }
    .frame(width: 480, height: 470)
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
