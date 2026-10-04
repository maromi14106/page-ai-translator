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
  "en": { name: "English", label: "英語" },
  "ko": { name: "Korean", label: "韓国語" },
  "zh-CN": { name: "Simplified Chinese", label: "中国語（簡体字）" },
  "zh-TW": { name: "Traditional Chinese", label: "中国語（繁体字）" },
  "fr": { name: "French", label: "フランス語" },
  "de": { name: "German", label: "ドイツ語" },
  "es": { name: "Spanish", label: "スペイン語" }
};

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
    return "日本語・標準設定";
  }

  const language =
    meta.targetLanguageLabel ??
    TARGET_LANGUAGES[meta.targetLanguage]?.label ??
    meta.targetLanguage ??
    "不明";

  const styleLabels = {
    natural: "自然",
    faithful: "忠実",
    concise: "簡潔"
  };

  const style =
    styleLabels[meta.translationStyle] ??
    meta.translationStyle ??
    "標準";

  return `${language}・${style}`;
}

function updatePageDisplay(state) {
  const cachedCount = state?.cachedCount ?? state?.translatedCount ?? 0;
  const pendingNodeCount = state?.pendingNodeCount ?? 0;
  const pendingCharacterCount =
    state?.pendingCharacterCount ?? 0;
  const displayMode = state?.displayMode ?? "original";

  if (cachedCount > 0 && pendingNodeCount > 0) {
    pageState.textContent =
      `一部翻訳済み（キャッシュ ${cachedCount}か所）`;
    translateButton.textContent =
      `新しく追加された文章を${currentTargetLanguage().label}へ翻訳`;
  } else if (cachedCount > 0) {
    pageState.textContent =
      displayMode === "translated"
        ? `翻訳文を表示中（${cachedCount}か所）`
        : displayMode === "original"
          ? `原文を表示中（翻訳キャッシュ ${cachedCount}か所）`
          : `原文・訳文混在（キャッシュ ${cachedCount}か所）`;

    translateButton.textContent =
      `未翻訳部分を${currentTargetLanguage().label}へ翻訳`;
  } else {
    pageState.textContent = "原文";
    translateButton.textContent =
      `このページを${currentTargetLanguage().label}へ翻訳`;
  }

  pageStats.textContent =
    `${pendingNodeCount}か所 / 約${pendingCharacterCount.toLocaleString()}文字`;

  const persistentPairCount =
    state?.persistentPairCount ?? 0;

  cacheState.textContent =
    persistentPairCount > 0
      ? `${persistentPairCount}件`
      : "なし";

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
    throw new Error("アクティブなタブを取得できませんでした。");
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
    throw new Error("ページ側スクリプトを起動できませんでした。");
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
      throw new Error(response?.error || "ページ操作に失敗しました。");
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
      throw new Error(response?.error || "ページ操作に失敗しました。");
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
    throw new Error("AIの応答にtranslations配列がありません。");
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
    throw new Error(`AIの応答が不足しています（${missing.length}件）。`);
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
      "OpenAIモードには、翻訳対象のページ本文をOpenAI APIへ送信する許可が必要です。"
    );
  }
}

