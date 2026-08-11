// Templates use `{{variable}}` placeholders filled from a notification's
// `metadata` map (plus the built-in `recipientId`). Rendering happens once, at
// create time, so the stored notification row holds the exact text the worker
// will hand to the provider.
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export type RenderedTemplate = {
  text: string;
  /** Placeholders with no matching variable, in first-seen order. */
  missing: string[];
};

/** Every distinct placeholder name used by a template, in first-seen order. */
export function extractTemplateVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    seen.add(match[1]);
  }
  return [...seen];
}

export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): RenderedTemplate {
  const missing: string[] = [];

  const text = template.replace(PLACEHOLDER_PATTERN, (placeholder, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      // Leave the placeholder intact so an unrendered value is obvious if this
      // ever reaches a provider; callers reject on `missing` before that.
      if (!missing.includes(name)) missing.push(name);
      return placeholder;
    }
    return value;
  });

  return { text, missing };
}
