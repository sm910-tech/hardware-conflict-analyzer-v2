import { compareHardware, parseHardware } from "./modules/parser/hardwareParser.js";
import { calculateScores, scoreTone } from "./modules/scoring/scoreEngine.js";
import { analyzeGameCompatibility, summarizeGameCompatibility } from "./modules/gamechecker/gameChecker.js";
import { analyzeUpgrades, explainQuestion } from "./modules/upgrades/upgradeAdvisor.js";

const sampleText = `Processor Intel i3-6006U
Graphics Intel HD Graphics 520
Memory 8GB DDR3 RAM
Storage 480GB SSD`;

const comparisonText = `CPU Ryzen 7 7700X
GPU RTX 4070
RAM 32GB DDR5
Storage 1TB NVMe Gen4 SSD`;

// Shared Global App State Definition Engine
const dom = Object.create(null);
const state = {
  file: null,
  fileUrl: null,
  ocr: null,
  hardware: null,
  scoring: null,
  games: [],
  upgrades: null,
  searchCounts: null,         // Local storage memory cache
  ocrRunning: false,          // OCR concurrency lock
  analyzing: false,           // Analysis lock
  currentOcrId: 0,            // Race condition tracking ID
  particleAnimationId: null   // Animation loop hook reference
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
      console.error("Bitmap resizing error encountered:", error);
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
        console.error("Image asset mapping parsing failed:", err);
        resolve(file);
      };
      img.src = e.target.result;
    };
    reader.onerror = (err) => {
      console.error("FileReader process mapping aborted:", err);
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

// Cache reference arrays completely upfront
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

  dom.navLinks = document.querySelectorAll(".nav-link");
  dom.questionChips = document.querySelectorAll(".question-chip");
  dom.mobileUploadButtons = document.querySelectorAll(".mobile-upload-btn"); // Cached mobile controls
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
  if (state.searchCounts) return state.searchCounts;
  try {
    state.searchCounts = JSON.parse(localStorage.getItem("hca_game_searches")) || {};
  } catch (error) {
    console.error("Failed to recover user storage map data:", error);
    state.searchCounts = {};
  }
  return state.searchCounts;
}

function incrementSearchCount(gameName) {
  if (!gameName) return;
  try {
    const counts = getSearchCounts();
    counts[gameName] = (counts[gameName] || 0) + 1;
    
    // Prune cache keys dynamically if they cross capacity limit
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
    console.error("Failed to write search telemetry database profile:", error);
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

    // Cache structural search strings
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
    console.error("Critical error building system hardware metric calculation paths:", error);
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

/* --- Deconstructed Game Management View Pipeline Module --- */

function filterGames(games, query) {
  return games.filter((game) => game.searchString?.includes(query));
}

function renderSummary(filtered, games) {
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
}

function renderPopularGames(games, query) {
  if (!dom.popularGames) return;
  if (query.length > 0) {
    dom.popularGames.innerHTML = "";
    dom.popularGames.style.display = "none";
    return;
  }
  
  dom.popularGames.style.display = "grid";
  const counts = getSearchCounts();
  
  const sortedByPopularity = [...games].sort((a, b) => {
    const countA = counts[a.name] || 0;
    const countB = counts[b.name] || 0;
    if (countB !== countA) return countB - countA;
    return a.name.localeCompare(b.name);
  });

  const popularTitles = sortedByPopularity.slice(0, 5);

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

function renderGameCards(filtered) {
  const virtualizedMatches = filtered.slice(0, 30); // Virtualization window limit

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
}

function renderGames() {
  const games = Array.isArray(state.games) ? state.games : [];
  const query = dom.gameSearch?.value.trim().toLowerCase() || "";
  
  const filtered = filterGames(games, query);
  renderSummary(filtered, games);
  renderPopularGames(games, query);
  renderGameCards(filtered);
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
    suggestionsBox.className = "search-suggestions-dropdown"; // Modular CSS target
    dom.gameSearch.parentElement.classList.add("relative-position-container");
    dom.gameSearch.parentElement.appendChild(suggestionsBox);

    // Event delegation pipeline pattern
    suggestionsBox.addEventListener("click", (e) => {
      const targetItem = e.target.closest(".suggestion-item");
      if (targetItem) {
        const selectedName = targetItem.dataset.gameName;
        incrementSearchCount(selectedName);
        dom.gameSearch.value = selectedName;
        suggestionsBox.remove();
        renderGames();
      }
    });
  }

  suggestionsBox.innerHTML = matches.map(game => `
    <div class="suggestion-item" data-game-name="${escapeHtml(game.name)}">
      ${escapeHtml(game.name)} <span class="suggestion-genre-aside">${escapeHtml(game.genre)}</span>
    </div>
  `).join("");
}

/* --- End Game Management View Pipeline Module --- */

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
  if (state.analyzing) return; // Analysis execution lock
  
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
    console.error("Analysis sequence loop unexpected block crash:", error);
    showError(`Analysis error: ${error.message}`);
  } finally {
    state.analyzing = false;
    dom.scanFrame.classList.remove("scan-active");
  }
}

