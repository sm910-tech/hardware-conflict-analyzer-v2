import { compareHardware, parseHardware } from "./modules/parser/hardwareParser.js";
import { calculateScores, scoreTone } from "./modules/scoring/scoreEngine.js";
import { analyzeGameCompatibility, summarizeGameCompatibility } from "./modules/gamechecker/gameChecker.js";
import { analyzeUpgrades, explainQuestion } from "./modules/upgrades/upgradeAdvisor.js";
import { runOcr } from "./modules/ocr/ocrEngine.js";
import { generatePdfReport } from "./modules/reports/pdfReport.js";

// CDN dependency fallback detection
function validateCdnDependencies() {
  const missing = [];
  if (!window.Tesseract) missing.push("Tesseract.js");
  if (!window.jspdf) missing.push("jsPDF");
  if (!window.lucide) missing.push("Lucide Icons");
  
  if (missing.length > 0) {
    console.warn(`Missing CDN dependencies: ${missing.join(", ")}. Some features may not work.`);
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
  const safePixels = 32_000_000; // around 32MP

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
      img.onerror = () => {
        resolve(file);
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
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

function clearError() {
  if (dom.errorArea) {
    dom.errorArea.hidden = true;
    dom.errorArea.textContent = "";
  }

  if (dom.debugOutput) {
    dom.debugOutput.textContent = "";
  }
}

// Simple debounce for game search
function debounce(fn, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Clamp percent values to 0-100
function clampPercent(value) {
  const num = Number(value) || 0;
  return Math.max(0, Math.min(100, num));
}

// Update button states based on input validity
function updateAnalyzeButtonState() {
  const text = dom.inputText?.value.trim() || "";
  dom.analyzeButton.disabled = text.length === 0;
}

const sampleText = `Processor Intel i3-6006U
Graphics Intel HD Graphics 520
Memory 8GB DDR3 RAM
Storage 480GB SSD`;

const comparisonText = `CPU Ryzen 7 7700X
GPU RTX 4070
RAM 32GB DDR5
Storage 1TB NVMe Gen4 SSD`;

const dom = {};
const state = {
  file: null,
  ocr: null,
  hardware: null,
  scoring: null,
  games: [],
  upgrades: null
};

function queryDom() {
  [
    "startupOverlay",
    "particleCanvas",
    "dropZone",
    "fileInput",
    "scanFrame",
    "previewImage",
    "debugToggle",
    "ocrButton",
    "analyzeButton",
    "sampleButton",
    "reportButton",
    "ocrProgress",
    "inputText",
    "errorArea",
    "debugOutput",
    "confidenceValue",
    "confidenceMeter",
    "snapshotGrid",
    "scoreGrid",
    "radarCanvas",
    "scoreNarrative",
    "compatSummary",
    "gameSearch",
    "gameList",
    "upgradeList",
    "aiResponse",
    "compareA",
    "compareB",
    "compareButton",
    "compareResults"
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
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

    if (dom.reportButton) {
      dom.reportButton.disabled = false;
    }
    return true;
  } catch (error) {
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
  const hardware = safeObject(state.hardware, {
    cpu: {},
    gpu: {},
    ram: {},
    storage: {}
  });

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
    ["Overall", "overall"],
    ["Gaming", "gaming"],
    ["Programming", "programming"],
    ["Productivity", "productivity"],
    ["Streaming", "streaming"],
    ["Video Editing", "videoEditing"],
    ["AI Workload", "aiWorkload"]
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
  const filtered = games.filter((game) => `${game.name} ${game.genre}`.toLowerCase().includes(query));
  const summary = summarizeGameCompatibility(filtered.length ? filtered : games);

  dom.compatSummary.innerHTML = [
    ["Recommended", summary.recommended],
    ["Can Run", summary.runnable],
    ["Limited", summary.limited],
    ["Cannot Run", summary.cannot]
  ].map(([label, value]) => `
    <div class="summary-tile">
      <strong>${value}</strong>
      <span>${label}</span>
    </div>
  `).join("");

  dom.gameList.innerHTML = filtered.map((game, index) => `
    <article class="game-card" style="animation-delay:${Math.min(index * 18, 240)}ms">
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
    showError("Please enter hardware information in both comparison boxes.");
    dom.compareResults.innerHTML = "";
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
  const text = dom.inputText.value.trim();
  if (!text) {
    showError("Please enter hardware information or load an image to analyze.");
    return;
  }
  clearError();
  renderSkeletons();
  dom.scanFrame.classList.add("scan-active");
  dom.ocrProgress.style.width = "36%";
  await delay(420);
  if (!computeState(text)) {
    dom.scanFrame.classList.remove("scan-active");
    return;
  }
  dom.ocrProgress.style.width = "100%";
  renderAll();
  await delay(280);
  dom.scanFrame.classList.remove("scan-active");
}

async function handleOcr() {
  if (!state.file) return;
  
  // Validate file size before OCR
  const validation = validateImageFile(state.file);
  if (!validation.valid) {
    showError(validation.error);
    return;
  }
  clearError();
  
  // Resize image if needed to prevent OCR slowdown
  const processedFile = await resizeImageIfNeeded(state.file);
  
  dom.ocrButton.disabled = true;
  dom.analyzeButton.disabled = true;
  dom.scanFrame.classList.add("scan-active");
  dom.ocrProgress.style.width = "4%";
  dom.debugOutput.hidden = !dom.debugToggle.checked;
  dom.debugOutput.textContent = "";

  try {
    const result = await runOcr(processedFile, {
      debug: dom.debugToggle.checked,
      onProgress(event) {
        const progress = Math.max(4, Math.round((event.progress || 0) * 100));
        dom.ocrProgress.style.width = `${progress}%`;
      }
    });
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
    showError(`OCR failed: ${error.message}`);
    dom.debugOutput.hidden = false;
    dom.debugOutput.textContent = error.message;
  } finally {
    dom.ocrButton.disabled = false;
    dom.analyzeButton.disabled = false;
    dom.scanFrame.classList.remove("scan-active");
  }
}

function handleFile(file) {
  if (!file) return;

  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|tiff)$/i.test(file.name);
  if (!isImage) {
    showFileError("Please choose a valid screenshot image file (PNG, JPG, WebP, GIF, BMP, or TIFF). If the file is saved in Music, move it to a picture folder or select a supported image.");
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
  };

  dom.previewImage.onerror = () => {
    URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = null;
    state.file = null;
    dom.previewImage.src = "";
    dom.fileInput.value = "";
    showFileError("Unable to preview this image. Please select a different screenshot file.");
  };

  dom.previewImage.src = state.fileUrl;
}

function handleReport() {
  try {
    // Validate state before generating PDF
    if (!state.hardware || !state.scoring) {
      showError("Please analyze hardware information first before generating a report.");
      return;
    }
    clearError();
    generatePdfReport(state);
  } catch (error) {
    showError(`PDF report generation failed: ${error?.message || "unknown error"}`);
    console.error(error);
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
  
  // Update button state when text input changes
  dom.inputText.addEventListener("input", updateAnalyzeButtonState);
  
  dom.sampleButton.addEventListener("click", async () => {
    dom.inputText.value = sampleText;
    updateAnalyzeButtonState();
    await analyzeCurrentText();
  });
  dom.reportButton.addEventListener("click", handleReport);
  
  // Debounce game search to prevent lag
  dom.gameSearch.addEventListener("input", debounce(renderGames, 200));
  
  dom.compareButton.addEventListener("click", renderComparison);
  document.querySelectorAll(".question-chip").forEach((button) => {
    button.addEventListener("click", () => renderAi(button.dataset.question));
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
}

function initParticles() {
  const canvas = dom.particleCanvas;
  const ctx = canvas.getContext("2d");
  const particles = [];
  const total = Math.min(110, Math.max(48, Math.floor(window.innerWidth / 16)));

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
    for (let index = 0; index < total; index += 1) {
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

    window.requestAnimationFrame(draw);
  }

  resize();
  seed();
  draw();
  window.addEventListener("resize", () => {
    resize();
    seed();
    drawRadar();
  });
}

function init() {
  try {
    queryDom();
    
    // Validate CDN dependencies at startup (delayed to allow script loading)
    window.setTimeout(() => {
      if (!validateCdnDependencies()) {
        console.warn("Some CDN features may be unavailable");
      }
    }, 100);
    
    dom.inputText.value = sampleText;
    dom.compareA.value = sampleText;
    dom.compareB.value = comparisonText;
    
    // Initialize button states from sample text
    updateAnalyzeButtonState();
    dom.reportButton.disabled = true;
    
    // Compute initial sample state before rendering
    computeState(sampleText);
    dom.reportButton.disabled = true;
    renderAll();
    bindEvents();
    initParticles();
    
    // Hide overlay after UI is ready
    window.setTimeout(() => {
      if (dom.startupOverlay) {
        dom.startupOverlay.classList.add("is-hidden");
      }
    }, 1450);
  } catch (error) {
    console.error("Initialization error:", error);
    if (dom.startupOverlay) {
      dom.startupOverlay.textContent = "Application failed to initialize. Please refresh the page.";
    }
  }
}

// Cleanup object URLs on page unload
window.addEventListener("beforeunload", () => {
  if (state.fileUrl) {
    URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = null;
  }
});

document.addEventListener("DOMContentLoaded", init);
