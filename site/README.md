# Pristine Home Services — website

A plain static website. No build step, no framework, no npm install. Every page is a `.html`
file you can open in a text editor and change.

```
site/
├── index.html                 Home
├── about.html                 About
├── contact.html               Contact + main estimate form
├── thank-you.html             Shown after a form is sent (no-JS fallback)
├── 404.html
├── services/
│   ├── paver-restoration.html
│   ├── soft-washing.html
│   ├── concrete-washing.html
│   ├── seal-coating.html
│   └── holiday-lighting.html
├── assets/
│   ├── css/site.css           All styling. Brand colors are at the very top.
│   ├── js/site.js             Menu + form handling. FORM SETUP LIVES HERE.
│   └── img/                   Logo, favicon, and your photos
├── robots.txt
├── sitemap.xml
├── netlify.toml               Netlify deploy settings
└── vercel.json                Vercel deploy settings
```

---

## WHERE DO FORM SUBMISSIONS GO?

**Straight to your email inbox.** Nothing is stored on the website.

The chain is: visitor submits → the page sends it to **Web3Forms** → Web3Forms emails it to
`pristinecleannj@outlook.com` → you reply from your normal email. Usually lands in under
10 seconds.

Web3Forms is the mail carrier only. It does not host your site and it does not keep a
customer database — it takes the submission and emails it to the one address you verified.
The free plan covers 250 submissions a month, which is far more quote requests than a
company this size gets.

### It is not live yet — you have to do one thing

Right now the forms are in **demo mode**: they validate properly and show the success
message, but nothing is actually sent. That is deliberate — creating the access key
requires clicking a link in *your* email, which only you can do.

**To switch it on (takes about two minutes):**

1. Go to **https://web3forms.com**
2. Type `pristinecleannj@outlook.com` into the box and click **Create Access Key**
3. Check that inbox — Web3Forms sends you a key that looks like
   `a1b2c3d4-1234-5678-9abc-de1234567890`
4. Open `site/assets/js/site.js`. Line 22 reads:

   ```js
   var ACCESS_KEY = "REPLACE_WITH_YOUR_WEB3FORMS_ACCESS_KEY";
   ```

   Replace the text inside the quotes with your key. Keep the quotes.
5. Save and re-upload the site.

Send yourself a test submission afterwards. **Check your junk folder the first time** — mark
it "not junk" so future leads land in the inbox.

### What arrives in your email

Each lead comes through as one message containing:

| Field | Notes |
|---|---|
| Name | required |
| Phone | required, must be 10 digits |
| Email | required, must be a valid address |
| Town | required |
| Service | which of the five they picked |
| Property type | residential / commercial / HOA |
| Details | free text about the job |

The subject line tells you where it came from — e.g. `New Paver Restoration request —
pristinecleannj.com`, or `(home page)` / `(contact page)` for the general forms. Handy for
seeing which service is actually pulling leads.

### Sending leads to more than one place

- **Second inbox (e.g. a partner or an office address):** in your Web3Forms dashboard, add a
  CC address. No code change needed.
- **Text message alerts:** most carriers accept email-to-SMS. Add
  `6093791760@vtext.com` (Verizon), `@txt.att.net` (AT&T) or `@tmomail.net` (T-Mobile) as a
  CC in Web3Forms and every lead pings your phone.
- **A spreadsheet or CRM:** Web3Forms supports webhooks and Zapier. Point it at a Google
  Sheet if you want a running log of every lead.

### Spam protection

Two layers, already in place:

1. A hidden honeypot field (`botcheck`). Humans never see it; bots fill it in, and anything
   that fills it is silently discarded.
2. Web3Forms runs its own spam filtering server-side.

If junk ever gets through, turn on hCaptcha in the Web3Forms dashboard.

### If you would rather not use Web3Forms

Any of these work as a drop-in replacement — they all take a POST and email you:

- **Formspree** (formspree.io) — change `ENDPOINT` in `site.js` to your Formspree URL.
- **Netlify Forms** — if you host on Netlify, add `netlify` and `name="quote"` to each
  `<form>` tag; submissions then appear in the Netlify dashboard with email alerts, and you
  can delete the fetch logic in `site.js`.
