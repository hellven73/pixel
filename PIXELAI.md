# Deploy PixelAI

PixelAI lives in this release repository. The existing Pages workflow still builds the pinned Arcade source. It then adds PixelAI, updates the existing AI navigation, and removes the Puter chat from the published Arcade. The separate Portal and its existing Assistant use their original code.

## 1. Create the free accounts

1. Sign up for [Cloudflare](https://dash.cloudflare.com/sign-up) and use **Workers Free**. The Worker uses SQLite-backed Durable Objects for quota accounting. No paid SQL database is needed.
2. Sign up for [GroqCloud](https://console.groq.com/keys) and create a key in a Free-tier organization. Confirm your tier before creating the key. If the organization is upgraded later, remove its key from PixelAI first. Groq applies its plan to the entire organization and the same model IDs can be billed on Groq’s paid tier. [Groq billing and plans](https://console.groq.com/docs/billing-faqs), [model limits](https://console.groq.com/docs/rate-limits)
3. Optionally create an [OpenRouter API key](https://openrouter.ai/keys) for fallback or deployments without Groq. Leave the account unfunded. The Worker sends only `openrouter/free` to this provider. An unfunded account is typically limited to 50 free requests a day and 20 per minute, subject to provider policy. [OpenRouter free models](https://openrouter.ai/collections/free-models/)
4. In Cloudflare **Turnstile**, add a **Managed** widget. Enter both hostnames `pixelarcade.com.au` and `hellven73.github.io`. Copy its public **site key** and keep its separate **secret key** private. [Turnstile widget settings](https://developers.cloudflare.com/turnstile/concepts/widget/)

## 2. Deploy the API

Open a terminal in this repository with Node.js 24 and run:

```sh
npm ci --ignore-scripts
npx wrangler login
npx wrangler deploy --config worker/pixelai/wrangler.toml
npx wrangler secret put TURNSTILE_SECRET --config worker/pixelai/wrangler.toml
npx wrangler secret put SESSION_SECRET --config worker/pixelai/wrangler.toml
npx wrangler secret put GROQ_API_KEY --config worker/pixelai/wrangler.toml
npx wrangler secret put OPENROUTER_API_KEY --config worker/pixelai/wrangler.toml
```

Use at least one provider. Skip the secret command for a provider you did not choose. Generate a new random session secret with `openssl rand -hex 32` or a password manager. Paste each value into its local Wrangler prompt. The first deploy is disabled for inference until the required secrets exist. Keep the provider keys out of GitHub, frontend files and chat messages. [Wrangler secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

Keep the Worker URL Wrangler prints. The default allowlist in `worker/pixelai/wrangler.toml` covers both published origins. An origin contains a scheme and hostname, with no path or trailing slash. The global limit defaults to 45 upstream attempts per UTC day. Each call, including fallback or provider errors, uses one attempt. The Worker additionally applies per-IP, per-provider and per-model limits. Arena sends two independently metered requests. Lower the limits in `[vars]` if you share provider keys or have lower account quotas, then redeploy.

## 3. Publish to GitHub Pages

1. In `hellven73/pixel`, open **Settings → Secrets and variables → Actions → Variables**.
2. Create `PIXELAI_ENDPOINT` with the Worker URL and `PIXELAI_SITE_KEY` with your public Turnstile site key. These two values are intentionally public. The static `pixelai/config.js` also accepts them if you prefer to configure them in source.
3. Confirm **Settings → Pages → Build and deployment → Source** is **GitHub Actions**. Merge the feature PR after review. If you set the variables after merging, rerun **Deploy Pixel Arcade** from the Actions tab.
4. Open [PixelAI on GitHub Pages](https://hellven73.github.io/pixel/ai/) and verify the PixelAI shortcut from [Arcade](https://hellven73.github.io/pixel/arcade/). Try a short message, refresh, and reopen its chat.

## 4. Publish on pixelarcade.com.au

The live Arcade uses a Render origin. The optional Cloudflare Worker serves the same PixelAI assets and updates the existing Arcade navigation and manual at the edge. It keeps Render as the origin and does not require updating or deploying the `pixel-portal` repository.

1. In Cloudflare, add `pixelarcade.com.au` on the Free plan, copy all existing DNS records (including mail or verification records), and follow Cloudflare's nameserver instructions at your registrar. Verify that Cloudflare has activated the zone. Keep the current Render target and use a **Proxied** record for the apex. Use **Full (strict)** SSL and confirm the homepage and account flows still work before adding Worker routes. [Add a site to Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/), [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
2. Set the two public values in `pixelai/config.js` or set `PIXELAI_ENDPOINT` and `PIXELAI_SITE_KEY` in the terminal environment. Build and publish:

   ```sh
   npm run build:edge
   npx wrangler deploy --config worker/custom-domain/wrangler.toml
   ```

3. Visit [PixelAI on the custom domain](https://pixelarcade.com.au/ai/) and the [Arcade](https://pixelarcade.com.au/arcade/). Verify the shared AI allowance, legacy AI shortcut, one local game and an existing account operation on both sites. Keep the repository’s existing Vercel deployment path separate if you use it to preview a branch. It can build from the same feature with the same public environment variables.
4. To undo the edge change, remove the `pixelai-custom-domain` Worker’s routes in Cloudflare. Requests will continue going directly to the current Render origin.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| “Chat service setup is pending” | Check the frontend’s two public variables, required Worker secrets and deployed Worker URL. Rebuild after changing the frontend variables. |
| Origin denied | Make sure the full frontend origin is in `ALLOWED_ORIGINS` and redeploy. A GitHub Pages project path like `/pixel/` is not part of the origin. |
| Turnstile loops or fails | Check the widget hostname list, matching keys, and that your network can load `challenges.cloudflare.com`. |
| Free quota reached | Try again after the UTC date changes, or check Groq or OpenRouter limits. The Worker never switches to a paid route. |
| New AI page works on Pages but returns 404 on the custom domain | Check that the Cloudflare zone is active, the domain DNS record is proxied, and the edge Worker is installed on its listed routes. |
| PDF attachments have no text | Select a text-based PDF under 3 MB. PixelAI extracts up to seven pages and sends only the attached excerpt. Scans need OCR elsewhere. |

Chats and custom personas are stored in the current browser and origin. Temporary chats and the Studio editor are session-only. PixelAI sends chat excerpts and attachments only when you submit them. Cloudflare quota storage records counts and daily-rotating IP pseudonyms, with no message content. Provider processing policies apply. The Studio frame can execute project code in an opaque origin. Its policy blocks fetches and external resources; run only project code you trust and inspect files before using them outside Studio. Image analysis, web browsing, cross-device sync and a floating assistant are not included.

## Local checks

Run `npm test` for the API tests. The Pages pull-request workflow also runs Chromium against both platform layouts using a mocked verification and inference service. To run it locally, install Chromium with `npx playwright install chromium`, build the pinned Arcade Pages source, run `node pixelai-build.mjs <pages-output>` and `node build-vercel.mjs`, then set `PAGES_OUTPUT` to the generated Pages directory and run `npm run test:browser`. The browser fixtures never contact the AI providers.
