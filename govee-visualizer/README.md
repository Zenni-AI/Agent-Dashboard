# Govee Lights Visualizer — lead-gen site

A landing page you can send ad traffic to. Visitors enter **name, email, phone and home address**, and about 30 seconds later they see **their own house at dusk with Govee Permanent Outdoor Lights Pro on the roofline**, with a before/after slider, color themes to try, and a "get a quote" call to action. Each submission is saved as a lead.

```
Visitor types address ──► Google Geocoding ──► Street View (camera aimed at the house) ──┐
        or uploads a photo ─────────────────────────────────────────────────────────────┤
                                                                                        ▼
                                                   AI image edit (Gemini "Nano Banana")  ──► before/after preview
Lead saved instantly to SQLite (+ optional webhook to your CRM) ◄── form submit
```

## How the house photo is found from just an address

This uses three **Google Maps Platform** APIs:

1. **Places API (New)**: address autocomplete as the visitor types, so the address is real and spelled right.
2. **Geocoding API**: converts the address to the house's coordinates (rooftop-accurate for most US homes).
3. **Street View Static API**: finds the nearest street-level panorama, computes the compass bearing from that camera to the house, and requests a photo **pointed at the house** (`src/streetview.ts`).

If Google has no street photo (rural roads, private drives, new builds), or the visitor says "not my house", they upload their own photo instead. Photos are re-encoded server-side, EXIF/GPS data is stripped, and anything that isn't a real image is rejected.

## How the lights are added

The house photo plus a detailed installation prompt (`src/themes.ts`) go to an AI image-editing model. The prompt specifies evenly spaced point lights under the eaves following every roofline, the color theme, the dusk setting, and "change nothing else".

| Provider | Setting | Notes |
|---|---|---|
| **Google Gemini** (recommended) | `GEMINI_API_KEY` | `gemini-2.5-flash-image` is fast and cheap. Try `gemini-3-pro-image-preview` for higher quality. |
| OpenAI | `OPENAI_API_KEY` | `gpt-image-1` image edits |
| Mock | no key needed | Darkens the photo and draws dots on it. For trying the site and load testing for free. |

Themes: Warm White, Holiday, Halloween, Red/White/Blue, Rainbow, Winter Ice. Edit `THEMES` in `src/themes.ts` to add more.

## Handling 10, 100 or more visitors at once

- Rendering is waiting on network calls, not CPU work, so one Node process can hold hundreds of visitors at once.
- The real limit is your **AI provider's rate limit**. A job queue (`src/queue.ts`) caps how many renders hit the provider simultaneously (`MAX_CONCURRENT_GENERATIONS`). Everyone else waits in first-come order, and the page shows "3 people ahead of you".
- Rate-limit (429) and server errors from the provider are retried with exponential backoff, so a burst of visitors makes previews slower rather than making them fail.
- Measured with the included load test: **100 simultaneous visitors → 100/100 previews delivered, no errors**, never more than 10 renders in flight.

  ```bash
  TRUST_PROXY=1 IMAGE_PROVIDER=mock MOCK_DELAY_MS=3000 npm start      # terminal 1
  npm run loadtest -- --url http://localhost:3000 --visitors 100        # terminal 2
  ```

- **Throughput ≈ `MAX_CONCURRENT_GENERATIONS × 60 / seconds per render`.** At 10 concurrent and ~15s per Gemini render, that's ~40 previews per minute. Raise the setting once your provider tier allows more requests per minute.
- Spam and cost protection: per-IP rate limits, a hidden honeypot field against bots, and `MAX_RENDERS_PER_LEAD` (default 5) to cap the AI spend per visitor.

**Scaling past one server:** the queue and image files live on one machine. One instance is plenty for a lot of traffic. To run several instances behind a load balancer, move the queue to Redis (BullMQ) and the images to S3/R2. Those are the two swaps needed.

## Your leads

- Every submission is written to `DATA_DIR/leads.db` (SQLite) **before** any image work starts, so you keep the lead even if a render fails.
- Download them all: `https://your-site/admin/leads.csv` (set `ADMIN_PASSWORD`; any username works).
- Set `LEAD_WEBHOOK_URL` (Zapier, Make, GoHighLevel, HubSpot…) to receive a `lead.created` event instantly and a `render.completed` event with the before/after image links. You can text the visitor their render.
- Each lead records its UTM source/medium/campaign and referrer, so you can see which ads convert.
- The page pushes `lead_submitted` / `preview_shown` events to `dataLayer` (GTM/GA4) and calls `fbq` (Meta Pixel) if they're on the page.

## Run it locally

Requires Node 22.13 or newer.

```bash
cd govee-visualizer
npm install
cp .env.example .env        # works with no keys at all (demo mode, upload-only)
npm run dev                 # http://localhost:3000
npm test
```

## Go live

1. **Google Cloud**: create a project with billing, then enable *Geocoding API*, *Street View Static API*, *Maps JavaScript API*, and *Places API (New)*. Make two keys: a **server key** limited to Geocoding and Street View Static, and a **browser key** limited to Maps JS and Places, restricted to your domain by HTTP referrer.
2. **Gemini key**: get one from https://aistudio.google.com/apikey on a paid tier (the free tier's rate limits are far too low for ads).
3. **Deploy** the Dockerfile to any host with a **persistent disk** mounted at `/data`, e.g. Render, Railway or Fly.io. Set the variables from `.env.example`, plus `TRUST_PROXY=1` and `PUBLIC_BASE_URL`.
4. Point your domain at it and send traffic.

Rough cost per lead: Geocoding + Street View ≈ $0.01, Gemini Flash Image ≈ $0.04 per render. Check the current pricing pages.

## Things to check before running ads

- **Google Maps terms.** Google Maps Platform's terms restrict modifying Street View imagery and creating derivative content from it. Have someone review the current terms for this use. If it's a problem, run with `GOOGLE_MAPS_SERVER_KEY` unset: visitors then upload their own photo (address autocomplete still works).
- **Texting and calling leads (TCPA).** The form includes an express-consent checkbox. Have the wording reviewed for your state before you text or auto-dial.
- **Govee branding.** The footer says you're an independent installer. If you're an authorized dealer, check Govee's guidelines for using their name.

## Layout

```
src/server.ts        startup + graceful shutdown (finishes in-flight renders)
src/app.ts           HTTP routes, security headers, rate limits, uploads
src/queue.ts         bounded-concurrency job queue
src/render.ts        address/photo → house image → AI → saved before/after
src/streetview.ts    Geocoding + Street View, camera aimed at the house
src/providers/       gemini, openai, mock + retry/backoff
src/themes.ts        light themes and the AI prompt
src/leads.ts         SQLite lead store, CSV export, webhook
public/              the landing page (plain HTML/CSS/JS)
scripts/loadtest.ts  N simultaneous visitors
```
