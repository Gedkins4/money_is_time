// content.js
// Money → Time converter content script
// - Detects monetary mentions (GBP, USD, EUR symbols and currency codes GBP/USD/EUR)
// - Converts using user's hourly rate stored in chrome.storage.sync
// - Inserts inline annotation (or tooltip) showing the top 3 time units
// - Skips script/style/code/pre/textarea/input and already-processed nodes
// - Observes DOM changes and updates newly added content (debounced)
// Walk the DOM and process text nodes & structured prices
function processDocument(root = document.body) {
  if (!root) return;

  // --- 1️⃣ Process text nodes as before ---
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

  let node;
  const textNodes = [];
  while ((node = walker.nextNode())) textNodes.push(node);

  for (const tn of textNodes) processTextNode(tn);

  // --- 2️⃣ Process structured prices (Amazon-style) ---
  const structuredPriceSelectors = [
    '.a-price',               // Amazon price container
    // you can add more site-specific selectors here
  ];

  structuredPriceSelectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => processStructuredPrice(el));
  });
}

// Helper: process Amazon-style or other structured price spans
function processStructuredPrice(el) {
  if (!el || el.closest("[data-mt-processed]")) return;

  let priceText;

  // Try Amazon a-offscreen first (most reliable)
  const offscreen = el.querySelector('.a-offscreen');
  if (offscreen && offscreen.textContent.trim()) {
    priceText = offscreen.textContent.trim();
  } else {
    // fallback: reconstruct from visible spans
    const symbol = el.querySelector('.a-price-symbol')?.textContent || '';
    const whole = el.querySelector('.a-price-whole')?.textContent || '';
    const fraction = el.querySelector('.a-price-fraction')?.textContent || '';
    if (!whole) return; // cannot parse
    priceText = `${symbol}${whole}${fraction}`;
  }

  // Parse numeric value
  const match = /([\d,.]+)/.exec(priceText);
  if (!match) return;
  const amount = parseFloat(match[1].replace(/,/g, ""));
  const timeStr = formatTimeFromMoney(amount, settings.hourlyRate);
  if (!timeStr) return;

  // Avoid double-processing
  if (el.querySelector(".mt-annotation")) return;

  // Append annotation inline
  const ann = document.createElement("span");
  ann.className = "mt-annotation";
  ann.textContent = ` (~${timeStr})`;
  el.appendChild(ann);
  el.setAttribute("data-mt-processed", "true");
}
