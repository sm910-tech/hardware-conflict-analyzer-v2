function safeObject(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

export function generatePdfReport(state) {
  const jsPdfNamespace = window.jspdf;
  if (!jsPdfNamespace?.jsPDF) {
    throw new Error("jsPDF is not available. Check the script connection and try again.");
  }

  const hardware = safeObject(state.hardware, {
    cpu: {},
    gpu: {},
    ram: {},
    storage: {}
  });
  const scoring = safeObject(state.scoring, { scores: {}, explanations: {} });
  const upgrades = safeObject(state.upgrades, { upgrades: [], bottleneckSummary: "No upgrade data available." });

  const { jsPDF } = jsPdfNamespace;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = 52;

  const addHeading = (text, size = 18) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(20, 28, 44);
    doc.text(text, margin, y);
    y += size + 14;
  };

  const addText = (text, size = 10, color = [78, 88, 112]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, 500);
    doc.text(lines, margin, y);
    y += lines.length * (size + 4) + 8;
  };

  const addMetric = (label, value, x, metricY) => {
    doc.setDrawColor(222, 230, 240);
    doc.setFillColor(245, 248, 252);
    doc.roundedRect(x, metricY, 118, 54, 8, 8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(16, 24, 40);
    doc.text(String(value), x + 12, metricY + 26);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(88, 98, 118);
    doc.text(label, x + 12, metricY + 42);
  };

  doc.setFillColor(9, 14, 28);
  doc.rect(0, 0, 595, 120, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("HARDWARE CONFLICT ANALYZER PRO", margin, 54);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(176, 190, 215);
  doc.text(`Professional hardware report - ${new Date().toLocaleString()}`, margin, 78);
  y = 150;

  addHeading("Detected Hardware");
  addText(`CPU: ${hardware.cpu.name || "Unknown Hardware"} (${hardware.cpu.confidence || 0}% confidence)`);
  addText(`GPU: ${hardware.gpu.name || "Unknown Hardware"} (${hardware.gpu.confidence || 0}% confidence)`);
  addText(`RAM: ${hardware.ram.name || "Unknown Hardware"} (${hardware.ram.confidence || 0}% confidence)`);
  addText(`Storage: ${hardware.storage.name || "Unknown Hardware"} (${hardware.storage.confidence || 0}% confidence)`);

  addHeading("Scores");
  const metricY = y;
  addMetric("Overall", scoring.scores.overall || 0, margin, metricY);
  addMetric("Gaming", scoring.scores.gaming || 0, margin + 130, metricY);
  addMetric("Programming", scoring.scores.programming || 0, margin + 260, metricY);
  addMetric("AI Workload", scoring.scores.aiWorkload || 0, margin + 390, metricY);
  y += 82;
  addText(scoring.explanations.overall || "No score summary available.");

  const reportGames = Array.isArray(state.games) ? state.games : [];
  const reportUpgrades = Array.isArray(state.upgrades?.upgrades) ? state.upgrades.upgrades : [];

  addHeading("Game Compatibility");
  reportGames.slice(0, 12).forEach((game) => {
    addText(`${game.name || "Unknown title"}: ${game.status || "Unknown status"}, ${game.settings || "Unknown settings"}, estimated ${game.estimatedFps || 0} FPS. Bottlenecks: ${(Array.isArray(game.bottlenecks) ? game.bottlenecks.join(", ") : "None") || "None"}.`);
    if (y > 720) {
      doc.addPage();
      y = 54;
    }
  });

  addHeading("Upgrade Advisor");
  reportUpgrades.slice(0, 5).forEach((upgrade, index) => {
    addText(`${index + 1}. ${upgrade.title || "Upgrade suggestion"} - ${upgrade.reason || "No details provided."} Expected gain: ${upgrade.expectedGain || "Unknown"}.`);
    if (y > 720) {
      doc.addPage();
      y = 54;
    }
  });

  addHeading("Analysis Summary");
  addText(state.upgrades.bottleneckSummary);
  addText("Unknown Hardware means the OCR/parser confidence was below the safe threshold, so the analyzer intentionally avoided guessing.");

  doc.save("hardware-conflict-analyzer-pro-report.pdf");
}
