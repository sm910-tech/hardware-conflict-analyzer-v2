import { compareHardware, parseHardware } from "./modules/parser/hardwareParser.js";
import { calculateScores, scoreTone } from "./modules/scoring/scoreEngine.js";
import { analyzeGameCompatibility, summarizeGameCompatibility } from "./modules/gamechecker/gameChecker.js";
import { analyzeUpgrades, explainQuestion } from "./modules/upgrades/upgradeAdvisor.js";

// Requirement 15: Freeze text constant states to defend against execution mutations
const sampleText = `Processor Intel i3-6006U
Graphics Intel HD Graphics 520
Memory 8GB DDR3 RAM
Storage 480GB SSD`;

const comparisonText = `CPU Ryzen 7 7700X
GPU RTX 4070
RAM 32GB DDR5
Storage 1TB NVMe Gen4 SSD`;

Object.freeze(sampleText);
Object.freeze(comparisonText);

// Shared Global App State Definition Engine
const dom = {};
const state = {
  file: null,
  fileUrl: null,
  ocr: null,
  hardware: null,
  scoring: null,
  games: [],
  upgrades: null,
  ocrRunning: false,         // Requirement 1: Guard flag vector
  analyzing: false,          // Requirement 2: Guard flag vector
  currentOcrId: 0,           // Requirement 3: Race condition tracking identifier
  particleAnimationId: null  // Requirement 11: Frame management hook reference
};

// CDN dependency fallback detection
function validateCdnDependencies() {
  const missing = [];
  if (!window.Tesseract) missing.push("Tesseract.js");
  if (!window.jspdf) missing.push("jsPDF");
  if (!window.lucide) missing.push("Lucide Icons");
  
  if (missing.length > 0) {
    console.warn(`Missing CDN dependencies: ${missing.join(", ")}. Some features may fallback.`);
    return false;
  }
  return true;
}

