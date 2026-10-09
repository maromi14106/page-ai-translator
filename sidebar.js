const MAX_TOTAL_CHARS = 30000;
const MAX_BATCH_CHARS = 1800;
const MAX_BATCH_ITEMS = 25;
const MAX_SELECTION_CHARS = 5000;
const CACHE_INDEX_KEY = "pageAITranslator.cacheIndex.v1";
const CACHE_PREFIXES = [
  "pageAITranslator.cache.v1.",
  "pageAITranslator.cache.v2."
];

const TARGET_LANGUAGES = {
  "ja": { name: "Japanese", label: "日本語" },
  "en": { name: "English", label: "English" },
  "ko": { name: "Korean", label: "한국어" },
  "zh-CN": { name: "Simplified Chinese", label: "简体中文" },
  "zh-TW": { name: "Traditional Chinese", label: "繁體中文" },
  "fr": { name: "French", label: "Français" },
  "de": { name: "German", label: "Deutsch" },
  "es": { name: "Spanish", label: "Español" }
};

const UI_LOCALE = browser.i18n.getUILanguage();

function msg(key, substitutions) {
  return browser.i18n.getMessage(key, substitutions) || key;
}

function applyStaticI18n() {
  document.documentElement.lang =
    UI_LOCALE.toLowerCase().startsWith("ja") ? "ja" : "en";
  document.title = msg("extensionName");

  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = msg(element.dataset.i18n);
  }

  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.setAttribute(
      "placeholder",
      msg(element.dataset.i18nPlaceholder)
    );
  }
}

applyStaticI18n();

const engine = document.getElementById("engine");
const openaiSettings = document.getElementById("openaiSettings");
const ollamaSettings = document.getElementById("ollamaSettings");
const openaiModel = document.getElementById("openaiModel");
const openaiKey = document.getElementById("openaiKey");
const ollamaModel = document.getElementById("ollamaModel");
const refreshModelsButton = document.getElementById("refreshModelsButton");

const targetLanguage = document.getElementById("targetLanguage");
const translationStyle = document.getElementById("translationStyle");
const terminologyPolicy = document.getElementById("terminologyPolicy");
const customInstructions = document.getElementById("customInstructions");

const translateButton = document.getElementById("translateButton");
const cancelButton = document.getElementById("cancelButton");
const showOriginalButton = document.getElementById("showOriginalButton");
const showTranslationButton = document.getElementById("showTranslationButton");
const translateSelectionButton = document.getElementById("translateSelectionButton");

const pageState = document.getElementById("pageState");
const pageStats = document.getElementById("pageStats");
const cacheState = document.getElementById("cacheState");
const clearCacheButton = document.getElementById("clearCacheButton");
const selectionStats = document.getElementById("selectionStats");
const result = document.getElementById("result");
const progressWrap = document.getElementById("progressWrap");
const progress = document.getElementById("progress");
const progressText = document.getElementById("progressText");
const progressCount = document.getElementById("progressCount");
const refreshCacheListButton = document.getElementById("refreshCacheListButton");
const clearAllCachesButton = document.getElementById("clearAllCachesButton");
const cacheSummary = document.getElementById("cacheSummary");
const cacheList = document.getElementById("cacheList");

let isTranslating = false;
let cancelRequested = false;
let currentController = null;
let targetTabId = null;
let lastOllamaModels = [];

function showMessage(message) {
  result.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = message;
  result.appendChild(p);
}

function currentTargetLanguage() {
  return TARGET_LANGUAGES[targetLanguage.value] ?? TARGET_LANGUAGES.ja;
}

function getCacheProfileObject() {
  return {
    targetLanguage: targetLanguage.value,
    translationStyle: translationStyle.value,
    terminologyPolicy: terminologyPolicy.value,
    customInstructions: customInstructions.value.trim()
  };
}

function getCacheProfile() {
  return JSON.stringify(getCacheProfileObject());
}

function getCacheProfileMeta() {
  return {
    targetLanguage: targetLanguage.value,
    targetLanguageLabel: currentTargetLanguage().label,
    translationStyle: translationStyle.value,
    terminologyPolicy: terminologyPolicy.value,
    hasCustomInstructions:
      customInstructions.value.trim().length > 0
  };
}

