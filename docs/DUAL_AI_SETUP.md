# Gemini and DeepSeek API setup in PIT

This integration updates the existing Gemini and DeepSeek providers; **it does not replace the standard browser/on-device or other explicitly configured MT provider**. The plugin remains an opt-in, bring-your-own-API-key translation client. This branch has not been merged or deployed.

## Account requirements

- Google Gemini app subscription (including consumer Plus/Pro plans) **is separate from Gemini developer API billing and quota**. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey); inspect its own rate limits and billing tier.
- Hermes is an open-source Nous Research agent, **not** a DeepSeek API model. Use a DeepSeek developer key from [DeepSeek Platform](https://platform.deepseek.com/api_keys), not a Hermes login or chat-session cookie.
- For new configurations: `gemini-3.5-flash-lite` and `deepseek-flash` are the default model IDs; advanced users can manually change the model to `gemini-3.8-flash` or `deepseek-v4-pro` when their API account allows it.
- This change deliberately preserves a previously saved model ID; updating the default does **not** silently overwrite a user's selection.

## Owner setup

1. Open **Extension Options → AI 服务** and paste the Gemini and DeepSeek developer API keys into their **separate fields**; select or edit each model name.
2. Save settings. The keys reside in extension-local storage and must not be committed or copied into a public release. `chrome.storage.local` is not an encrypted credential vault.
3. For normal webpage translation, keep the standard no-key/default MT path. In the extension popup, **manually** choose AI mode only when context-sensitive translation is needed.
4. Choose Gemini or DeepSeek as the active AI provider. One translation batch calls **only that provider**. Switching providers does not silently trigger another API call.
5. Start with a short language-pair test; test image/PDF/video flows separately, as availability of the AI model does **not** imply those pipelines have been fully implemented or live-validated.

## Delivery boundaries

- Both API adapters use official endpoints and JSON response parsing; tests use mocked HTTP responses. They do not prove genuine API-key entitlement or end-to-end browser success.
- Current adapter sends **text**, not raw image/video/audio inputs. Native Gemini multimodal understanding and model-combination workflows require separate implementation and real tests.
- PIT does **not** send ordinary translation text to a paid AI as automatic error fallback; a two-model second-pass must be explicitly requested and separately budgeted.
- Be mindful of per-provider token costs, network timeouts, response accuracy and private third-party source text.

Official docs: [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Gemini key setup](https://ai.google.dev/gemini-api/docs/api-key), [DeepSeek models](https://api-docs.deepseek.com/quick_start/pricing/), [Hermes setup](https://api-docs.deepseek.com/quick_start/agent_integrations/hermes/).


## Third provider: OpenRouter (direct selector)

PIT now also has a separate **OpenRouter** option in the AI Service dropdown, dedicated `openrouterKey` and `openrouterModel` inputs, and an official Chat Completions adapter at `https://openrouter.ai/api/v1/chat/completions`. It is only used after **explicitly selecting AI mode**, not on normal webpage translation and never as an automatic paid fallback.

- If a key has appeared in an image or a copy-paste example, **revoke and regenerate it** at [OpenRouter Keys](https://openrouter.ai/settings/keys). Never commit or screenshot the replacement.
- The default model ID is `openrouter/free`, which routes to available zero-token-price models but may change underlying models between requests. Quotas and whether a free model follows strict JSON translation formatting can differ; malformed results are reported as errors.
- OpenRouter models may include Gemini/DeepSeek variants, but they still use **the OpenRouter account's own key and quota**. Direct provider keys remain independent.
- A key's `$100 credit limit` is a **maximum permitted charge**, not a free account balance. Prefer a much smaller custom cap for personal prototyping.
- Source code and mocked tests are in the review branch; genuine browser and live-API acceptance require a newly generated key entered **only into the installed extension's local settings**.
