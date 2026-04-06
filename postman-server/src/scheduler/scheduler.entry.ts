
import { startScheduler } from "./scheduler";

const INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS ?? "60000");

console.log(`[scheduler] starting — interval: ${INTERVAL_MS}ms`);

startScheduler(INTERVAL_MS).catch((error) => {
  console.error("[scheduler] fatal error, exiting", error);
  process.exit(1);
});