function profileLabel(meta) {
  if (!meta) {
    return msg("profileDefault", TARGET_LANGUAGES.ja.label);
  }

  const language =
    TARGET_LANGUAGES[meta.targetLanguage]?.label ??
    meta.targetLanguageLabel ??
    meta.targetLanguage ??
    msg("unknown");

  const styleLabels = {
    natural: msg("styleShortNatural"),
    faithful: msg("styleShortFaithful"),
    concise: msg("styleShortConcise")
  };

  const style =
    styleLabels[meta.translationStyle] ??
    meta.translationStyle ??
    msg("styleShortStandard");

  return msg("profileLabel", [language, style]);
}

function updatePageDisplay(state) {
  const cachedCount = state?.cachedCount ?? state?.translatedCount ?? 0;
  const pendingNodeCount = state?.pendingNodeCount ?? 0;
  const pendingCharacterCount =
    state?.pendingCharacterCount ?? 0;
  const displayMode = state?.displayMode ?? "original";

  if (cachedCount > 0 && pendingNodeCount > 0) {
    pageState.textContent =
      msg("pagePartiallyTranslated", String(cachedCount));
    translateButton.textContent =
      msg("buttonTranslateNewText", currentTargetLanguage().label);
  } else if (cachedCount > 0) {
    pageState.textContent =
      displayMode === "translated"
        ? msg("pageShowingTranslation", String(cachedCount))
        : displayMode === "original"
          ? msg("pageShowingOriginal", String(cachedCount))
          : msg("pageMixed", String(cachedCount));

    translateButton.textContent =
      msg("buttonTranslatePendingTo", currentTargetLanguage().label);
  } else {
    pageState.textContent = msg("pageOriginal");
    translateButton.textContent =
      msg("buttonTranslatePageTo", currentTargetLanguage().label);
  }

  pageStats.textContent =
    msg("statsNodesChars", [String(pendingNodeCount), pendingCharacterCount.toLocaleString(UI_LOCALE)]);

  const persistentPairCount =
    state?.persistentPairCount ?? 0;

  cacheState.textContent =
    persistentPairCount > 0
      ? msg("countEntries", String(persistentPairCount))
      : msg("none");

  clearCacheButton.disabled =
    isTranslating || persistentPairCount === 0;

  showOriginalButton.classList.toggle(
    "active-view",
    cachedCount > 0 && displayMode === "original"
  );

  showTranslationButton.classList.toggle(
    "active-view",
    cachedCount > 0 && displayMode === "translated"
  );

  showOriginalButton.disabled =
    isTranslating || cachedCount === 0;

  showTranslationButton.disabled =
    isTranslating || cachedCount === 0;
}

function updateEngineUI() {
  const usingOpenAI = engine.value === "openai";
  openaiSettings.classList.toggle("hidden", !usingOpenAI);
  ollamaSettings.classList.toggle("hidden", usingOpenAI);
}

function setTranslating(value) {
  isTranslating = value;

  engine.disabled = value;
  openaiModel.disabled = value;
  openaiKey.disabled = value;
  ollamaModel.disabled = value;
  refreshModelsButton.disabled = value;
  targetLanguage.disabled = value;
  translationStyle.disabled = value;
  terminologyPolicy.disabled = value;
  customInstructions.disabled = value;
  translateSelectionButton.disabled = value;
  translateButton.disabled = value;
  showOriginalButton.disabled = value;
  showTranslationButton.disabled = value;
  clearCacheButton.disabled = value;
  refreshCacheListButton.disabled = value;
  clearAllCachesButton.disabled = value;

  cancelButton.classList.toggle("hidden", !value);

  // キャンセルを一度押すと disabled=true になるため、
  // 次回の翻訳開始時には必ず操作可能な状態へ戻す。
  if (value) {
    cancelButton.disabled = false;
  }
}

function setProgress(label, current, total) {
  progressWrap.classList.remove("hidden");
  progressText.textContent = label;
  progressCount.textContent = `${current} / ${total}`;
  progress.max = Math.max(total, 1);
  progress.value = current;
}

function clearProgress() {
  progressWrap.classList.add("hidden");
  progress.value = 0;
}

