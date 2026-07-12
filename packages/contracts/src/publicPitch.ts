import { z } from 'zod';

/**
 * Minimal projection returned by the public pitch endpoint.
 * Must never include precise location, phone, email, legal name,
 * or verification artifacts (FRIENDWORD_HANDOFF.md, "API 경계").
 */
export const publicPitchSchema = z.object({
  campaignSlug: z.string().min(1),
  daterDisplayName: z.string().min(1),
  approximateLocation: z.string().optional(),
  audioUrl: z.string().url(),
  captions: z.array(z.object({ startMs: z.number().int().min(0), text: z.string() })),
  photoUrls: z.array(z.string().url()).min(1),
  status: z.enum(['published', 'paused', 'expired']),
});

export type PublicPitch = z.infer<typeof publicPitchSchema>;
