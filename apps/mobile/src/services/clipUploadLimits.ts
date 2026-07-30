import Constants from 'expo-constants';
import { z } from 'zod';

import { DEFAULT_CLIP_MAX_BYTES } from './types';

const extraSchema = z.object({
  videoMaxBytes: z.coerce.number().int().positive(),
});

/**
 * The configured clip byte ceiling, or {@link DEFAULT_CLIP_MAX_BYTES}.
 *
 * `app.config.ts` mirrors `FRIENDWORD_VIDEO_MAX_BYTES` into `extra` so both
 * sides read one env name. A missing or unusable value falls back to the default
 * rather than to "no limit": an app that cannot read the ceiling must still
 * refuse the uploads the server would.
 *
 * Isolated in its own module because it reaches for `expo-constants`, which pulls
 * in React Native — the picker model that consumes the value stays importable on
 * its own.
 */
export function getClipMaxBytes(): number {
  const parsed = extraSchema.safeParse(Constants.expoConfig?.extra);
  return parsed.success ? parsed.data.videoMaxBytes : DEFAULT_CLIP_MAX_BYTES;
}
