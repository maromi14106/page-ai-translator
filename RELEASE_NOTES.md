# Page AI Translator v1.0.0

This release candidate freezes the v0.9.2 feature set and focuses on release hardening.

## Release hardening

- Correct Firefox data-transmission declaration for OpenAI mode.
- Optional `websiteContent` consent is requested before OpenAI translation.
- Firefox 140+ minimum version for the built-in data-consent flow.
- Ollama remains the local translation option.
- Removed the unused `activeTab` API permission.
- Simplified redundant host permission entries.
- Updated stale error wording.
- Added privacy documentation.
- Added package integrity validation.

## Core feature set

- OpenAI API and Ollama translation engines.
- Full-page translation.
- Selected-text translation.
- 8 target languages.
- Translation style, terminology, and custom rules.
- Cancel and resume behavior.
- Original/translated instant display switching.
- Dynamic-page detection.
- Translation-profile-aware persistent cache.
- Cache list, per-entry deletion, and delete-all.
- Ctrl+Shift+. sidebar shortcut.


## RC2 fix

- Selection translation no longer depends only on the live `window.getSelection()` state at the moment the sidebar button is clicked.
- The content script remembers the last valid page selection.
- A collapsed selection caused by moving focus to the sidebar does not erase the stored selection.
- Selection is captured before the OpenAI website-content consent prompt is requested.
- Stale selection offsets are rejected if the page changes the selected text before translation is applied.


## RC3 fix

- Fixed Firefox error: `permissions.request may only be called from a user input handler`.
- Removed the awaited `permissions.getAll()` check before requesting OpenAI website-content consent.
- `permissions.request()` is now the first asynchronous operation in OpenAI translation button handlers.
- Selection translation keeps the RC2 last-selection snapshot, so the permission prompt can safely appear before selection retrieval.


## RC4 UX cleanup

- After a successful full-page translation, the translated text is shown automatically.
- After a successful selected-text translation, the translated text is shown automatically.
- Removed the redundant `翻訳対象を確認` button.
- Untranslated counts and page state continue to update automatically.


## Final release

v1.0.0 is functionally identical to RC4. Only release labeling/documentation was finalized after RC4 passed user testing.
