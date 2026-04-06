import { runWorkerLoop } from ".";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "1000");

console.log(`[worker] starting — id: ${process.env.WORKER_ID ?? "worker-1"}, interval: ${POLL_INTERVAL_MS}ms`);

runWorkerLoop(POLL_INTERVAL_MS).catch((error) => {
  console.error("[worker] fatal error, exiting", error);
  process.exit(1);
});