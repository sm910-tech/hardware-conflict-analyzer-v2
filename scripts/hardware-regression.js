import assert from "assert";
import { parseHardware } from "../modules/parser/hardwareParser.js";

function assertMatch(sourceText, component, expectedId) {
  const parsed = parseHardware(sourceText);
  const actual = parsed[component]?.id;
  assert.strictEqual(actual, expectedId, `Expected ${component} to be ${expectedId} from ${JSON.stringify(sourceText)}, got ${actual}`);
  console.log(`PASS ${component.toUpperCase()} - ${sourceText} -> ${actual}`);
}

const tests = [
  { source: "Intel Core i3-4005U processor", component: "cpu", expectedId: "intel-i3-4005u" },
  { source: "AMD Ryzen 5 5500U", component: "cpu", expectedId: "amd-ryzen-5-5500u" },
  { source: "Intel Core Ultra 7 200 laptop CPU", component: "cpu", expectedId: "intel-core-ultra-7-200" },
  { source: "NVIDIA GeForce GTX 750 Ti graphics card", component: "gpu", expectedId: "nvidia-gtx-750-ti" },
  { source: "GeForce GTX 1080", component: "gpu", expectedId: "nvidia-gtx-1080" },
  { source: "NVIDIA GTX 1060", component: "gpu", expectedId: "nvidia-gtx-1060" }
];

for (const test of tests) {
  assertMatch(test.source, test.component, test.expectedId);
}

console.log("All hardware regression tests passed.");
