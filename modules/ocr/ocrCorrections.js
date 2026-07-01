import { CPU_DATABASE } from "../../database/cpu/cpus.js";
import { GPU_DATABASE } from "../../database/gpu/gpus.js";
import { RAM_DATABASE } from "../../database/ram/ram.js";
import { STORAGE_DATABASE } from "../../database/storage/storage.js";

// 1. Unified Character-Level Replacements (Run first)
const CHARACTER_CLEANUPS = [
  [/[|]/g, "l"],
  [/ı/g, "i"],
  [/–|—|_/g, "-"],
  [/®|©|™/g, ""],
];

// 2. Structural Spacing Rules (Saves dozens of standalone loops)
const STRUCTURED_PASSES = [
  // Standarize common hardware spacing patterns (e.g., ryzen5 -> ryzen 5, ddr5 -> ddr 5)
  [/\b(ryzen|rtx|gtx|rx|ddr|lpddr)\s*([0-9iVv]+)\b/gi, "$1 $2"],
  [/\brt\s+x\b/gi, "rtx"],
  [/\bgt\s+x\b/gi, "gtx"],
  [/\bcore\s+i\s+(\d+)\b/gi, "core i$1"],
  [/\bi\s*(\d+)\s*-\s*/gi, "i$1-"],
  // Force clean spacing on metric values to prevent downstream parser confusion (e.g., 16GB -> 16 GB)
  [/\b(\d+)\s*(gb|tb|mb|mhz|w)\b/gi, "$1 $2"],
  // Roman numeral standardization for RAM generations
  [/\bddr\s+i{2,}\b/gi, "ddr3"],
  [/\bddr\s+iii\b/gi, "ddr3"],
  [/\bddr\s+iv\b/gi, "ddr4"],
  [/\bddr\s+v\b/gi, "ddr5"],
  // Standard interface terminology mapping
  [/\bnvme\s*gen\s*(\d)/gi, "nvme gen$1"],
  [/\bpcie\s*gen\s*(\d)/gi, "pcie gen$1"],
  [/\bm\.?\s*2\b/gi, "m.2"]
];

// 3. Exact Word Typo Replacements
const STATIC_WORD_FIXES = {
  intcl: "intel", intei: "intel", nvidla: "nvidia", nvldia: "nvidia",
  geforcc: "geforce", geforoe: "geforce", corc: "core", grapliics: "graphics",
  graphlcs: "graphics", graphies: "graphics", graphlc: "graphic", radean: "radeon",
  ryzcn: "ryzen", ss0: "ssd", "52o": "520", "62o": "620", "400o": "4000",
  processor: "processor", "installed ram": "installed ram", "graphics adapter": "graphics", "gpu 0": "gpu"
};

function normalizeKey(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

// 4. Advanced Compiling Engine: Merges static dictionary and dynamic database records into an O(1) Search Tree
function compileMasterTokenEngine() {
  const tokenMap = new Map();

  // Populate static configurations
  for (const [typo, correction] of Object.entries(STATIC_WORD_FIXES)) {
    tokenMap.set(normalizeKey(typo), correction);
  }

  // Inject dynamic cross-references from databases
  const databases = [CPU_DATABASE, GPU_DATABASE, RAM_DATABASE, STORAGE_DATABASE];
  
  for (const database of databases) {
    if (!database) continue;
    for (const item of database) {
      const canonical = normalizeKey(item.name);
      const aliases = [item.name, ...(item.aliases || [])];

      for (const alias of aliases) {
        const aliasKey = normalizeKey(alias);
        if (!aliasKey || aliasKey === canonical) continue;

        // Catch typical OCR character skips inside string aliases
        if (/graphlcs|graphies|grapliics|52o|62o|intcl|nvidla|geforcc|ss0|corc/i.test(alias)) {
          tokenMap.set(aliasKey, canonical);
          continue;
        }

        // Catch and process squashed configurations (e.g., "gtx1060" -> "gtx 1060")
        const compact = aliasKey.replace(/[^a-z0-9]/g, "");
        const canonicalCompact = canonical.replace(/[^a-z0-9]/g, "");
        if (compact.length >= 6 && compact !== canonicalCompact && /^[a-z]+\d/.test(compact)) {
          const spaced = aliasKey
            .replace(/([a-z]+)(\d)/i, "$1 $2")
            .replace(/(\d)([a-z])/gi, "$1 $2");
          tokenMap.set(compact, spaced);
        }
      }
    }
  }

  // Sort keys by character length descending to prevent shorter sub-strings from hijacking longer terms
  const sortedKeys = Array.from(tokenMap.keys()).sort((a, b) => b.length - a.length);
  
  // Wrap in boundary groups safely checking for structural text formatting rules
  const regexPatterns = sortedKeys.map(key => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leadingBoundary = /^[a-z0-9]/i.test(key) ? "\\b" : "";
    const trailingBoundary = /[a-z0-9]$/i.test(key) ? "\\b" : "";
    return `${leadingBoundary}${escaped}${trailingBoundary}`;
  });

  const masterRegex = new RegExp(regexPatterns.join("|"), "gi");

  return { masterRegex, tokenMap };
}

// Compile once globally at runtime initialization
const { masterRegex: MASTER_TOKEN_REGEX, tokenMap: TARGET_LOOKUP_MAP } = compileMasterTokenEngine();

// Cleans up numeric 'O' glitches safely without infinite loops
function fixNumericLetterO(text) {
  // Native global (/g) handles all matches in one loop phase across the string context
  return text.replace(/(?<=\d)[oO](?=\d|[uUxXtT]|$)/g, "0");
}

export function applyOcrCorrections(text = "") {
  if (!text) return "";
  let corrected = String(text);

  // Phase 1: Pure Character Cleanup
  for (let i = 0; i < CHARACTER_CLEANUPS.length; i++) {
    corrected = corrected.replace(CHARACTER_CLEANUPS[i][0], CHARACTER_CLEANUPS[i][1]);
  }

  // Phase 2: Structural Hardware Syntax Spacing Passes
  for (let i = 0; i < STRUCTURED_PASSES.length; i++) {
    corrected = corrected.replace(STRUCTURED_PASSES[i][0], STRUCTURED_PASSES[i][1]);
  }

  // Phase 3: Fast Numerical OCR Pass
  corrected = fixNumericLetterO(corrected);

  // Phase 4: High Performance Unified Token Matching Engine (Single Native Pass)
  corrected = corrected.replace(MASTER_TOKEN_REGEX, (matched) => {
    const key = matched.toLowerCase().replace(/\s+/g, " ").trim();
    return TARGET_LOOKUP_MAP.get(key) || matched;
  });

  // Phase 5: Clean Whitespace Geometry
  return corrected
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