async function loadSettings() {
  const stored = await browser.storage.local.get([
    "engine",
    "openaiModel",
    "ollamaModel",
    "targetLanguage",
    "translationStyle",
    "terminologyPolicy",
    "customInstructions"
  ]);

  if (stored.engine) engine.value = stored.engine;
  if (stored.openaiModel) openaiModel.value = stored.openaiModel;
  if (stored.targetLanguage && TARGET_LANGUAGES[stored.targetLanguage]) {
    targetLanguage.value = stored.targetLanguage;
  }
  if (stored.translationStyle) translationStyle.value = stored.translationStyle;
  if (stored.terminologyPolicy) terminologyPolicy.value = stored.terminologyPolicy;
  if (typeof stored.customInstructions === "string") {
    customInstructions.value = stored.customInstructions;
  }

  updateEngineUI();

  if (engine.value === "ollama") {
    await refreshOllamaModels(stored.ollamaModel || "");
  }
}

async function saveSettings() {
  await browser.storage.local.set({
    engine: engine.value,
    openaiModel: openaiModel.value.trim(),
    ollamaModel: ollamaModel.value,
    targetLanguage: targetLanguage.value,
    translationStyle: translationStyle.value,
    terminologyPolicy: terminologyPolicy.value,
    customInstructions: customInstructions.value.trim()
  });
}

engine.addEventListener("change", async () => {
  updateEngineUI();
  await saveSettings();

  if (engine.value === "ollama" && lastOllamaModels.length === 0) {
    await refreshOllamaModels();
  }
});

openaiModel.addEventListener("change", saveSettings);
ollamaModel.addEventListener("change", saveSettings);
targetLanguage.addEventListener("change", async () => {
  await saveSettings();
  await updatePageState();
  await refreshCacheList();
});
translationStyle.addEventListener("change", async () => {
  await saveSettings();
  await updatePageState();
  await refreshCacheList();
});
terminologyPolicy.addEventListener("change", async () => {
  await saveSettings();
  await updatePageState();
  await refreshCacheList();
});
customInstructions.addEventListener("change", async () => {
  await saveSettings();
  await updatePageState();
  await refreshCacheList();
});

async function getActiveTab() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tabs.length || !tabs[0].id) {
    throw new Error(msg("errorNoActiveTab"));
  }

  return tabs[0];
}

function isMissingReceiverError(error) {
  const text = error?.message || String(error);

  return (
    text.includes("Receiving end does not exist") ||
    text.includes("Could not establish connection")
  );
}

async function injectContentScript(tabId) {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function ensureContentScript(tabId) {
  try {
    const ping = await browser.tabs.sendMessage(tabId, {
      type: "PING_CONTENT_SCRIPT"
    });

    if (ping?.ok) return;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }
  }

  await injectContentScript(tabId);

  const ping = await browser.tabs.sendMessage(tabId, {
    type: "PING_CONTENT_SCRIPT"
  });

  if (!ping?.ok) {
    throw new Error(msg("errorContentScriptStart"));
  }
}

async function sendToTab(tabId, type, payload = {}) {
  await ensureContentScript(tabId);

  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type,
      cacheProfile: getCacheProfile(),
      cacheProfileMeta: getCacheProfileMeta(),
      ...payload
    });

    if (!response?.ok) {
      throw new Error(response?.error || msg("errorPageOperation"));
    }

    return response;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await injectContentScript(tabId);

    const response = await browser.tabs.sendMessage(tabId, {
      type,
      cacheProfile: getCacheProfile(),
      cacheProfileMeta: getCacheProfileMeta(),
      ...payload
    });

    if (!response?.ok) {
      throw new Error(response?.error || msg("errorPageOperation"));
    }

    return response;
  }
}

