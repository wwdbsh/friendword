import type { MockProviderOptions } from './types';

export async function simulateDelay(options: MockProviderOptions): Promise<void> {
  const delayMs = options.delayMs ?? 0;
  if (delayMs === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
