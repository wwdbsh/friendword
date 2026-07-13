# Friendword

> **Dating, in your friends' words.**

Friendword is an 18+ friend-led dating campaign app that turns a friend's 30–60 second voice recommendation and dater-approved photos and copy into a shareable vertical motion pitch, then lets a verified viewer express interest and enter a safe in-app conversation after the dater accepts.

## Why this is not another dating app

Friendword has no public profile feed or infinite swipe loop in its MVP. Discovery begins with campaign links shared through existing networks such as Instagram, TikTok, iMessage, and WhatsApp. The product's center is a consented, share-first voice campaign, not a friend quote attached to a conventional dating marketplace.

Five boundaries define the product: the introducer's original voice is the emotional center; the result is an externally shareable vertical motion pitch; the dater must pass identity/face checks and approve every item before publication; anyone may view without signing up but only an adult with a verified photo and profile may express interest; campaign URLs and referral attribution come before an in-app discovery feed.

## One user, contextual roles

Friendword has one `User` identity per person, not separate Creator, Dater, or Interested Person account types. The same user can be an **Introducer** for one resource, a **Dater** for another campaign, and an **Interested Person** for a third. The entry link, action, ownership, and resource membership determine the current context. “Creator” is only the marketing name in the Creator Launch product.

The end-to-end flow is:

1. An Introducer privately proposes photos, records a 30–60 second original voice recommendation, reviews an AI-structured draft, and sends a consent request.
2. The Dater claims the invitation, completes required adult/identity checks, edits or approves each photo, phrase, audio item, audience, and duration, and publishes the first campaign URL.
3. Anyone can view the pitch without an account. A viewer who selects **I'm interested** must sign in and provide current photos, a short bio, age, approximate location, dating intent, phone verification, and the required identity check.
4. The Dater accepts, declines, or reports the interest. Acceptance opens a private text-only Intro Room; contact details are shared only if both people later choose to do so.

## Repository layout and current state

pnpm monorepo: `apps/mobile` (Expo), `apps/web` (Next.js 15), `packages/{domain,contracts,config,ui-tokens,data,adapters}`, `supabase/` (migrations 0001–0023, all state transitions behind SECURITY DEFINER RPCs). Web surfaces: the acquisition landing `/`, public pitch `/p/[slug]` (+ `/api/og` campaign image), interest flow, consent flow `/consent/[token]`, inbox with campaign management and Campaign Pass funnel, intro rooms, the Creator Launch kit `/kit/[draftId]`, and the APIs `/api/transcribe`, `/api/revenuecat`, `/api/media/validate`, `/api/report`.

**Current verdict (second audit, 2026-07-13): functional beta.** The product is not ready for an external beta, real payments, or Grand Prize submission. [`docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md`](docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md) is the acceptance source of truth; real payments and public interest submission are blocked server-side by the launch gates in migration 0023 until its Slice 10 release gate passes. The first audit and its resolution are recorded in [`docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`](docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md); working status lives in [`docs/SESSION_HANDOFF.md`](docs/SESSION_HANDOFF.md) and [`docs/TASKS.md`](docs/TASKS.md).

## Local development

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
bash scripts/test-db.sh          # migrations + DB/RLS suites 01–17 on local PostgreSQL 17
bash scripts/test-db-audit.sh    # audit regression suite (7 files)
pnpm test:audit                  # DB audit runner + webhook contract suite (first audit, green)
pnpm test:audit2                 # second-audit regression suite (red by design until Slices 1–9 land)
pnpm --filter @friendword/web test:e2e   # Playwright (reuses :3000, boots a dev server otherwise)
node scripts/e2e-production.mjs  # full-funnel E2E against hosted Supabase (mutating — advisor-run)
node scripts/export-growth-evidence.mjs  # anonymized aggregate metrics
```

CI runs lint/type/unit/format, the web production build, the webhook audit suite, the Playwright suite against a mocked-network dev server, and both DB harnesses on every push.

## Environment and secrets

Copy `.env.example` and treat it as the authoritative environment-variable list:

| Boundary                            | Variables                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Client-safe Supabase                | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Client-safe RevenueCat sandbox      | `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`                                                                                     |
| Server-only Supabase/RevenueCat     | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REVENUECAT_WEBHOOK_AUTH_TOKEN`                                             |
| Phone verification                  | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`                                                   |
| Identity/image provider credentials | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`                                                               |
| AI and analytics                    | `OPENAI_API_KEY`, `POSTHOG_API_KEY`                                                                                      |
| Local adapter selection             | `IDENTITY_PROVIDER`, `MODERATION_PROVIDER`                                                                               |

Never commit real credentials or user data. Keep client-safe identifiers separate from server-only keys; a service-role key must never reach a client. Use deployment secret stores for production and sandbox/test values for local work. Do not put phone numbers, emails, legal names, identity documents, photos, audio, message content, tokens, or secrets in logs, screenshots, fixtures, or Devpost assets.

## RevenueCat sandbox

Configure the `starter`, `creator_launch`, and `campaign_30d` offerings against sandbox products. `creator_launch_credit_499` is a repeatable consumable tracked by the server credit ledger, while `campaign_30d_1999` grants 30-day non-renewing campaign access and synchronizes its expiration through customer state and webhooks. Test purchase, webhook idempotency/replay, restore, expiration, and refund paths. Restore must not reissue an already-consumed Creator Launch credit. Production credentials and products must remain separate from sandbox configuration.

## Provider adapters and staged enforcement

Transcription, pitch structuring, and moderation run through provider adapters: with `OPENAI_API_KEY` set they call OpenAI for real; without it the affected endpoint answers 501 or records a `skipped` moderation verdict — nothing is ever faked into production data. Identity verification is deliberately `Unconfigured` and fails loudly until a liveness/face-match vendor is selected.

Two service-role switches in `app_config` stage the launch boundaries: `identity_enforcement` (when `on`, publish and interest submission require a passed `verification_checks` row plus a verified phone) and `media_validation_enforcement` (when `on`, only server-validated, moderation-passed media can finalize or submit). Both default to `off` until their provider keys exist; the regression suites already assert the enforced behavior. Never mark privacy, consent, moderation, identity, or payment work complete with mocks alone.

## Cost guardrail

The initial monthly cloud/API hard cap is **$200**. At 75% usage, reduce new free campaign slots; at 90%, stop high-cost work except paid and existing safety paths. Update [`docs/COST_MODEL.md`](docs/COST_MODEL.md) whenever an official provider price, usage assumption, product mix, fee, or cost observation changes: record the source URL, absolute verification date, revised per-campaign and monthly calculations, and the resulting operational decision.

## MVP scope

P0 includes one contextual user identity; private voice pitch drafting; Dater consent and identity/face verification; a 9:16 original-voice pitch; a public no-sign-up campaign link with share attribution; verified interest; a text-only Intro Room; RevenueCat sandbox purchase/restore/expiration; reporting, blocking, moderation, deletion, and analytics.

Post-hackathon P2 excludes an in-app discovery feed or recommendation engine, background/financial checks, video or photo chat, offline events and date scheduling, a global Introducer leaderboard, AI dating coaching or auto-replies, compatibility scores, and full contact syncing.

## Shipaton 2026

Friendword is being built for [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com/); see the [official announcement](https://www.revenuecat.com/blog/company/announcing-shipaton-2026/) and [`docs/HACKATHON_RULES.md`](docs/HACKATHON_RULES.md). As of **2026-07-12**, the status is **Final Official Rules pending**. Published pages disagree on prize amounts, so no prize value is treated as final. Recheck the official Rules, Overview, and Resources before relying on any competition requirement.
