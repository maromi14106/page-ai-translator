# Page AI Translator - Privacy

## OpenAI mode

When OpenAI API is selected and the user starts a translation, the extension sends only the text selected for translation, together with translation instructions, to `https://api.openai.com`.

Firefox's optional `websiteContent` data-collection permission is requested before OpenAI translation is used.

The OpenAI API key entered in the sidebar is not saved to `browser.storage.local`.

## Ollama mode

When Ollama is selected, translation requests are sent to the local Ollama endpoint at `http://127.0.0.1:11434`.

The extension does not send Ollama translation text to a server operated by the extension developer.

## Local cache

Original text and translated text can be stored in Firefox `storage.local` so cached translations can be restored without another AI request.

Users can delete the current translation-profile cache, individual cached entries, or all translation caches from the sidebar.

## Telemetry

The extension does not implement analytics, advertising, crash-report upload, or developer-operated telemetry.
