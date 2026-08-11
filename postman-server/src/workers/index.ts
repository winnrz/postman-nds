// `worker.entry` is deliberately not re-exported: it starts the poll loop as an
// import side effect, so pulling it into this barrel would spawn a worker inside
// any process that imports from `workers/` (the API included).
export * from "./worker";
export * from "./worker.util";
export * from "./rateLimiter";