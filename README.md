# Knock

Knock is a private Product Hunt outreach desk. It ingests each Product Hunt day, filters launches against a project, researches official websites, finds source-backed public emails, drafts short messages, and waits for a human to press Send.

## Stack

- Next.js 16, React 19, TypeScript 6, Tailwind CSS 4, and current shadcn/ui components
- Clerk authentication with Convex JWT validation
- Convex Cloud database, actions, cron jobs, and HTTP webhooks
- AI SDK v6 with DeepSeek V4 Pro; one direct MiniMax M3 batch request through OpenCode Go per sync
- TinyFish Fetch/Search with Firecrawl Scrape and Agent fallbacks
- Nodemailer over Spaceship Spacemail SMTP from a Vercel Node.js route

TypeScript 7.0 is not used because the parser shipped with the current Next.js 16 lint stack rejects the TypeScript 7.0 API. `6.0.3` is the latest compatible stable release.

## Setup

1. Install packages with `npm install`.
2. Create a Clerk app, activate its Convex integration, and copy the Clerk Frontend API URL.
3. Run `npx convex dev`, select a Convex Cloud project, and keep the generated `CONVEX_DEPLOYMENT` plus `NEXT_PUBLIC_CONVEX_URL` values in `.env.local`.
4. Copy the Vercel/local values from `.env.example` into `.env.local`.
5. Set every Convex-side secret shown below with `npx convex env set NAME value` on both development and production deployments.
6. Run `npm run dev`.

Product Hunt restricts commercial API use. Obtain Product Hunt approval if this deployment falls under that restriction.

## Environment

### Vercel and `.env.local`

| Variable                            | Purpose                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk browser key                                                        |
| `CLERK_SECRET_KEY`                  | Clerk server key                                                         |
| `NEXT_PUBLIC_CONVEX_URL`            | Convex client URL                                                        |
| `SPACEMAIL_SMTP_HOST`               | Use `mail.spacemail.com` unless Spacemail gives the mailbox another host |
| `SPACEMAIL_SMTP_PORT`               | `465` for implicit TLS; `587` also works when enabled for the mailbox    |
| `SPACEMAIL_SMTP_USER`               | Existing primary Spacemail mailbox login                                 |
| `SPACEMAIL_SMTP_PASSWORD`           | Existing mailbox password or app password                                |
| `SPACEMAIL_ALLOWED_SENDERS`         | Comma-separated exact aliases allowed in the `From` header               |
| `CONVEX_DEPLOY_KEY`                 | Optional production deploy key for `npm run vercel:build`                |

The project sender can be a Spacemail alias. Its root domain must match the project domain. The SMTP login remains the existing primary mailbox, so the alias does not need a separate mailbox.

### Convex Cloud

| Variable                   | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `CLERK_JWT_ISSUER_DOMAIN`  | Clerk Frontend API URL used by `convex/auth.config.ts`       |
| `PRODUCT_HUNT_TOKEN`       | Product Hunt developer token for GraphQL v2                  |
| `OPENCODE_GO_API_KEY`      | OpenCode Go key for MiniMax M3                               |
| `DEEPSEEK_API_KEY`         | DeepSeek Platform key; calls go to `api.deepseek.com`        |
| `TINYFISH_API_KEY`         | TinyFish Fetch and Search key                                |
| `FIRECRAWL_API_KEY`        | Firecrawl v2 key for Crawl, Scrape, Agent, and Monitor       |
| `FIRECRAWL_WEBHOOK_SECRET` | HMAC secret from Firecrawl's Advanced settings               |
| `CONVEX_SITE_URL`          | Production Convex HTTP Actions URL, ending in `.convex.site` |
| `KNOCK_ALLOWED_USER_IDS`   | Clerk user IDs allowed to use the backend, comma-separated   |

Set production variables against the production deployment, for example:

```bash
npx convex env set PRODUCT_HUNT_TOKEN ph_replace_me --prod
npx convex env set DEEPSEEK_API_KEY replace_me --prod
npx convex env set CONVEX_SITE_URL https://replace-me.convex.site --prod
```

## Pipeline

Convex schedules fixed UTC times because Pakistan Standard Time stays at UTC+5:

| PKT      | UTC   | Work                                                  |
| -------- | ----- | ----------------------------------------------------- |
| 2:45 PM  | 09:45 | Main Product Hunt sync and one MiniMax metadata batch |
| 3:05 PM  | 10:05 | Queue drafts for completed research                   |
| 11:45 PM | 18:45 | Optional per-project late sync for unseen launches    |
| 12:00 AM | 19:00 | Remove expired skipped draft content                  |

The GraphQL query omits the `featured` argument, uses Product Hunt day boundaries, and follows every cursor. RSS runs only after an API failure. Convex deduplicates by Product Hunt ID, canonical website URL, then Product Hunt URL.

Each retained launch gets its own action. TinyFish fetches the homepage and up to four useful same-domain pages. Firecrawl Scrape retries weak or failed results. Contact extraction checks page text, `mailto:` links, metadata, JSON-LD, and mild obfuscation. TinyFish Search only contributes official-domain pages. The database allocates at most five Firecrawl Agent contact runs per PKT calendar day across every project. A run uses `maxCredits: 100`; failure leaves the launch at No email rather than buying another run. Do not share this Firecrawl key with another process if the account-wide free-run count must match Knock's counter.

DeepSeek drafting uses `deepseek-v4-pro`, thinking enabled, and `reasoning_effort: "high"`. Structured output passes through Zod. The system prompt treats scraped content as untrusted data and includes the repository's `stop-slop` constraints.

## Monitoring

Enabling weekly monitoring creates a Firecrawl website Monitor with meaningful-change judging and a signed callback to `/firecrawl-monitor` on the Convex HTTP Actions site. Knock fetches the completed check, sends only meaningful diffs plus existing context to DeepSeek, and writes a new context version. Settings can inspect or restore any version.

## Sending

The browser posts only a draft ID to `src/app/api/send/route.ts`. That route authenticates the Clerk session, reserves a Convex delivery attempt, then sends plain text over authenticated Spacemail SMTP. SMTP credentials never enter Convex or browser bundles. Knock adds no tracking pixels, short links, or images. A successful provider response stores its message ID and advances the review queue.

Knock requires each project sender in `SPACEMAIL_ALLOWED_SENDERS`. If SMTP accepts a message but the function cannot confirm and persist the result, Knock marks the outcome unknown and blocks automatic retries. Check Spacemail's Sent folder before taking further action.

## Deploy

1. Run `npx convex deploy` and set production Convex environment variables.
2. Import this repository into Vercel and add the Vercel variables above.
3. Use `npm run build` when Convex deploys separately. Use `npm run vercel:build` only when Vercel has `CONVEX_DEPLOY_KEY` and should deploy Convex before Next.js.
4. Add the Vercel production URL to Clerk's allowed origins and redirect URLs.
5. Disable public sign-up in Clerk and set the owner's Clerk ID in `KNOCK_ALLOWED_USER_IDS`.
6. Verify Firecrawl created monitors point to the production `.convex.site/firecrawl-monitor` URL.

## Commands

```bash
npm run dev
npm run format
npm run lint
npm run typecheck
npm test
npm run build
```

Useful failures stay attached to their launch or sync run. One failed scrape or draft does not discard other launches. Repeated schedules reuse run keys and database uniqueness checks, so they do not duplicate launches, drafts, or sent state.
