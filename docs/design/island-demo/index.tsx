import { useRef, type CSSProperties, type ReactNode } from 'react'
import { Inbox, LayoutGrid, List, Pause, Radio, Settings, Square, Flag } from 'lucide-react'
import { Button, Check, Collapse, Stage, Stream, type Act } from '../../kit'
import './island.css'

// The yravgSubMeetly island on a Windows desktop: one white shape whose box
// (width, height, radius) springs between presentations, and whose content is
// separate layers at their final positions, so nothing in it ever stretches
// (the gold is dynamic-island: grow with a small overshoot, shrink critically
// damped and a beat late, content blurs out first and sharpens in after).
//
// The loop, about 15s, one thing at a time:
//   0.0s  idle pill: wordmark and "ready"
//   1.1s  captions start: rec dot and timer, the line streams in, then its translation
//   3.6s  the cursor arrives on the pill; a ring fills for 1.5s (hover-to-open)
//   6.0s  the island springs open to the Live page: previous line dim, current, translation
//   8.0s  the Meeting tab; the decision row waits with Accept
//   9.8s  Accept is clicked: the row leaves, "Accepted in register" holds
//  13.0s  the cursor leaves; the island folds back to the live pill
//  14.5s  captions stop: the pill draws in to idle, so the loop meets itself
//
// Real strings: the wordmark, "ready", the caption and its translation, the
// tab names, the decision and Accept. The rest is the product's own chrome.

const CAP = 'Drill evakuasi dipindah ke Jumat 07:30'
const TRS = 'Evacuation drill moved to Friday 07:30'
const PREV = 'Lars: incident investigation report sudah selesai.'
const NW = CAP.split(' ').length
const TW = TRS.split(' ').length

/** A damped spring as a CSS linear() easing */
function spring(zeta: number, omega: number, ms: number, n = 48) {
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  const pts: string[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (ms / 1000)
    const x = i === n ? 1 : 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
    pts.push(x.toFixed(4))
  }
  return `linear(${pts.join(', ')})`
}
const GROW = { ease: spring(0.72, 15, 520), ms: 520 }
const SHRINK = { ease: spring(0.98, 19, 380), ms: 380 }

type Mode = 'idle' | 'pill' | 'live' | 'meet' | 'done'
type Box = { w: number; h: number; r: number }
type S = { mode: Mode; sec: number; cap: number; trs: number; ring: boolean; acc: boolean }
const START: S = { mode: 'idle', sec: 0, cap: 0, trs: 0, ring: false, acc: false }
const POSTER: S = { mode: 'live', sec: 9, cap: NW, trs: TW, ring: false, acc: false }
const SIZE: Record<Mode, number> = { idle: 0, pill: 1, done: 2, meet: 3, live: 4 }

// Geometry in stage px; the island hangs from the top centre
const WIDE = { sw: 900, top: 18, geo: { idle: { w: 190, h: 40, r: 20 }, pill: { w: 660, h: 40, r: 20 }, live: { w: 660, h: 232, r: 24 }, meet: { w: 660, h: 176, r: 24 }, done: { w: 660, h: 166, r: 24 } } as Record<Mode, Box> }
const NARROW = { sw: 358, top: 14, geo: { idle: { w: 176, h: 40, r: 20 }, pill: { w: 326, h: 56, r: 24 }, live: { w: 326, h: 246, r: 24 }, meet: { w: 326, h: 236, r: 24 }, done: { w: 326, h: 166, r: 24 } } as Record<Mode, Box> }

const mmss = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

const TABS: Array<[string, ReactNode, string]> = [
  ['live', <Radio key="i" size={16} />, 'Live'],
  ['meet', <List key="i" size={16} />, 'Meeting'],
  ['inbox', <Inbox key="i" size={16} />, 'Inbox'],
  ['addins', <LayoutGrid key="i" size={16} />, 'Add-ins'],
]

