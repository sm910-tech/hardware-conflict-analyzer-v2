function addUpgrade(list, upgrade) {
  list.push({
    ...upgrade,
    priorityScore: Math.round(upgrade.impact * 0.52 + upgrade.costEffectiveness * 0.32 + upgrade.urgency * 0.16)
  });
}

export function analyzeUpgrades(hardware, scoringResult) {
  const upgrades = [];
  const components = scoringResult.components;
  const scores = scoringResult.scores;

  if (!hardware.cpu || hardware.cpu.name === "Unknown Hardware") {
    addUpgrade(upgrades, {
      component: "CPU",
      title: "Confirm CPU model",
      reason: "CPU confidence is too low for a safe recommendation.",
      expectedGain: "Unknown until detected",
      impact: 45,
      costEffectiveness: 70,
      urgency: 60
    });
  } else if (components.cpu < 45) {
    addUpgrade(upgrades, {
      component: "CPU",
      title: "Move to a modern 6-core or better CPU",
      reason: "The processor is likely causing system latency, compile delays, and low 1% lows in games.",
      expectedGain: "35-70% better responsiveness",
      impact: 82,
      costEffectiveness: 74,
      urgency: 86
    });
  } else if (components.cpu < 68) {
    addUpgrade(upgrades, {
      component: "CPU",
      title: "Upgrade CPU for heavier multitasking",
      reason: "The CPU is serviceable, but modern engines and creative apps benefit from stronger single-core and multi-core speed.",
      expectedGain: "15-35% in CPU-bound work",
      impact: 58,
      costEffectiveness: 60,
      urgency: 52
    });
  }

  if (!hardware.gpu || hardware.gpu.name === "Unknown Hardware") {
    addUpgrade(upgrades, {
      component: "GPU",
      title: "Confirm graphics hardware",
      reason: "The analyzer will not guess a GPU when the OCR signal is weak.",
      expectedGain: "Unknown until detected",
      impact: 50,
      costEffectiveness: 68,
      urgency: 64
    });
  } else if (components.gpu < 35) {
    addUpgrade(upgrades, {
      component: "GPU",
      title: "Add a discrete GPU or choose a newer iGPU laptop",
      reason: "Integrated legacy graphics are the main limiter for games, GPU acceleration, and AI workloads.",
      expectedGain: "3x-8x gaming uplift",
      impact: 94,
      costEffectiveness: 82,
      urgency: 92
    });
  } else if (components.gpu < 68) {
    addUpgrade(upgrades, {
      component: "GPU",
      title: "Upgrade graphics for modern 1080p gaming",
      reason: "The GPU can run many titles, but visual quality and frame consistency will be constrained.",
      expectedGain: "45-120% in GPU-bound games",
      impact: 78,
      costEffectiveness: 66,
      urgency: 68
    });
  }

  if (!hardware.ram || hardware.ram.name === "Unknown Hardware") {
    addUpgrade(upgrades, {
      component: "RAM",
      title: "Confirm RAM type and capacity",
      reason: "RAM capacity was not detected confidently enough.",
      expectedGain: "Unknown until detected",
      impact: 42,
      costEffectiveness: 80,
      urgency: 58
    });
  } else if ((hardware.ram.capacityGb || 0) < 8) {
    addUpgrade(upgrades, {
      component: "RAM",
      title: "Upgrade to at least 16GB RAM",
      reason: "Low memory causes tab swapping, stutter, long loading, and poor multitasking.",
      expectedGain: "Major smoothness improvement",
      impact: 82,
      costEffectiveness: 92,
      urgency: 88
    });
  } else if ((hardware.ram.capacityGb || 0) < 16) {
    addUpgrade(upgrades, {
      component: "RAM",
      title: "Upgrade from 8GB to 16GB RAM",
      reason: "8GB is the floor for modern apps and many games; 16GB reduces stutter and background pressure.",
      expectedGain: "20-45% smoother multitasking",
      impact: 68,
      costEffectiveness: 96,
      urgency: 76
    });
  } else if (hardware.ram.type === "DDR3") {
    addUpgrade(upgrades, {
      component: "RAM",
      title: "Move to a newer platform with DDR4 or DDR5",
      reason: "DDR3 bandwidth usually indicates an older motherboard and CPU platform.",
      expectedGain: "Platform-wide uplift",
      impact: 58,
      costEffectiveness: 58,
      urgency: 50
    });
  }

  if (!hardware.storage || hardware.storage.name === "Unknown Hardware") {
    addUpgrade(upgrades, {
      component: "Storage",
      title: "Confirm storage type",
      reason: "Storage OCR confidence is too low for a safe speed estimate.",
      expectedGain: "Unknown until detected",
      impact: 38,
      costEffectiveness: 78,
      urgency: 52
    });
  } else if (hardware.storage.type === "HDD" || hardware.storage.type === "eMMC") {
    addUpgrade(upgrades, {
      component: "Storage",
      title: "Install an SSD",
      reason: "Slow storage is one of the most visible causes of boot delays, app lag, and update stalls.",
      expectedGain: "3x-10x faster loading",
      impact: 88,
      costEffectiveness: 98,
      urgency: 90
    });
  } else if (hardware.storage.type === "SATA SSD" && scores.productivity > 65) {
    addUpgrade(upgrades, {
      component: "Storage",
      title: "Move heavy projects to NVMe",
      reason: "A SATA SSD is good for general use, but NVMe helps large builds, media caches, and game streaming.",
      expectedGain: "15-40% faster heavy file workflows",
      impact: 48,
      costEffectiveness: 64,
      urgency: 38
    });
  }

  upgrades.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    upgrades,
    primary: upgrades[0] || {
      component: "System",
      title: "No urgent upgrade",
      reason: "The system is balanced for the detected workload profile.",
      expectedGain: "Minor",
      impact: 20,
      costEffectiveness: 40,
      urgency: 20,
      priorityScore: 25
    },
    bottleneckSummary: summarizeBottlenecks(hardware, scoringResult)
  };
}

