// content.js
// Money → Time converter content script
// - Detects monetary mentions (GBP, USD, EUR symbols and codes)
// - Supports suffixes: k, m, b, t, and words (thousand, million, billion, trillion)
// - Converts using user's hourly rate stored in chrome.storage.sync
// - Inserts inline annotation (or tooltip) showing the top 3 time units
// - Skips script/style/code/pre/textarea/input and already-processed nodes
// - Observes DOM changes and updates newly added content (debounced)

(() => {
  // Default settings
  const DEFAULT = {
    hourlyRate: 15,           // default £15/hour
    currencySymbol: "£",
    displayMode: "inline",    // "inline", "tooltip", "replace"
    hoursPerWeek: 40,
    hoursPerDay: 8,
    daysPerWeek: 5
  };

  // -------------------------------
  // Money pattern (readable + robust)
  // -------------------------------
  const MONEY = (() => {
    const SYMBOLS = "[$£€]";
    const NUMBER = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?"; // 12,345.67 or 12345.67
    const SCALE  = "\\b(?:trillion|tn|t|billion|bn|b|million|mn|m|thousand|k)\\b";
    const CODES  = "\\b(?:USD|GBP|EUR)\\b";

    // Layouts
    const SYMBOL_FIRST = `(?<sym>${SYMBOLS})\\s*(?<num1>${NUMBER})\\s*(?<suf1>${SCALE})?`;
    const CODE_LAST    = `(?<num2>${NUMBER})\\s*(?<suf2>${SCALE})?\\s*(?<code1>${CODES})`;
    const CODE_FIRST   = `(?<code2>${CODES})\\s*(?<num3>${NUMBER})\\s*(?<suf3>${SCALE})?`;

    const regex = new RegExp(`${SYMBOL_FIRST}|${CODE_LAST}|${CODE_FIRST}`, "gi");

    const SCALE_MAP = {
      k: 1e3, thousand: 1e3,
      m: 1e6, mn: 1e6, million: 1e6,
      b: 1e9, bn: 1e9, billion: 1e9,
      t: 1e12, tn: 1e12, trillion: 1e12
    };

    function multiplier(suffix) {
      if (!suffix) return 1;
      const key = suffix.toLowerCase();
      return SCALE_MAP[key] || 1;
    }

    function amountFromMatch(m) {
      const g = m.groups || {};
      const numStr = (g.num1 || g.num2 || g.num3 || "").replace(/,/g, "");
      const sufStr = (g.suf1 || g.suf2 || g.suf3 || "");
      const base   = parseFloat(numStr);
      if (!isFinite(base)) return NaN;
      return base * multiplier(sufStr);
    }

    return { regex, amountFromMatch };
  })();

  // Tags to skip when scanning
  const SKIP_TAGS = new Set(["SCRIPT","STYLE","NOSCRIPT","IFRAME","CODE","PRE","TEXTAREA","INPUT"]);

  // Storage for settings
  let settings = { ...DEFAULT };

  // Debounce helper
  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // Read user's settings from chrome.storage.sync
  function loadSettings(callback) {
    chrome.storage.sync.get(
      ["hourlyRate", "currencySymbol", "displayMode", "hoursPerWeek", "hoursPerDay", "daysPerWeek"],
      (res) => {
        settings.hourlyRate = (res.hourlyRate && Number(res.hourlyRate) > 0) ? Number(res.hourlyRate) : DEFAULT.hourlyRate;
        settings.currencySymbol = res.currencySymbol || DEFAULT.currencySymbol;
        settings.displayMode = res.displayMode || DEFAULT.displayMode;
        settings.hoursPerWeek = (res.hoursPerWeek && Number(res.hoursPerWeek) > 0) ? Number(res.hoursPerWeek) : DEFAULT.hoursPerWeek;
        settings.hoursPerDay = (res.hoursPerDay && Number(res.hoursPerDay) > 0) ? Number(res.hoursPerDay) : DEFAULT.hoursPerDay;
        settings.daysPerWeek = (res.daysPerWeek && Number(res.daysPerWeek) > 0) ? Number(res.daysPerWeek) : DEFAULT.daysPerWeek;
        if (callback) callback();
      }
    );
  }

  // Convert monetary amount (number) to formatted time string (top 3 units)
  function formatTimeFromMoney(amount, hourlyRate) {
    if (!isFinite(amount) || amount <= 0 || !isFinite(hourlyRate) || hourlyRate <= 0) return null;

    const workMinutesPerDay = settings.hoursPerDay * 60;
    const workMinutesPerWeek = workMinutesPerDay * settings.daysPerWeek;
    const workMinutesPerMonth = workMinutesPerWeek * (52 / 12); // approx months
    const workMinutesPerYear = workMinutesPerWeek * 52;

    const UNITS = [
      { short: "c", minutes: workMinutesPerYear * 100 },
      { short: "y", minutes: workMinutesPerYear },
      { short: "mo", minutes: workMinutesPerMonth },
      { short: "w", minutes: workMinutesPerWeek },
      { short: "d", minutes: workMinutesPerDay },
      { short: "h", minutes: 60 },
      { short: "min", minutes: 1 }
    ];

    const totalMinutes = (amount / hourlyRate) * 60;
    let remaining = Math.floor(totalMinutes);
    const parts = [];

    for (const unit of UNITS) {
      if (parts.length >= 3) break;
      if (unit.minutes <= 0) continue;
      const count = Math.floor(remaining / unit.minutes);
      if (count > 0) {
        parts.push(`${count}${unit.short}`);
        remaining -= count * unit.minutes;
      }
    }

    if (parts.length === 0) return "<1m";
    return parts.join(" ");
  }

  // Given a text node, return a DocumentFragment with replacements
  function buildAnnotatedFragment(textNodeValue) {
    MONEY.regex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = MONEY.regex.exec(textNodeValue)) !== null) {
      const fullMatch = match[0];
      const amount = MONEY.amountFromMatch(match);
      const matchStart = match.index;
      const matchEnd = MONEY.regex.lastIndex;

      if (matchStart > lastIndex) {
        frag.appendChild(document.createTextNode(textNodeValue.slice(lastIndex, matchStart)));
      }

      const moneyText = document.createTextNode(fullMatch);
      const timeStr = formatTimeFromMoney(amount, settings.hourlyRate);

      if (timeStr) {
        const wrapper = document.createElement("span");
        wrapper.setAttribute("data-mt-processed", "true");
        wrapper.className = "mt-wrapper";

        if (settings.displayMode === "tooltip") {
          wrapper.appendChild(moneyText);
          wrapper.title = timeStr;
        } else if (settings.displayMode === "inline") {
          wrapper.appendChild(moneyText);
          const ann = document.createElement("span");
          ann.className = "mt-annotation";
          ann.textContent = (/\s$/.test(fullMatch) ? '' : ' ') + `(${timeStr}) `;
          wrapper.appendChild(ann);
        } else if (settings.displayMode === "replace") {
          wrapper.appendChild(document.createTextNode(timeStr));
        }

        frag.appendChild(wrapper);
      } else {
        frag.appendChild(moneyText);
      }

      lastIndex = matchEnd;
    }

    if (lastIndex < textNodeValue.length) {
      frag.appendChild(document.createTextNode(textNodeValue.slice(lastIndex)));
    }

    return frag;
  }

  function processTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) return;
    if (parent.closest && parent.closest("[data-mt-processed]")) return;
    if (parent.closest && parent.closest("[data-mt-ignore]")) return;

    const text = node.nodeValue;
    MONEY.regex.lastIndex = 0;
    if (!MONEY.regex.test(text)) return;

    const frag = buildAnnotatedFragment(text);
    if (frag && frag.childNodes.length > 0) {
      parent.replaceChild(frag, node);
    }
  }

  function processDocument(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest && parent.closest("[data-mt-processed]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }
    for (const tn of textNodes) processTextNode(tn);
  }

  const debouncedProcess = debounce(() => processDocument(document.body), 250);

  function setupMutationObserver() {
    const observer = new MutationObserver(() => {
      debouncedProcess();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function injectStyles() {
    const id = "money-time-extension-styles";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      .mt-wrapper { white-space: pre-wrap; }
      .mt-annotation { font-size: 0.95em; opacity: 0.8; margin-left: 3px; }
      .mt-annotation { color: inherit; font-style: italic; }
      .mt-wrapper { pointer-events: auto; }
    `;
    document.head && document.head.appendChild(style);
  }

  function init() {
    loadSettings(() => {
      injectStyles();
      try {
        processDocument(document.body);
      } catch (e) {
        console.error("Money→Time extension processing error:", e);
      }
      setupMutationObserver();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      loadSettings(() => {
        processDocument(document.body);
      });
    }
  });

  init();
})();
