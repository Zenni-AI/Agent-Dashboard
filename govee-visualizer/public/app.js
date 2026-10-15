const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  config: null,
  theme: 'warm_white',
  leadId: null,
  rendersRemaining: null,
  firstName: '',
  busy: false,
};

const STAGE_COPY = {
  queued: ['You’re in line…', 'Lots of people are designing their lights right now — hang tight.'],
  starting: ['Getting started…', 'This usually takes 15–40 seconds.'],
  locating: ['Finding your house…', 'Pulling up the street view of your home.'],
  rendering: ['Installing your lights…', 'Placing lights along every roofline. Almost there.'],
  finishing: ['Final touches…', 'Just a second.'],
};

init();

async function init() {
  try {
    state.config = await (await fetch('/api/config')).json();
  } catch {
    state.config = { themes: [], maxRendersPerLead: 5, defaultTheme: 'warm_white', businessName: '' };
  }
  const c = state.config;
  state.theme = c.defaultTheme;

  if (c.businessName) $$('[data-bind=businessName]').forEach((el) => (el.textContent = c.businessName));
  if (c.businessName) document.title = `See Your Home Lit Up — ${c.businessName}`;
  if (c.businessPhone) {
    const tel = `tel:${c.businessPhone.replace(/[^\d+]/g, '')}`;
    const top = $('[data-bind=phoneLink]');
    top.href = tel;
    top.textContent = c.businessPhone;
    top.hidden = false;
    const call = $('#cta-call');
    call.href = tel;
    call.textContent = `Call ${c.businessPhone}`;
    call.hidden = false;
  }
  if (c.ctaUrl && /^https?:\/\//.test(c.ctaUrl)) {
    $('#cta-link').href = c.ctaUrl;
    $('#cta-link').hidden = false;
  }
  if (c.demoMode) $('#demo-note').hidden = false;
  if (!c.streetView) $('#form-photo-name').textContent = 'Add a photo of the front of your house for the best result.';

  renderThemeChips();
  wireForm();
  wireCompare();
  wireResultTools();
  if (c.mapsBrowserKey) initAutocomplete(c.mapsBrowserKey, c.addressRegions || []).catch((err) => console.warn('Address autocomplete unavailable', err));
}

/* ---------- themes ---------- */

function renderThemeChips() {
  for (const container of $$('[data-themes]')) {
    container.replaceChildren(
      ...state.config.themes.map((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme-chip';
        b.dataset.theme = t.id;
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = t.swatch;
        b.append(sw, document.createTextNode(t.label));
        b.addEventListener('click', () => onThemeClick(t.id, container.dataset.themes));
        return b;
      }),
    );
  }
  syncThemeChips();
}