- **A database instead of email** — if you outgrow the inbox and want a searchable lead
  table, that is a bigger change; say the word.

---

## Changing your details

Your phone number, email and address are written into each HTML page (search engines read
them there, so they cannot live in one JS file). To change one:

```bash
cd site
grep -rl "609-379-1760" . | xargs sed -i 's/609-379-1760/NEW-NUMBER/g'
grep -rl "+16093791760" . | xargs sed -i 's/+16093791760/+1NEWNUMBER/g'
```

Same idea for the email address. There is also a copy of the phone number in the two success
messages inside `assets/js/site.js`.

## Your logo

The header and footer show your logo as two pieces:

- **The house mark** — `assets/img/logo-mark.svg` (for light backgrounds) and
  `assets/img/logo-mark-light.svg` (white version, for the dark footer). These are hand-traced
  vector rebuilds of your logo, so they stay razor sharp at any size.
- **The "PRISTINE / HOME SERVICES" wordmark** — set in live text using the Outfit webfont,
  not baked into an image. That keeps it crisp on every screen and lets it resize on mobile.

**To use your original logo file instead**, drop it in as `assets/img/logo.png` and run:

```bash
cd site
python3 - <<'EOF'
import glob, re
for f in glob.glob("*.html") + glob.glob("services/*.html"):
    s = open(f).read()
    s = re.sub(r'<img class="brand__mark"[^>]*>\s*<span class="brand__text">.*?</span>\s*</span>',
               '<img class="brand__mark" src="REL/assets/img/logo.png" alt="Pristine Home Services">',
               s, flags=re.S)
    s = s.replace('src="REL/', 'src="../' if f.startswith("services/") else 'src="')
    open(f, "w").write(s)
EOF
```

Then bump `.brand__mark { height: 44px }` in `site.css` to suit your file's proportions —
a logo with the wordmark built in usually wants 56-64px.

## Your photos

Three spots currently show a hatched placeholder box (home page ×2, about page ×1). Each one
is marked in the HTML. Replace a placeholder like this:

```html
<!-- before -->
<div class="visual">
  <div class="visual__placeholder">…</div>
</div>

<!-- after -->
<div class="visual">
  <img src="assets/img/patio-before-after.jpg" alt="Paver patio before and after restoration in Delran NJ">
</div>
```

Use `../assets/` instead of `assets/` on the service pages. Before-and-afters sell this work
better than anything else on the page — a split image of one patio is worth more than a
paragraph.

## Customer reviews

There is deliberately no testimonials section with made-up quotes on it. When you have real
reviews you want to show, paste them in and I will style them — the CSS for review cards
(`.reviews`, `.review`, `.stars`) is already written and waiting in `site.css`.

## Service area

The town list on the home page and about page is in both files as `<ul class="towns">`.
**Check it and delete anything you do not actually cover** — listing towns you will not drive
to generates calls you have to turn down.

## Brand colors

Top of `assets/css/site.css`:

```css
--ink:   #0A1A2B;   /* deep navy */
--brand: #0E86B0;   /* water blue */
--gold:  #D89B2C;   /* warm accent — holiday lighting */
```

Change those three and the whole site follows.

---

## Putting it online

The site is static files, so almost anything hosts it.

**Fastest (free, ~2 minutes):** go to https://app.netlify.com/drop and drag the `site` folder
onto the page. You get a live URL immediately. Then in Site settings → Domain management,
add `pristinecleannj.com` and follow the DNS steps.

**Connected to this repo (auto-deploys on every change):** in Netlify or Vercel, "Add new
site" → import this repository → set the **publish directory** to `site`. Leave the build
command empty. Every push then updates the live site.

**Traditional web host:** upload everything inside `site/` to your `public_html` folder over
FTP.

### Before you point the domain at it

- [ ] Web3Forms access key pasted into `site.js` and a test submission received
- [ ] Real logo dropped in
- [ ] Town list trimmed to where you actually work
- [ ] Photos in place of the three placeholders
- [ ] Phone number checked on every page
- [ ] Submit `sitemap.xml` in Google Search Console
- [ ] Point your Google Business Profile at the new site

## Local preview

```bash
cd site && python3 -m http.server 8080
```

Then open http://localhost:8080.
