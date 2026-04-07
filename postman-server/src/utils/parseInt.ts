
// Coerces optional pagination query params; invalid or missing values fall back to defaults.
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export { parsePositiveInt };