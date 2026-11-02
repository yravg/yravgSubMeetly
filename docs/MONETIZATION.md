# Monetization strategy — yraverageSub / Local TransSub

Status: research + recommendation, 2026-09-06. Nothing in `src/`, `native/` or `mac/` is changed by
this document. Decisions marked **[DECIDE]** need the owner's call before implementation.

## 1. What we are selling

Three surfaces, one promise: speech → subtitles / transcript / minutes, **100% on-device, no
account, no cloud**.

| Surface | Cost to us per user | Perceived value | Natural buyer |
| --- | --- | --- | --- |
| Chrome extension (`src/`) | ~0 (models from Hugging Face, inference on user GPU) | Medium: live subtitles, file → SRT/VTT | Students, language learners, viewers |
| Native helper (`native/`) | ~0 | High: 10–20× realtime, >2 GiB files, LLM translation | Power users, professionals |
| macOS app (`mac/`) | ~0 | High: any-app audio, 0.25 s first subtitle, dictation | Professionals on Mac |
| Minutes Register (`notes-*`, `minutes.js`) | ~0 | **Highest**: typed, owned, carried-forward register with provenance to the audio; 14 project types; Library + Training | Project control, contract, HSE, engineering teams in confidentiality-sensitive work |

Because marginal cost is zero, we can afford a genuinely generous free tier. The thing to charge
for is the **workflow value** (minutes, register, exports, team features), not the raw inference.

## 2. Market reference points (checked 2026-09)

| Product | Model | Free tier | Paid |
| --- | --- | --- | --- |
| MacWhisper (on-device, Mac) | Freemium, one-time | Small models free | €59 lifetime Pro on Gumroad; App Store $6.99/mo, $29.99/yr, $99.99 lifetime; 5/10/20/50-seat bundles, ~25% academic |
| Superwhisper (on-device dictation, Mac/Win/iOS) | Freemium, subscription + lifetime | Limited | $8.49/mo, $84.99/yr, $249.99 lifetime |
| Otter.ai (cloud notes) | Freemium, per seat | 300 min/mo, 30 min/conversation | Pro $8.33/mo annual, Business ~$20/mo |
| Fireflies (cloud notes) | Freemium | ~800 min/mo | Pro $10/user/mo |
| Granola (bot-free notes, cloud LLM) | Per seat | Trial | Business $14/user/mo, Enterprise $35 |
| Krisp | Per seat | Limited | ~$16/mo |

Takeaways:

- The **on-device** segment (MacWhisper, Superwhisper) monetizes with a **one-time lifetime licence
  around $59–99**, sometimes alongside an annual plan. Buyers there explicitly reject subscriptions
  for something that runs on their own hardware.
- The **meeting-notes** segment monetizes **per seat, monthly, $8–20**, and its free tiers are
  metered by minutes. Our marginal cost is zero, so we should not meter minutes; we meter *workflow*
  features instead.
- Chrome Web Store payments were sunset in 2021. Every paid extension today uses an external
  merchant of record (Lemon Squeezy, Paddle, Gumroad) or ExtensionPay (5% flat), with a licence
  key pasted into the extension. This is also the only pattern compatible with "no account".

## 3. Recommended model: **Free core + Pro licence (one-time) + Team (annual)**

### 3.1 Free — forever, no key, no account

Keep everything that makes the product trustworthy and shareable:

- Realtime subtitles in the browser engine (Whisper Tiny/Base/Small, WASM/WebGPU).
- Translation tiers 1–3 (Whisper-direct, Chrome Translator, Opus-MT).
- File transcription, **no file-size or minute cap**, export SRT / VTT / TXT.
- History (last 20 sessions).
- Minutes: **1 active meeting series**, full register UI, export MD/TXT.
- Native helper for **transcription** (open source, MIT-licensed weights): free.
- macOS app: live subtitles and dictation free.

Rationale: privacy-first users are the marketing channel. A crippled free tier kills word of
mouth, and inference costs us nothing.

### 3.2 Pro — one-time licence per person **[DECIDE price]**

Suggested **$49 launch / $69 list**, lifetime updates for the 1.x line (MacWhisper €59 is the
anchor; we bundle three surfaces, so we sit at or slightly above it).

Unlocks, across extension + helper + Mac app with one key:

- Whisper Large v3 Turbo and Voxtral in the browser engine (the "accurate" models).
- Helper LLM translation and refine (`/translate`, `/draft`, `/translate_refine`) — see §5 licence.
- Minutes: unlimited series, carry-forward of open actions, risk matrix, Library import of the
  214-transcript sample set, Training / XP / quizzes.
- Performance tab, benchmark import, perf report export.
- History unlimited, batch export.
- macOS: floating overlay over any app + file transcription of >2 GiB via helper.

### 3.3 Team — per seat, annual **[DECIDE]**

