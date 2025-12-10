const fs = require("fs");
const path = require("path");

const resultsDirArg = process.argv[2] || "tests/k6_results";
const resultsDir = path.resolve(resultsDirArg);

if (!fs.existsSync(resultsDir)) {
  console.error("Results directory does not exist:", resultsDir);
  process.exit(1);
}

// change this list to the metrics you want to look into. Below is an example. 
const METRICS_TO_TRACK = {
  iteration_duration: "avg",
  ws_session_duration: "avg",
  ws_connecting: "avg",

  iterations: "count",
  ws_sessions: "count",

  vus: "value",
  vus_max: "value",

  data_sent: "count",
  data_received: "count"
};


const aggregates = {};
for (const name of Object.keys(METRICS_TO_TRACK)) {
  aggregates[name] = { sum: 0, runs: 0 };
}

const files = fs
  .readdirSync(resultsDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error("No JSON files found in:", resultsDir);
  process.exit(1);
}

console.log(`Found ${files.length} run files in ${resultsDir}\n`);

let printedMetricNamesOnce = false;

for (const file of files) {
  const fullPath = path.join(resultsDir, file);
  const raw = fs.readFileSync(fullPath, "utf8");
  const summary = JSON.parse(raw);

  if (!summary.metrics) {
    console.error("No 'metrics' field in summary JSON for file:", file);
    continue;
  }

  if (!printedMetricNamesOnce) {
    console.log("Available metric names in JSON:", Object.keys(summary.metrics));
    console.log("");
    printedMetricNamesOnce = true;
  }

  for (const [name, field] of Object.entries(METRICS_TO_TRACK)) {
    const metric = summary.metrics[name];
    if (!metric) continue;

    const value = metric[field];
    if (typeof value === "number") {
      aggregates[name].sum += value;
      aggregates[name].runs += 1;
    }
  }
}

console.log("*********************");
console.log(`Averaged metrics across ${files.length} runs:`);
console.log("*********************\n");

for (const [name, { sum, runs }] of Object.entries(aggregates)) {
  if (runs > 0) {
    const avg = sum / runs;
    console.log(`${name} (${METRICS_TO_TRACK[name]}): ${avg}`);
  } else {
    console.log(`${name}: not present in any summary..`);
  }
}