function Island({ s, compact }: { s: S; compact: boolean }) {
  const L = compact ? NARROW : WIDE
  const last = useRef<{ mode: Mode; grow: boolean }>({ mode: s.mode, grow: true })
  if (last.current.mode !== s.mode) last.current = { mode: s.mode, grow: SIZE[s.mode] > SIZE[last.current.mode] }
  const grow = last.current.grow
  const b = L.geo[s.mode]
  const open = s.mode === 'live' || s.mode === 'meet' || s.mode === 'done'
  const left = (w: number) => (L.sw - w) / 2
  const layer = (mode: 'idle' | 'pill' | 'open'): CSSProperties => {
    const g = mode === 'open' ? L.geo.live : L.geo[mode]
    return { left: left(g.w), top: L.top, width: g.w, height: mode === 'open' ? b.h : g.h }
  }
  const tab = s.mode === 'live' ? 'live' : 'meet'
  return (
    <div className="si-island" data-mode={s.mode}>
      <span
        className="si-shape"
        style={{
          left: left(b.w),
          top: L.top,
          width: b.w,
          height: b.h,
          borderRadius: b.r,
          transitionDuration: `${grow ? GROW.ms : SHRINK.ms}ms`,
          transitionTimingFunction: grow ? GROW.ease : SHRINK.ease,
          // Shrinking waits for the content to clear, so nothing paints past the edge
          transitionDelay: grow ? '0ms' : '120ms',
        }}
      />
      <span className="si-hit" data-target="pill" style={{ left: left(L.geo.pill.w), top: L.top, width: L.geo.pill.w, height: L.geo.pill.h }} />

      {/* Idle: the wordmark and its state */}
      <div className="si-item si-idle" data-on={s.mode === 'idle' || undefined} style={layer('idle')}>
        <span className="si-wm">SubMeetly</span>
        <span className="si-dim">ready</span>
      </div>

      {/* The live pill: rec dot and timer, the line, its translation, the level or the hover ring */}
      <div className="si-item si-pill" data-on={s.mode === 'pill' || undefined} style={layer('pill')}>
        <span className="si-rt">
          <i className="si-rec" />
          <span className="si-mono">
            {mmss(s.sec)}
          </span>
        </span>
        <span className="si-lines">
          <span className="si-cap">
            <Stream text={CAP} count={s.cap} />
          </span>
          <span className="si-trs">
            <Stream text={TRS} count={s.trs} />
          </span>
        </span>
        <span className="si-slot">
          <span className="si-eq" data-off={s.ring || undefined}>
            <i />
            <i />
            <i />
          </span>
          <svg className="si-ring" data-off={!s.ring || undefined} viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <circle cx="12" cy="12" r="9" fill="none" stroke="#dfe2ec" strokeWidth="2.5" />
            <circle className="si-ring__arc" data-run={s.ring || undefined} cx="12" cy="12" r="9" fill="none" stroke="var(--si-accent)" strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: s.ring ? 0 : 1 }} />
          </svg>
        </span>
      </div>

      {/* Open: tabs on top, one page below */}
      <div className="si-item si-open" data-on={open || undefined} style={layer('open')}>
        <div className="si-tabs">
          {TABS.map(([k, icon, label]) => (
            <span key={k} className="si-tab" data-on={k === tab || undefined} data-target={`tab-${k}`} aria-label={label}>
              {icon}
              <span className="si-tab__lab">
                <span>{label}</span>
              </span>
            </span>
          ))}
          <span className="si-grow" />
          <span className="si-tab__dim">
            <Settings size={16} />
          </span>
          {!compact && <span className="si-tab__dim">Tue 17 Feb</span>}
          <b className="si-mono si-clock">07:12</b>
        </div>

        <div className="si-page si-live" data-on={s.mode === 'live' || undefined}>
          <div className="si-ctl">
            <div className="si-tm">
              <i className="si-rec si-rec--lg" />
              <b className="si-mono">{mmss(s.sec)}</b>
            </div>
            {!compact && <span className="si-dim">Rapat Komite K3 · W01</span>}
            <div className="si-btns">
              <span className="si-ib" aria-label="Pause">
                <Pause size={18} />
              </span>
              <span className="si-ib si-ib--stop" aria-label="Stop">
                <Square size={16} fill="currentColor" />
              </span>
            </div>
            {!compact && <span className="si-dim si-small">zh to en · Rust engine · CUDA</span>}
          </div>
          <div className="si-card2">
            <p className="si-dim si-prev">{PREV}</p>
            <p className="si-now">
              <Stream text={CAP + '.'} count={s.cap} />
            </p>
            <p className="si-tr">
              <Stream text={TRS + '.'} count={s.trs} />
            </p>
            {!compact && <p className="si-dim">…</p>}
          </div>
        </div>

        <div className="si-page si-meet" data-on={s.mode === 'meet' || s.mode === 'done' || undefined}>
          <div className="si-dic">
            <div className="si-dic__h">
              <Flag size={16} />
              <span className="si-hdr">
                <span data-off={s.acc || undefined}>1 waits on you</span>
                <span data-off={!s.acc || undefined}>Nothing waits on you</span>
              </span>
            </div>
            <Collapse open={!s.acc}>
              <div className="si-mrow">
                <span className="si-tag">Decision</span>
                <span className="si-mt">Drill evakuasi dipindah ke Jumat 07:30</span>
                <span className="si-mbtns">
                  <Button variant="primary" size="large" data-target="accept">
                    Accept
                  </Button>
                  <Button size="large">Edit</Button>
                </span>
              </div>
            </Collapse>
            <Collapse open={s.acc}>
              <div className="si-done">
                <Check on={s.acc} size={16} />
                <span>Accepted in register</span>
              </div>
            </Collapse>
          </div>
        </div>
      </div>
    </div>
  )
}

