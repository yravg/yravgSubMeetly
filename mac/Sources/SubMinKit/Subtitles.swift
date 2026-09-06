// Transcript line model + SRT / VTT / TXT export.
// Long ASR segments are split into short cues so players don't cover the
// screen with a wall of text (and lag rendering it).
import Foundation

public struct SubtitleLine: Sendable, Identifiable, Equatable {
    public let id: UUID
    public var start: Double
    public var end: Double
    public var source: String
    public var translation: String

    public init(
        id: UUID = UUID(), start: Double, end: Double, source: String, translation: String = ""
    ) {
        self.id = id
        self.start = start
        self.end = end
        self.source = source
        self.translation = translation
    }

    /// What the overlay/export shows: translation when present, else source.
    public var display: String { translation.isEmpty ? source : translation }
}

public enum SubtitleFormat: String, Sendable, CaseIterable {
    case srt, vtt, txt

    public var fileExtension: String { rawValue }
}

public enum SubtitleExporter {
    /// ≈ 2 lines × 42 chars — longer cues flood the video frame.
    public static let maxCharsPerCue = 84
    public static let softLineChars = 42

    public static func format(
        _ lines: [SubtitleLine], as format: SubtitleFormat, dualLine: Bool = false
    ) -> String {
        let cues = format == .txt ? lines : splitForSubtitles(lines)
        switch format {
        case .srt: return srt(cues, dualLine: dualLine)
        case .vtt: return vtt(cues, dualLine: dualLine)
        case .txt: return txt(cues, dualLine: dualLine)
        }
    }

    /// Break long ASR segments into timed, readable subtitle cues.
    public static func splitForSubtitles(
        _ lines: [SubtitleLine], maxChars: Int = maxCharsPerCue
    ) -> [SubtitleLine] {
        var out: [SubtitleLine] = []
        for l in lines {
            let t0 = l.start
            var t1 = l.end
            if !(t1 > t0) { t1 = t0 + 3 }
            let src = l.source.trimmingCharacters(in: .whitespacesAndNewlines)
            let tgt = l.translation.trimmingCharacters(in: .whitespacesAndNewlines)
            let primary = tgt.isEmpty ? src : tgt
            guard !primary.isEmpty else { continue }

            let chunks = chunkWords(primary, maxChars: maxChars)
            let srcChunks: [String]? =
                (!src.isEmpty && !tgt.isEmpty && src != tgt)
                ? alignChunks(src, count: chunks.count) : nil
            let weights = chunks.map { max(1, $0.replacingOccurrences(of: "\n", with: "").count) }
            let totalW = weights.reduce(0, +)
            let dur = t1 - t0
            var acc = 0
            for (i, chunk) in chunks.enumerated() {
                let start = t0 + dur * (Double(acc) / Double(totalW))
                acc += weights[i]
                let end = i == chunks.count - 1 ? t1 : t0 + dur * (Double(acc) / Double(totalW))
                let cueSrc: String
                if let srcChunks {
                    cueSrc = srcChunks[i]
                } else if tgt.isEmpty {
                    cueSrc = chunk
                } else {
                    cueSrc = ""
                }
                out.append(
                    SubtitleLine(
                        start: start, end: max(end, start + 0.05),
                        source: cueSrc,
                        translation: tgt.isEmpty ? "" : chunk
                    ))
            }
        }
        return out
    }

    private static func chunkWords(_ text: String, maxChars: Int) -> [String] {
        let words = text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !words.isEmpty else { return [text] }
        var chunks: [String] = []
        var cur = ""
        for w in words {
            let next = cur.isEmpty ? w : "\(cur) \(w)"
            if next.count > maxChars, !cur.isEmpty {
                chunks.append(wrapCueLines(cur))
                cur = w.count > maxChars ? String(w.prefix(maxChars)) : w
            } else {
                cur = next
            }
        }
        if !cur.isEmpty { chunks.append(wrapCueLines(cur)) }
        return chunks
    }

    private static func wrapCueLines(_ text: String) -> String {
        if text.count <= softLineChars { return text }
        let words = text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        var line1 = ""
        var i = 0
        while i < words.count {
            let next = line1.isEmpty ? words[i] : "\(line1) \(words[i])"
            if next.count > softLineChars, !line1.isEmpty { break }
            line1 = next
            i += 1
        }
        let line2 = words[i...].joined(separator: " ")
        return line2.isEmpty ? line1 : "\(line1)\n\(line2)"
    }

    private static func alignChunks(_ text: String, count n: Int) -> [String] {
        let words = text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if n <= 1 { return [wrapCueLines(text)] }
        guard !words.isEmpty else { return Array(repeating: "", count: n) }
        var chunks: [String] = []
        let per = Double(words.count) / Double(n)
        for i in 0..<n {
            let a = Int((Double(i) * per).rounded())
            let b = i == n - 1 ? words.count : Int((Double(i + 1) * per).rounded())
            let part = words[a..<max(b, a)].joined(separator: " ")
            chunks.append(wrapCueLines(part))
        }
        return chunks
    }

    private static func body(_ l: SubtitleLine, dualLine: Bool) -> String {
        if dualLine, !l.translation.isEmpty, !l.source.isEmpty, l.translation != l.source {
            return "\(l.translation)\n\(l.source)"
        }
        return l.display
    }

    static func srt(_ lines: [SubtitleLine], dualLine: Bool) -> String {
        var out = ""
        for (i, l) in lines.enumerated() {
            out += "\(i + 1)\n"
            out += "\(stamp(l.start, comma: true)) --> \(stamp(l.end, comma: true))\n"
            out += body(l, dualLine: dualLine) + "\n\n"
        }
        return out
    }

    static func vtt(_ lines: [SubtitleLine], dualLine: Bool) -> String {
        var out = "WEBVTT\n\n"
        for l in lines {
            out += "\(stamp(l.start, comma: false)) --> \(stamp(l.end, comma: false))\n"
            out += body(l, dualLine: dualLine) + "\n\n"
        }
        return out
    }

    static func txt(_ lines: [SubtitleLine], dualLine: Bool) -> String {
        lines.map { body($0, dualLine: dualLine) }.joined(separator: "\n")
    }

    /// 00:01:02,345 (SRT) or 00:01:02.345 (VTT)
    public static func stamp(_ seconds: Double, comma: Bool) -> String {
        let total = max(0, seconds)
        let h = Int(total) / 3600
        let m = (Int(total) % 3600) / 60
        let s = Int(total) % 60
        let ms = Int((total - Double(Int(total))) * 1000)
        return String(format: "%02d:%02d:%02d%@%03d", h, m, s, comma ? "," : ".", ms)
    }
}
