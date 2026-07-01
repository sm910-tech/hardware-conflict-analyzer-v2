import { parseHardware } from "../modules/parser/hardwareParser.js";

// Regression test cases locked in memory to prevent accidental mutations
const TESTS = Object.freeze([
  // 1. Standard Matches
  { source: "Intel Core i3-4005U processor", component: "cpu", expectedId: "intel-i3-4005u" },
  { source: "AMD Ryzen 5 5500U", component: "cpu", expectedId: "amd-ryzen-5-5500u" },
  { source: "NVIDIA GeForce GTX 750 Ti graphics card", component: "gpu", expectedId: "nvidia-gtx-750-ti" },
  { source: "GeForce GTX 1080", component: "gpu", expectedId: "nvidia-gtx-1080" },
  { source: "NVIDIA GTX 1060", component: "gpu", expectedId: "nvidia-gtx-1060" },

  // 2. Negative Tests (Unknown/Garbage Hardware expects null)
  { source: "Intel Potato 9000", component: "cpu", expectedId: null },
  { source: "Unknown GPU XYZ", component: "gpu", expectedId: null },
  { source: "Random text with no hardware", component: "ram", expectedId: null },

  // 3. OCR Mistakes & Typos
  { source: "InteI Core i3-4005U", component: "cpu", expectedId: "intel-i3-4005u" },
  { source: "GTX l060", component: "gpu", expectedId: "nvidia-gtx-1060" },
  { source: "NVIDlA RTX 3080", component: "gpu", expectedId: "nvidia-rtx-3080" },
  { source: "Ryzen 5 55OOU", component: "cpu", expectedId: "amd-ryzen-5-5500u" },

  // 4. Modern & Future Hardware Generations
  { source: "Intel Core Ultra 5 125H", component: "cpu", expectedId: "intel-core-ultra-5-125h" },
  { source: "Intel Core Ultra 9 185H", component: "cpu", expectedId: "intel-core-ultra-9-185h" },
  { source: "AMD Ryzen AI 9 HX 370", component: "cpu", expectedId: "amd-ryzen-ai-9-hx-370" },
  { source: "NVIDIA RTX 5090", component: "gpu", expectedId: "nvidia-rtx-5090" },
  { source: "Radeon RX 9900 XTX", component: "gpu", expectedId: "amd-rx-9900-xtx" },
  { source: "Intel Iris Xe Graphics", component: "gpu", expectedId: "intel-iris-xe" },
  { source: "AMD Radeon 780M", component: "gpu", expectedId: "amd-radeon-780m" },
  { source: "Intel Arc A770", component: "gpu", expectedId: "intel-arc-a770" }
]);

console.time("Regression Suite Execution");

let passed = 0;
let failed = 0;
const failureLogs = [];

for (let i = 0; i < TESTS.length; i++) {
  const t = TESTS[i];
  const parsed = parseHardware(t.source);
  
  // Safely extract the ID, falling back to null if the component is entirely missing
  const actual = parsed[t.component] ? parsed[t.component].id : null; 

  if (actual === t.expectedId) {
    passed++;
  } else {
    failed++;
    // Format the strings nicely so 'null' doesn't look like a string literal
    const formattedExpected = t.expectedId ? `"${t.expectedId}"` : "null";
    const formattedActual = actual ? `"${actual}"` : "null";
    failureLogs.push(`❌ FAIL: Expected ${t.component} to be ${formattedExpected} from "${t.source}", but got ${formattedActual}`);
  }
}

// Print Report
console.log("\n--- Test Results ---");
if (failureLogs.length > 0) {
  console.log(failureLogs.join("\n"));
  console.log(""); 
}

const successRate = ((passed / TESTS.length) * 100).toFixed(1);

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Success Rate: ${successRate}%`);

if (failed === 0) {
  console.log(`\n\x1b[32m✔ All regression tests passed successfully.\x1b[0m`);
} else {
  console.log(`\n\x1b[31m✖ Some tests failed. Check the logs above.\x1b[0m`);
  process.exitCode = 1; 
}

console.timeEnd("Regression Suite Execution");