async function handleOcr() {
  if (!state.file) return;
  if (state.ocrRunning) return; // OCR concurrency lock

  const validation = validateImageFile(state.file);
  if (!validation.valid) {
    showError(validation.error);
    return;
  }
  clearError();
  
  state.ocrRunning = true;
  state.currentOcrId++; // Race condition tracking token ID
  const activeOcrTokenId = state.currentOcrId;

  const processedFile = await resizeImageIfNeeded(state.file);
  
  dom.ocrButton.disabled = true;
  dom.analyzeButton.disabled = true;
  dom.scanFrame.classList.add("scan-active");
  dom.ocrProgress.style.width = "4%";
  dom.debugOutput.hidden = !dom.debugToggle.checked;
  dom.debugOutput.textContent = "";

  try {
    const { runOcr } = await import("./modules/ocr/ocrEngine.js"); // Lazy-load OCR engine
    
    const result = await runOcr(processedFile, {
      debug: dom.debugToggle.checked,
      onProgress(event) {
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
    console.error("Critical OCR mapping operations failure:", error);
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
    if (state.fileUrl) {
      URL.revokeObjectURL(state.fileUrl); // Clean up temporary object URLs immediately
    }
  };

  dom.previewImage.onerror = (err) => {
    console.error("Blob presentation mapping threw layout fault exceptions:", err);
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

    const { generatePdfReport } = await import("./modules/reports/pdfReport.js"); // Lazy-load PDF Report writer
    generatePdfReport(state);
  } catch (error) {
    console.error("PDF engine initialization module loading dropped unhandled errors:", error);
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

  dom.questionChips.forEach((button) => {
    button.addEventListener("click", () => renderAi(button.dataset.question));
  });

  dom.navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      dom.navLinks.forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });

  // Hotkey mapping layer modules
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== dom.gameSearch &&
        document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      if (dom.gameSearch) {
        dom.gameSearch.focus();
        dom.gameSearch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    if (e.ctrlKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      dom.sampleButton?.click();
    }

    if (e.ctrlKey && e.key === "Enter") {
      if (dom.analyzeButton && !dom.analyzeButton.disabled) {
        e.preventDefault();
        dom.analyzeButton.click();
      }
    }
  });

  // Scroll event observer with optimization configurations
  const bttButton = document.getElementById("backToTop");
  if (bttButton) {
    window.addEventListener("scroll", () => {
      if (window.scrollY > 400) {
        bttButton.style.display = "flex";
      } else {
        bttButton.style.display = "none";
      }
    }, { passive: true });
  }

  // Intercept hooks mapped to mobile triggers directly from cache window
  if (dom.fileInput && dom.mobileUploadButtons.length > 0) {
    dom.mobileUploadButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        dom.fileInput.click();
      });
    });
  }

  // Unload event clean hooks execution module
  window.addEventListener("beforeunload", () => {
    if (state.particleAnimationId) {
      cancelAnimationFrame(state.particleAnimationId);
    }
  });
}

function initParticles() {
  const canvas = dom.particleCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Prevent multiple double animation loop bugs
  if (state.particleAnimationId) {
    cancelAnimationFrame(state.particleAnimationId);
  }

  const particles = [];
  
  // Calculate particle volume allocation matrices dynamically
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
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 1.5 + 0.5
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.fillStyle = "rgba(0, 240, 255, 0.25)";
    
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > window.innerWidth) p.vx *= -1;
      if (p.y < 0 || p.y > window.innerHeight) p.vy *= -1;
    });
    
    state.particleAnimationId = requestAnimationFrame(draw);
  }

  window.addEventListener("resize", debounce(() => {
    resize();
    seed();
  }, 200));

  resize();
  seed();
  draw();
}

// Chained animation timers for system tracer logs rendering
function runPremiumBootSequence() {
  const bootLogs = document.querySelectorAll(".boot-log");
  const bootReadyText = document.querySelector(".boot-log-ready");
  const overlay = dom.startupOverlay;
  
  if (overlay && bootLogs.length > 0) {
    let currentLogIndex = 0;
    
    function nextLog() {
      bootLogs[currentLogIndex].classList.remove("active");
      currentLogIndex++;
      
      if (currentLogIndex < bootLogs.length) {
        bootLogs[currentLogIndex].classList.add("active");
        setTimeout(nextLog, 1000); // Chained sequence mapping avoids hidden interval bugs
      } else {
        if (bootReadyText) bootReadyText.classList.add("active");
        
        setTimeout(() => {
          overlay.style.opacity = "0";
          overlay.style.transform = "scale(1.03)";
          setTimeout(() => {
            overlay.style.display = "none";
          }, 500);
        }, 800);
      }
    }
    
    setTimeout(nextLog, 1000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.history && 'scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
  
  queryDom();
  validateCdnDependencies();
  bindEvents();
  initParticles();
  runPremiumBootSequence();
});
