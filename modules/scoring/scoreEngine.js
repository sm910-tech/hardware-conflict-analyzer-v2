function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(clamp(value));
}

function ramScore(ram) {
  if (!ram || ram.name === "Unknown Hardware") return 0;
  const capacity = ram.capacityGb || 0;
  const capacityScore = capacity >= 64 ? 100 : capacity >= 32 ? 92 : capacity >= 16 ? 78 : capacity >= 8 ? 58 : capacity >= 4 ? 36 : 18;
  return round((ram.score || 0) * 0.58 + capacityScore * 0.42);
}

function storageScore(storage) {
  if (!storage || storage.name === "Unknown Hardware") return 0;
  const capacity = storage.capacityGb || 0;
  const capacityScore = capacity >= 2048 ? 94 : capacity >= 1024 ? 86 : capacity >= 512 ? 74 : capacity >= 256 ? 62 : capacity >= 128 ? 44 : 30;
  return round((storage.score || 0) * 0.72 + capacityScore * 0.28);
}

function explainScore(label, score) {
  if (score >= 90) return `${label} is flagship-class and ready for demanding modern workloads.`;
  if (score >= 75) return `${label} is strong with only minor compromises in heavy scenarios.`;
  if (score >= 58) return `${label} is capable for mainstream use with some tuning.`;
  if (score >= 38) return `${label} is usable, but modern games and creative workloads will expose limits.`;
  if (score > 0) return `${label} is entry-level and will feel constrained in current software.`;
  return `${label} needs confirmed hardware before a reliable score can be produced.`;
}

export function calculateScores(hardware) {
  const cpu = hardware.cpu?.score || 0;
  const cpuGaming = hardware.cpu?.gaming || cpu;
  const cpuProductivity = hardware.cpu?.productivity || cpu;
  const cpuAi = hardware.cpu?.ai || 0;
  const gpu = hardware.gpu?.score || 0;
  const gpuGaming = hardware.gpu?.gaming || gpu;
  const gpuAi = hardware.gpu?.ai || 0;
  const memory = ramScore(hardware.ram);
  const disk = storageScore(hardware.storage);

  const scores = {
    overall: round(cpu * 0.3 + gpu * 0.32 + memory * 0.2 + disk * 0.18),
    gaming: round(cpuGaming * 0.22 + gpuGaming * 0.58 + memory * 0.13 + disk * 0.07),
    programming: round(cpuProductivity * 0.44 + memory * 0.34 + disk * 0.18 + gpu * 0.04),
    productivity: round(cpuProductivity * 0.36 + memory * 0.3 + disk * 0.24 + gpu * 0.1),
    streaming: round(cpuProductivity * 0.34 + gpu * 0.32 + memory * 0.22 + disk * 0.12),
    videoEditing: round(cpuProductivity * 0.36 + gpu * 0.32 + memory * 0.2 + disk * 0.12),
    aiWorkload: round(cpuAi * 0.22 + gpuAi * 0.58 + memory * 0.12 + disk * 0.08)
  };

  const components = {
    cpu: round(cpu),
    gpu: round(gpu),
    ram: round(memory),
    storage: round(disk)
  };

  return {
    scores,
    components,
    explanations: {
      overall: explainScore("The overall system", scores.overall),
      gaming: explainScore("Gaming performance", scores.gaming),
      programming: explainScore("Programming performance", scores.programming),
      productivity: explainScore("Productivity performance", scores.productivity),
      streaming: explainScore("Streaming performance", scores.streaming),
      videoEditing: explainScore("Video editing performance", scores.videoEditing),
      aiWorkload: explainScore("AI workload performance", scores.aiWorkload)
    },
    radar: [
      { label: "CPU", value: components.cpu },
      { label: "GPU", value: components.gpu },
      { label: "RAM", value: components.ram },
      { label: "Storage", value: components.storage },
      { label: "Gaming", value: scores.gaming },
      { label: "AI", value: scores.aiWorkload }
    ]
  };
}

export function scoreTone(score) {
  if (score >= 85) return "elite";
  if (score >= 68) return "strong";
  if (score >= 45) return "balanced";
  if (score > 0) return "limited";
  return "unknown";
}