function syncThemeChips() {
  $$('.theme-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === state.theme)));
  $$('[data-themes=result] .theme-chip').forEach((b) => (b.disabled = state.busy || state.rendersRemaining === 0));
}

function onThemeClick(themeId, where) {
  if (where === 'form') {
    state.theme = themeId;
    syncThemeChips();
    return;
  }
  if (state.busy || themeId === state.theme) return;
  state.theme = themeId;
  syncThemeChips();
  requestRender({ reuse: 'last' });
}

/* ---------- lead form ---------- */

function wireForm() {
  const form = $('#lead-form');
  const photo = $('#form-photo');
  photo.addEventListener('change', () => {
    const f = photo.files[0];
    $('#form-photo-name').textContent = f ? `✓ ${f.name}` : 'No photo? No problem — we’ll find your house from the street.';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = validateForm(form);
    showError('#form-error', error);
    if (error) return;

    const data = new FormData(form);
    data.set('theme', state.theme);
    if (!photo.files[0]) data.delete('photo');
    const params = new URLSearchParams(location.search);
    for (const [key, param] of [['utmSource', 'utm_source'], ['utmMedium', 'utm_medium'], ['utmCampaign', 'utm_campaign']]) {
      if (params.get(param)) data.set(key, params.get(param).slice(0, 100));
    }
    if (document.referrer) data.set('referrer', document.referrer.slice(0, 500));
    state.firstName = String(data.get('name')).trim().split(/\s+/)[0];

    const btn = $('#submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      const res = await fetch('/api/leads', { method: 'POST', body: data });
      const body = await res.json().catch(() => ({}));
      if (body.leadId) state.leadId = body.leadId;
      if (!res.ok || !body.jobId) {
        if (state.leadId) {
          // The lead is saved; only the preview couldn't start. Offer a retry rather than re-submitting.
          showStep('needs-photo');
          $('#needs-photo-msg').textContent = body.error || 'We couldn’t start your preview.';
          $('#retry-btn').hidden = false;
        } else {
          showError('#form-error', body.error || 'Something went wrong. Please try again.');
        }
        return;
      }
      state.rendersRemaining = body.rendersRemaining;
      track('lead_submitted');
      showStep('progress');
      followJob(body.jobId);
    } catch {
      showError('#form-error', 'Network error — please check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Show my house lit up <span aria-hidden="true">→</span>';
    }
  });
}

function validateForm(form) {
  const v = (n) => String(form.elements[n].value || '').trim();
  const mark = (n, bad) => form.elements[n].setAttribute('aria-invalid', String(bad));
  const checks = [
    ['name', v('name').length >= 2, 'Please enter your name.'],
    ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email')), 'Please enter a valid email.'],
    ['phone', v('phone').replace(/\D/g, '').length >= 10, 'Please enter a valid phone number.'],
    ['address', v('address').length >= 5, 'Please enter your home address.'],
  ];
  let first = '';
  for (const [name, ok, msg] of checks) {
    mark(name, !ok);
    if (!ok && !first) {
      first = msg;
      form.elements[name].focus();
    }
  }
  if (first) return first;
  if (!form.elements.consent.checked) return 'Please check the box so we can send you your design.';
  return '';
}

/* ---------- rendering & polling ---------- */

async function requestRender({ reuse, photo } = {}) {
  if (!state.leadId || state.busy) return;
  setBusy(true);
  showError('#result-error', '');
  const data = new FormData();
  data.set('theme', state.theme);
  if (reuse) data.set('reuse', reuse);
  if (photo) data.set('photo', photo);
  try {
    const res = await fetch(`/api/leads/${encodeURIComponent(state.leadId)}/renders`, { method: 'POST', body: data });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.jobId) {
      setBusy(false);
      if (!$('#step-result').hidden) showError('#result-error', body.error || 'Something went wrong.');
      else {
        showStep('needs-photo');
        $('#needs-photo-msg').textContent = body.error || 'Something went wrong.';
      }
      if (res.status === 429) state.rendersRemaining = 0;
      updateRendersLeft();
      return;
    }
    state.rendersRemaining = body.rendersRemaining;
    if ($('#step-result').hidden) showStep('progress');
    followJob(body.jobId);
  } catch {
    setBusy(false);
    showError('#result-error', 'Network error — please try again.');
  }
}

async function followJob(jobId) {
  setBusy(true);
  const started = Date.now();
  let delay = 1200;
  while (Date.now() - started < 5 * 60_000) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 200, 2500);
    let job;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
      if (res.status === 429) continue;
      job = await res.json();
      if (!res.ok) throw new Error(job.error);
    } catch (err) {
      if (err instanceof TypeError) continue; // offline blip — keep polling
      return jobFailed({ code: 'expired', message: err.message || 'Something went wrong.' });
    }
    if (job.status === 'done') return jobDone(job.result);
    if (job.status === 'failed') return jobFailed(job.error);
    updateProgress(job);
  }
  jobFailed({ code: 'timeout', message: 'This is taking longer than usual. Please try again.' });
}

function updateProgress(job) {
  const stage = job.status === 'queued' ? 'queued' : job.stage;
  const [title, detail] = STAGE_COPY[stage] || STAGE_COPY.starting;
  $('#progress-title').textContent = title;
  $('#progress-detail').textContent =
    job.status === 'queued' && job.position > 1 ? `${job.position - 1} ${job.position === 2 ? 'person' : 'people'} ahead of you — usually under a minute.` : detail;
  const order = ['locating', 'rendering', 'finishing'];
  const idx = order.indexOf(stage);
  $$('.stages li').forEach((li, i) => {
    li.classList.toggle('active', i === idx);
    li.classList.toggle('done', idx > i);
  });
  if (!$('#step-result').hidden) $('#compare-busy span').textContent = stage === 'queued' ? 'In line…' : 'Re-lighting…';
}

function jobDone(result) {
  setBusy(false);
  const after = $('#after-img');
  const before = $('#before-img');
  after.onload = () => {
    if (after.naturalWidth && after.naturalHeight) $('#compare').style.aspectRatio = `${after.naturalWidth} / ${after.naturalHeight}`;
  };
  after.src = result.afterUrl;
  before.src = result.beforeUrl;
  $('#download-link').href = result.afterUrl;
  $('[data-bind=firstName]').textContent = state.firstName ? `${state.firstName}’s` : 'your';
  $('#result-address').textContent = result.formattedAddress || '';
  state.theme = result.themeId || state.theme;
  syncThemeChips();
  updateRendersLeft();
  setCompare(50);
  if ($('#step-result').hidden) {
    showStep('result');
    track('preview_shown');
    animateReveal();
  }
}

