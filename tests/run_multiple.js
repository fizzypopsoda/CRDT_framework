const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const N = parseInt(process.argv[2], 10);
const scriptArg = process.argv[3];

if (!N || !scriptArg) {
  console.error("Usage: node run_multiple.js <num_runs> <k6_script.js>");
  process.exit(1);
}

const scriptPath = path.resolve(scriptArg);
console.log("Using k6 script:", scriptPath);

const outDir = path.resolve(__dirname, "k6_results");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
  console.log("Created results directory:", outDir);
}

for (let i = 1; i <= N; i++) {
  console.log("**********************************");
  console.log(`Run ${i} of ${N}`);
  console.log("**********************************");

  const summaryPath = path.join(outDir, `run_${i}.json`);
  const cmd = `k6 run "${scriptPath}" --summary-export "${summaryPath}"`;

  console.log("Running:", cmd);
  execSync(cmd, { stdio: "inherit" });

  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, 5000);
}

console.log(`\nSaved ${N} summary files in ${outDir}`);