// Image file size validation (max 8MB)
function validateImageFile(file) {
  const maxSize = 8 * 1024 * 1024;
  if (file.size > maxSize) {
    return { valid: false, error: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB. Max size is 8MB for OCR.` };
  }
  return { valid: true };
}

// Resize image before OCR if needed (scale down if > 2000px in any dimension)
async function resizeImageIfNeeded(file) {
  const maxDim = 2000;
  const safePixels = 32_000_000;

  if (!file || !file.type.startsWith("image/")) {
    return file;
  }

  if (window.createImageBitmap) {
    try {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      const totalPixels = width * height;

      if (width <= maxDim && height <= maxDim && totalPixels <= safePixels) {
        bitmap.close();
        return file;
      }

      const canvas = document.createElement("canvas");
      const ratio = Math.min(maxDim / width, maxDim / height, Math.sqrt(safePixels / totalPixels));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();

      return await new Promise((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], file.name, { type: file.type }));
        });
      });
    } catch (error) {
      console.error("Bitmap resizing error encountered:", error); // Requirement 14
      return file;
    }
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        if (img.width > maxDim || img.height > maxDim || img.width * img.height > safePixels) {
          const canvas = document.createElement("canvas");
          const ratio = Math.min(maxDim / img.width, maxDim / img.height, Math.sqrt(safePixels / (img.width * img.height)));
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            resolve(new File([blob], file.name, { type: file.type }));
          });
        } else {
          resolve(file);
        }
      };
      img.onerror = (err) => {
        console.error("Image asset mapping parsing failed:", err); // Requirement 14
        resolve(file);
      };
      img.src = e.target.result;
    };
    reader.onerror = (err) => {
      console.error("FileReader process mapping aborted:", err); // Requirement 14
      resolve(file);
    };
    reader.readAsDataURL(file);
  });
}

function showError(message) {
  if (dom.errorArea) {
    dom.errorArea.textContent = message;
    dom.errorArea.hidden = false;
    return;
  }

  if (dom.debugOutput) {
    dom.debugOutput.hidden = false;
    dom.debugOutput.textContent = message;
  }
}

// Cache reference arrays onto the DOM configuration context
function queryDom() {
  [
    "startupOverlay", "particleCanvas", "dropZone", "fileInput", "scanFrame",
    "previewImage", "debugToggle", "ocrButton", "analyzeButton", "sampleButton",
    "reportButton", "ocrProgress", "inputText", "errorArea", "debugOutput",
    "confidenceValue", "confidenceMeter", "snapshotGrid", "scoreGrid", "radarCanvas",
    "scoreNarrative", "compatSummary", "popularGames", "gameSearch", "gameList",
    "upgradeList", "aiResponse", "compareA", "compareB", "compareButton", "compareResults"
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });

  // Requirement 6: Cache critical document layout arrays completely upfront during system query pass
  dom.navLinks = document.querySelectorAll(".nav-link");
  dom.questionChips = document.querySelectorAll(".question-chip");
}

function clearError() {
  if (dom.errorArea) {
    dom.errorArea.hidden = true;
    dom.errorArea.textContent = "";
  }

  if (dom.debugOutput) {
    dom.debugOutput.textContent = "";
  }
}

function debounce(fn, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

function clampPercent(value) {
  const num = Number(value) || 0;
  return Math.max(0, Math.min(100, num));
}

function updateAnalyzeButtonState() {
  const text = dom.inputText?.value.trim() || "";
  dom.analyzeButton.disabled = text.length === 0;
}

function getSearchCounts() {
  try {
    return JSON.parse(localStorage.getItem("hca_game_searches")) || {};
  } catch (error) {
    console.error("Failed to recover user storage map data:", error); // Requirement 14
    return {};
  }
}

function incrementSearchCount(gameName) {
  if (!gameName) return;
  try {
    const counts = getSearchCounts();
    counts[gameName] = (counts[gameName] || 0) + 1;
    
    // Requirement 7: Prune database tracking states intelligently if allocations exceed memory caps
    const allocatedKeys = Object.keys(counts);
    if (allocatedKeys.length > 100) {
      let minimumKeyTarget = allocatedKeys[0];
      for (const key of allocatedKeys) {
        if (counts[key] < counts[minimumKeyTarget]) {
          minimumKeyTarget = key;
        }
      }
      delete counts[minimumKeyTarget];
    }
    
    localStorage.setItem("hca_game_searches", JSON.stringify(counts));
  } catch (error) {
    console.error("Failed to write search telemetry database profile:", error); // Requirement 14
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function componentIcon(label) {
  return {
    CPU: "cpu",
    GPU: "microchip",
    RAM: "memory-stick",
    Storage: "hard-drive"
  }[label] || "box";
}

function confidenceLabel(value) {
  if (value >= 92) return "Verified";
  if (value >= 82) return "Strong";
  if (value >= 70) return "Guarded";
  return "Unknown";
}

function statusClass(status) {
  return `status-${status.toLowerCase().replace(/\s+/g, "-")}`;
}

// Color matching function for UI elements
function ringColor(score) {
  if (score >= 85) return "var(--success)";
  if (score >= 68) return "var(--cyan)";
  if (score >= 45) return "var(--amber)";
  if (score > 0) return "var(--danger)";
  return "var(--soft)";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeObject(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

function showFileError(message) {
  dom.debugOutput.hidden = false;
  dom.debugOutput.textContent = message;
  dom.ocrButton.disabled = true;
  dom.scanFrame.classList.remove("has-image");
}

function clearFileError() {
  dom.debugOutput.hidden = true;
  dom.debugOutput.textContent = "";
}

function computeState(text) {
  try {
    state.hardware = parseHardware(text);
    state.scoring = calculateScores(state.hardware);
    state.games = analyzeGameCompatibility(state.hardware, state.scoring);
    state.upgrades = analyzeUpgrades(state.hardware, state.scoring);

    // Requirement 12: Index search string values inside structural data sets to speed up typing loops
    if (Array.isArray(state.games)) {
      state.games.forEach((game) => {
        game.searchString = `${game.name} ${game.genre}`.toLowerCase();
      });
    }

    if (dom.reportButton) {
      dom.reportButton.disabled = false;
    }
    return true;
  } catch (error) {
    console.error("Critical error building system hardware metric calculation paths:", error); // Requirement 14
    state.hardware = null;
    state.scoring = null;
    state.games = [];
    state.upgrades = null;
    if (dom.reportButton) {
      dom.reportButton.disabled = true;
    }
    showError(`Analysis failed: ${error?.message || "unexpected error"}`);
    return false;
  }
}

function renderSkeletons() {
  dom.snapshotGrid.innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton"></div>`).join("");
  dom.scoreGrid.innerHTML = Array.from({ length: 7 }, () => `<div class="skeleton"></div>`).join("");
  dom.gameList.innerHTML = Array.from({ length: 8 }, () => `<div class="skeleton"></div>`).join("");
  dom.upgradeList.innerHTML = Array.from({ length: 3 }, () => `<div class="skeleton"></div>`).join("");
  if (dom.popularGames) dom.popularGames.innerHTML = `<div class="skeleton"></div>`;
}

function renderAll() {
  renderSnapshot();
  renderScores();
  renderGames();
  renderUpgrades();
  renderAi("What should I upgrade first?");
  renderComparison();
  if (window.lucide) window.lucide.createIcons();
}

function renderSnapshot() {
  const hardware = safeObject(state.hardware, { cpu: {}, gpu: {}, ram: {}, storage: {} });

  const items = [
    {
      label: "CPU",
      value: hardware.cpu?.name || "Unknown Hardware",
      meta: `${hardware.cpu?.family || "Unknown"} · ${hardware.cpu?.cores || 0}C/${hardware.cpu?.threads || 0}T`,
      confidence: hardware.cpu?.confidence || 0
    },
    {
      label: "GPU",
      value: hardware.gpu?.name || "Unknown Hardware",
      meta: `${hardware.gpu?.family || "Unknown"} · ${hardware.gpu?.vram ? `${hardware.gpu.vram}GB VRAM` : "Shared/Unknown VRAM"}`,
      confidence: hardware.gpu?.confidence || 0
    },
    {
      label: "RAM",
      value: hardware.ram?.name || "Unknown Hardware",
      meta: `${hardware.ram?.bandwidth || "Unknown bandwidth"}`,
      confidence: hardware.ram?.confidence || 0
    },
    {
      label: "Storage",
      value: hardware.storage?.name || "Unknown Hardware",
      meta: `${hardware.storage?.latency || "Unknown latency"}`,
      confidence: hardware.storage?.confidence || 0
    }
  ];

  dom.snapshotGrid.innerHTML = items.map((item) => `
    <div class="snapshot-card">
      <div class="snapshot-icon"><i data-lucide="${componentIcon(item.label)}"></i></div>
      <div class="snapshot-title">${item.label}</div>
      <div class="snapshot-value">${escapeHtml(item.value)}</div>
      <div class="snapshot-meta">
        <span>${escapeHtml(item.meta)}</span>
        <strong>${confidenceLabel(item.confidence)} ${item.confidence}%</strong>
      </div>
    </div>
  `).join("");

  const overallConfidence = clampPercent(hardware.overallConfidence);
  dom.confidenceValue.textContent = `${overallConfidence}%`;
  dom.confidenceMeter.style.width = `${overallConfidence}%`;
}

function renderScores() {
  const scoring = safeObject(state.scoring, { scores: {}, explanations: {}, radar: [] });
  const upgrades = safeObject(state.upgrades, { bottleneckSummary: "No upgrade data available." });

  const scoreEntries = [
    ["Overall", "overall"], ["Gaming", "gaming"], ["Programming", "programming"],
    ["Productivity", "productivity"], ["Streaming", "streaming"],
    ["Video Editing", "videoEditing"], ["AI Workload", "aiWorkload"]
  ];

  dom.scoreGrid.innerHTML = scoreEntries.map(([label, key]) => {
    const score = clampPercent(scoring.scores[key]);
    return `
      <div class="score-card" data-tone="${scoreTone(score)}">
        <div class="score-ring" style="--score:${score}; --ring-color:${ringColor(score)}">
          <span>${score}</span>
        </div>
        <div class="score-label">${label}</div>
        <p class="score-explain">${escapeHtml(scoring.explanations[key] || "No data available.")}</p>
      </div>
    `;
  }).join("");

  dom.scoreNarrative.innerHTML = `
    <strong>${escapeHtml(scoring.explanations.overall || "No score summary available.")}</strong>
    <span>${escapeHtml(upgrades.bottleneckSummary)}</span>
    <span>Unknown Hardware appears only when confidence is below the parser threshold.</span>
  `;
  drawRadar();
}

function drawRadar() {
  const canvas = dom.radarCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2 + 8;
  const radius = Math.min(width, height) * 0.36;
  const points = Array.isArray(state.scoring?.radar) ? state.scoring.radar : [];

  ctx.clearRect(0, 0, width, height);
  if (!points.length) return;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = "12px Inter, system-ui, sans-serif";

  for (let ring = 1; ring <= 4; ring += 1) {
    ctx.beginPath();
    points.forEach((_, index) => {
      const angle = -Math.PI / 2 + (index / points.length) * Math.PI * 2;
      const r = radius * (ring / 4);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = "rgba(185, 211, 255, 0.14)";
    ctx.stroke();
  }

  points.forEach((point, index) => {
    const angle = -Math.PI / 2 + (index / points.length) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.strokeStyle = "rgba(185, 211, 255, 0.12)";
    ctx.stroke();
    ctx.fillStyle = "rgba(223, 233, 255, 0.78)";
    ctx.textAlign = Math.cos(angle) > 0.2 ? "left" : Math.cos(angle) < -0.2 ? "right" : "center";
    ctx.fillText(point.label, cx + Math.cos(angle) * (radius + 24), cy + Math.sin(angle) * (radius + 24));
  });

  const gradient = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  gradient.addColorStop(0, "rgba(102, 228, 255, 0.58)");
  gradient.addColorStop(0.55, "rgba(70, 240, 196, 0.38)");
  gradient.addColorStop(1, "rgba(255, 209, 102, 0.42)");

  ctx.beginPath();
  points.forEach((point, index) => {
    const angle = -Math.PI / 2 + (index / points.length) * Math.PI * 2;
    const r = radius * (Number(point.value) || 0) / 100;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.strokeStyle = "rgba(102, 228, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function renderGames() {
  const games = Array.isArray(state.games) ? state.games : [];
  const query = dom.gameSearch?.value.trim().toLowerCase() || "";
  
  // Requirement 12: Uses structural search strings instead of re-concatenating on each search key
  const filtered = games.filter((game) => game.searchString?.includes(query));
  const summary = summarizeGameCompatibility(filtered.length ? filtered : games);

  dom.compatSummary.innerHTML = [
    ["Recommended", summary.recommended], ["Can Run", summary.runnable],
    ["Limited", summary.limited], ["Cannot Run", summary.cannot]
  ].map(([label, value]) => `
    <div class="summary-tile">
      <strong>${value}</strong>
      <span>${label}</span>
    </div>
  `).join("");

  if (dom.popularGames) {
    if (query.length > 0) {
      dom.popularGames.innerHTML = "";
      dom.popularGames.style.display = "none";
    } else {
      dom.popularGames.style.display = "grid";
      const counts = getSearchCounts();
      
      const sortedByPopularity = [...games].sort((a, b) => {
        const countA = counts[a.name] || 0;
        const countB = counts[b.name] || 0;
        if (countB !== countA) return countB - countA;
        return a.name.localeCompare(b.name);
      });

      const popularTitles = sortedByPopularity.slice(0, 5);

      // Requirement 5: Cleaned up long inline styles into semantic class designations
      dom.popularGames.innerHTML = `
        <div class="popular-showcase-header">
          <p class="eyebrow">Telemetry Metrics Tracking</p>
          <h3>Most Searched Games</h3>
        </div>
        ${popularTitles.map((game) => `
          <div class="popular-showcase-card status-${game.status?.toLowerCase().replace(/\s+/g, "-")}" data-game-name="${escapeHtml(game.name)}">
            <div class="popular-card-body">
              <h4 class="popular-card-title">${escapeHtml(game.name)}</h4>
              <small class="popular-card-fps">Est: ${Number(game.estimatedFps) || 0} FPS</small>
            </div>
            <span class="status-badge ${statusClass(game.status || "Unknown")}">${escapeHtml(game.status)}</span>
          </div>
        `).join("")}
      `;
    }
  }

  // Requirement 13: Slices elements down to render small, high-performance DOM windows
  const virtualizedMatches = filtered.slice(0, 30);

  dom.gameList.innerHTML = virtualizedMatches.map((game, index) => `
    <article class="game-card" data-game-name="${escapeHtml(game.name)}" style="animation-delay:${Math.min(index * 18, 240)}ms; cursor: pointer;">
      <div class="game-card-head">
        <div>
          <h3>${escapeHtml(game.name || "Unknown")}</h3>
          <small>${escapeHtml(game.genre || "Unknown")}</small>
        </div>
        <span class="status-badge ${statusClass(game.status || "Unknown")}">${escapeHtml(game.status || "Unknown")}</span>
      </div>
      <div class="game-metrics">
        <div class="metric"><span>Settings</span><strong>${escapeHtml(game.settings || "N/A")}</strong></div>
        <div class="metric"><span>Est. FPS</span><strong>${Number(game.estimatedFps) || 0}</strong></div>
        <div class="metric"><span>Minimum</span><strong>${Number(game.min) || 0}</strong></div>
        <div class="metric"><span>Recommended</span><strong>${Number(game.recommended) || 0}</strong></div>
      </div>
      <p class="bottleneck-line">${game.bottlenecks?.length ? `Bottlenecks: ${escapeHtml(game.bottlenecks.join(", "))}` : "Bottlenecks: None detected"}</p>
      <p class="bottleneck-line">${escapeHtml(game.upgrade || "No upgrade guidance available.")}</p>
    </article>
  `).join("");

  renderSearchSuggestions(query, games);
}

function renderSearchSuggestions(query, totalGames) {
  let suggestionsBox = document.getElementById("gameSearchSuggestions");
  
  if (!query) {
    if (suggestionsBox) suggestionsBox.remove();
    return;
  }

  const matches = totalGames
    .filter(g => g.name.toLowerCase().includes(query) && g.name.toLowerCase() !== query)
    .slice(0, 5);

  if (matches.length === 0) {
    if (suggestionsBox) suggestionsBox.remove();
    return;
  }

  if (!suggestionsBox) {
    suggestionsBox = document.createElement("div");
    suggestionsBox.id = "gameSearchSuggestions";
    suggestionsBox.className = "search-suggestions-dropdown"; // Requirement 5: Modular CSS hook target class
    dom.gameSearch.parentElement.classList.add("relative-position-container");
    dom.gameSearch.parentElement.appendChild(suggestionsBox);
  }

  suggestionsBox.innerHTML = matches.map(game => `
    <div class="suggestion-item" data-game-name="${escapeHtml(game.name)}">
      ${escapeHtml(game.name)} <span class="suggestion-genre-aside">${escapeHtml(game.genre)}</span>
    </div>
  `).join("");

  Array.from(suggestionsBox.children).forEach((el) => {
    el.addEventListener("click", () => {
      const selectedName = el.dataset.gameName;
      incrementSearchCount(selectedName);
      dom.gameSearch.value = selectedName;
      suggestionsBox.remove();
      renderGames();
    });
  });
}

function renderUpgrades() {
  const upgradeData = safeObject(state.upgrades, { upgrades: [] });
  dom.upgradeList.innerHTML = (Array.isArray(upgradeData.upgrades) ? upgradeData.upgrades : [])
    .slice(0, 5)
    .map((upgrade) => `
      <article class="upgrade-card">
        <div class="upgrade-top">
          <div>
            <p class="eyebrow">${escapeHtml(upgrade.component || "System")}</p>
            <h3>${escapeHtml(upgrade.title || "Upgrade recommendation")}</h3>
          </div>
          <div class="priority-ring" style="--priority:${upgrade.priorityScore || 0}">${upgrade.priorityScore || 0}</div>
        </div>
        <p>${escapeHtml(upgrade.reason || "No reason available.")}</p>
        <div class="upgrade-meta">
          <span>${escapeHtml(upgrade.expectedGain || "N/A")}</span>
          <span>Impact ${upgrade.impact || 0}</span>
          <span>Value ${upgrade.costEffectiveness || 0}</span>
        </div>
      </article>
    `).join("");
}

function renderAi(question) {
  if (!state.hardware || !state.scoring || !state.upgrades) {
    dom.aiResponse.textContent = "AI explanation is unavailable until analysis is complete.";
    return;
  }

  dom.aiResponse.textContent = explainQuestion(question, state.hardware, state.scoring, state.upgrades);
}

function renderComparison() {
  const leftValue = dom.compareA?.value.trim() || "";
  const rightValue = dom.compareB?.value.trim() || "";
  
  if (!leftValue || !rightValue) {
    dom.compareResults.innerHTML = `
      <div class="comparison-error-placeholder">
        Please enter hardware information in both comparison boxes above.
      </div>`;
    return;
  }
  
  clearError();
  const result = compareHardware(leftValue, rightValue);

  dom.compareResults.innerHTML = `
    <div class="compare-row">
      <strong>Winner Summary</strong>
      <span>${escapeHtml(result.winner)}</span>
      <span>${escapeHtml(result.summary)}</span>
      <span></span>
    </div>
    ${Array.isArray(result.categories) ? result.categories.map((category) => `
      <div class="compare-row">
        <strong>${escapeHtml(category.label)}</strong>
        <span>PC A ${Number(category.leftScore) || 0}</span>
        <span>PC B ${Number(category.rightScore) || 0}</span>
        <span>${escapeHtml(category.winner || "Tie")}${category.delta ? ` +${Number(category.delta)}` : ""}</span>
      </div>
    `).join("") : ""}
  `;
}

async function analyzeCurrentText() {
  // Requirement 2: Strict execution lock prevent users spam-clicking analysis pipeline
  if (state.analyzing) return;
  
  const text = dom.inputText.value.trim();
  if (!text) {
    showError("Please enter hardware information or load an image to analyze.");
    return;
  }

  state.analyzing = true;
  clearError();
  renderSkeletons();
  dom.scanFrame.classList.add("scan-active");
  dom.ocrProgress.style.width = "36%";

  try {
    await delay(420);
    if (!computeState(text)) {
      dom.scanFrame.classList.remove("scan-active");
      return;
    }
    dom.ocrProgress.style.width = "100%";
    renderAll();
    await delay(280);
  } catch (error) {
    console.error("Analysis sequence loop unexpected block crash:", error); // Requirement 14
    showError(`Analysis error: ${error.message}`);
  } finally {
    state.analyzing = false;
    dom.scanFrame.classList.remove("scan-active");
  }
}

async function handleOcr() {
  if (!state.file) return;
  // Requirement 1: Guard flag ensures concurrent OCR threads never fire together
  if (state.ocrRunning) return;

  const validation = validateImageFile(state.file);
  if (!validation.valid) {
    showError(validation.error);
    return;
  }
  clearError();
  
  state.ocrRunning = true;
  // Requirement 3: Steps up token baseline count on new operations triggers
  state.currentOcrId++;
  const activeOcrTokenId = state.currentOcrId;

  const processedFile = await resizeImageIfNeeded(state.file);
  
  dom.ocrButton.disabled = true;
  dom.analyzeButton.disabled = true;
  dom.scanFrame.classList.add("scan-active");
  dom.ocrProgress.style.width = "4%";
  dom.debugOutput.hidden = !dom.debugToggle.checked;
  dom.debugOutput.textContent = "";

  try {
    // Requirement 9: Lazy-load massive OCR parsing assets directly at execution request boundary
    const { runOcr } = await import("./modules/ocr/ocrEngine.js");
    
    const result = await runOcr(processedFile, {
      debug: dom.debugToggle.checked,
      onProgress(event) {
        // Requirement 3: Discards execution tracking outputs if user shifted files mid-pass
        if (activeOcrTokenId !== state.currentOcrId) return;
        const progress = Math.max(4, Math.round((event.progress || 0) * 100));
        dom.ocrProgress.style.width = `${progress}%`;
      }
    });
    
    if (activeOcrTokenId !== state.currentOcrId) return;

    state.ocr = result;
    dom.inputText.value = result.text.trim() || dom.inputText.value;
    if (dom.debugToggle.checked) {
      dom.debugOutput.hidden = false;
      dom.debugOutput.textContent = JSON.stringify({
        confidence: result.confidence,
        lines: result.lines,
        words: result.words.slice(0, 80)
      }, null, 2);
    }
    await analyzeCurrentText();
  } catch (error) {
    console.error("Critical OCR mapping operations failure:", error); // Requirement 14
    if (activeOcrTokenId === state.currentOcrId) {
      showError(`OCR failed: ${error.message}`);
      dom.debugOutput.hidden = false;
      dom.debugOutput.textContent = error.message;
    }
  } finally {
    if (activeOcrTokenId === state.currentOcrId) {
      state.ocrRunning = false;
      dom.ocrButton.disabled = false;
      dom.analyzeButton.disabled = false;
      dom.scanFrame.classList.remove("scan-active");
    }
  }
}

function handleFile(file) {
  if (!file) return;

  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|tiff)$/i.test(file.name);
  if (!isImage) {
    showFileError("Please choose a valid screenshot image file (PNG, JPG, WebP, GIF, BMP, or TIFF).");
    dom.fileInput.value = "";
    return;
  }

  clearFileError();
  if (state.fileUrl) {
    URL.revokeObjectURL(state.fileUrl);
  }
  
  clearError();

  state.file = file;
  state.fileUrl = URL.createObjectURL(file);
  dom.ocrButton.disabled = false;
  dom.ocrProgress.style.width = "0%";

  dom.previewImage.onload = () => {
    dom.scanFrame.classList.add("has-image");
    // Requirement 4: Revoke object allocations as soon as the element completes memory layout configuration load
    if (state.fileUrl) {
      URL.revokeObjectURL(state.fileUrl);
    }
  };

  dom.previewImage.onerror = (err) => {
    console.error("Blob presentation mapping threw layout fault exceptions:", err); // Requirement 14
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = null;
    state.file = null;
    dom.previewImage.src = "";
    dom.fileInput.value = "";
    showFileError("Unable to preview this image. Please select a different screenshot file.");
  };

  dom.previewImage.src = state.fileUrl;
}

async function handleReport() {
  try {
    if (!state.hardware || !state.scoring) {
      showError("Please analyze hardware information first before generating a report.");
      return;
    }
    clearError();

    // Requirement 8: Lazy-load heavy report dependencies dynamically at generation execution time
    const { generatePdfReport } = await import("./modules/reports/pdfReport.js");
    generatePdfReport(state);
  } catch (error) {
    console.error("PDF engine initialization module loading dropped unhandled errors:", error); // Requirement 14
    showError(`PDF report generation failed: ${error?.message || "unknown error"}`);
  }
}

function bindEvents() {
  dom.fileInput.addEventListener("change", (event) => {
    clearFileError();
    clearError();
    handleFile(event.target.files?.[0]);
  });
  dom.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dom.scanFrame.classList.add("scan-active");
  });
  dom.dropZone.addEventListener("dragleave", () => dom.scanFrame.classList.remove("scan-active"));
  dom.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dom.scanFrame.classList.remove("scan-active");
    clearError();
    handleFile(event.dataTransfer.files?.[0]);
  });
  dom.ocrButton.addEventListener("click", handleOcr);
  dom.analyzeButton.addEventListener("click", analyzeCurrentText);
  
  dom.inputText.addEventListener("input", updateAnalyzeButtonState);
  
  dom.sampleButton.addEventListener("click", async () => {
    dom.inputText.value = sampleText;
    updateAnalyzeButtonState();
    await analyzeCurrentText();
  });
  dom.reportButton.addEventListener("click", handleReport);
  
  dom.gameSearch.addEventListener("input", debounce(renderGames, 200));

  if (dom.popularGames) {
    dom.popularGames.addEventListener("click", (e) => {
      const card = e.target.closest(".popular-showcase-card");
      if (card) {
        const selectedGameName = card.dataset.gameName;
        incrementSearchCount(selectedGameName);
        dom.gameSearch.value = selectedGameName;
        renderGames();
      }
    });
  }

  if (dom.gameList) {
    dom.gameList.addEventListener("click", (e) => {
      const card = e.target.closest(".game-card");
      if (card) {
        const selectedGameName = card.dataset.gameName;
        incrementSearchCount(selectedGameName);
        renderGames(); 
      }
    });
  }

  document.addEventListener("click", (e) => {
    const sug = document.getElementById("gameSearchSuggestions");
    if (sug && e.target !== dom.gameSearch) {
      sug.remove();
    }
  });
  
  dom.compareButton.addEventListener("click", renderComparison);

  // Requirement 6: Use cached DOM references instead of running repeated document queries
  dom.questionChips.forEach((button) => {
    button.addEventListener("click", () => renderAi(button.dataset.question));
  });

  dom.navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      dom.navLinks.forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
}

