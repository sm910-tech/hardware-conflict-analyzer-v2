import { CPU_DATABASE, UNKNOWN_CPU } from "../../database/cpu/cpus.js";
import { GPU_DATABASE, UNKNOWN_GPU } from "../../database/gpu/gpus.js";
import { RAM_DATABASE, UNKNOWN_RAM } from "../../database/ram/ram.js";
import { STORAGE_DATABASE, UNKNOWN_STORAGE } from "../../database/storage/storage.js";

const OCR_REPLACEMENTS = [
  [/[|]/g, "l"],
  [/ı/g, "i"],
  [/–|—|_/g, "-"],
  [/®|©|™/g, ""],
  [/\bintel\s*\(?r\)?\b/g, "intel"],
  [/\bcore\s*\(?tm\)?\b/g, "core"],
  [/\bnvidia\b/g, "nvidia"],
  [/\bgeforce\b/g, "geforce"],
  [/\bgraphics\s*adapter\b/g, "graphics"],
  [/\binstalled\s*ram\b/g, "ram"],
  [/\bprocessor\b/g, "cpu"],
  [/\bcorc\b/g, "core"],
  [/\bintcl\b/g, "intel"],
  [/\blntel\b/g, "intel"],       // Bugfix 10: Common OCR anomalies
  [/\blnvidia\b/g, "nvidia"],   // Bugfix 10: Common OCR anomalies
  [/\bcorel5\b/g, "core i5"],   // Bugfix 10: Common OCR anomalies
  [/\bgrapliics\b/g, "graphics"],
  [/\bgraphlcs\b/g, "graphics"],
  [/\bgraphies\b/g, "graphics"],
  [/\bgpu\s*0\b/g, "gpu"],
  [/\bss0\b/g, "ssd"],
  [/\bddr\s*iii\b/g, "ddr3"],
  [/\bddr\s*iv\b/g, "ddr4"],
  [/\bddr\s*v\b/g, "ddr5"]
];

const LOW_CONFIDENCE = 0.74;

let LEV_ROW_PREV = new Int32Array(128);
let LEV_ROW_CURR = new Int32Array(128);

export function normalizeText(value = "") {
  if (!value) return "";
  let text = String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\r/g, "\n");

  for (let i = 0; i < OCR_REPLACEMENTS.length; i++) {
    text = text.replace(OCR_REPLACEMENTS[i][0], OCR_REPLACEMENTS[i][1]);
  }

  // Bugfix 10: Standardize glued variant tokens before protection pass
  text = text.replace(/\bryzen5\b/g, "ryzen 5");

  // Bugfix 2: Token Protection Sentinel Scheme
  text = text
    .replace(/\bddr5\b/gi, "__DDR5__")
    .replace(/\bddr4\b/gi, "__DDR4__")
    .replace(/\bddr3\b/gi, "__DDR3__")
    .replace(/\brtx\s*(\d+)/gi, "__RTX__$1")
    .replace(/\bgtx\s*(\d+)/gi, "__GTX__$1")
    .replace(/\brx\s*(\d+)/gi, "__RX__$1")
    .replace(/\bcore\s*i(\d+)/gi, "__CORE__I$1")
    .replace(/\bryzen\s*(\d+)/gi, "__RYZEN__$1")
    .replace(/\bultra\s*(\d+)/gi, "__ULTRA__$1");

  text = text
    .replace(/[()\[\]{}]/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2");

  // Restore protected structures
  text = text
    .replace(/__DDR5__/g, "ddr5")
    .replace(/__DDR4__/g, "ddr4")
    .replace(/__DDR3__/g, "ddr3")
    .replace(/__RTX__/g, "rtx ")
    .replace(/__GTX__/g, "gtx ")
    .replace(/__RX__/g, "rx ")
    .replace(/__CORE__I/g, "core i")
    .replace(/__RYZEN__/g, "ryzen ")
    .replace(/__ULTRA__/g, "ultra ");

  return text.replace(/\s+/g, " ").trim();
}

function compact(value = "") {
  return normalizeText(value)
    .replace(/(?<=\d)o|o(?=\d)/g, "0") // Bugfix 1: Contextual digit zero map
    .replace(/[^\da-z]/g, "");
}