For the project-control / contract-management buyer (the user's own field): **$8/seat/month
billed annually, min 5 seats**, ≈ $480/yr for a 5-person PMT. Pricing below Otter Pro and
Granola because we carry no cloud cost and no cloud risk.

Adds on top of Pro:

- Shared register templates per project type (weekly-progress, HSE, design review, client review,
  finance, legal…), organisation-wide.
- Register export to DOCX minutes on the company template, and CSV/XLSX action log.
- Multi-key management (one licence file, N seats, offline activation for air-gapped sites).
- Priority support and a named contact.

Everything Team still runs on-device. The pitch: "the only minute-taker allowed in a contract
meeting", which is the exact position `NOTES-V2-SPEC.md` already argues (provenance is the moat).

### 3.4 Volume and goodwill

- Education and NGO: 50% off Pro, keyed by e-mail domain at checkout.
- Open-source contributors: free Pro key on merged PR.
- 14-day Pro trial, no card, activated by clicking "Try Pro" (local timestamp, honour system).

## 4. Licensing mechanics (fits "no account, no telemetry")

Recommended: **Lemon Squeezy** (merchant of record, handles VAT/GST worldwide, licence-key API,
one-time and subscription products in one store) or **Paddle** if the team prefers. ExtensionPay
is simpler but Chrome-only and cannot key the Mac app or helper.

Flow:

1. User buys on the website, receives a key `LTS-XXXX-…` by e-mail.
2. Key is pasted in Settings → Licence in any surface. The extension validates once against the
   Lemon Squeezy licence endpoint, stores `{key, plan, seats, expiresAt, signature}` in
   `chrome.storage.local` (helper: in `~/.localtranssub/licence.json`, Mac app: Keychain).
3. Offline grace: 30 days without re-validation, then features fall back to Free (never lose
   data, never block export of existing transcripts).
4. Privacy policy (`store/PRIVACY.md`) gains one paragraph: the *only* network call we make is the
   optional licence validation, and it sends the key and a random install id, nothing else.

Do not obfuscate or DRM the code beyond this. The buyer profile pays for legitimacy and
convenience, not because they cannot bypass a check.

## 5. Blocker before selling anything: model licences

| Component | Licence | Commercial use |
| --- | --- | --- |
| Whisper (all sizes, large-v3-turbo) | MIT | OK |
| Voxtral Mini 3B | Apache 2.0 | OK |
| Opus-MT (Helsinki-NLP) | CC-BY-4.0 | OK, attribution required in the UI / about page |
| Silero VAD, transformers.js, ONNX Runtime | MIT / Apache 2.0 | OK |
| Apple SpeechAnalyzer / Translation (Mac app) | OS frameworks | OK |
| **Qwen2.5-3B-Instruct** (helper `TRANSLATE_MODEL` default) | **Qwen Research License, non-commercial** | **NOT OK** |

Action **[MUST, before launch]**: switch the helper default to an Apache-2.0 sibling, e.g.
`Qwen2.5-1.5B-Instruct` or `Qwen2.5-7B-Instruct` (both Apache 2.0), or Gemma / Llama with their
own terms reviewed. Re-run `bench-lab.py` because the draft latency target (≤ 500 ms) was measured
on the 3B model. Add a `THIRD-PARTY-LICENSES.md` listing all model attributions.

Also: the README says "inspired by Local AI Subtitle, rebuilt from scratch". Keep it that way; do
not reuse its branding or listing copy in paid marketing.

## 6. Implementation roadmap (small, in order)

| # | Step | Where | Effort |
| --- | --- | --- | --- |
| 1 | Replace non-commercial Qwen default, re-bench, add licence attributions | `native/run.sh`, `native/server.py`, docs | 0.5 day |
| 2 | Feature-gate module `src/lib/licence.js` (`isPro()`, `plan()`, offline grace), gates at model picker, minutes series limit, perf panel, helper `/translate` | `src/lib`, `native/server.py` | 1–2 days |
| 3 | Settings → Licence UI in side panel and Mac app; "Try Pro 14 days" | `sidepanel.html`, `mac/` | 1 day |
| 4 | Lemon Squeezy store, two products (Pro one-time, Team annual), webhooks not needed | web | 0.5 day |
| 5 | Landing page + pricing page; CWS listing keeps "free" wording and links to pricing | `store/listing.md`, site | 1 day |
| 6 | Tests: `test/licence.test.mjs` (gate matrix, expiry, grace), app-surfaces + Pro/Free render | `test/` | 0.5 day |
| 7 | Team pack: DOCX minutes export on template, multi-seat key | later, after first paying users | 1–2 weeks |

## 7. Metrics to watch (no telemetry, so measured at the store)

- Installs (CWS dashboard) → Pro purchases: target 1–2% in month 3.
- Refund rate under 5%.
- Team enquiries from the pricing page contact form; two design-partner PMTs in the first quarter.

## 8. What not to do

- No ads, no data resale, no "anonymous analytics": it contradicts the only reason people choose us.
- No minute caps on the free tier: it costs us nothing and it is the competitors' weak spot.
- No subscription-only Pro: the on-device segment punishes that (see MacWhisper vs Superwhisper
  reviews). Offer one-time first, annual only for Team.

## Sources

- MacWhisper pricing: https://www.getvoibe.com/resources/macwhisper-pricing/ , https://lumevoice.com/blog/macwhisper-pricing-2026/
- Superwhisper pricing: https://tldv.io/blog/superwhisper-review/
- Otter / Fireflies / tl;dv: https://tldv.io/blog/otter-pricing/ , https://sonix.ai/resources/otter-ai-pricing/
- Granola, Krisp: https://efficient.app/apps/granola , https://www.heykuno.com/en/blog/krisp-app-review/
- Extension billing options: https://crxpay.io/blog/chrome-extension-monetization-models-2026 , https://dodopayments.com/blogs/monetize-chrome-extension
- Model licences: https://mistral.ai/news/voxtral/ , https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/main/LICENSE , https://huggingface.co/Helsinki-NLP/opus-mt-zh-en
