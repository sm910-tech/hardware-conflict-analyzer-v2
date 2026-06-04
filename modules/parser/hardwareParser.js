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

export function normalizeText(value = "") {
  let text = String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\r/g, "\n");

  for (const [pattern, replacement] of OCR_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  return text
    .replace(/[()\[\]{}]/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value = "") {
  return normalizeText(value)
    .replace(/[o]/g, "0")
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

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

function bestSubstringSimilarity(source, needle) {
  if (!source || !needle || needle.length < 5) return 0;
  const width = needle.length;
  let best = 0;
  const minWidth = Math.max(5, width - 2);
  const maxWidth = Math.min(source.length, width + 2);

  for (let size = minWidth; size <= maxWidth; size += 1) {
    for (let start = 0; start <= source.length - size; start += 1) {
      const score = similarity(source.slice(start, start + size), needle);
      if (score > best) best = score;
      if (best >= 0.99) return best;
    }
  }

  return best;
}

function hasWordPhrase(source, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  const phraseTokens = words(normalizedPhrase);
  if (phraseTokens.length === 1 && phraseTokens[0].length < 4) {
    const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegExp(phraseTokens[0])}([^a-z0-9]|$)`);
    return boundary.test(normalizeText(source));
  }
  return normalizeText(source).includes(normalizedPhrase);
}

function matchDatabase(database, sourceText, options = {}) {
  const {
    threshold = 0.82,
    exactBoost = 0,
    component = "hardware",
    allowShortAliases = false
  } = options;
  const normalized = normalizeText(sourceText);
  const sourceCompact = compact(sourceText);
  const candidates = [];

  for (const item of database) {
    const aliases = [item.name, ...(item.aliases || [])];
    for (const alias of aliases) {
      const aliasCompact = compact(alias);
      if (!aliasCompact) continue;

      let score = 0;
      let strategy = "none";

      if ((allowShortAliases || aliasCompact.length >= 4) && sourceCompact.includes(aliasCompact)) {
        score = Math.min(1, 0.96 + exactBoost);
        strategy = "exact compact";
      } else if (hasWordPhrase(normalized, alias)) {
        score = Math.min(1, 0.94 + exactBoost);
        strategy = "exact phrase";
      } else if (aliasCompact.length >= 6) {
        const fuzzy = bestSubstringSimilarity(sourceCompact, aliasCompact);
        score = fuzzy * 0.96;
        strategy = "fuzzy compact";
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

  if (!best || best.rawScore < threshold) {
    return {
      item: null,
      confidence: 0,
      matched: "",
      strategy: "unknown",
      component,
      alternatives: candidates.slice(0, 3)
    };
  }

  const second = candidates.find((candidate) => candidate.item.id !== best.item.id);
  if (second && best.rawScore - second.rawScore < 0.035 && best.rawScore < 0.94) {
    return {
      item: null,
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

function extractRamCapacity(sourceText) {
  const normalized = normalizeText(sourceText);
  const matches = [...normalized.matchAll(/\b(\d{1,3}(?:\.\d)?)\s*(?:gb|g)\b/g)].map((match) => Number(match[1]));
  const plausible = matches.filter((value) => value >= 2 && value <= 256);
  if (!plausible.length) return 0;

  const ramContext = plausible.find((value) => {
    const pattern = new RegExp(`\\b${escapeRegExp(String(value))}\\s*(?:gb|g)\\b`);
    const index = normalized.search(pattern);
    const slice = normalized.slice(Math.max(0, index - 20), index + 35);
    return /ram|memory|ddr|lpddr/.test(slice);
  });

  return Math.round(ramContext || plausible[0]);
}

function extractStorageCapacity(sourceText) {
  const normalized = normalizeText(sourceText);
  const matches = [...normalized.matchAll(/\b(\d(?:\.\d)?|\d{2,4})\s*(tb|gb)\b/g)].map((match) => {
    const value = Number(match[1]);
    return match[2] === "tb" ? value * 1024 : value;
  });
  const plausible = matches.filter((value) => value >= 16 && value <= 16384);
  if (!plausible.length) return 0;

  const storageContext = plausible.find((value) => {
    const gbLabel = value >= 1024 && value % 1024 === 0 ? `${value / 1024}tb` : `${value}gb`;
    const spacedLabel = gbLabel.replace(/(tb|gb)$/, " $1");
    const index = normalized.indexOf(spacedLabel);
    const slice = normalized.slice(Math.max(0, index - 24), index + 42);
    return /ssd|hdd|nvme|emmc|storage|drive|disk|sata|pcie/.test(slice);
  });

  return storageContext || plausible[plausible.length - 1];
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

function classifyRam(sourceText) {
  const normalized = normalizeText(sourceText);
  const explicitDdr3 = /\bddr3\b|\bpc3\b/i.test(normalized);
  const explicitDdr4 = /\bddr4\b|\bpc4\b/i.test(normalized);
  const match = matchDatabase(RAM_DATABASE, sourceText, {
    threshold: 0.76,
    component: "ram",
    allowShortAliases: true
  });
  const capacityGb = extractRamCapacity(sourceText);

  if (match.item?.id === "ddr3" && !explicitDdr3 && /\b(1600mhz|1333mhz)\b/.test(normalized)) {
    return {
      ...UNKNOWN_RAM,
      capacityGb,
      confidence: Math.max(LOW_CONFIDENCE * 100 - 5, 66),
      matched: "",
      strategy: "ambiguous ram frequency",
      name: capacityGb ? `${capacityGb}GB RAM (Type Unknown)` : "Unknown Hardware"
    };
  }

  if (match.item?.id === "ddr4" && !explicitDdr4 && /\b(2400mhz|2666mhz|3200mhz)\b/.test(normalized) && /\bddr\b/i.test(normalized)) {
    // keep DDR4 when DDR is explicit and frequency matches DDR4 range
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

function classifyStorage(sourceText) {
  const match = matchDatabase(STORAGE_DATABASE, sourceText, {
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

function extractSignals(sourceText) {
  const normalized = normalizeText(sourceText);
  const ramCapacity = extractRamCapacity(sourceText);
  const storageCapacity = extractStorageCapacity(sourceText);
  return {
    hasCpuSignal: /\b(cpu|processor|intel|amd|ryzen|core|xeon|threadripper|apple m|snapdragon)\b/.test(normalized),
    hasGpuSignal: /\b(gpu|graphics|geforce|rtx|gtx|radeon|vega|iris|arc|uhd|hd|graphics)\b/.test(normalized),
    hasRamSignal: /\b(ram|memory|ddr|lpddr)\b/.test(normalized) || ramCapacity > 0,
    hasStorageSignal: /\b(storage|ssd|hdd|nvme|emmc|drive|disk|sata|pcie)\b/.test(normalized) || storageCapacity > 0
  };
}

export function parseHardware(sourceText = "") {
  const cleanedText = normalizeText(sourceText);
  const signals = extractSignals(cleanedText);

  const cpuMatch = signals.hasCpuSignal
    ? matchDatabase(CPU_DATABASE, cleanedText, { threshold: 0.75, component: "cpu" })
    : { item: null, confidence: 0, matched: "", strategy: "missing signal", alternatives: [] };
  const gpuMatch = signals.hasGpuSignal
    ? matchDatabase(GPU_DATABASE, cleanedText, { threshold: 0.76, component: "gpu" })
    : { item: null, confidence: 0, matched: "", strategy: "missing signal", alternatives: [] };

  const cpu = withUnknown(cpuMatch.item, UNKNOWN_CPU, cpuMatch.confidence, cpuMatch);
  const gpu = withUnknown(gpuMatch.item, UNKNOWN_GPU, gpuMatch.confidence, gpuMatch);
  const ram = signals.hasRamSignal ? classifyRam(cleanedText) : { ...UNKNOWN_RAM, confidence: 0, matched: "", strategy: "missing signal", capacityGb: 0 };
  const storage = signals.hasStorageSignal ? classifyStorage(cleanedText) : { ...UNKNOWN_STORAGE, confidence: 0, matched: "", strategy: "missing signal", capacityGb: 0 };

  const confidence = {
    cpu: cpu.id === "unknown-cpu" ? 0 : cpu.confidence,
    gpu: gpu.id === "unknown-gpu" ? 0 : gpu.confidence,
    ram: ram.id === "unknown-ram" ? 0 : ram.confidence,
    storage: storage.id === "unknown-storage" ? 0 : storage.confidence
  };

  const detectedCount = [cpu, gpu, ram, storage].filter((item) => item.name !== "Unknown Hardware").length;
  const totalComponents = 4;
  const coveragePercent = (detectedCount / totalComponents) * 100;

  let overallConfidence = 0;
  if (detectedCount > 0) {
    const sum = confidence.cpu + confidence.gpu + confidence.ram + confidence.storage;
    const avgConfidence = Math.round(sum / detectedCount);
    overallConfidence = Math.round((avgConfidence * coveragePercent) / 100);
    if (detectedCount < totalComponents) {
      overallConfidence = Math.min(overallConfidence, 60);
    }
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
    unknownCount: [cpu, gpu, ram, storage].filter((item) => item.name === "Unknown Hardware").length
  };
}

export function compareHardware(left, right) {
  const leftParsed = typeof left === "string" ? parseHardware(left) : left;
  const rightParsed = typeof right === "string" ? parseHardware(right) : right;

  const categories = [
    ["CPU", leftParsed.cpu.score, rightParsed.cpu.score],
    ["GPU", leftParsed.gpu.score, rightParsed.gpu.score],
    ["RAM", leftParsed.ram.score + Math.min(20, (leftParsed.ram.capacityGb || 0) * 1.2), rightParsed.ram.score + Math.min(20, (rightParsed.ram.capacityGb || 0) * 1.2)],
    ["Storage", leftParsed.storage.score, rightParsed.storage.score]
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
