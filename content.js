// content.js
// Money → Time converter content script
// - Detects monetary mentions (GBP, USD, EUR symbols and currency codes GBP/USD/EUR)
// - Converts using user's hourly rate stored in chrome.storage.sync
// - Inserts inline annotation (or tooltip) showing the top 3 time units
// - Skips script/style/code/pre/textarea/input and already-processed nodes
// - Observes DOM changes and updates newly added content (debounced)

(() => {
  // Default settings (used until options are saved)
  const DEFAULT = {
    hourlyRate: 15,           // default £15/hour (please set your own in options)
    currencySymbol: "£",      // symbol shown in examples & default
    displayMode: "inline",    // "inline" or "tooltip"
    hoursPerWeek: 40,         // used if user sets weekly/monthly/yearly incomes
    hoursPerDay: 8,
    daysPerWeek: 5
  };


  // Regex to find money mentions:
  // - symbol style: £1,000.50 or $1,000 or €1,234
  // - code style: 1,000 GBP or 1,000.50 USD
  // This regex will capture the full match and the numeric portion.
  const currencyRegex = /(?:£\s?([\d,]+(?:\.\d+)?)|\$\s?([\d,]+(?:\.\d+)?)|€\s?([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s?(GBP|USD|EUR))/g;

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
    chrome.storage.sync.get(["hourlyRate", "currencySymbol", "displayMode", "hoursPerWeek", "hoursPerDay", "daysPerWeek"], (res) => {
      settings.hourlyRate = (res.hourlyRate && Number(res.hourlyRate) > 0) ? Number(res.hourlyRate) : DEFAULT.hourlyRate;
      settings.currencySymbol = res.currencySymbol || DEFAULT.currencySymbol;
      settings.displayMode = res.displayMode || DEFAULT.displayMode;
      settings.hoursPerWeek = (res.hoursPerWeek && Number(res.hoursPerWeek) > 0) ? Number(res.hoursPerWeek) : DEFAULT.hoursPerWeek;
      settings.hoursPerDay = (res.hoursPerDay && Number(res.hoursPerDay) > 0) ? Number(res.hoursPerDay) : DEFAULT.hoursPerDay;
      settings.daysPerWeek = (res.daysPerWeek && Number(res.daysPerWeek) > 0) ? Number(res.daysPerWeek) : DEFAULT.daysPerWeek;
      if (callback) callback();
    });
  }

  // Convert monetary amount (number) to formatted time string (top 3 units)
  function formatTimeFromMoney(amount, hourlyRate) {
    if (!isFinite(amount) || amount <= 0 || !isFinite(hourlyRate) || hourlyRate <= 0) return null;

    const workMinutesPerDay = settings.hoursPerDay * 60;
    const workMinutesPerWeek = workMinutesPerDay * settings.daysPerWeek;
    // Approximate months and years based on work schedule
    const workMinutesPerMonth = workMinutesPerWeek * (52 / 12);
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

    // convert money to total minutes
    const totalMinutes = (amount / hourlyRate) * 60;
    let remaining = Math.floor(totalMinutes);
    const parts = [];

    for (const unit of UNITS) {
      if (parts.length >= 3) break;
      // Ensure unit.minutes is positive to avoid infinite loops
      if (unit.minutes <= 0) continue;
      const count = Math.floor(remaining / unit.minutes);
      if (count > 0) {
        parts.push(`${count}${unit.short}`);
        remaining -= count * unit.minutes;
      }
    }
    // If nothing matched (amount smaller than 1 minute), show "<1m"
    if (parts.length === 0) return "<1m";
    return parts.join("");
  }

  // Given a text node, return a DocumentFragment with replacements:
  // original text with added span annotations for money mentions
  function buildAnnotatedFragment(textNodeValue) {
    currencyRegex.lastIndex = 0; // reset global regex
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = currencyRegex.exec(textNodeValue)) !== null) {
      const fullMatch = match[0];
      // Determine numeric capture group
      const amountStr = (match[1] || match[2] || match[3] || match[4] || "0").replace(/,/g, "");
      const amount = parseFloat(amountStr);
      const matchStart = match.index;
      const matchEnd = currencyRegex.lastIndex;

      // text before match
      if (matchStart > lastIndex) {
        frag.appendChild(document.createTextNode(textNodeValue.slice(lastIndex, matchStart)));
      }

      // original money text node
      const moneyText = document.createTextNode(fullMatch);

      // compute time string with current hourlyRate
      const timeStr = formatTimeFromMoney(amount, settings.hourlyRate);

      if (timeStr) {
        // create wrapper span so we can mark it as processed and optionally add tooltip
        const wrapper = document.createElement("span");
        wrapper.setAttribute("data-mt-processed", "true");
        wrapper.className = "mt-wrapper";

        if (settings.displayMode === "tooltip") {
          // put original money text inside span and add title attr
          wrapper.appendChild(moneyText);
          wrapper.title = timeStr;
        } else {
          // inline: append the original money text then a small annotation
          wrapper.appendChild(moneyText);
          const ann = document.createElement("span");
          ann.className = "mt-annotation";
          ann.textContent = ` (${timeStr})`;
          wrapper.appendChild(ann);
        }

        frag.appendChild(wrapper);
      } else {
        // no conversion (invalid), just append original text
        frag.appendChild(moneyText);
      }

      lastIndex = matchEnd;
    }

    // remaining text after last match
    if (lastIndex < textNodeValue.length) {
      frag.appendChild(document.createTextNode(textNodeValue.slice(lastIndex)));
    }

    return frag;
  }

  // Process a single text node: replace with annotated fragment if money mentions found
  function processTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) return;
    if (parent.closest && parent.closest("[data-mt-ignore]")) return; // allow pages to opt-out by adding data-mt-ignore to container

    const text = node.nodeValue;
    currencyRegex.lastIndex = 0;
    if (!currencyRegex.test(text)) return;
    // avoid double-processing: if parent already contains processed wrappers, skip
    if (parent && parent.querySelector && parent.querySelector("[data-mt-processed]")) {
      // but it might contain other text nodes to convert; still proceed but ensure we don't re-process those processed spans
      // We'll rebuild fragment but skip existing processed spans by checking original node context (we're working on a text node)
    }

    const frag = buildAnnotatedFragment(text);
    if (frag && frag.childNodes.length > 0) {
      // replace the text node with the fragment
      parent.replaceChild(frag, node);
    }
  }

  // Walk the DOM and process text nodes
  function processDocument(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        // skip empty nodes
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        // skip if inside skipped tags
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        // skip nodes that are inside processed wrapper (so we don't re-run on our annotations)
        if (parent.closest && parent.closest("[data-mt-processed]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    const textNodes = [];
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }
    // process collected nodes
    for (const tn of textNodes) processTextNode(tn);
  }

  // Observe DOM changes and process newly added nodes (debounced)
  const debouncedProcess = debounce(() => processDocument(document.body), 250);

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // We'll call the debounced full scan to keep logic simple and avoid missing matches
      debouncedProcess();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // Inject lightweight CSS for inline annotation
  function injectStyles() {
    const id = "money-time-extension-styles";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      .mt-wrapper { white-space: pre-wrap; }
      .mt-annotation { font-size: 0.95em; opacity: 0.8; margin-left: 3px; }
      /* Keep the annotation unobtrusive */
      .mt-annotation { color: inherit; font-style: italic; }
      /* Ensure we don't interfere with copy/paste too much */
      .mt-wrapper { pointer-events: auto; }
    `;
    document.head && document.head.appendChild(style);
  }

  // Initialize: load settings, inject styles, process current document, setup observer
  function init() {
    loadSettings(() => {
      injectStyles();
      try {
        processDocument(document.body);
      } catch (e) {
        // defensive: some sites may block or throw; ignore
        console.error("Money→Time extension processing error:", e);
      }
      setupMutationObserver();
    });
  }

  // Re-run if settings change (user updates options)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      // reload settings and reprocess whole page
      loadSettings(() => {
        // reprocess entire document (simple approach: do full scan)
        processDocument(document.body);
      });
    }
  });

  // Run
  init();
})();