const script = async (a: Act<S>) => {
  // The recording timer counts real stage time, only while captions run
  let running = false
  let sec = 0
  const ticker = (async () => {
    try {
      for (;;) {
        await a.wait(1000)
        if (running) a.put({ sec: ++sec })
      }
    } catch {
      /* the stage stopped */
    }
  })()
  void ticker

  const rest = a.layout === 'compact' ? { x: 300, y: 292 } : { x: 800, y: 330 }
  await a.snap({ ...START })
  await a.wait(1100)
  a.mark('captions')
  running = true
  sec = 0
  a.put({ mode: 'pill', sec: 0 })
  await a.wait(650)
  for (let i = 1; i <= NW; i++) {
    a.put({ cap: i })
    await a.wait(110)
  }
  await a.wait(150)
  for (let i = 1; i <= TW; i++) {
    a.put({ trs: i })
    await a.wait(90)
  }
  await a.wait(500)
  a.mark('hover')
  await a.move('pill', { duration: 800 })
  a.put({ ring: true })
  // The ring fills for exactly the hover-to-open time
  await a.wait(1500)
  a.mark('open')
  a.put({ mode: 'live', ring: false })
  await a.wait(2300)
  a.mark('meeting')
  await a.click('tab-meet')
  a.put({ mode: 'meet' })
  await a.wait(1100)
  a.mark('accept')
  await a.click('accept')
  a.put({ mode: 'done', acc: true })
  await a.wait(1900)
  a.mark('fold')
  void a.move(rest, { duration: 700 })
  a.put({ mode: 'pill' })
  await a.wait(1500)
  a.mark('end')
  running = false
  a.put({ mode: 'idle' })
  await a.wait(700)
  // Unseen: the idle pill shows no timer or line
  await a.snap({ sec: 0, cap: 0, trs: 0, acc: false })
  await a.wait(500)
}

export default function SubMeetlyIsland() {
  return (
    <Stage<S>
      width={900}
      height={420}
      compact={{ below: 600, width: 358, height: 340 }}
      initial={START}
      poster={POSTER}
      script={script}
      cursor={{ at: { wide: { x: 800, y: 330 }, compact: { x: 300, y: 292 } }, style: 'arrow' }}
      className="si"
    >
      {(s, _rect, layout) => (
        <>
          <div className="si-desk" aria-hidden />
          <div className="si-task" aria-hidden>
            <i /><i /><i /><i /><i /><b />
          </div>
          <Island s={s} compact={layout === 'compact'} />
        </>
      )}
    </Stage>
  )
}
