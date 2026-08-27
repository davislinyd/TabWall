(function () {
  var root = document.documentElement;
  var themeBtn = document.getElementById("themeBtn");
  var langBtn = document.getElementById("langBtn");
  var find = document.getElementById("find");

  var COPY = {
    zh: {
      title: "TabWall 使用者說明",
      description: "TabWall 2.59.2 使用者說明：儲存分頁與 Tab Group、可設定的新分頁、GitHub Release 更新檢查、overlay favicon 與一致的 TabWall logo、未停車標註、頁面繪圖與 Sticker、空間畫布、本機 AI agent、單一 HTML Sticker Note 與獨立縮放、來源網頁、卡片提醒、Webhook profiles、卡片上鎖、自訂標題、圖片卡、自訂背景、搜尋、備份與隱私。",
      skip: "跳到本文",
      brand: "使用者說明 · v2.59.2",
      find: "搜尋手冊…",
      empty: "手冊中沒有符合的段落。試試「繪圖」「標註」「AI」「提醒」「Webhook」「上鎖」「備份」「硬碟」「搜尋」或「快捷鍵」。",
      toc: "目錄",
      themeLight: "淺色",
      themeDark: "深色",
      langOther: "EN",
    },
    en: {
      title: "TabWall User Guide",
      description: "TabWall 2.59.2 user guide: park tabs and Tab Groups, configurable New Tab, GitHub Release update checks, a temporary overlay favicon and consistent TabWall logo, live page notes, drawing and page Stickers, spatial canvas, local AI agent, single-document HTML Sticker Notes with independent resizing, source pages, card reminders, Webhook profiles, card lock, display titles, image cards, custom background, search, backup, and privacy.",
      skip: "Skip to content",
      brand: "User guide · v2.59.2",
      find: "Search the guide…",
      empty: "No matching section. Try “draw”, “annotate”, “AI”, “reminder”, “webhook”, “lock”, “backup”, “disk”, “search”, or “shortcut”.",
      toc: "Contents",
      themeLight: "Light",
      themeDark: "Dark",
      langOther: "中文",
    },
  };

  function stored(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function detectLang() {
    var query = "";
    try { query = new URLSearchParams(location.search).get("lang") || ""; } catch (e) {}
    if (query === "en" || query === "zh") return query;
    var saved = stored("tabwall-manual-lang");
    if (saved === "en" || saved === "zh") return saved;
    var nav = String(navigator.language || "").toLowerCase();
    return nav.indexOf("en") === 0 ? "en" : "zh";
  }

  function currentLang() {
    return root.getAttribute("data-lang") === "en" ? "en" : "zh";
  }

  function syncChrome() {
    var copy = COPY[currentLang()];
    document.title = copy.title;
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", copy.description);
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", copy.title);
    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", copy.description);
    var skip = document.querySelector(".skip");
    if (skip) skip.textContent = copy.skip;
    var brand = document.querySelector(".brand span");
    if (brand) brand.textContent = copy.brand;
    if (find) find.setAttribute("placeholder", copy.find);
    var empty = document.getElementById("emptyFind");
    if (empty) empty.textContent = copy.empty;
    var toc = document.querySelector(".toc h2");
    if (toc) toc.textContent = copy.toc;
    if (langBtn) {
      langBtn.textContent = copy.langOther;
      langBtn.setAttribute("aria-label", currentLang() === "en" ? "Switch to Chinese" : "切換為英文");
    }
    if (themeBtn) {
      var light = root.getAttribute("data-theme") !== "light";
      themeBtn.textContent = light ? copy.themeLight : copy.themeDark;
    }
  }

  function applyTheme(theme) {
    var next = theme === "light" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    if (themeBtn) themeBtn.setAttribute("aria-pressed", next === "light" ? "true" : "false");
    store("tabwall-manual-theme", next);
    syncChrome();
  }

  function applyLang(lang) {
    var next = lang === "en" ? "en" : "zh";
    root.setAttribute("data-lang", next);
    root.setAttribute("lang", next === "en" ? "en" : "zh-Hant");
    store("tabwall-manual-lang", next);
    try {
      var url = new URL(location.href);
      url.searchParams.set("lang", next);
      history.replaceState({}, "", url);
    } catch (e) {}
    syncChrome();
    document.dispatchEvent(new Event("tabwall-langchange"));
  }

  applyTheme(stored("tabwall-manual-theme") || "dark");
  applyLang(detectLang());

  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  }
  if (langBtn) {
    langBtn.addEventListener("click", function () {
      applyLang(currentLang() === "en" ? "zh" : "en");
    });
  }
})();