function makeBatches(items) {
  const batches = [];
  let current = [];
  let currentChars = 0;

  for (const item of items) {
    const itemChars = item.text.length;

    if (
      current.length > 0 &&
      (
        currentChars + itemChars > MAX_BATCH_CHARS ||
        current.length >= MAX_BATCH_ITEMS
      )
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(item);
    currentChars += itemChars;
  }

  if (current.length) {
    batches.push(current);
  }

  return batches;
}

function translationInstructions() {
  const target = currentTargetLanguage().name;

  const styleRules = {
    natural:
      `Write natural, fluent ${target} that reads as if originally written in ${target}, while preserving the original meaning.`,
    faithful:
      `Stay close to the source wording and structure. Prefer fidelity over paraphrasing, while keeping the ${target} grammatical and readable.`,
    concise:
      `Use concise ${target}. Remove unnecessary verbosity but do not omit factual meaning.`
  };

  const terminologyRules = {
    balanced:
      `Use terminology natural to the domain and to ${target}. Keep established loanwords, product names, abbreviations, or source-language terms when that is more natural.`,
    preserve:
      "Preserve common technical terms, product names, skill names, abbreviations, and established source-language terminology when practical.",
    japanese:
      `Translate terminology into understandable ${target} where a natural equivalent exists, while preserving product names and proper nouns.`
  };

  const rules = [
    "You are a web-page translation engine.",
    `Translate every supplied text item into ${target}.`,
    styleRules[translationStyle.value] ?? styleRules.natural,
    terminologyRules[terminologyPolicy.value] ?? terminologyRules.balanced,
    "Preserve names, numbers, URLs, symbols, formatting intent, and product names.",
    "Do not add explanations, translator notes, headings, or commentary.",
    "Return exactly one translation for every supplied id."
  ];

  const extra = customInstructions.value.trim();

  if (extra) {
    rules.push(
      `Additional user translation rules: ${extra}`
    );
  }

  return rules.join(" ");
}

function translationSchema() {
  return {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            translation: { type: "string" }
          },
          required: ["id", "translation"],
          additionalProperties: false
        }
      }
    },
    required: ["translations"],
    additionalProperties: false
  };
}

function validateTranslations(items, translations) {
  if (!Array.isArray(translations)) {
    throw new Error(msg("errorTranslationsArrayMissing"));
  }

  const expectedIds = new Set(items.map((item) => String(item.id)));
  const resultById = new Map();

  for (const entry of translations) {
    const id = String(entry?.id ?? "");
    const translation = entry?.translation;

    if (expectedIds.has(id) && typeof translation === "string") {
      resultById.set(id, translation);
    }
  }

  const missing = [...expectedIds].filter(
    (id) => !resultById.has(id)
  );

  if (missing.length) {
    throw new Error(msg("errorTranslationsMissing", String(missing.length)));
  }

  return items.map((item) => ({
    id: String(item.id),
    translation: resultById.get(String(item.id))
  }));
}

function extractOpenAIOutputText(data) {
  const pieces = [];

  for (const output of data?.output ?? []) {
    for (const content of output?.content ?? []) {
      if (
        content?.type === "output_text" &&
        typeof content.text === "string"
      ) {
        pieces.push(content.text);
      }
    }
  }

  return pieces.join("");
}

function newAbortController() {
  currentController = new AbortController();
  return currentController;
}

async function ensureOpenAIWebsiteContentConsent() {
  if (engine.value !== "openai") {
    return;
  }

  // permissions.request() はユーザー操作ハンドラーの有効な間に
  // 呼ぶ必要がある。事前に getAll()/contains() を await しない。
  const granted = await browser.permissions.request({
    data_collection: ["websiteContent"]
  });

  if (!granted) {
    throw new Error(
      msg("errorOpenAIConsent")
    );
  }
}

async function translateWithOpenAI(items) {
  const apiKey = openaiKey.value.trim();
  const model = openaiModel.value.trim();

  if (!apiKey) {
    throw new Error(msg("errorOpenAIKeyRequired"));
  }

  if (!model) {
    throw new Error(msg("errorOpenAIModelRequired"));
  }

  const controller = newAbortController();

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        instructions: translationInstructions(),
        input: JSON.stringify({
          target_language: currentTargetLanguage().name,
          items
        }),
        text: {
          format: {
            type: "json_schema",
            name: "web_page_translations",
            strict: true,
            schema: translationSchema()
          }
        }
      })
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `OpenAI API: ${
        data?.error?.message ||
        `${response.status} ${response.statusText}`
      }`
    );
  }

  const outputText = extractOpenAIOutputText(data);

  if (!outputText) {
    throw new Error(msg("errorOpenAIResultMissing"));
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error(msg("errorOpenAIJson"));
  }

  return validateTranslations(items, parsed.translations);
}