async function translateWithOpenAI(items) {
  const apiKey = openaiKey.value.trim();
  const model = openaiModel.value.trim();

  if (!apiKey) {
    throw new Error("OpenAI APIキーを入力してください。");
  }

  if (!model) {
    throw new Error("OpenAIモデル名を入力してください。");
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
    throw new Error("OpenAI APIから翻訳結果を取得できませんでした。");
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI APIの翻訳結果をJSONとして解析できませんでした。");
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
      `Ollama接続テスト: HTTP ${response.status} ${response.statusText}`
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Ollama接続テスト: JSON応答を解析できませんでした。");
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
      option.textContent = "モデルが見つかりません";
      ollamaModel.appendChild(option);
      showMessage("Ollamaへ接続できましたが、モデルがありません。");
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
      `Ollama接続OK。${models.length}個のモデルを検出しました。`
    );
  } catch (error) {
    if (error?.name !== "AbortError") {
      showMessage(
        `Ollamaモデル取得エラー: ${error?.message || String(error)}`
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
    throw new Error("Ollamaモデルを選択してください。");
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
    throw new Error("Ollamaから翻訳結果を取得できませんでした。");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Ollamaの翻訳結果をJSONとして解析できませんでした。");
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
    return "このサイトへのアクセス権限がありません。Firefoxの拡張機能設定で、この拡張機能のサイトアクセスを許可してください。";
  }

  if (
    raw.includes("Cannot access") ||
    raw.includes("restricted")
  ) {
    return "このページはFirefoxの保護対象のため翻訳できません。通常のhttp/https Webページで試してください。";
  }

  if (
    raw.includes("NetworkError") ||
    raw.includes("Failed to fetch")
  ) {
    return engine.value === "ollama"
      ? "Ollama APIとの通信に失敗しました。Ollamaの状態を確認してください。"
      : `エラー: ${raw}`;
  }

  if (isMissingReceiverError(error)) {
    return "ページとの接続が途中で切れました。タブの再読み込み・移動がなかったか確認してください。";
  }

  return `エラー: ${raw}`;
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
    pageState.textContent = "対象外 / 未確認";
  }
}

function formatCacheDate(timestamp) {
  const value = Number(timestamp);

  if (!Number.isFinite(value) || value <= 0) {
    return "日時不明";
  }

  return new Date(value).toLocaleString();
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
        ? `${index.length}件のページ / 翻訳設定キャッシュを保存中`
        : "保存済み翻訳キャッシュはありません。";

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
      meta.textContent =
        `${profileLabel(item.profileMeta)} / ` +
        `${Number(item.pairCount ?? 0).toLocaleString()}件 / ` +
        `${formatCacheDate(item.updatedAt)}`;
      wrapper.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "cache-item-actions";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "ghost";
      removeButton.textContent = "このキャッシュを削除";

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
            "選択した保存キャッシュを削除しました。"
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
      `キャッシュ一覧の取得に失敗しました: ${error?.message || String(error)}`;
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
      "Page AI Translator の保存済み翻訳キャッシュをすべて削除しますか？\n\n翻訳エンジンや翻訳ルールなどの設定は残ります。"
    )
  ) {
    return;
  }

  try {
    clearAllCachesButton.disabled = true;
    await clearAllTranslationCaches();
    showMessage(
      "保存済み翻訳キャッシュをすべて削除しました。現在開いているタブ内の一時キャッシュはタブを閉じるまで残ります。"
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
      throw new Error("OpenAI APIキーを入力してください。");
    }

    if (
      engine.value === "ollama" &&
      !ollamaModel.value
    ) {
      throw new Error("Ollamaモデルを選択してください。");
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
        ? `${selected.nodeCount}か所 / 約${selected.characterCount.toLocaleString()}文字`
        : "選択なし";

    if (!selected.items.length) {
      showMessage(
        "Webページ上で翻訳したい文章を選択してから、もう一度押してください。"
      );
      return;
    }

    if (selected.characterCount > MAX_SELECTION_CHARS) {
      throw new Error(
        `選択範囲は約${selected.characterCount.toLocaleString()}文字あります。` +
        `v1.0.0の上限${MAX_SELECTION_CHARS.toLocaleString()}文字を超えています。`
      );
    }

    await saveSettings();
    setTranslating(true);

    const batches = makeBatches(selected.items);
    const allTranslations = [];

    for (let index = 0; index < batches.length; index += 1) {
      if (cancelRequested) break;

      setProgress(
        "選択範囲をAI翻訳中",
        index,
        batches.length
      );

      showMessage(
        `選択範囲をAI翻訳中… バッチ ${index + 1}/${batches.length}`
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
          `選択範囲 バッチ ${index + 1}/${batches.length}: ` +
          `${error?.message || String(error)}`
        );
      }

      allTranslations.push(...translations);

      setProgress(
        "選択範囲を翻訳中",
        index + 1,
        batches.length
      );
    }

    if (cancelRequested) {
      showMessage(
        "選択範囲の翻訳をキャンセルしました。ページへの変更は行っていません。"
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
      `選択範囲の翻訳完了: ${applied.changedCount}か所を置換しました。`
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
      throw new Error("OpenAI APIキーを入力してください。");
    }

    if (
      engine.value === "ollama" &&
      !ollamaModel.value
    ) {
      throw new Error("Ollamaモデルを選択してください。");
    }

    if (engine.value === "openai") {
      await ensureOpenAIWebsiteContentConsent();
    }

    await saveSettings();

    const tab = await getActiveTab();
    targetTabId = tab.id;

    setTranslating(true);
    setProgress("文章を取得中", 0, 1);
    showMessage("ページから文章を取得しています…");

    const page = await sendToTab(
      targetTabId,
      "GET_TRANSLATION_ITEMS",
      { untranslatedOnly: true }
    );

    updatePageDisplay(page);

    if (!page.items.length) {
      showMessage(
        "未翻訳の文章はありません。"
      );
      return;
    }

    if (page.characterCount > MAX_TOTAL_CHARS) {
      throw new Error(
        `このページは約${page.characterCount.toLocaleString()}文字あります。` +
        `上限${MAX_TOTAL_CHARS.toLocaleString()}文字を超えています。`
      );
    }

    const batches = makeBatches(page.items);
    progress.max = batches.length;

    let changedTotal = 0;

    for (let index = 0; index < batches.length; index += 1) {
      if (cancelRequested) break;

      setProgress(
        "AI翻訳中",
        index,
        batches.length
      );

      showMessage(
        `AI翻訳中… バッチ ${index + 1}/${batches.length}`
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
          `バッチ ${index + 1}/${batches.length}: ` +
          `${error?.message || String(error)}`
        );
      }

      if (cancelRequested) break;

      setProgress(
        "ページへ反映中",
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
          `バッチ ${index + 1}/${batches.length} の反映: ` +
          `${error?.message || String(error)}`
        );
      }

      changedTotal += applied.changedCount;

      setProgress(
        "翻訳中",
        index + 1,
        batches.length
      );
    }

    if (cancelRequested) {
      showMessage(
        `翻訳をキャンセルしました。すでに反映済みの${changedTotal}か所は残っています。` +
        `「原文を表示」で元の文章を表示できます。`
      );
    } else {
      await showTranslatedAfterTranslation(targetTabId);

      showMessage(
        `翻訳完了: ${changedTotal}か所を翻訳しました。`
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
  progressText.textContent = "キャンセル中…";
  showMessage("現在のAIリクエストをキャンセルしています…");

  if (currentController) {
    currentController.abort();
  }
});

