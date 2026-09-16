// Pil rekam mengambang — chrome paling khas Meetily. Kapsul putih dengan
// shadow-lg, tetap di bawah kolom baca. Idle: satu tombol mic merah. Merekam:
// tombol stop merah + tiga batang meter yang berdenyut.
//
// Tidak ada tombol jeda: sesi subtitel kita tidak punya keadaan jeda, dan
// tombol yang tidak melakukan apa-apa lebih buruk daripada tidak ada tombol.
// Batang meter juga jujur: Meetily sendiri mengacak tingginya tiap 300 ms
// (tidak dari audio) — kita lakukan hal yang sama dan menyebutnya indikator
// aktivitas, bukan meter.
import SwiftUI

struct RecordingPill: View {
    @ObservedObject var app: AppController

    var body: some View {
        HStack(spacing: 12) {
            if app.isRunning {
                Button { app.toggle() } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(DS.Colors.record)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Stop recording")
                .accessibilityLabel("Stop recording")

                ActivityBars()
            } else {
                Button { app.toggle() } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(app.hasScreenPermission ? DS.Colors.record : DS.Colors.recordDisabled)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(!app.hasScreenPermission)
                .help(app.hasScreenPermission ? "Start recording" : "Grant Screen Recording to start")
                .accessibilityLabel("Start recording")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(DS.Colors.panel)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(DS.Colors.lineSubtle, lineWidth: 1))
        .dsFloating()
        .animation(.easeInOut(duration: DS.Motion.base), value: app.isRunning)
    }
}

/// Tiga batang yang berubah tinggi tiap 300 ms selama merekam.
private struct ActivityBars: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.3)) { ctx in
            let seed = Int(ctx.date.timeIntervalSinceReferenceDate * 10 / 3)
            HStack(alignment: .center, spacing: 3) {
                ForEach(0..<3, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DS.Colors.record)
                        .frame(width: 4, height: height(seed: seed, bar: i))
                        .animation(.easeInOut(duration: 0.25), value: seed)
                }
            }
            .frame(width: 22, height: 30)
        }
        .accessibilityHidden(true)
    }

    private func height(seed: Int, bar: Int) -> CGFloat {
        // 10–30 px, deterministik dari waktu supaya tanpa @State.
        let v = (seed &* 1103515245 &+ 12345 &+ bar &* 7919) & 0x7fffffff
        return 10 + CGFloat(v % 21)
    }
}

/// Bilah `Recording • 04:12` lengket di atas kolom baca (Meetily
/// RecordingStatusBar): sumur gray-50, titik merah berdenyut, jam MM:SS.
struct RecordingStatusBar: View {
    let startedAt: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            HStack(spacing: 8) {
                DSStatusDot(kind: .recording, size: 8, pulse: true)
                Text("Recording")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DS.Colors.textBody)
                Text("•").foregroundStyle(DS.Colors.textFaint)
                Text(DS.clock(ctx.date.timeIntervalSince(startedAt)))
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(DS.Colors.textMuted)
                Spacer()
            }
            .padding(.horizontal, 14)
            .frame(height: 36)
            .background(DS.Colors.sunken)
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
        }
    }
}