async function fetchOllamaModels() {
  const controller = newAbortController();

  const response = await fetch(
    "http://127.0.0.1:11434/api/tags",
    {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      msg("ollamaConnectionTestHttp", [String(response.status), response.statusText])
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(msg("errorOllamaConnectionJson"));
  }

  return Array.isArray(data?.models)
    ? data.models.map((item) => item?.name).filter(Boolean)
    : [];
}

async function refreshOllamaModels(preferred = "") {
  try {
    refreshModelsButton.disabled = true;
    const models = await fetchOllamaModels();
    currentController = null;
    lastOllamaModels = models;

    const stored = preferred || ollamaModel.value;

    ollamaModel.innerHTML = "";

    if (!models.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = msg("ollamaModelNotFound");
      ollamaModel.appendChild(option);
      showMessage(msg("ollamaConnectedNoModels"));
      return;
    }

    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      ollamaModel.appendChild(option);
    }

    if (stored && models.includes(stored)) {
      ollamaModel.value = stored;
    } else {
      ollamaModel.value = models[0];
    }

    await saveSettings();
    showMessage(
      msg("ollamaConnectedModels", String(models.length))
    );
  } catch (error) {
    if (error?.name !== "AbortError") {
      showMessage(
        msg("ollamaModelFetchError", error?.message || String(error))
      );
    }
  } finally {
    currentController = null;
    refreshModelsButton.disabled = isTranslating;
  }
}

async function translateWithOllama(items) {
  const model = ollamaModel.value;

  if (!model) {
    throw new Error(msg("errorOllamaModelRequired"));
  }

  const controller = newAbortController();

  const response = await fetch(
    "http://127.0.0.1:11434/api/chat",
    {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: translationSchema(),
        options: {
          temperature: 0
        },
        messages: [
          {
            role: "system",
            content: translationInstructions()
          },
          {
            role: "user",
            content: JSON.stringify({
              target_language: currentTargetLanguage().name,
              items
            })
          }
        ]
      })
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `Ollama: ${
        data?.error ||
        `${response.status} ${response.statusText}`
      }`
    );
  }

  const content = data?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error(msg("errorOllamaResultMissing"));
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(msg("errorOllamaJson"));
  }

  return validateTranslations(items, parsed.translations);
}

async function translateBatch(items) {
  try {
    if (engine.value === "ollama") {
      return await translateWithOllama(items);
    }

    return await translateWithOpenAI(items);
  } finally {
    currentController = null;
  }
}

function friendlyError(error) {
  const raw = error?.message || String(error);

  if (raw.includes("Missing host permission")) {
    return msg("errorHostPermission");
  }

  if (
    raw.includes("Cannot access") ||
    raw.includes("restricted")
  ) {
    return msg("errorProtectedPage");
  }

  if (
    engine.value === "ollama" &&
    (raw.includes("Ollama: 403") || raw.includes("HTTP 403"))
  ) {
    return msg("errorOllamaForbidden");
  }

  if (
    raw.includes("NetworkError") ||
    raw.includes("Failed to fetch")
  ) {
    return engine.value === "ollama"
      ? msg("errorOllamaNetwork")
      : msg("errorGeneric", raw);
  }

  if (isMissingReceiverError(error)) {
    return msg("errorPageDisconnected");
  }

  return msg("errorGeneric", raw);
}

async function updatePageState() {
  if (isTranslating) {
    return;
  }

  try {
    const tab = await getActiveTab();
    const response = await sendToTab(
      tab.id,
      "GET_TRANSLATION_STATE"
    );

    updatePageDisplay(response);
  } catch (error) {
    pageState.textContent = msg("pageUnsupported");
  }
}

function formatCacheDate(timestamp) {
  const value = Number(timestamp);

  if (!Number.isFinite(value) || value <= 0) {
    return msg("dateUnknown");
  }

  return new Date(value).toLocaleString(UI_LOCALE);
}