showOriginalButton.addEventListener("click", async () => {
  try {
    showOriginalButton.disabled = true;
    showMessage("原文表示へ切り替えています…");

    const tab = await getActiveTab();
    const response = await sendToTab(
      tab.id,
      "SHOW_ORIGINAL_TEXT"
    );

    updatePageDisplay(response);
    showMessage(
      `原文を表示しました。翻訳キャッシュは保持されています。`
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
    showMessage("翻訳文表示へ切り替えています…");

    const tab = await getActiveTab();
    const response = await sendToTab(
      tab.id,
      "SHOW_TRANSLATED_TEXT"
    );

    updatePageDisplay(response);
    showMessage(
      `保存済みの翻訳文を表示しました。AI通信は行っていません。`
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
    showMessage("現在設定の保存キャッシュを削除しています…");

    const tab = await getActiveTab();
    const response = await sendToTab(
      tab.id,
      "DELETE_PERSISTENT_CACHE"
    );

    updatePageDisplay(response);

    showMessage(
      "現在の翻訳設定に対応する保存キャッシュを削除しました。現在のタブ内一時キャッシュは、タブを閉じるまで利用できます。"
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
            `新しい文章を${message.pendingNodeCount}か所検出しました。`
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
      `初期化エラー: ${error?.message || String(error)}`
    );
  });

refreshCacheList();
