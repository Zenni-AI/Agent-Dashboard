const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESIGN_PATH = /^\/d\/([a-f0-9]{32})\/?$/;

const state = {
  config: null,
  designId: null,
  /** Bumped whenever we start following a different design, so stale polls stop. */
  pollToken: 0,
  selected: null,
  revealed: false,
  step: null,
};

init();

async function init() {
  try {
    state.config = await (await fetch('/api/config')).json();
  } catch {
    state.config = { themes: [], businessName: '' };
  }
  const c = state.config;

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

  wireForm();
  wireCompare();
  wirePhotoUploads();
  if (c.mapsBrowserKey) initAutocomplete(c.mapsBrowserKey, c.addressRegions || []).catch((err) => console.warn('Address autocomplete unavailable', err));

  window.addEventListener('popstate', route);
  route();
}

function route() {
  const m = location.pathname.match(DESIGN_PATH);
  if (m) openDesign(m[1]);
  else {
    state.pollToken++;
    showStep('form');
  }
}

function goToDesign(id) {
  history.pushState({}, '', `/d/${id}`);
  openDesign(id);
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
    if (!photo.files[0]) data.delete('photo');
    const params = new URLSearchParams(location.search);
    for (const [key, param] of [['utmSource', 'utm_source'], ['utmMedium', 'utm_medium'], ['utmCampaign', 'utm_campaign']]) {
      if (params.get(param)) data.set(key, params.get(param).slice(0, 100));
    }
    if (document.referrer) data.set('referrer', document.referrer.slice(0, 500));

    const btn = $('#submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      const res = await fetch('/api/leads', { method: 'POST', body: data });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.designId) {
        showError('#form-error', body.error || 'Something went wrong. Please try again.');
        return;
      }
      track('lead_submitted');
      goToDesign(body.designId);
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

/* ---------- following a design ---------- */

async function openDesign(id) {
  const token = ++state.pollToken;
  if (state.designId !== id) {
    state.designId = id;
    state.selected = null;
    state.revealed = false;
    $('#looks').replaceChildren();
  }
  let delay = 1000;
  let afterDone = 0;
  while (token === state.pollToken) {
    let view;
    try {
      const res = await fetch(`/api/designs/${id}`, { cache: 'no-store' });
      if (res.status === 404) {
        history.replaceState({}, '', '/');
        showStep('form');
        showError('#form-error', 'That design link has expired. Fill in the form to make a new one.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      view = await res.json();
    } catch {
      await sleep(3000); // offline blip or rate limit — keep trying
      continue;
    }
    if (token !== state.pollToken) return;
    renderDesign(view);
    // Once finished, keep checking briefly so the page can say whether the text/email actually went out.
    const finished = view.status === 'done' || view.status === 'failed';
    if (finished && (view.status === 'failed' || view.delivery || ++afterDone > 20)) return;
    await sleep(delay);
    delay = Math.min(delay + 250, 2500);
  }
}

function renderDesign(view) {
  const c = state.config;
  const join = (list) => list.join(' and ');
  const channels = join([c.sms && 'text', c.email && 'email'].filter(Boolean));
  const sent = view.delivery ? join([view.delivery.sms === 'sent' && 'text', view.delivery.email === 'sent' && 'email'].filter(Boolean)) : '';
  let notice = '';
  if (channels && (view.status === 'locating' || view.status === 'rendering')) {
    notice = `No need to wait here — feel free to close this page. We’ll ${channels} your ${view.renders.length} designs to you as soon as they’re ready.`;
  } else if (channels && view.status === 'done') {
    notice = !view.delivery ? `Sending your designs to you by ${channels}…` : sent ? `We’ve sent your designs to you by ${sent}.` : '';
  }
  $$('[data-notice]').forEach((el) => {
    el.textContent = notice;
    el.hidden = !notice;
  });

  if (view.status === 'locating') return showStep('progress');

  if (!view.beforeUrl) {
    // Couldn't find a street photo: the way forward is the visitor's own photo.
    showStep('needs-photo');
    $('#needs-photo-msg').textContent = view.canUploadPhoto
      ? view.error?.message || 'We couldn’t find a street photo of your house.'
      : 'We couldn’t find a street photo of your house. We’ll be in touch to put together your design.';
    $('#retry-photo').closest('label').hidden = !view.canUploadPhoto;
    return;
  }

  showStep('result');
  $('[data-bind=firstName]').textContent = view.firstName ? `${view.firstName}’s` : 'your';
  $('#result-address').textContent = view.formattedAddress || '';
  $('#swap-photo-wrap').hidden = !view.canUploadPhoto;
  showError('#result-error', view.status === 'failed' ? 'We couldn’t light up this photo. Try uploading a clear daytime photo of the front of your house.' : '');

  const choice = view.renders.find((r) => r.themeId === state.selected);
  if (!choice || (choice.status === 'failed' && view.renders.some((r) => r.status === 'done'))) {
    state.selected = (view.renders.find((r) => r.status === 'done') || view.renders[0]).themeId;
  }
  renderTabs(view);
  showLook(view);
}

function renderTabs(view) {
  const tabs = $('#looks');
  for (const r of view.renders) {
    let tab = tabs.querySelector(`[data-theme="${r.themeId}"]`);
    if (!tab) {
      tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'look-tab';
      tab.role = 'tab';
      tab.dataset.theme = r.themeId;
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = r.swatch;
      const text = document.createElement('span');
      text.append(document.createElement('b'), document.createElement('small'));
      text.firstChild.textContent = r.label;
      tab.append(sw, text);
      tab.addEventListener('click', () => {
        state.selected = r.themeId;
        renderTabs(state.lastView);
        showLook(state.lastView);
      });
      tabs.append(tab);
    }
    tab.dataset.status = r.status;
    tab.setAttribute('aria-selected', String(r.themeId === state.selected));
    tab.querySelector('small').textContent =
      r.status === 'done' ? 'Ready ✓' : r.status === 'failed' ? 'Unavailable' : view.position > 1 ? `In line (#${view.position})` : 'Lighting up…';
  }
  state.lastView = view;
}

function showLook(view) {
  const r = view.renders.find((x) => x.themeId === state.selected);
  const ready = r?.status === 'done';
  $('#before-base').src = view.beforeUrl;
  $('#before-img').src = view.beforeUrl;
  for (const id of ['#after-img', '#before-wrap', '#compare-handle', '#compare-range', '#tag-after']) $(id).hidden = !ready;
  $('#before-base').hidden = ready;
  $('#download-link').hidden = !ready;
  $('#compare-busy').hidden = ready || r?.status === 'failed';
  $('#busy-text').textContent = view.position > 1 ? `You’re #${view.position} in line — lighting up shortly…` : `Installing your ${r?.label ?? ''} lights…`;
  if (!ready) return;

  const after = $('#after-img');
  if (!after.src.endsWith(r.afterUrl)) {
    after.alt = `Your house at dusk with ${r.label} permanent outdoor lights`;
    after.onload = () => {
      if (after.naturalWidth && after.naturalHeight) $('#compare').style.aspectRatio = `${after.naturalWidth} / ${after.naturalHeight}`;
    };
    after.src = r.afterUrl;
  }
  $('#download-link').href = r.afterUrl;
  $('#download-link').download = `my-house-${r.themeId.replace(/_/g, '-')}.jpg`;
  if (!state.revealed) {
    state.revealed = true;
    track('preview_shown');
    animateReveal();
  }
}

/* ---------- uploading a different photo ---------- */

function wirePhotoUploads() {
  for (const id of ['#swap-photo', '#retry-photo']) {
    const input = $(id);
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.value = '';
      if (!f || !state.designId) return;
      const errorSel = id === '#swap-photo' ? '#result-error' : '#needs-photo-msg';
      if (f.size > 15 * 1024 * 1024) return showError(errorSel, 'That photo is too large (15 MB max).');
      const data = new FormData();
      data.set('photo', f);
      showError(errorSel, 'Uploading…');
      try {
        const res = await fetch(`/api/designs/${state.designId}/photo`, { method: 'POST', body: data });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.designId) return showError(errorSel, body.error || 'Upload failed. Please try again.');
        showError(errorSel, '');
        goToDesign(body.designId);
      } catch {
        showError(errorSel, 'Network error — please try again.');
      }
    });
  }
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

/** Sweeps the slider once so visitors see the lights "turn on". */
function animateReveal() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setCompare(50);
  const dur = 1400;
  setCompare(100);
  setTimeout(() => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      setCompare(Math.round(100 - 50 * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, 400);
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
  if (state.step === step) return;
  state.step = step;
  for (const s of ['form', 'progress', 'needs-photo', 'result']) $(`#step-${s}`).hidden = s !== step;
  $('#how').hidden = step !== 'form';
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