function initParticles() {
  const canvas = dom.particleCanvas;
  const ctx = canvas.getContext("2d");
  const particles = [];
  
  // Requirement 10: Dynamically scales background arrays up or down based on screen targets
  let totalParticles = 50;
  if (window.innerWidth <= 480) {
    totalParticles = 20;
  } else if (window.innerWidth <= 1024) {
    totalParticles = 35;
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function seed() {
    particles.length = 0;
    for (let index = 0; index < totalParticles; index += 1) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        size: Math.random() * 1.8 + 0.4,
        hue: Math.random() > 0.5 ? "102, 228, 255" : Math.random() > 0.5 ? "70, 240, 196" : "255, 209, 102"
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const particle of particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      if (particle.x < 0 || particle.x > window.innerWidth) particle.vx *= -1;
      if (particle.y < 0 || particle.y > window.innerHeight) particle.vy *= -1;

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${particle.hue}, 0.42)`;
      ctx.fill();
    }

    for (let a = 0; a < particles.length; a += 1) {
      for (let b = a + 1; b < particles.length; b += 1) {
        const dx = particles[a].x - particles[b].x;
        const dy = particles[a].y - particles[b].y;
        const distance = Math.hypot(dx, dy);
        if (distance < 115) {
          ctx.beginPath();
          ctx.moveTo(particles[a].x, particles[a].y);
          ctx.lineTo(particles[b].x, particles[b].y);
          ctx.strokeStyle = `rgba(185, 211, 255, ${0.08 * (1 - distance / 115)})`;
          ctx.stroke();
        }
      }
    }

    state.particleAnimationId = window.requestAnimationFrame(draw);
  }

  // Requirement 11: Freezes loop tracking states if browser tabs hide or shift focus context
  function handleVisibilityLifecycle() {
    if (document.hidden) {
      if (state.particleAnimationId) {
        cancelAnimationFrame(state.particleAnimationId);
        state.particleAnimationId = null;
      }
    } else {
      if (!state.particleAnimationId) {
        draw();
      }
    }
  }

  resize();
  seed();
  draw();

  window.addEventListener("resize", () => {
    resize();
    seed();
    drawRadar();
  });

  document.addEventListener("visibilitychange", handleVisibilityLifecycle);
}

function init() {
  try {
    queryDom();
    
    window.setTimeout(() => {
      if (!validateCdnDependencies()) {
        console.warn("Some backend structural CDN modules could not map accurately.");
      }
    }, 100);
    
    dom.inputText.value = sampleText;
    dom.compareA.value = sampleText;
    dom.compareB.value = comparisonText;
    
    updateAnalyzeButtonState();
    dom.reportButton.disabled = true;
    
    computeState(sampleText);
    dom.reportButton.disabled = true;
    renderAll();
    bindEvents();
    initParticles();
    
    window.setTimeout(() => {
      if (dom.startupOverlay) {
        dom.startupOverlay.classList.add("is-hidden");
      }
    }, 1450);
  } catch (error) {
    console.error("Critical system error mapped inside core boot step tracking trees:", error); // Requirement 14
  }
}

// Global initialization trigger loop
document.addEventListener("DOMContentLoaded", init);
