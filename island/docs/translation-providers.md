# Caption translation providers

Captions are translated **on this device** by default: the engine's own model (Marian / Qwen),
nothing leaves the computer. Settings › Models › *Caption translation service* lets the person pick
another service instead, like LiveCaptions-Translator's engine list (features only; see
`THIRD-PARTY-NOTICES.txt`).

| Provider (`id`) | Needs | Notes |
|---|---|---|
| On this device (`local`) | nothing | The default. |
| Google Translate (`google`) | nothing | The free web endpoint `translate.googleapis.com/translate_a/single?client=gtx`. **Unofficial**: Google does not document or promise it; it can be rate limited or change. |
| Google Cloud Translation (`google_cloud`) | API key | The official v2 API. |
| DeepL (`deepl`) | API key | A key ending in `:fx` uses `api-free.deepl.com`, any other `api.deepl.com`. |
| Youdao (`youdao`) | app id, secret | Signed with SHA-256 (`signType=v3`). The secret is never sent, only the signature. |
| Baidu Translate (`baidu`) | app id, secret | Signed with MD5 (`md5(appid+q+salt+secret)`). |
| MTranServer (`mtran`) | server URL (default `http://localhost:8989`), optional token | Self-hosted. |
| LibreTranslate (`libre`) | server URL (default `https://libretranslate.com`), optional key | Self-hosted or public. |
| Ollama (`ollama`) | server URL (default `http://localhost:11434/v1`), model | Through the chat connector, with a translation prompt. |
| OpenAI-compatible (`openai`) | API key, model, URL (default `https://api.openai.com/v1`) | Any server that speaks the OpenAI chat format. |
| OpenRouter (`openrouter`) | API key, model | `https://openrouter.ai/api/v1`. |

Every provider's server URL can be overridden (a proxy, a company gateway, a test server).

## Privacy

* Off by default. Nothing is sent anywhere unless a provider other than *On this device* is chosen
  **and** switched on (*Use this service for captions*). Choosing a provider alone does not turn it on.
* When on, **each caption line's text** (final lines only, not the growing utterance) goes to that service.
  Settings says so under the switch. A self-hosted server on this computer (`localhost`) stays local.
* Keys and secrets are stored in `providers.json` in the engine's state folder (mode 0600 on Unix), never
  logged, never returned by the API (only "saved" and the last four characters of a key).
* If the service fails (offline, quota, wrong key) the caption is translated by the on-device model and the
  `/draft` answer carries `translateError` with the reason; no caption is lost.

## Engine API

* `GET /translate/provider` — the saved choice without secrets, plus the list of providers.
* `POST /translate/provider` — `{provider, enabled, baseUrl, apiKey, secret, appId, model, clearKey}`.
  Each provider keeps its own fields. Turning on without the needed fields is a 400.
* `POST /translate/provider/test` — `{provider?, …, src?, tgt?}` translates one short sentence through the
  saved settings plus any overrides, whether or not the provider is on; it never turns it on.

## Limits

* Interim lines (the growing utterance) stay on the local model: a service call per second would cost
  quota and is slow. Only final lines go to the service.
* Cloud calls add their network time to each final line (timeouts: 8 s to connect, 20 s in all).
* The Settings text fields come from the clipboard (Settings has no text boxes): copy, then press Paste.
* Not exercised against the real services here (no keys): request shapes and signing are covered by tests
  against mock servers, and Baidu's signature against its documented example.
