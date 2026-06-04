export const RAM_DATABASE = [
  {
    id: "ddr3",
    name: "DDR3 RAM",
    type: "DDR3",
    score: 34,
    bandwidth: "12.8-17 GB/s",
    aliases: ["ddr3", "ddr 3", "pc3", "1600mhz", "1333mhz"]
  },
  {
    id: "ddr4",
    name: "DDR4 RAM",
    type: "DDR4",
    score: 63,
    bandwidth: "19-25.6 GB/s",
    aliases: ["ddr4", "ddr 4", "pc4", "2400mhz", "2666mhz", "3200mhz"]
  },
  {
    id: "ddr5",
    name: "DDR5 RAM",
    type: "DDR5",
    score: 88,
    bandwidth: "38-64 GB/s",
    aliases: ["ddr5", "ddr 5", "pc5", "4800mhz", "5600mhz", "6000mhz"]
  },
  {
    id: "lpddr4",
    name: "LPDDR4 RAM",
    type: "LPDDR4",
    score: 58,
    bandwidth: "25-34 GB/s",
    aliases: ["lpddr4", "lp ddr4", "lpddr 4", "lp ddr 4"]
  },
  {
    id: "lpddr5",
    name: "LPDDR5 RAM",
    type: "LPDDR5",
    score: 84,
    bandwidth: "51-68 GB/s",
    aliases: ["lpddr5", "lp ddr5", "lpddr 5", "lp ddr 5"]
  }
];

export const UNKNOWN_RAM = {
  id: "unknown-ram",
  name: "Unknown Hardware",
  type: "Unknown",
  score: 0,
  bandwidth: "Unknown",
  capacityGb: 0,
  aliases: []
};
