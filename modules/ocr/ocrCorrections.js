import { CPU_DATABASE } from "../../database/cpu/cpus.js";
import { GPU_DATABASE } from "../../database/gpu/gpus.js";
import { RAM_DATABASE } from "../../database/ram/ram.js";
import { STORAGE_DATABASE } from "../../database/storage/storage.js";

const GENERAL_OCR_FIXES = [
  [/[|]/g, "l"],
  [/ı/g, "i"],
  [/–|—|_/g, "-"],
  [/®|©|™/g, ""],
  [/\bintcl\b/gi, "intel"],
  [/\bintei\b/gi, "intel"],
  [/\bnvidla\b/gi, "nvidia"],
  [/\bnvldia\b/gi, "nvidia"],
  [/\bgeforcc\b/gi, "geforce"],
  [/\bgeforoe\b/gi, "geforce"],
  [/\bcorc\b/gi, "core"],
  [/\bgrapliics\b/gi, "graphics"],
  [/\bgraphlcs\b/gi, "graphics"],
  [/\bgraphies\b/gi, "graphics"],
  [/\bgraphlc\b/gi, "graphic"],
  [/\bradean\b/gi, "radeon"],
  [/\bryzcn\b/gi, "ryzen"],
  [/\bryzen\s*5\b/gi, "ryzen 5"],
  [/\bryzen\s*7\b/gi, "ryzen 7"],
  [/\bryzen\s*9\b/gi, "ryzen 9"],
  [/\brt\s*x\b/gi, "rtx"],
  [/\bgt\s*x\b/gi, "gtx"],
  [/\brx\s*(\d)/gi, "rx $1"],
  [/\bss0\b/gi, "ssd"],
  [/\bddr\s*l{2,}\b/gi, "ddr3"],
  [/\bddr\s*iii\b/gi, "ddr3"],
  [/\bddr\s*iv\b/gi, "ddr4"],
  [/\bddr\s*v\b/gi, "ddr5"],
  [/\bddr\s*3\b/gi, "ddr3"],
  [/\bddr\s*4\b/gi, "ddr4"],
  [/\bddr\s*5\b/gi, "ddr5"],
  [/\blp\s*ddr\s*4\b/gi, "lpddr4"],
  [/\blp\s*ddr\s*5\b/gi, "lpddr5"],
  [/\bnvme\s*gen\s*(\d)/gi, "nvme gen$1"],
  [/\bpcie\s*gen\s*(\d)/gi, "pcie gen$1"],
  [/\bm\.?\s*2\b/gi, "m.2"],
  [/\b52o\b/gi, "520"],
  [/\b62o\b/gi, "620"],
  [/\b400o\b/gi, "4000"],
  [/\bi\s*(\d)\s*-\s*/gi, "i$1-"],
  [/\bcore\s*i\s*(\d)/gi, "core i$1"],
  [/\bprocessor\b/gi, "processor"],
  [/\binstalled\s*ram\b/gi, "installed ram"],
  [/\bgraphics\s*adapter\b/gi, "graphics"],
  [/\bgpu\s*0\b/gi, "gpu"]
];

function normalizeKey(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function buildAliasFixes(database) {
  const fixes = [];

  for (const item of database) {
    const canonical = normalizeKey(item.name);
    const aliases = [item.name, ...(item.aliases || [])];

    for (const alias of aliases) {
      const aliasKey = normalizeKey(alias);
      if (!aliasKey || aliasKey === canonical) continue;

      // Aliases that look like OCR typos of the canonical name.
      if (/graphlcs|graphies|grapliics|52o|62o|intcl|nvidla|geforcc|ss0|corc/i.test(alias)) {
        const pattern = new RegExp(aliasKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        fixes.push([pattern, canonical]);
        continue;
      }

      // Compact alias variants (e.g. gtx1060, rtx4070) -> spaced form for parser.
      const compact = aliasKey.replace(/[^a-z0-9]/g, "");
      const canonicalCompact = canonical.replace(/[^a-z0-9]/g, "");
      if (compact.length >= 6 && compact !== canonicalCompact && /^[a-z]+\d/.test(compact)) {
        const spaced = aliasKey
          .replace(/([a-z]+)(\d)/i, "$1 $2")
          .replace(/(\d)([a-z])/gi, "$1 $2");
        fixes.push([new RegExp(compact, "gi"), spaced]);
      }
    }
  }

  return fixes;
}

const DATABASE_ALIAS_FIXES = [
  ...buildAliasFixes(CPU_DATABASE),
  ...buildAliasFixes(GPU_DATABASE),
  ...buildAliasFixes(RAM_DATABASE),
  ...buildAliasFixes(STORAGE_DATABASE)
];

function fixNumericLetterO(text) {
  let fixed = text;
  let previous = "";

  while (fixed !== previous) {
    previous = fixed;
    fixed = fixed.replace(/(?<=\d)[oO](?=\d|[uUxXtT]|$)/g, "0");
  }

  return fixed;
}

export function applyOcrCorrections(text = "") {
  let corrected = String(text);

  for (const [pattern, replacement] of GENERAL_OCR_FIXES) {
    corrected = corrected.replace(pattern, replacement);
  }

  corrected = fixNumericLetterO(corrected);

  for (const [pattern, replacement] of DATABASE_ALIAS_FIXES) {
    corrected = corrected.replace(pattern, replacement);
  }

  return corrected
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