async function readCacheIndex() {
  const stored = await browser.storage.local.get(CACHE_INDEX_KEY);
  const index = Array.isArray(stored[CACHE_INDEX_KEY])
    ? stored[CACHE_INDEX_KEY]
    : [];

  return index
    .filter((item) => item?.key && item?.url)
    .sort(
      (a, b) =>
        Number(b?.updatedAt ?? 0) -
        Number(a?.updatedAt ?? 0)
    );
}

async function refreshCurrentPersistentStatus() {
  try {
    const tab = await getActiveTab();
    const response = await sendToTab(
      tab.id,
      "REFRESH_PERSISTENT_CACHE_STATUS"
    );
    updatePageDisplay(response);
  } catch {
    // 対象外ページなどでは無視。
  }
}

async function refreshCacheList() {
  try {
    refreshCacheListButton.disabled = true;

    const index = await readCacheIndex();

    cacheList.innerHTML = "";
    cacheSummary.textContent =
      index.length > 0
        ? msg("cacheSummarySaved", String(index.length))
        : msg("cacheSummaryEmpty");

    clearAllCachesButton.disabled =
      isTranslating || index.length === 0;

    for (const item of index) {
      const wrapper = document.createElement("div");
      wrapper.className = "cache-item";

      const url = document.createElement("div");
      url.className = "cache-item-url";
      url.textContent = item.url;
      wrapper.appendChild(url);

      const meta = document.createElement("div");
      meta.className = "cache-item-meta";
      meta.textContent = msg("cacheItemMeta", [
        profileLabel(item.profileMeta),
        Number(item.pairCount ?? 0).toLocaleString(UI_LOCALE),
        formatCacheDate(item.updatedAt)
      ]);
      wrapper.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "cache-item-actions";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "ghost";
      removeButton.textContent = msg("buttonDeleteThisCache");

      removeButton.addEventListener("click", async () => {
        removeButton.disabled = true;

        try {
          await browser.storage.local.remove(item.key);

          const latest = await readCacheIndex();
          await browser.storage.local.set({
            [CACHE_INDEX_KEY]: latest.filter(
              (entry) => entry.key !== item.key
            )
          });

          await refreshCurrentPersistentStatus();
          await refreshCacheList();

          showMessage(
            msg("cacheDeletedSelected")
          );
        } catch (error) {
          showMessage(friendlyError(error));
        }
      });

      actions.appendChild(removeButton);
      wrapper.appendChild(actions);
      cacheList.appendChild(wrapper);
    }
  } catch (error) {
    cacheSummary.textContent =
      msg("cacheListError", error?.message || String(error));
  } finally {
    refreshCacheListButton.disabled = isTranslating;
  }
}

async function clearAllTranslationCaches() {
  const stored = await browser.storage.local.get(null);
  const keys = Object.keys(stored).filter(
    (key) =>
      key === CACHE_INDEX_KEY ||
      CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );

  if (keys.length > 0) {
    await browser.storage.local.remove(keys);
  }

  await refreshCurrentPersistentStatus();
  await refreshCacheList();
}

refreshModelsButton.addEventListener("click", () => {
  refreshOllamaModels();
});

refreshCacheListButton.addEventListener("click", () => {
  refreshCacheList();
});

clearAllCachesButton.addEventListener("click", async () => {
  if (
    !confirm(
      msg("confirmClearAllCaches")
    )
  ) {
    return;
  }

  try {
    clearAllCachesButton.disabled = true;
    await clearAllTranslationCaches();
    showMessage(
      msg("cacheAllDeleted")
    );
  } catch (error) {
    showMessage(friendlyError(error));
  }
});

async function showTranslatedAfterTranslation(tabId) {
  const response = await sendToTab(
    tabId,
    "SHOW_TRANSLATED_TEXT"
  );

  updatePageDisplay(response);
  return response;
}