function jobFailed(error) {
  setBusy(false);
  const code = error?.code;
  if (!$('#step-result').hidden && code !== 'no_street_view' && code !== 'address_not_found') {
    showError('#result-error', error?.message || 'Something went wrong.');
    return;
  }
  showStep('needs-photo');
  $('#needs-photo-msg').textContent = error?.message || 'Something went wrong.';
  // Retrying only helps for transient failures; for "no street view" a photo is the way forward.
  $('#retry-btn').hidden = code === 'no_street_view' || code === 'address_not_found' || state.rendersRemaining === 0;
}

function setBusy(busy) {
  state.busy = busy;
  $('#compare-busy').hidden = !busy || $('#step-result').hidden;
  syncThemeChips();
}

function updateRendersLeft() {
  const n = state.rendersRemaining;
  $('#renders-left').textContent = n === null ? '' : n === 0 ? '(no free previews left)' : `(${n} free ${n === 1 ? 'preview' : 'previews'} left)`;
}

/* ---------- result tools ---------- */

function wireResultTools() {
  const onPhoto = (input) => () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      showError('#result-error', 'That photo is too large (15 MB max).');
      return;
    }
    requestRender({ photo: f });
  };
  const swap = $('#swap-photo');
  swap.addEventListener('change', onPhoto(swap));
  const retryPhoto = $('#retry-photo');
  retryPhoto.addEventListener('change', onPhoto(retryPhoto));
  $('#retry-btn').addEventListener('click', () => requestRender({}));
}

/* ---------- before/after slider ---------- */

function wireCompare() {
  $('#compare-range').addEventListener('input', (e) => setCompare(Number(e.target.value)));
}

function setCompare(pct) {
  $('#compare-range').value = String(pct);
  $('#before-wrap').style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  $('#compare-handle').style.left = `${pct}%`;
}

/** Sweeps the slider once so visitors immediately see the lights "turn on". */
function animateReveal() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  const from = 100;
  const to = 50;
  const dur = 1400;
  setCompare(from);
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    setCompare(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  setTimeout(() => requestAnimationFrame(step), 400);
}

/* ---------- address autocomplete (Google Places API (New)) ---------- */

async function initAutocomplete(key, regions) {
  await new Promise((resolve, reject) => {
    window.__goveeMapsReady = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__goveeMapsReady`;
    s.async = true;
    s.onerror = reject;
    document.head.append(s);
  });
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary('places');

  const input = $('#address');
  const list = $('#address-suggestions');
  const placeIdField = $('#lead-form').elements.placeId;
  let token = new AutocompleteSessionToken();
  let items = [];
  let active = -1;
  let seq = 0;
  let timer;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const choose = (i) => {
    const s = items[i];
    if (!s) return;
    input.value = s.text;
    placeIdField.value = s.placeId;
    token = new AutocompleteSessionToken();
    close();
  };
  const paint = () => {
    list.replaceChildren(
      ...items.map((s, i) => {
        const li = document.createElement('li');
        li.id = `addr-opt-${i}`;
        li.role = 'option';
        li.textContent = s.text;
        li.setAttribute('aria-selected', String(i === active));
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(i);
        });
        return li;
      }),
    );
    const powered = document.createElement('li');
    powered.className = 'powered';
    powered.textContent = 'powered by Google';
    powered.setAttribute('aria-hidden', 'true');
    list.append(powered);
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(items.length > 0));
    if (active >= 0) input.setAttribute('aria-activedescendant', `addr-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', () => {
    placeIdField.value = '';
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) {
      items = [];
      return close();
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const req = { input: q, sessionToken: token };
        if (regions.length) req.includedRegionCodes = regions;
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
        if (mine !== seq) return;
        items = suggestions
          .filter((s) => s.placePrediction)
          .slice(0, 5)
          .map((s) => ({ text: s.placePrediction.text.toString(), placeId: s.placePrediction.placeId }));
        active = -1;
        paint();
      } catch (err) {
        console.warn('autocomplete failed', err);
      }
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
}

/* ---------- helpers ---------- */

function showStep(step) {
  for (const s of ['form', 'progress', 'needs-photo', 'result']) $(`#step-${s}`).hidden = s !== step;
  $('#how').hidden = step !== 'form';
  if (step === 'progress') updateProgress({ status: 'running', stage: 'starting' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(sel, msg) {
  const el = $(sel);
  el.textContent = msg;
  el.hidden = !msg;
}

/** Hook for ad pixels (Meta, Google Ads, GA4) if they're added to the page. */
function track(event) {
  try {
    window.dataLayer?.push({ event });
    window.fbq?.('track', event === 'lead_submitted' ? 'Lead' : 'ViewContent');
  } catch {
    /* analytics must never break the page */
  }
}
