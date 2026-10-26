# Govee Lights Visualizer — lead-gen site

A landing page you can send ad traffic to. Visitors enter **name, email, phone and home address**. The site pulls up their house on Google Street View and creates **three AI images of it at dusk with Govee Permanent Outdoor Lights Pro on the roofline**: Warm White, Holiday and Multicolor. They can watch the looks appear on the page, or close it: when the images are ready, they get them by **email** either way (and by **text message** too once texting is switched on).

```
form submit ──► lead saved (SQLite) ──► Geocoding ──► Street View photo, aimed straight at the house
                                                         │      (or the visitor's own photo)
                                                         ▼
                                  AI render × 3 themes, in parallel (Gemini "Nano Banana")
                                                         │
                         ┌───────────────────────────────┼──────────────────────────────┐
                         ▼                               ▼                              ▼
             shows up live on the page       text with picture + link        email with all 3 looks
```

Every design has its own private link (`/d/<id>`). That's what the text and email point to, so someone who left the page can open it later on their phone, flip between the three looks and drag the before/after slider.

## How the house photo is found from just an address

Three **Google Maps Platform** APIs:

1. **Places API (New)**: address autocomplete as the visitor types.
2. **Geocoding API**: turns the address into the house's coordinates (rooftop-accurate for most US homes).
3. **Street View Static API**: finds the panorama closest to the house. That's normally the spot on the street right in front of it. The code then:
   - points the camera at the house using the compass bearing from that spot to the house,
   - tilts it up slightly so the roofline is in frame,
   - sets the zoom from the distance, so a house 10 m away gets a wide shot and one 40 m back gets zoomed in.

   The result is a 640×480 shot of the house head-on (`src/streetview.ts`).

If Google has no street photo of the address (rural roads, private drives, new builds), the page asks for a photo instead. Visitors can also tap "Not your house? Upload a photo" at any time. Uploads are re-encoded, stripped of location data, and rejected if they aren't real images.

## How the lights are drawn

The house photo goes to an AI image-editing model with an installer-style brief (`src/themes.ts`):

- one run of separate point lights under the eaves, following every roofline edge and gable,
- **evenly spaced about `LIGHT_SPACING_INCHES` apart** (default 12; match it to your kit),
- explicitly *not* a continuous strip or rope light,
- dusk lighting, and nothing else about the house changed.

| Provider | Setting | Notes |
|---|---|---|
| **Google Gemini** (recommended) | `GEMINI_API_KEY` | `gemini-2.5-flash-image` is fast and cheap. `gemini-3-pro-image-preview` is higher quality. |
| OpenAI | `OPENAI_API_KEY` | `gpt-image-1` image edits |
| Mock | no key | Darkens the photo and draws dots. For trying the site and load tests for free. |

To change the three looks, edit `THEMES` in `src/themes.ts`. Every theme is one more AI image per lead.

## Email now, text messages later

**Email is on as soon as `SMTP_URL` and `EMAIL_FROM` are set. Texting stays off until `SMS_ENABLED=true`.** You can enter the Twilio settings while A2P registration is pending; nothing is texted until you flip the switch. The page only promises the channels that are actually on ("We'll email your 3 designs to you").

As soon as all three looks are done (or as many as succeeded), the visitor gets:

- **Text (Twilio, once `SMS_ENABLED=true`):** a picture message with the Warm White image plus a link to see all three looks, your phone number, and "Reply STOP to opt out" (Twilio handles opt-outs automatically).
- **Email (any SMTP provider):** all three images inline, a "See my design" button, and your phone number.

Each design is texted and emailed **at most once**, even across restarts. The result (`sent`, `failed` or `disabled`) is saved on the design and shown on the page, so it never claims a message went out when it didn't.

**If the server restarts mid-render**, everything resumes from the database on startup and the visitor still gets their text and email. Closing the page never cancels anything.

## Handling 10, 100 or more visitors at once

