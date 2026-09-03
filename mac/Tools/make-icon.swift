// Generates the app icon from the yraverage brand marks.
//
// The logo's signature element is the teal rounded tag holding white text, so
// the icon is that tag turned into a caption bubble with subtitle bars —
// recognisably the same brand, and still legible at 16pt.
//
//   swift Tools/make-icon.swift branding/logo.png
import AppKit
import Foundation

let size = 1024.0
let teal = NSColor(srgbRed: 0x38 / 255, green: 0x90 / 255, blue: 0x8E / 255, alpha: 1)
let tealDeep = NSColor(srgbRed: 0x2B / 255, green: 0x73 / 255, blue: 0x72 / 255, alpha: 1)
let cream = NSColor(srgbRed: 0xF7 / 255, green: 0xF6 / 255, blue: 0xEE / 255, alpha: 1)
let charcoal = NSColor(srgbRed: 0x30 / 255, green: 0x2F / 255, blue: 0x2C / 255, alpha: 1)

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "branding/logo.png"

let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
guard let ctx = NSGraphicsContext.current?.cgContext else { exit(1) }

// Cream ground — macOS applies its own mask, so fill the full square.
cream.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: size, height: size)).fill()

// Caption bubble, echoing the tag in the wordmark.
let bubble = NSRect(x: size * 0.13, y: size * 0.26, width: size * 0.74, height: size * 0.46)
let bubblePath = NSBezierPath(roundedRect: bubble, xRadius: size * 0.10, yRadius: size * 0.10)

// Soft vertical gradient so the mark has some depth at large sizes.
ctx.saveGState()
bubblePath.addClip()
let gradient = NSGradient(colors: [teal, tealDeep])!
gradient.draw(in: bubble, angle: -90)
ctx.restoreGState()

// Tail, bottom-left — turns the tag into a speech bubble. Drawn with a wide
// base that overlaps the bubble so the two read as one solid shape.
let tail = NSBezierPath()
tail.move(to: NSPoint(x: size * 0.24, y: size * 0.34))
tail.line(to: NSPoint(x: size * 0.17, y: size * 0.15))
tail.curve(
    to: NSPoint(x: size * 0.46, y: size * 0.30),
    controlPoint1: NSPoint(x: size * 0.27, y: size * 0.24),
    controlPoint2: NSPoint(x: size * 0.38, y: size * 0.29))
tail.close()
tealDeep.setFill()
tail.fill()

// Subtitle bars: two white lines, the second shorter — reads as captions.
let barH = size * 0.075
let radius = barH / 2
cream.setFill()
for (i, spec) in [(0.20, 0.52), (0.16, 0.34)].enumerated() {
    let y = bubble.minY + bubble.height * (i == 0 ? 0.56 : 0.24)
    let w = size * spec.1
    let x = bubble.minX + (bubble.width - w) / 2
    NSBezierPath(
        roundedRect: NSRect(x: x, y: y, width: w, height: barH),
        xRadius: radius, yRadius: radius
    ).fill()
}

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bmp = NSBitmapImageRep(data: tiff),
      let png = bmp.representation(using: .png, properties: [:])
else {
    FileHandle.standardError.write("failed to render icon\n".data(using: .utf8)!)
    exit(1)
}
try? FileManager.default.createDirectory(
    at: URL(fileURLWithPath: out).deletingLastPathComponent(),
    withIntermediateDirectories: true)
try png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
_ = charcoal   // reserved for future wordmark use
