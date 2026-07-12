import { simulateDelay } from './delay';
import type { MockProviderOptions, ModerationProvider, ModerationResult } from './types';

const TEXT_CATEGORY_RULES = {
  harassment: /\b(hate|idiot|stupid)\b/i,
  sexual: /\b(explicit|nude)\b/i,
  violence: /\b(kill|weapon)\b/i,
} as const;

const IMAGE_CATEGORY_RULES = {
  explicit: /\b(explicit|nude)\b/i,
  violence: /\b(violence|weapon)\b/i,
} as const;

function evaluateCategories(
  value: string,
  rules: Readonly<Record<string, RegExp>>,
): ModerationResult {
  const categories = Object.entries(rules)
    .filter(([, pattern]) => pattern.test(value))
    .map(([category]) => category);

  return { allowed: categories.length === 0, categories };
}

export class MockModerationProvider implements ModerationProvider {
  readonly #options: MockProviderOptions;

  constructor(options: MockProviderOptions = {}) {
    this.#options = options;
  }

  async checkText(text: string): Promise<ModerationResult> {
    await simulateDelay(this.#options);
    return evaluateCategories(text, TEXT_CATEGORY_RULES);
  }

  async checkImage(storagePath: string): Promise<ModerationResult> {
    await simulateDelay(this.#options);
    return evaluateCategories(storagePath, IMAGE_CATEGORY_RULES);
  }
}