function summarizeBottlenecks(hardware, scoringResult) {
  const components = scoringResult.components;
  const weakest = Object.entries(components).sort((a, b) => a[1] - b[1])[0];
  if (!weakest) return "No component data available.";
  const [component, score] = weakest;

  if (score === 0) return `The ${component.toUpperCase()} could not be detected confidently.`;
  if (score < 40) return `${component.toUpperCase()} is the dominant bottleneck and should be addressed first.`;
  if (score < 65) return `${component.toUpperCase()} is the soft bottleneck under demanding workloads.`;
  return "The detected hardware is reasonably balanced.";
}

export function explainQuestion(question, hardware, scoringResult, upgradeResult) {
  const q = question.toLowerCase();
  const primary = upgradeResult.primary;

  if (q.includes("slow") || q.includes("laptop")) {
    if (hardware.storage?.type === "HDD" || hardware.storage?.type === "eMMC") {
      return "Your system is likely slow because storage latency is high. Moving to an SSD usually gives the biggest day-to-day improvement.";
    }
    if ((hardware.ram?.capacityGb || 0) < 16) {
      return "Your system may feel slow because memory pressure forces apps to swap data to storage. Upgrading to 16GB RAM should make multitasking smoother.";
    }
    return `The main limiter is ${primary.component}. ${primary.reason}`;
  }

  if (q.includes("lag") || q.includes("game")) {
    if ((scoringResult.components.gpu || 0) < 45) {
      return "Game lag is mainly coming from graphics limits. Lower resolution and textures first; for a real jump, upgrade the GPU.";
    }
    if ((scoringResult.components.cpu || 0) < 45) {
      return "Game stutter is likely CPU-bound, especially in open-world and competitive games. A newer CPU will improve frame pacing.";
    }
    return "Game lag is likely workload-specific. Check thermals, background apps, and use the recommended settings from the compatibility table.";
  }

  if (q.includes("ssd")) {
    return "An SSD is faster because it has very low latency and no moving parts. Apps, boot, updates, and game streaming all benefit from that faster access pattern.";
  }

  if (q.includes("upgrade")) {
    return `${primary.title}. ${primary.reason} Expected gain: ${primary.expectedGain}.`;
  }

  return `${primary.component} is the first area I would investigate. ${primary.reason}`;
}