translateSelectionButton.addEventListener("click", async () => {
  if (isTranslating) return;

  cancelRequested = false;
  cancelButton.disabled = false;
  targetTabId = null;

  try {
    // 同期チェックだけ先に行い、OpenAIの場合はユーザー操作が有効な
    // うちに最初の非同期処理としてpermissions.request()を呼ぶ。
    if (
      engine.value === "openai" &&
      !openaiKey.value.trim()
    ) {
      throw new Error(msg("errorOpenAIKeyRequired"));
    }

    if (
      engine.value === "ollama" &&
      !ollamaModel.value
    ) {
      throw new Error(msg("errorOllamaModelRequired"));
    }

    if (engine.value === "openai") {
      await ensureOpenAIWebsiteContentConsent();
    }

    // RC2でページ側に最後の有効なSelectionを保持しているため、
    // 許可ダイアログ後でもここで安全に取得できる。
    const tab = await getActiveTab();
    targetTabId = tab.id;

    const selected = await sendToTab(
      targetTabId,
      "GET_SELECTION_ITEMS"
    );

    selectionStats.textContent =
      selected.nodeCount > 0
        ? msg("selectionStats", [String(selected.nodeCount), selected.characterCount.toLocaleString(UI_LOCALE)])
        : msg("selectionNone");

    if (!selected.items.length) {
      showMessage(
        msg("selectionPrompt")
      );
      return;
    }

    if (selected.characterCount > MAX_SELECTION_CHARS) {
      throw new Error(
        msg("errorSelectionTooLong", [
        selected.characterCount.toLocaleString(UI_LOCALE),
        MAX_SELECTION_CHARS.toLocaleString(UI_LOCALE)
      ])
      );
    }

    await saveSettings();
    setTranslating(true);

    const batches = makeBatches(selected.items);
    const allTranslations = [];

    for (let index = 0; index < batches.length; index += 1) {
      if (cancelRequested) break;

      setProgress(
        msg("progressSelectionAI"),
        index,
        batches.length
      );

      showMessage(
        msg("messageSelectionAIBatch", [String(index + 1), String(batches.length)])
      );

      let translations;

      try {
        translations = await translateBatch(
          batches[index]
        );
      } catch (error) {
        if (
          cancelRequested ||
          error?.name === "AbortError"
        ) {
          break;
        }

        throw new Error(
          msg("errorSelectionBatch", [
          String(index + 1),
          String(batches.length),
          error?.message || String(error)
        ])
        );
      }

      allTranslations.push(...translations);

      setProgress(
        msg("progressSelection"),
        index + 1,
        batches.length
      );
    }

    if (cancelRequested) {
      showMessage(
        msg("selectionCancelled")
      );
      return;
    }

    const applied = await sendToTab(
      targetTabId,
      "APPLY_SELECTION_TRANSLATIONS",
      { translations: allTranslations }
    );

    await showTranslatedAfterTranslation(targetTabId);

    showMessage(
      msg("selectionComplete", String(applied.changedCount))
    );
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    currentController = null;
    setTranslating(false);
    targetTabId = null;
    await updatePageState();
  }
});

