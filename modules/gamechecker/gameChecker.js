import { GAME_DATABASE } from "../../database/games/games.js";

function clamp(value, min = 0, max = 240) {
  return Math.max(min, Math.min(max, value));
}

function settingsFor(ratio, hasHardBottleneck) {
  if (hasHardBottleneck) return "Below minimum";
  if (ratio >= 1.35) return "Ultra / 1440p";
  if (ratio >= 1.12) return "High / 1080p";
  if (ratio >= 0.95) return "Medium / 1080p";
  if (ratio >= 0.78) return "Low / 720p-900p";
  return "Very Low";
}

function fpsFor(game, hardwareScore, ratio, hasHardBottleneck) {
  if (hasHardBottleneck) return Math.round(clamp(12 + ratio * 18, 8, 28));
  const base = game.recommended >= 80 ? 56 : game.recommended >= 65 ? 68 : 82;
  return Math.round(clamp(base * ratio + (hardwareScore - game.recommended) * 0.55, 24, 180));
}

function bottlenecksFor(game, hardware, componentScores) {
  const bottlenecks = [];
  if ((componentScores.cpu || 0) < game.cpu) bottlenecks.push("CPU");
  if ((componentScores.gpu || 0) < game.gpu) bottlenecks.push("GPU");
  if ((hardware.ram?.capacityGb || 0) < game.ram) bottlenecks.push("RAM");
  if (hardware.storage?.capacityGb && hardware.storage.capacityGb < game.storage) bottlenecks.push("Storage capacity");
  if (hardware.storage?.type === "HDD" && game.recommended > 55) bottlenecks.push("Storage speed");
  return bottlenecks;
}

export function analyzeGameCompatibility(hardware, scoringResult, limit = GAME_DATABASE.length) {
  const gamingScore = scoringResult.scores.gaming;
  const componentScores = scoringResult.components;

  return GAME_DATABASE.slice(0, limit).map((game) => {
    const bottlenecks = bottlenecksFor(game, hardware, componentScores);
    const upgradeTarget = bottlenecks.includes("GPU") ? "GPU" : bottlenecks[0];
    const hardBottleneck = (componentScores.cpu || 0) < (game.cpu || 0) * 0.68
      || (componentScores.gpu || 0) < (game.gpu || 0) * 0.68
      || ((hardware.ram?.capacityGb || 0) > 0 && (hardware.ram.capacityGb || 0) < Math.max(4, (game.ram || 0) * 0.5));
    const ratio = game.recommended > 0 ? Math.max(0, gamingScore / game.recommended) : 0;
    const canRun = !hardBottleneck && gamingScore >= (game.min || 0);
    const recommended = game.recommended > 0 && gamingScore >= game.recommended && bottlenecks.length === 0;
    const status = recommended ? "Recommended" : canRun ? "Can Run" : hardBottleneck ? "Cannot Run" : "Limited";

    return {
      ...game,
      status,
      canRun,
      settings: settingsFor(ratio, hardBottleneck),
      estimatedFps: fpsFor(game, gamingScore, ratio, hardBottleneck),
      bottlenecks,
      upgrade: bottlenecks.length
        ? `Upgrade ${upgradeTarget} first for the largest uplift.`
        : "No urgent upgrade needed for this title.",
      margin: Math.round(gamingScore - game.recommended)
    };
  });
}

export function summarizeGameCompatibility(results) {
  const recommended = results.filter((game) => game.status === "Recommended").length;
  const runnable = results.filter((game) => game.status === "Can Run").length;
  const limited = results.filter((game) => game.status === "Limited").length;
  const cannot = results.filter((game) => game.status === "Cannot Run").length;

  return {
    recommended,
    runnable,
    limited,
    cannot,
    playable: recommended + runnable + limited
  };
}
