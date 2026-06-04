export const STORAGE_DATABASE = [
  {
    id: "hdd",
    name: "Hard Disk Drive",
    type: "HDD",
    score: 20,
    latency: "High",
    aliases: ["hdd", "hard disk", "hard drive", "5400 rpm", "7200 rpm"]
  },
  {
    id: "sata-ssd",
    name: "SATA SSD",
    type: "SATA SSD",
    score: 58,
    latency: "Low",
    aliases: ["ssd", "sata ssd", "solid state drive", "2.5 ssd", "480gb ssd", "512gb ssd", "256gb ssd", "sata"]
  },
  {
    id: "nvme-gen3",
    name: "NVMe Gen3 SSD",
    type: "NVMe Gen3",
    score: 76,
    latency: "Very low",
    aliases: ["nvme gen3", "nvme gen 3", "pcie 3", "pcie gen3", "m.2 nvme", "m2 nvme"]
  },
  {
    id: "nvme-gen4",
    name: "NVMe Gen4 SSD",
    type: "NVMe Gen4",
    score: 88,
    latency: "Very low",
    aliases: ["nvme gen4", "nvme gen 4", "pcie 4", "pcie gen4", "gen4 ssd"]
  },
  {
    id: "nvme-gen5",
    name: "NVMe Gen5 SSD",
    type: "NVMe Gen5",
    score: 97,
    latency: "Extreme low",
    aliases: ["nvme gen5", "nvme gen 5", "pcie 5", "pcie gen5", "gen5 ssd"]
  },
  {
    id: "emmc",
    name: "eMMC Storage",
    type: "eMMC",
    score: 24,
    latency: "Medium",
    aliases: ["emmc", "embedded multimedia card", "emmc storage"]
  }
];

export const UNKNOWN_STORAGE = {
  id: "unknown-storage",
  name: "Unknown Hardware",
  type: "Unknown",
  score: 0,
  latency: "Unknown",
  capacityGb: 0,
  aliases: []
};
