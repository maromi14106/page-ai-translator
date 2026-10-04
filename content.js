(() => {
  if (globalThis.__pageAITranslatorLoaded) {
    return;
  }

  globalThis.__pageAITranslatorLoaded = true;

  const SKIPPED_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE",
    "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG", "CANVAS"
  ]);

  const LEGACY_CACHE_PREFIX = "pageAITranslator.cache.v1.";
  const CACHE_PREFIX = "pageAITranslator.cache.v2.";
  const CACHE_INDEX_KEY = "pageAITranslator.cacheIndex.v1";
  const DEFAULT_CACHE_PROFILE =
    '{"targetLanguage":"ja","translationStyle":"natural","terminologyPolicy":"balanced","customInstructions":""}';
  const MAX_CACHED_PAGES = 30;
  const MAX_PAIRS_PER_PAGE = 2500;

  const nodeToId = new Map();
  const idToNode = new Map();
  const translationById = new Map();
  const cacheByOriginal = new Map();
  const cacheByTranslation = new Map();
  const extensionMutationCounts = new WeakMap();

  // 選択範囲翻訳用。GET_SELECTION_ITEMSのたびに作り直す。
  const selectionRecords = new Map();

  // サイドバーへフォーカスを移した際にFirefoxがSelectionを
  // collapseしても翻訳できるよう、最後の有効な選択範囲を保持する。
  let lastSelectionSnapshot = [];

  let nextId = 1;
  let notifyTimer = null;
  let preferredView = "translated";
  let persistentPairCount = 0;
  let currentCacheProfile = "";
  let currentCacheProfileMeta = null;
  let profileLoadPromise = Promise.resolve();

  function normalizeText(text) {
    return String(text ?? "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalPageUrl() {
    const url = new URL(location.href);
    url.hash = "";
    return url.href;
  }

  function fnv1aHash(text) {
    let hash = 0x811c9dc5;

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function cacheStorageKey() {
    const url = canonicalPageUrl();

    if (currentCacheProfile === DEFAULT_CACHE_PROFILE) {
      return `${LEGACY_CACHE_PREFIX}${fnv1aHash(url)}.${url.length}`;
    }

    const identity = `${url}\n${currentCacheProfile}`;

    return `${CACHE_PREFIX}${fnv1aHash(identity)}.${identity.length}`;
  }

  function resetProfileMemory() {
    translationById.clear();
    cacheByOriginal.clear();
    cacheByTranslation.clear();
    persistentPairCount = 0;
  }

  function restoreOriginalBeforeProfileSwitch() {
    let changedCount = 0;

    for (const [id, pair] of translationById.entries()) {
      const node = idToNode.get(id);

      if (
        !node ||
        !node.isConnected ||
        !pair ||
        typeof pair.original !== "string" ||
        typeof pair.translation !== "string"
      ) {
        continue;
      }

      const current = normalizeText(node.nodeValue);
      const translated = normalizeText(pair.translation);

      // 現在画面に旧プロファイルの訳文が表示されている場合だけ、
      // 翻訳設定を切り替える前に保持済み原文へ戻す。
      if (
        current === translated &&
        setNodeRawText(node, pair.original)
      ) {
        changedCount += 1;
      }
    }

    preferredView = "original";
    return changedCount;
  }

  async function ensureCacheProfile(profile, meta = null) {
    const nextProfile =
      typeof profile === "string" && profile
        ? profile
        : DEFAULT_CACHE_PROFILE;

    if (nextProfile === currentCacheProfile) {
      if (meta) {
        currentCacheProfileMeta = meta;
      }
      await profileLoadPromise;
      return;
    }

    if (currentCacheProfile) {
      restoreOriginalBeforeProfileSwitch();
    }

    currentCacheProfile = nextProfile;
    currentCacheProfileMeta = meta;
    resetProfileMemory();

    profileLoadPromise = loadPersistentCache().catch(
      (error) => {
        console.error(
          "Page AI Translator: persistent cache load failed",
          error
        );
        persistentPairCount = 0;
      }
    );

    await profileLoadPromise;
  }

  function isElementVisible(element) {
    if (!element) return false;

    const style = getComputedStyle(element);

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function isTranslatableTextNode(node) {
    const text = node.nodeValue?.trim();

    if (!text || text.length < 2) return false;

    const parent = node.parentElement;

    if (!parent || SKIPPED_TAGS.has(parent.tagName)) {
      return false;
    }

    if (
      parent.closest(
        "script, style, noscript, code, pre, textarea, input, select, option, svg, canvas"
      )
    ) {
      return false;
    }

    if (!isElementVisible(parent)) return false;
    if (!/[\p{L}\p{M}]/u.test(text)) return false;

    return true;
  }

  function getOrAssignId(node) {
    if (nodeToId.has(node)) {
      return nodeToId.get(node);
    }

    const id = String(nextId++);
    nodeToId.set(node, id);
    idToNode.set(id, node);

    return id;
  }

  function markExtensionMutation(node) {
    const count = extensionMutationCounts.get(node) ?? 0;
    extensionMutationCounts.set(node, count + 1);
  }

  function consumeExtensionMutation(node) {
    const count = extensionMutationCounts.get(node) ?? 0;

    if (count <= 0) return false;

    if (count === 1) {
      extensionMutationCounts.delete(node);
    } else {
      extensionMutationCounts.set(node, count - 1);
    }

    return true;
  }

  function indexPair(pair) {
    const originalKey = normalizeText(pair.original);
    const translationKey = normalizeText(pair.translation);

    if (originalKey) {
      cacheByOriginal.set(originalKey, pair);
    }

    if (translationKey) {
      cacheByTranslation.set(translationKey, pair);
    }
  }

  function rememberPair(id, original, translation) {
    const pair = { original, translation };
    translationById.set(id, pair);
    indexPair(pair);
    return pair;
  }

  function adoptCachedPair(node, id, currentText) {
    if (translationById.has(id)) {
      return translationById.get(id);
    }

    const key = normalizeText(currentText);

    if (!key) {
      return null;
    }

    const pair =
      cacheByOriginal.get(key) ??
      cacheByTranslation.get(key) ??
      null;

    if (pair) {
      translationById.set(id, pair);
    }

    return pair;
  }

  function setNodeText(node, text) {
    const current = node.nodeValue ?? "";
    const leading = current.match(/^\s*/)?.[0] ?? "";
    const trailing = current.match(/\s*$/)?.[0] ?? "";
    const nextValue = `${leading}${text}${trailing}`;

    if (current === nextValue) {
      return false;
    }

    markExtensionMutation(node);
    node.nodeValue = nextValue;

    return true;
  }


  function setNodeRawText(node, nextValue) {
    const current = node.nodeValue ?? "";

    if (current === nextValue) {
      return false;
    }

    markExtensionMutation(node);
    node.nodeValue = nextValue;

    return true;
  }

  function buildSelectionSnapshot(range) {
    const root =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;

    if (!root) {
      return [];
    }

    const nodes = [];

    if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
      nodes.push(range.commonAncestorContainer);
    } else {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );

      let node;

      while ((node = walker.nextNode())) {
        nodes.push(node);
      }
    }

    const snapshot = [];

    for (const node of nodes) {
      if (!node?.isConnected || !isTranslatableTextNode(node)) {
        continue;
      }

      let intersects = false;

      try {
        intersects = range.intersectsNode(node);
      } catch {
        intersects = false;
      }

      if (!intersects) {
        continue;
      }

      const fullText = node.nodeValue ?? "";
      let start = 0;
      let end = fullText.length;

      if (node === range.startContainer) {
        start = range.startOffset;
      }

      if (node === range.endContainer) {
        end = range.endOffset;
      }

      start = Math.max(
        0,
        Math.min(start, fullText.length)
      );

      end = Math.max(
        start,
        Math.min(end, fullText.length)
      );

      const rawSegment = fullText.slice(start, end);
      const leading =
        rawSegment.match(/^\s*/)?.[0] ?? "";
      const trailing =
        rawSegment.match(/\s*$/)?.[0] ?? "";

      const coreStart = start + leading.length;
      const coreEnd = end - trailing.length;
      const text = fullText.slice(coreStart, coreEnd);

      if (
        text.length < 1 ||
        !/[\p{L}\p{M}]/u.test(text)
      ) {
        continue;
      }

      const nodeId = getOrAssignId(node);

      snapshot.push({
        nodeId,
        start: coreStart,
        end: coreEnd,
        originalSegment: text
      });
    }

    return snapshot;
  }

  function captureCurrentSelectionSnapshot() {
    const selection = window.getSelection();

    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      // 空選択で最後の有効なSelectionを上書きしない。
      return false;
    }

    let range;

    try {
      range = selection.getRangeAt(0);
    } catch {
      return false;
    }

    const snapshot = buildSelectionSnapshot(range);

    if (!snapshot.length) {
      return false;
    }

    lastSelectionSnapshot = snapshot;
    return true;
  }

  function validatedSelectionSnapshot(snapshot) {
    const valid = [];

    for (const record of snapshot) {
      const node = idToNode.get(record.nodeId);

      if (!node || !node.isConnected) {
        continue;
      }

      const fullText = node.nodeValue ?? "";
      const currentSegment = fullText.slice(
        record.start,
        record.end
      );

      // 選択後にサイト側が文章を書き換えた場合は、
      // staleなオフセットで別文字列を置換しない。
      if (currentSegment !== record.originalSegment) {
        continue;
      }

      valid.push(record);
    }

    return valid;
  }

  function collectSelectionItems() {
    selectionRecords.clear();

    // まず現在のSelectionを取得する。サイドバーへのフォーカス移動で
    // Selectionが消えていれば、最後にページ側で記録したSelectionを使う。
    captureCurrentSelectionSnapshot();

    const snapshot =
      validatedSelectionSnapshot(lastSelectionSnapshot);

    const items = [];

    for (const record of snapshot) {
      const selectionId =
        `selection:${record.nodeId}:${record.start}:${record.end}`;

      selectionRecords.set(selectionId, {
        ...record
      });

      items.push({
        id: selectionId,
        text: record.originalSegment
      });
    }

    return items;
  }

  document.addEventListener(
    "selectionchange",
    () => {
      captureCurrentSelectionSnapshot();
    }
  );

  document.addEventListener(
    "mouseup",
    () => {
      captureCurrentSelectionSnapshot();
    },
    true
  );

  document.addEventListener(
    "keyup",
    () => {
      captureCurrentSelectionSnapshot();
    },
    true
  );

  function collectItems({ untranslatedOnly = false } = {}) {
    if (!document.body) return [];

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );

    const items = [];
    let node;

    while ((node = walker.nextNode())) {
      if (!isTranslatableTextNode(node)) continue;

      const id = getOrAssignId(node);
      const text = node.nodeValue?.trim() ?? "";

      if (!text) continue;

      const pair = adoptCachedPair(node, id, text);

      if (untranslatedOnly && pair) {
        continue;
      }

      items.push({ id, text });
    }

    return items;
  }

  function collectUniquePairs() {
    const unique = new Map();

    for (const pair of cacheByOriginal.values()) {
      const key = normalizeText(pair.original);

      if (!key) continue;

      unique.set(key, {
        original: pair.original,
        translation: pair.translation
      });
    }

    return [...unique.values()].slice(0, MAX_PAIRS_PER_PAGE);
  }

  async function prunePersistentCache() {
    const stored = await browser.storage.local.get(CACHE_INDEX_KEY);
    const index = Array.isArray(stored[CACHE_INDEX_KEY])
      ? stored[CACHE_INDEX_KEY]
      : [];

    index.sort(
      (a, b) =>
        Number(b?.updatedAt ?? 0) -
        Number(a?.updatedAt ?? 0)
    );

    const keep = index.slice(0, MAX_CACHED_PAGES);
    const remove = index.slice(MAX_CACHED_PAGES);

    if (remove.length) {
      await browser.storage.local.remove(
        remove.map((item) => item?.key).filter(Boolean)
      );
    }

    await browser.storage.local.set({
      [CACHE_INDEX_KEY]: keep
    });
  }

  async function savePersistentCache() {
    const pairs = collectUniquePairs();
    const key = cacheStorageKey();
    const url = canonicalPageUrl();

    if (!pairs.length) {
      await deletePersistentCache();
      return;
    }

    const entry = {
      version: 2,
      url,
      profile: currentCacheProfile,
      profileMeta: currentCacheProfileMeta,
      updatedAt: Date.now(),
      pairs
    };

    await browser.storage.local.set({
      [key]: entry
    });

    const stored = await browser.storage.local.get(CACHE_INDEX_KEY);
    const index = Array.isArray(stored[CACHE_INDEX_KEY])
      ? stored[CACHE_INDEX_KEY]
      : [];

    const nextIndex = index.filter(
      (item) => item?.key !== key
    );

    nextIndex.unshift({
      key,
      url,
      profile: currentCacheProfile,
      profileMeta: currentCacheProfileMeta,
      updatedAt: entry.updatedAt,
      pairCount: pairs.length
    });

    await browser.storage.local.set({
      [CACHE_INDEX_KEY]: nextIndex
    });

    persistentPairCount = pairs.length;

    await prunePersistentCache();
  }

  async function loadPersistentCache() {
    const key = cacheStorageKey();
    const stored = await browser.storage.local.get(key);
    const entry = stored[key];

    if (!entry || !Array.isArray(entry.pairs)) {
      persistentPairCount = 0;
      return;
    }

    const isLegacyDefault =
      entry.version === 1 &&
      currentCacheProfile === DEFAULT_CACHE_PROFILE &&
      entry.url === canonicalPageUrl();

    const isCurrentProfile =
      entry.version === 2 &&
      entry.url === canonicalPageUrl() &&
      entry.profile === currentCacheProfile;

    if (!isLegacyDefault && !isCurrentProfile) {
      persistentPairCount = 0;
      return;
    }

    for (const pair of entry.pairs) {
      if (
        typeof pair?.original !== "string" ||
        typeof pair?.translation !== "string"
      ) {
        continue;
      }

      indexPair({
        original: pair.original,
        translation: pair.translation
      });
    }

    persistentPairCount = entry.pairs.length;
  }

  async function deletePersistentCache() {
    const key = cacheStorageKey();

    await browser.storage.local.remove(key);

    const stored = await browser.storage.local.get(CACHE_INDEX_KEY);
    const index = Array.isArray(stored[CACHE_INDEX_KEY])
      ? stored[CACHE_INDEX_KEY]
      : [];

    await browser.storage.local.set({
      [CACHE_INDEX_KEY]: index.filter(
        (item) => item?.key !== key
      )
    });

    persistentPairCount = 0;
  }

  async function applyTranslations(translations) {
    await profileLoadPromise;

    let changedCount = 0;

    for (const entry of translations) {
      const id = String(entry?.id ?? "");
      const node = idToNode.get(id);

      if (
        !node ||
        !node.isConnected ||
        typeof entry?.translation !== "string"
      ) {
        continue;
      }

      let pair = translationById.get(id);

      if (!pair) {
        pair = rememberPair(
          id,
          node.nodeValue ?? "",
          entry.translation
        );
      }

      if (
        preferredView === "translated" &&
        setNodeText(node, pair.translation)
      ) {
        changedCount += 1;
      }
    }

    await savePersistentCache();

    return changedCount;
  }


  async function applySelectionTranslations(translations) {
    await profileLoadPromise;

    const byNodeId = new Map();

    for (const entry of translations) {
      const record = selectionRecords.get(
        String(entry?.id ?? "")
      );

      if (
        !record ||
        typeof entry?.translation !== "string"
      ) {
        continue;
      }

      const list = byNodeId.get(record.nodeId) ?? [];

      list.push({
        ...record,
        translation: entry.translation
      });

      byNodeId.set(record.nodeId, list);
    }

    let changedCount = 0;

    for (const [nodeId, records] of byNodeId.entries()) {
      const node = idToNode.get(nodeId);

      if (!node || !node.isConnected) {
        continue;
      }

      const originalFull = node.nodeValue ?? "";
      let nextFull = originalFull;
      let valid = true;

      // オフセットがずれないよう後ろから置換する。
      records.sort((a, b) => b.start - a.start);

      for (const record of records) {
        const currentSegment = nextFull.slice(
          record.start,
          record.end
        );

        if (
          currentSegment !== record.originalSegment
        ) {
          valid = false;
          break;
        }

        nextFull =
          nextFull.slice(0, record.start) +
          record.translation +
          nextFull.slice(record.end);
      }

      if (!valid || nextFull === originalFull) {
        continue;
      }

      rememberPair(
        nodeId,
        originalFull,
        nextFull
      );

      if (preferredView === "translated") {
        setNodeRawText(node, nextFull);
      }

      changedCount += records.length;
    }

    selectionRecords.clear();
    lastSelectionSnapshot = [];
    await savePersistentCache();

    return changedCount;
  }

  async function showOriginalText() {
    await profileLoadPromise;

    preferredView = "original";
    let changedCount = 0;

    collectItems({ untranslatedOnly: false });

    for (const [id, pair] of translationById.entries()) {
      const node = idToNode.get(id);

      if (!node || !node.isConnected || !pair) {
        continue;
      }

      if (setNodeText(node, pair.original)) {
        changedCount += 1;
      }
    }

    return changedCount;
  }

  async function showTranslatedText() {
    await profileLoadPromise;

    preferredView = "translated";
    let changedCount = 0;

    collectItems({ untranslatedOnly: false });

    for (const [id, pair] of translationById.entries()) {
      const node = idToNode.get(id);

      if (!node || !node.isConnected || !pair) {
        continue;
      }

      if (setNodeText(node, pair.translation)) {
        changedCount += 1;
      }
    }

    return changedCount;
  }

  async function getState() {
    await profileLoadPromise;

    const pendingItems = collectItems({
      untranslatedOnly: true
    });

    let cachedCount = 0;
    let shownAsTranslationCount = 0;
    let shownAsOriginalCount = 0;

    for (const [id, pair] of translationById.entries()) {
      const node = idToNode.get(id);

      if (!node?.isConnected || !pair) {
        continue;
      }

      cachedCount += 1;

      const current = normalizeText(node.nodeValue);

      if (current === normalizeText(pair.translation)) {
        shownAsTranslationCount += 1;
      } else if (current === normalizeText(pair.original)) {
        shownAsOriginalCount += 1;
      }
    }

    let displayMode = "mixed";

    if (
      cachedCount === 0 ||
      shownAsOriginalCount === cachedCount
    ) {
      displayMode = "original";
    } else if (
      shownAsTranslationCount === cachedCount
    ) {
      displayMode = "translated";
    }

    return {
      cachedCount,
      translatedCount: cachedCount,
      hasTranslationCache:
        cachedCount > 0 || persistentPairCount > 0,
      persistentPairCount,
      isTranslated:
        cachedCount > 0 &&
        displayMode === "translated",
      displayMode,
      pendingNodeCount: pendingItems.length,
      pendingCharacterCount: pendingItems.reduce(
        (sum, item) => sum + item.text.length,
        0
      )
    };
  }

  function scheduleContentChangedNotification() {
    if (notifyTimer !== null) {
      clearTimeout(notifyTimer);
    }

    notifyTimer = setTimeout(async () => {
      notifyTimer = null;

      const state = await getState();

      browser.runtime.sendMessage({
        type: "PAGE_CONTENT_CHANGED",
        ...state
      }).catch(() => {});
    }, 500);
  }

  function handleExternalMutation(record) {
    if (record.type === "characterData") {
      const node = record.target;

      if (consumeExtensionMutation(node)) {
        return false;
      }

      const id = nodeToId.get(node);

      if (id && translationById.has(id)) {
        const currentKey = normalizeText(node.nodeValue);
        const pair = translationById.get(id);

        const matchesKnownPair =
          currentKey === normalizeText(pair.original) ||
          currentKey === normalizeText(pair.translation);

        if (!matchesKnownPair) {
          translationById.delete(id);
        }
      }

      return true;
    }

    if (record.type === "childList") {
      return (
        record.addedNodes.length > 0 ||
        record.removedNodes.length > 0
      );
    }

    return false;
  }

  const observer = new MutationObserver((records) => {
    let externalChange = false;

    for (const record of records) {
      if (handleExternalMutation(record)) {
        externalChange = true;
      }
    }

    if (externalChange) {
      scheduleContentChangedNotification();
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }

  browser.runtime.onMessage.addListener((message) => {
    const run = async () => {
      if (message?.type !== "PING_CONTENT_SCRIPT") {
        await ensureCacheProfile(
          message?.cacheProfile,
          message?.cacheProfileMeta ?? null
        );
      }

      if (message?.type === "PING_CONTENT_SCRIPT") {
        return {
          ok: true,
          url: location.href
        };
      }

      if (message?.type === "GET_TRANSLATION_STATE") {
        return {
          ok: true,
          ...(await getState())
        };
      }

      if (message?.type === "GET_TRANSLATION_ITEMS") {
        const items = collectItems({
          untranslatedOnly:
            message?.untranslatedOnly === true
        });

        return {
          ok: true,
          items,
          nodeCount: items.length,
          characterCount: items.reduce(
            (sum, item) => sum + item.text.length,
            0
          ),
          ...(await getState())
        };
      }

      if (message?.type === "APPLY_TRANSLATIONS") {
        return {
          ok: true,
          changedCount: await applyTranslations(
            message.translations ?? []
          ),
          ...(await getState())
        };
      }

      if (message?.type === "GET_SELECTION_ITEMS") {
        const items = collectSelectionItems();

        return {
          ok: true,
          items,
          nodeCount: items.length,
          characterCount: items.reduce(
            (sum, item) => sum + item.text.length,
            0
          ),
          ...(await getState())
        };
      }

      if (message?.type === "APPLY_SELECTION_TRANSLATIONS") {
        return {
          ok: true,
          changedCount: await applySelectionTranslations(
            message.translations ?? []
          ),
          ...(await getState())
        };
      }

      if (message?.type === "SHOW_ORIGINAL_TEXT") {
        return {
          ok: true,
          changedCount: await showOriginalText(),
          ...(await getState())
        };
      }

      if (message?.type === "SHOW_TRANSLATED_TEXT") {
        return {
          ok: true,
          changedCount: await showTranslatedText(),
          ...(await getState())
        };
      }

      if (message?.type === "DELETE_PERSISTENT_CACHE") {
        await deletePersistentCache();

        return {
          ok: true,
          ...(await getState())
        };
      }

      if (message?.type === "REFRESH_PERSISTENT_CACHE_STATUS") {
        persistentPairCount = 0;
        const key = cacheStorageKey();
        const stored = await browser.storage.local.get(key);
        const entry = stored[key];

        if (
          entry &&
          Array.isArray(entry.pairs)
        ) {
          persistentPairCount = entry.pairs.length;
        }

        return {
          ok: true,
          ...(await getState())
        };
      }

      return undefined;
    };

    return run().catch((error) => {
      console.error(
        "Page AI Translator content:",
        error
      );

      return {
        ok: false,
        error: error?.message || String(error)
      };
    });
  });
})();