function words(value = "") {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeWindowLevenshtein(source, start, size, needle) {
  const needleLen = needle.length;
  
  if (LEV_ROW_PREV.length <= needleLen) {
    LEV_ROW_PREV = new Int32Array(needleLen + 16);
    LEV_ROW_CURR = new Int32Array(needleLen + 16);
  }

  for (let j = 0; j <= needleLen; j++) {
    LEV_ROW_PREV[j] = j;
  }

  for (let i = 1; i <= size; i++) {
    LEV_ROW_CURR[0] = i;
    const sourceCharCode = source.charCodeAt(start + i - 1);
    
    for (let j = 1; j <= needleLen; j++) {
      const substitutionCost = LEV_ROW_PREV[j - 1] + (sourceCharCode === needle.charCodeAt(j - 1) ? 0 : 1);
      LEV_ROW_CURR[j] = Math.min(LEV_ROW_PREV[j] + 1, LEV_ROW_CURR[j - 1] + 1, substitutionCost);
    }
    
    const tempBuffer = LEV_ROW_PREV;
    LEV_ROW_PREV = LEV_ROW_CURR;
    LEV_ROW_CURR = tempBuffer;
  }

  return LEV_ROW_PREV[needleLen];
}

function bestSubstringSimilarity(sourceCompact, needleCompact) {
  if (!sourceCompact || !needleCompact || needleCompact.length < 5) return 0;
  
  const needleLen = needleCompact.length;
  const minWidth = Math.max(5, needleLen - 2);
  const maxWidth = Math.min(sourceCompact.length, needleLen + 2);
  let bestScore = 0;

  for (let size = minWidth; size <= maxWidth; size++) {
    const maxStart = sourceCompact.length - size;
    const denominator = Math.max(size, needleLen);
    if (!denominator) continue;

    for (let start = 0; start <= maxStart; start++) {
      const distance = computeWindowLevenshtein(sourceCompact, start, size, needleCompact);
      const score = 1 - distance / denominator;
      
      if (score > bestScore) bestScore = score;
      if (bestScore >= 0.99) return bestScore;
    }
  }

  return bestScore;
}

// Bugfix 5: Pass pre-normalized input to prevent nested normalizations
function hasWordPhrase(normalizedSource, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  
  const phraseTokens = words(normalizedPhrase);
  if (phraseTokens.length === 1 && phraseTokens[0].length < 4) {
    const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegExp(phraseTokens[0])}([^a-z0-9]|$)`);
    return boundary.test(normalizedSource);
  }
  return normalizedSource.includes(normalizedPhrase);
}

// Bugfix 4: Lazy database memoization
function matchDatabase(database, normalizedSource, sourceCompact, options = {}) {
  const {
    threshold = 0.82,
    exactBoost = 0,
    component = "hardware",
    allowShortAliases = false
  } = options;
  
  const candidates = [];

  for (let i = 0; i < database.length; i++) {
    const item = database[i];
    
    // Lazy footprint caching right on the reference objects
    if (!item._compactName) item._compactName = compact(item.name);
    if (!item._compactAliases) {
      item._compactAliases = (item.aliases || []).map(a => compact(a));
    }

    const aliases = [item.name, ...(item.aliases || [])];
    const compactAliases = [item._compactName, ...item._compactAliases];
    
    for (let j = 0; j < aliases.length; j++) {
      const alias = aliases[j];
      const aliasCompact = compactAliases[j];
      if (!aliasCompact) continue;

      let score = 0;
      let strategy = "none";

      if ((allowShortAliases || aliasCompact.length >= 4) && sourceCompact.includes(aliasCompact)) {
        score = Math.min(1, 0.96 + exactBoost);
        strategy = "exact compact";
      } else if (hasWordPhrase(normalizedSource, alias)) {
        score = Math.min(1, 0.94 + exactBoost);
        strategy = "exact phrase";
      } else if (aliasCompact.length >= 6) {
        let characterOverlap = false;
        for (let charIdx = 0; charIdx < aliasCompact.length; charIdx++) {
          if (sourceCompact.includes(aliasCompact[charIdx])) {
            characterOverlap = true;
            break;
          }
        }
        
        if (characterOverlap) {
          const fuzzy = bestSubstringSimilarity(sourceCompact, aliasCompact);
          score = fuzzy * 0.96;
          strategy = "fuzzy compact";
        }
      }

      if (score > 0) {
        candidates.push({
          item,
          confidence: Math.round(score * 100),
          rawScore: score,
          matched: alias,
          strategy,
          component
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { item: null, confidence: 0, matched: "", strategy: "unknown", component, alternatives: [] };
  }

  candidates.sort((a, b) => {
    if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
    const lenA = compact(a.matched).length;
    const lenB = compact(b.matched).length;
    if (lenB !== lenA) return lenB - lenA;
    if (a.strategy === "exact phrase" && b.strategy !== "exact phrase") return -1;
    if (b.strategy === "exact phrase" && a.strategy !== "exact phrase") return 1;
    return b.matched.length - a.matched.length;
  });

  const best = candidates[0];

  if (best.rawScore < threshold) {
    return {
      item: null,
      confidence: 0,
      matched: "",
      strategy: "unknown",
      component,
      alternatives: candidates.slice(0, 3)
    };
  }

  let second = null;
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].item.id !== best.item.id) {
      second = candidates[i];
      break;
    }
  }

  if (second && (best.rawScore - second.rawScore < 0.035) && best.rawScore < 0.94) {
    return {
      item: best.item,
      confidence: Math.round(best.rawScore * 100),
      matched: best.matched,
      strategy: "ambiguous",
      component,
      alternatives: candidates.slice(0, 3)
    };
  }

  return {
    item: best.item,
    confidence: best.confidence,
    matched: best.matched,
    strategy: best.strategy,
    component,
    alternatives: candidates.slice(0, 3)
  };
}

// Bugfix 6: Multi-channel array tracking ("2x8 GB", "16 (8x2)")
function extractRamCapacity(sourceText) {
  const lines = sourceText.toLowerCase().split('\n');
  let bestCapacity = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const multiMatch = line.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(?:gb|g)\b/i) || 
                       line.match(/\b(\d+(?:\.\d+)?)\s*(?:gb|g)?\s*\(\s*(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*\)/i);
    
    if (multiMatch) {
      const total = line.includes('(') 
        ? parseFloat(multiMatch[2]) * parseFloat(multiMatch[3])
        : parseFloat(multiMatch[1]) * parseFloat(multiMatch[2]);
      
      if (total >= 2 && total <= 256) return Math.round(total);
    }

    const matches = [...line.matchAll(/\b(\d{1,3}(?:\.\d)?)\s*(?:gb|g)\b/g)];
    for (let j = 0; j < matches.length; j++) {
      const value = Number(matches[j][1]);
      if (value >= 2 && value <= 256) {
        if (/ram|memory|ddr|lpddr|sodimm|mhz/.test(line) && !/ssd|hdd|nvme|drive|tb/.test(line)) {
          return Math.round(value);
        }
        if (value > bestCapacity) bestCapacity = value;
      }
    }
  }
  return Math.round(bestCapacity);
}

// Bugfix 7: Multi-channel flash array tracking ("2 x 512 GB")
function extractStorageCapacity(sourceText) {
  const lines = sourceText.toLowerCase().split('\n');
  let bestCapacity = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const multiMatch = line.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(tb|gb)\b/i);
    if (multiMatch) {
      const mult = parseInt(multiMatch[1], 10);
      let base = parseFloat(multiMatch[2]);
      if (multiMatch[3].toLowerCase() === "tb") base *= 1024;
      const total = mult * base;
      if (total >= 16 && total <= 16384) return total;
    }

    const matches = [...line.matchAll(/\b(\d(?:\.\d)?|\d{2,4})\s*(tb|gb)\b/g)];
    for (let j = 0; j < matches.length; j++) {
      const match = matches[j];
      const value = Number(match[1]);
      const capacityGb = match[2].toLowerCase() === "tb" ? value * 1024 : value;
      if (capacityGb >= 16 && capacityGb <= 16384) {
        if (/ssd|hdd|nvme|emmc|storage|drive|disk|sata|pcie/.test(line) && !/ddr|lpddr|ram|memory|sodimm|mhz/.test(line)) {
          return capacityGb;
        }
        if (capacityGb > bestCapacity) bestCapacity = capacityGb;
      }
    }
  }
  return bestCapacity;
}

function withUnknown(item, unknown, confidence, match) {
  if (!item) {
    return {
      ...unknown,
      confidence,
      matched: match?.matched || "",
      strategy: match?.strategy || "unknown",
      alternatives: match?.alternatives || []
    };
  }
  return {
    ...item,
    confidence,
    matched: match.matched,
    strategy: match.strategy,
    alternatives: match.alternatives
  };
}

function classifyRam(sourceText, normalizedSource, sourceCompact) {
  const explicitDdr3 = /\bddr3\b|\bpc3\b/i.test(normalizedSource);
  const match = matchDatabase(RAM_DATABASE, normalizedSource, sourceCompact, {
    threshold: 0.76,
    component: "ram",
    allowShortAliases: true
  });
  const capacityGb = extractRamCapacity(sourceText);

  if (match.item?.id === "ddr3" && !explicitDdr3 && /\b(1600mhz|1333mhz)\b/.test(normalizedSource)) {
    return {
      ...UNKNOWN_RAM,
      capacityGb,
      confidence: Math.max(LOW_CONFIDENCE * 100 - 5, 66),
      matched: "",
      strategy: "ambiguous ram frequency",
      name: capacityGb ? `${capacityGb}GB RAM (Type Unknown)` : "Unknown Hardware"
    };
  }

  const confidence = match.item ? Math.min(100, match.confidence + (capacityGb ? 4 : 0)) : 0;
  const item = withUnknown(match.item, UNKNOWN_RAM, confidence, match);

  if (item.id === "unknown-ram" && capacityGb) {
    return {
      ...item,
      capacityGb,
      confidence: Math.max(LOW_CONFIDENCE * 100 - 5, 68),
      name: `${capacityGb}GB RAM (Type Unknown)`
    };
  }

  return {
    ...item,
    capacityGb,
    name: item.id === "unknown-ram" ? "Unknown Hardware" : `${capacityGb || "Unknown"}GB ${item.type} RAM`
  };
}

function classifyStorage(sourceText, normalizedSource, sourceCompact) {
  const match = matchDatabase(STORAGE_DATABASE, normalizedSource, sourceCompact, {
    threshold: 0.76,
    component: "storage",
    allowShortAliases: true
  });
  const capacityGb = extractStorageCapacity(sourceText);
  const confidence = match.item ? Math.min(100, match.confidence + (capacityGb ? 4 : 0)) : 0;
  const item = withUnknown(match.item, UNKNOWN_STORAGE, confidence, match);

  return {
    ...item,
    capacityGb,
    name: item.id === "unknown-storage"
      ? "Unknown Hardware"
      : `${formatCapacity(capacityGb)} ${item.type}`.trim()
  };
}

function formatCapacity(capacityGb) {
  if (!capacityGb) return "";
  if (capacityGb >= 1024 && capacityGb % 1024 === 0) return `${capacityGb / 1024}TB`;
  if (capacityGb >= 1024) return `${(capacityGb / 1024).toFixed(1)}TB`;
  return `${capacityGb}GB`;
}

function extractSignals(normalizedSource, sourceText) {
  const ramCapacity = extractRamCapacity(sourceText);
  const storageCapacity = extractStorageCapacity(sourceText);
  return {
    hasCpuSignal: /\b(cpu|processor|intel|amd|ryzen|core|xeon|threadripper|apple m|snapdragon)\b/.test(normalizedSource),
    hasGpuSignal: /\b(gpu|graphics|geforce|rtx|gtx|radeon|vega|iris|arc|uhd|hd|graphics)\b/.test(normalizedSource),
    hasRamSignal: /\b(ram|memory|ddr|lpddr)\b/.test(normalizedSource) || ramCapacity > 0,
    hasStorageSignal: /\b(storage|ssd|hdd|nvme|emmc|drive|disk|sata|pcie)\b/.test(normalizedSource) || storageCapacity > 0
  };
}

export function parseHardware(sourceText = "") {
  const cleanedText = normalizeText(sourceText);
  const sourceCompact = compact(sourceText);
  const signals = extractSignals(cleanedText, sourceText);

  const cpuMatch = signals.hasCpuSignal
    ? matchDatabase(CPU_DATABASE, cleanedText, sourceCompact, { threshold: 0.75, component: "cpu" })
    : { item: null, confidence: 0, matched: "", strategy: "missing signal", alternatives: [] };
      
  const gpuMatch = signals.hasGpuSignal
    ? matchDatabase(GPU_DATABASE, cleanedText, sourceCompact, { threshold: 0.76, component: "gpu" })
    : { item: null, confidence: 0, matched: "", strategy: "missing signal", alternatives: [] };

  const cpu = withUnknown(cpuMatch.item, UNKNOWN_CPU, cpuMatch.confidence, cpuMatch);
  const gpu = withUnknown(gpuMatch.item, UNKNOWN_GPU, gpuMatch.confidence, gpuMatch);
  const ram = signals.hasRamSignal ? classifyRam(sourceText, cleanedText, sourceCompact) : { ...UNKNOWN_RAM, confidence: 0, matched: "", strategy: "missing signal", capacityGb: 0 };
  const storage = signals.hasStorageSignal ? classifyStorage(sourceText, cleanedText, sourceCompact) : { ...UNKNOWN_STORAGE, confidence: 0, matched: "", strategy: "missing signal", capacityGb: 0 };

  const confidence = {
    cpu: cpu.id === "unknown-cpu" ? 0 : cpu.confidence,
    gpu: gpu.id === "unknown-gpu" ? 0 : gpu.confidence,
    ram: ram.id === "unknown-ram" ? 0 : ram.confidence,
    storage: storage.id === "unknown-storage" ? 0 : storage.confidence
  };

  const detectedCount = (cpu.id !== "unknown-cpu" ? 1 : 0) + 
                        (gpu.id !== "unknown-gpu" ? 1 : 0) + 
                        (ram.id !== "unknown-ram" ? 1 : 0) + 
                        (storage.id !== "unknown-storage" ? 1 : 0);
                        
  const totalComponents = 4;
  const coveragePercent = (detectedCount / totalComponents);

  // Bugfix 8: Smooth asymptotic scalar multiplier instead of flat 60 cap
  let overallConfidence = 0;
  if (detectedCount > 0) {
    const sum = confidence.cpu + confidence.gpu + confidence.ram + confidence.storage;
    const avgConfidence = Math.round(sum / detectedCount);
    overallConfidence = Math.round(avgConfidence * coveragePercent);
  }

  return {
    cleanedText,
    cpu,
    gpu,
    ram,
    storage,
    confidence,
    overallConfidence,
    signals,
    unknownCount: totalComponents - detectedCount
  };
}

export function compareHardware(left, right) {
  const leftParsed = typeof left === "string" ? parseHardware(left) : left;
  const rightParsed = typeof right === "string" ? parseHardware(right) : right;

  // Bugfix 9: Safe score cast lookups
  const categories = [
    ["CPU", Number(leftParsed.cpu?.score) || 0, Number(rightParsed.cpu?.score) || 0],
    ["GPU", Number(leftParsed.gpu?.score) || 0, Number(rightParsed.gpu?.score) || 0],
    ["RAM", (Number(leftParsed.ram?.score) || 0) + Math.min(20, (leftParsed.ram?.capacityGb || 0) * 1.2), (Number(rightParsed.ram?.score) || 0) + Math.min(20, (rightParsed.ram?.capacityGb || 0) * 1.2)],
    ["Storage", Number(leftParsed.storage?.score) || 0, Number(rightParsed.storage?.score) || 0]
  ].map(([label, leftScore, rightScore]) => {
    const delta = leftScore - rightScore;
    return {
      label,
      leftScore: Math.round(leftScore),
      rightScore: Math.round(rightScore),
      winner: Math.abs(delta) < 4 ? "Tie" : delta > 0 ? "PC A" : "PC B",
      delta: Math.round(Math.abs(delta))
    };
  });

  const leftTotal = categories.reduce((sum, item) => sum + item.leftScore, 0);
  const rightTotal = categories.reduce((sum, item) => sum + item.rightScore, 0);
  const winner = Math.abs(leftTotal - rightTotal) < 8 ? "Tie" : leftTotal > rightTotal ? "PC A" : "PC B";

  return {
    left: leftParsed,
    right: rightParsed,
    categories,
    winner,
    summary: winner === "Tie"
      ? "Both systems are closely matched. Choose based on price, thermals, warranty, and storage condition."
      : `${winner} is stronger overall, led by ${categories.filter((item) => item.winner === winner).map((item) => item.label).join(", ") || "balanced component scores"}.`
  };
}
