// options.js
// Save and load settings to chrome.storage.sync
document.addEventListener("DOMContentLoaded", () => {
  const currencySymbol = document.getElementById("currencySymbol");
  const incomeType = document.getElementById("incomeType");
  const incomeValue = document.getElementById("incomeValue");
  const hoursPerWeek = document.getElementById("hoursPerWeek");
  const hoursPerDay = document.getElementById("hoursPerDay");
  const saveBtn = document.getElementById("saveBtn");
  const status = document.getElementById("status");
  const displayModeRadios = document.getElementsByName("displayMode");
  const currencyPreview = document.getElementById("currencyPreview");

  function showStatus(msg, timeout = 2000) {
    status.textContent = msg;
    setTimeout(() => { if (status.textContent === msg) status.textContent = ""; }, timeout);
  }

  // Load saved settings
  chrome.storage.sync.get(["hourlyRate","currencySymbol","displayMode","hoursPerWeek","hoursPerDay","incomeType","incomeValue"], (res) => {
    currencySymbol.value = res.currencySymbol || "£";
    currencyPreview.textContent = currencySymbol.value;
    hoursPerWeek.value = (res.hoursPerWeek && Number(res.hoursPerWeek) > 0) ? res.hoursPerWeek : 40;
    hoursPerDay.value = (res.hoursPerDay && Number(res.hoursPerDay) > 0) ? res.hoursPerDay : 8;

    // If prior saved as explicit hourlyRate but no incomeType/incomeValue, show hourly
    if (res.incomeType && res.incomeValue !== undefined) {
      incomeType.value = res.incomeType;
      incomeValue.value = res.incomeValue;
    } else {
      // fallback: try to populate incomeValue from hourlyRate
      if (res.hourlyRate) {
        incomeType.value = "hourly";
        incomeValue.value = res.hourlyRate;
      } else {
        incomeType.value = "hourly";
        incomeValue.value = 15;
      }
    }

    const dm = res.displayMode || "inline";
    for (const r of displayModeRadios) if (r.value === dm) r.checked = true;
  });

  currencySymbol.addEventListener("change", () => {
    currencyPreview.textContent = currencySymbol.value;
  });

  saveBtn.addEventListener("click", () => {
    // gather values
    const curSym = currencySymbol.value || "£";
    const itype = incomeType.value;
    const ivalue = Number(incomeValue.value) || 0;
    const hpw = Number(hoursPerWeek.value) || 40;
    const hpd = Number(hoursPerDay.value) || 8;
    let displayMode = "inline";
    for (const r of displayModeRadios) if (r.checked) displayMode = r.value;

    if (!(ivalue > 0)) {
      showStatus("Please enter a positive income amount.");
      return;
    }

    // compute hourlyRate from the chosen income type
    let hourlyRate = 0;
    switch (itype) {
      case "hourly":
        hourlyRate = ivalue;
        break;
      case "daily":
        hourlyRate = ivalue / hpd;
        break;
      case "weekly":
        hourlyRate = ivalue / hpw;
        break;
      case "monthly":
        // approximate: 12 months -> yearly -> divide by (52 * hpw)
        const yearlyFromMonthly = ivalue * 12;
        hourlyRate = yearlyFromMonthly / (52 * hpw);
        break;
      case "yearly":
        hourlyRate = ivalue / (52 * hpw);
        break;
      default:
        hourlyRate = ivalue;
    }

    // Save both the explicit income information (for user's convenience) and the computed hourlyRate
    chrome.storage.sync.set({
      currencySymbol: curSym,
      incomeType: itype,
      incomeValue: ivalue,
      hoursPerWeek: hpw,
      hoursPerDay: hpd,
      hourlyRate: Number(hourlyRate.toFixed(6)),
      displayMode: displayMode
    }, () => {
      showStatus("Saved ✓");
    });
  });
});