translateButton.addEventListener("click", async () => {
  if (isTranslating) return;

  cancelRequested = false;
  cancelButton.disabled = false;
  targetTabId = null;

  try {
    if (
      engine.value === "openai" &&
      !openaiKey.value.trim()
    ) {
      throw new Error(msg("errorOpenAIKeyRequired"));
    }

    if (
      engine.value === "ollama" &&
      !ollamaModel.value
    ) {
      throw new Error(msg("errorOllamaModelRequired"));
    }

    if (engine.value === "openai") {
      await ensureOpenAIWebsiteContentConsent();
    }

    await saveSettings();

    const tab = await getActiveTab();
    targetTabId = tab.id;

    setTranslating(true);
    setProgress(msg("progressGettingText"), 0, 1);
    showMessage(msg("messageGettingText"));

    const page = await sendToTab(
      targetTabId,
      "GET_TRANSLATION_ITEMS",
      { untranslatedOnly: true }
    );

    updatePageDisplay(page);

    if (!page.items.length) {
      showMessage(
        msg("noUntranslatedText")
      );
      return;
    }

    if (page.characterCount > MAX_TOTAL_CHARS) {
      throw new Error(
        msg("errorPageTooLong", [
        page.characterCount.toLocaleString(UI_LOCALE),
        MAX_TOTAL_CHARS.toLocaleString(UI_LOCALE)
      ])
      );
    }

    const batches = makeBatches(page.items);
    progress.max = batches.length;

    let changedTotal = 0;

    for (let index = 0; index < batches.length; index += 1) {
      if (cancelRequested) break;

      setProgress(
        msg("progressAI"),
        index,
        batches.length
      );

      showMessage(
        msg("messageAIBatch", [String(index + 1), String(batches.length)])
      );

      let translations;

      try {
        translations = await translateBatch(batches[index]);
      } catch (error) {
        if (
          cancelRequested ||
          error?.name === "AbortError"
        ) {
          break;
        }

        throw new Error(
          msg("errorBatch", [
          String(index + 1),
          String(batches.length),
          error?.message || String(error)
        ])
        );
      }

      if (cancelRequested) break;

      setProgress(
        msg("progressApplying"),
        index,
        batches.length
      );

      let applied;

      try {
        applied = await sendToTab(
          targetTabId,
          "APPLY_TRANSLATIONS",
          { translations }
        );
      } catch (error) {
        throw new Error(
          msg("errorApplyBatch", [
          String(index + 1),
          String(batches.length),
          error?.message || String(error)
        ])
        );
      }

      changedTotal += applied.changedCount;

      setProgress(
        msg("progressTranslating"),
        index + 1,
        batches.length
      );
    }

    if (cancelRequested) {
      showMessage(
        msg("translationCancelled", String(changedTotal))
      );
    } else {
      await showTranslatedAfterTranslation(targetTabId);

      showMessage(
        msg("translationComplete", String(changedTotal))
      );
    }
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    currentController = null;
    setTranslating(false);
    targetTabId = null;
    await updatePageState();
  }
});

cancelButton.addEventListener("click", () => {
  if (!isTranslating) return;

  cancelRequested = true;
  cancelButton.disabled = true;
  progressText.textContent = msg("progressCancelling");
  showMessage(msg("messageCancelling"));

  if (currentController) {
    currentController.abort();
  }
});

showOriginalButton.addEventListener("click", async () => {
  try {
    showOriginalButton.disabled = true;
    showMessage(msg("messageSwitchingOriginal"));

    const tab = await getActiveTab();
    const response = await sendToTab(
      tab.id,
      "SHOW_ORIGINAL_TEXT"
    );

    updatePageDisplay(response);
    showMessage(
      msg("messageOriginalShown")
    );
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    await updatePageState();
  }
});

showTranslationButton.addEventListener("click", async () => {
  try {
    showTranslationButton.disabled = true;
    showMessage(msg("messageSwitchingTranslation"));

    const tab = await getActiveTab();
    const response = await sendToTab(
      tab.id,
      "SHOW_TRANSLATED_TEXT"
    );

    updatePageDisplay(response);
    showMessage(
      msg("messageTranslationShown")
    );
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    await updatePageState();
  }
});

clearCacheButton.addEventListener("click", async () => {
  try {
    clearCacheButton.disabled = true;
    showMessage(msg("messageDeletingCurrentCache"));

    const tab = await getActiveTab();
    const response = await sendToTab(
      tab.id,
      "DELETE_PERSISTENT_CACHE"
    );

    updatePageDisplay(response);

    showMessage(
      msg("messageCurrentCacheDeleted")
    );
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    await updatePageState();
  }
});

browser.runtime.onMessage.addListener(
  (message, sender) => {
    if (
      message?.type !== "PAGE_CONTENT_CHANGED" ||
      isTranslating
    ) {
      return undefined;
    }

    getActiveTab()
      .then((tab) => {
        if (sender?.tab?.id !== tab.id) {
          return;
        }

        updatePageDisplay(message);

        if (
          message.isTranslated &&
          message.pendingNodeCount > 0
        ) {
          showMessage(
            msg("messageNewTextDetected", String(message.pendingNodeCount))
          );
        }
      })
      .catch(() => {});

    return undefined;
  }
);

browser.tabs.onActivated.addListener(() => {
  updatePageState();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    tab.active &&
    (changeInfo.status === "complete" || changeInfo.url)
  ) {
    updatePageState();
  }
});

loadSettings()
  .then(updatePageState)
  .catch((error) => {
    console.error(error);
    showMessage(
      msg("initializationError", error?.message || String(error))
    );
  });

refreshCacheList();