- Rendering is network waiting, not CPU work, so one Node process can hold hundreds of visitors.
- The real limit is your AI provider's rate limit. A queue caps simultaneous AI calls (`MAX_CONCURRENT_GENERATIONS`). Everyone else waits in order and sees their place in line ("You're #4 in line").
- Rate limits and server errors from the provider are retried with backoff, so a rush makes previews slower rather than failing them.
- **Each visitor's first look jumps the line** ahead of everyone's second and third, so in a rush every visitor sees something on screen quickly and the rest fill in behind it.
- **Each visitor = 3 AI images.** Throughput ≈ `MAX_CONCURRENT_GENERATIONS × 60 / seconds-per-image / 3` visitors per minute. At 10 concurrent and ~15 s per image, that's ~13 visitors fully served per minute. Raise the setting as your Gemini tier allows.
- Measured with the mock renderer (3 s per image, 10 at a time), 100 visitors submitting at the same instant: **100/100 got all three looks**. Their first look arrived after 24 s for the typical visitor and 42 s for the last one; all three were done within 112 s. With real Gemini renders (~15 s each), multiply by about 5. That's why the page tells people they can leave and get the results by text. The automated tests also check that all 100 are texted and emailed exactly once (against fake Twilio/SMTP).

  ```bash
  TRUST_PROXY=1 IMAGE_PROVIDER=mock MOCK_DELAY_MS=3000 npm start      # terminal 1 (no Twilio/SMTP!)
  npm run loadtest -- --url http://localhost:3000 --visitors 100        # terminal 2
  ```

- Abuse and cost protection: per-IP rate limits, a hidden honeypot field against bots, and `MAX_DESIGNS_PER_LEAD` (default 3 designs = 9 images per person).

**Scaling past one server:** the queue and images live on one machine (the database survives restarts). One instance handles a lot of traffic. To run several, move the queue to Redis/BullMQ and the images to S3/R2.

## Your leads

- Saved to `DATA_DIR/leads.db` the moment the form is submitted, **before** any image work. A failed render never loses a lead.
- `https://your-site/admin/leads.csv` downloads every lead with a link to their design (set `ADMIN_PASSWORD`; any username works).
- `LEAD_WEBHOOK_URL` gets `lead.created` instantly and `design.completed` with the image links and whether the text/email went out. Use it to push into GoHighLevel, HubSpot, Zapier, etc.
- UTM source/medium/campaign and referrer are stored with each lead. The page fires `lead_submitted` / `preview_shown` to GTM/GA4 (`dataLayer`) and Meta Pixel (`fbq`) if present.

## Run it locally

Node 22.13+.

```bash
cd govee-visualizer
npm install
cp .env.example .env        # runs with no keys (demo mode, upload-only, no texts/emails)
npm run dev                 # http://localhost:3000
npm test
```

## Go live

1. **Google Cloud**: enable *Geocoding API*, *Street View Static API*, *Maps JavaScript API* and *Places API (New)*. Create a **server key** limited to Geocoding + Street View Static, and a **browser key** limited to Maps JS + Places and restricted to your domain.
2. **Gemini key** from https://aistudio.google.com/apikey, on a paid tier.
3. **Twilio (later)**: buy a number and complete **A2P 10DLC registration** (or toll-free verification). US carriers block unregistered business texting. When approved, add the Twilio settings and set `SMS_ENABLED=true`.
4. **Email**: any SMTP provider. Verify your sending domain (SPF/DKIM) so the emails don't land in spam.
5. **Privacy policy**: set `PRIVACY_URL`. It's linked under the form and in the footer, and Google/Meta ads expect it.
6. **Deploy** the Dockerfile to a host with a persistent disk at `/data` (Render, Railway, Fly.io…). Set `PUBLIC_BASE_URL=https://your-domain` (texts need https) and `TRUST_PROXY=1`.

Rough cost per lead: Google Maps ≈ $0.01, Gemini Flash Image ≈ $0.04 × 3 looks ≈ $0.12, text ≈ $0.02 (picture messages cost more than plain texts), email ≈ free. **About $0.15–0.20 per lead.** Check current pricing pages.

## Before you run ads

- **Google Maps terms.** Google Maps Platform restricts modifying Street View imagery and creating derivative content from it. Have someone review the current terms for this use. If it's a problem, run without `GOOGLE_MAPS_SERVER_KEY` and visitors upload their own photo.
- **Texting leads (TCPA).** The form has an express-consent checkbox covering texts. Have the wording reviewed before launch.
- **Govee branding.** The footer says you're an independent installer. Check Govee's guidelines if you're an authorized dealer.

## Layout

```
src/server.ts        startup, resume unfinished work, graceful shutdown
src/app.ts           HTTP routes, security headers, rate limits, uploads
src/designs.ts       the pipeline: locate → 3 renders → text + email
src/designStore.ts   design progress in SQLite (survives restarts)
src/streetview.ts    Geocoding + Street View, camera aimed and zoomed at the house
src/providers/       gemini, openai, mock + retry/backoff
src/themes.ts        the three looks and the AI prompt
src/notify.ts        Twilio text + SMTP email
src/leads.ts         lead store, CSV export, webhook
src/queue.ts         bounded-concurrency job queue
public/              the page (plain HTML/CSS/JS); /d/<id> is the shareable design page
scripts/loadtest.ts  N simultaneous visitors
```
