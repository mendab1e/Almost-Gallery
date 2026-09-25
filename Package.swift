// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "AlmostGallery",
  platforms: [.macOS(.v13)],
  products: [.executable(name: "AlmostGallery", targets: ["AlmostGallery"])],
  targets: [
    .executableTarget(name: "AlmostGallery", path: "Native/Sources"),
  ]
)
