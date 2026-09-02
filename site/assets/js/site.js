/* =========================================================
   Pristine Clean Power Washing — site behaviour
   ---------------------------------------------------------
   WHERE DO FORM SUBMISSIONS GO?
   Every quote form on this site POSTs to Web3Forms, which
   emails the submission straight to the inbox tied to the
   access key below. Nothing is stored on the website itself.

   TO TURN THE FORMS ON:
   1. Go to https://web3forms.com
   2. Type in  pristinecleannj@outlook.com  and hit "Create Access Key"
   3. Web3Forms emails you a key that looks like:
        a1b2c3d4-1234-5678-9abc-de1234567890
   4. Paste it between the quotes on the ACCESS_KEY line below.
   5. Save, redeploy. Done — leads now land in that inbox.

   Until a real key is pasted in, the forms stay in DEMO MODE:
   they validate and show the success message, but nothing is
   actually sent anywhere.
   ========================================================= */

var ACCESS_KEY = "REPLACE_WITH_YOUR_WEB3FORMS_ACCESS_KEY";

var ENDPOINT = "https://api.web3forms.com/submit";

(function () {
  "use strict";

  /* ---------- Mobile nav ---------- */
  var navToggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");

  function isMobile() { return window.matchMedia("(max-width: 980px)").matches; }

  function syncNav() {
    if (!nav || !navToggle) return;
    if (isMobile()) {
      var open = navToggle.getAttribute("aria-expanded") === "true";
      nav.hidden = !open;
    } else {
      nav.hidden = false;
      navToggle.setAttribute("aria-expanded", "false");
    }
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!open));
      syncNav();
    });
    window.addEventListener("resize", syncNav);
    syncNav();
  }

  /* ---------- Services dropdown ---------- */
  var menuToggles = document.querySelectorAll(".nav__toggle");

  function closeMenus(except) {
    menuToggles.forEach(function (t) {
      if (t === except) return;
      t.setAttribute("aria-expanded", "false");
      var m = document.getElementById(t.getAttribute("aria-controls"));
      if (m) m.hidden = true;
    });
  }

  menuToggles.forEach(function (toggle) {
    var menu = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!menu) return;

    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = toggle.getAttribute("aria-expanded") === "true";
      closeMenus(toggle);
      toggle.setAttribute("aria-expanded", String(!open));
      menu.hidden = open;
    });

    var wrapper = toggle.closest(".nav__item--has-menu");
    if (wrapper) {
      wrapper.addEventListener("mouseenter", function () {
        if (isMobile()) return;
        closeMenus(toggle);
        toggle.setAttribute("aria-expanded", "true");
        menu.hidden = false;
      });
      wrapper.addEventListener("mouseleave", function () {
        if (isMobile()) return;
        toggle.setAttribute("aria-expanded", "false");
        menu.hidden = true;
      });
    }
  });

  document.addEventListener("click", function () { closeMenus(null); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenus(null);
  });

  /* ---------- Form validation + submission ---------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function digits(value) { return (value || "").replace(/\D/g, ""); }

  function setError(field, message) {
    var box = field.parentElement.querySelector(".form-error");
    if (box) box.textContent = message || "";
    if (message) {
      field.setAttribute("aria-invalid", "true");
    } else {
      field.removeAttribute("aria-invalid");
    }
  }

  function validate(form) {
    var ok = true;
    var firstBad = null;

    form.querySelectorAll("[data-validate]").forEach(function (field) {
      var rule = field.getAttribute("data-validate");
      var value = (field.value || "").trim();
      var message = "";

      if (rule.indexOf("required") !== -1 && !value) {
        message = field.getAttribute("data-msg") || "This field is required.";
      } else if (value && rule.indexOf("email") !== -1 && !EMAIL_RE.test(value)) {
        message = "Please enter a valid email address.";
      } else if (value && rule.indexOf("phone") !== -1 && digits(value).length < 10) {
        message = "Please enter a 10-digit phone number.";
      }

      setError(field, message);
      if (message) {
        ok = false;
        if (!firstBad) firstBad = field;
      }
    });

    if (firstBad) {
      firstBad.focus();
      firstBad.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return ok;
  }

  function showStatus(form, type, message) {
    var status = form.querySelector(".form-status");
    if (!status) return;
    status.className = "form-status is-visible is-" + type;
    status.textContent = message;
    status.setAttribute("role", type === "error" ? "alert" : "status");
  }

  document.querySelectorAll("form[data-quote-form]").forEach(function (form) {
    /* Clear an error as soon as the visitor fixes it. */
    form.querySelectorAll("[data-validate]").forEach(function (field) {
      field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid") === "true") setError(field, "");
      });
      field.addEventListener("blur", function () {
        if ((field.value || "").trim()) setError(field, "");
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      if (!validate(form)) return;

      /* Honeypot: bots fill hidden fields, humans never see them. */
      var trap = form.querySelector('input[name="botcheck"]');
      if (trap && trap.checked) return;

      var button = form.querySelector('button[type="submit"]');
      var buttonText = button ? button.textContent : "";
      if (button) {
        button.setAttribute("aria-busy", "true");
        button.textContent = "Sending…";
      }

      function done(type, message) {
        if (button) {
          button.removeAttribute("aria-busy");
          button.textContent = buttonText;
        }
        showStatus(form, type, message);
        if (type === "success") form.reset();
      }

      var SUCCESS = "Thanks — your request is in. We'll get back to you within one business day. " +
                    "Need it sooner? Call or text 609-379-1760.";

      if (!ACCESS_KEY || ACCESS_KEY.indexOf("REPLACE_WITH") === 0) {
        /* Demo mode — no key set yet. */
        window.setTimeout(function () {
          done("success", SUCCESS);
          if (window.console) {
            console.warn(
              "Pristine Clean: form is in DEMO MODE — nothing was sent. " +
              "Add your Web3Forms access key in assets/js/site.js to start receiving leads."
            );
          }
        }, 600);
        return;
      }

      var data = new FormData(form);
      data.append("access_key", ACCESS_KEY);
      data.append("from_name", "Pristine Clean Website");
      data.append("subject", form.getAttribute("data-subject") || "New quote request — pristinecleannj.com");

      fetch(ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: data
      })
        .then(function (response) { return response.json(); })
        .then(function (result) {
          if (result && result.success) {
            done("success", SUCCESS);
          } else {
            done("error", "Something went wrong sending that. Please call or text 609-379-1760 and we'll take care of it.");
          }
        })
        .catch(function () {
          done("error", "We couldn't reach the server. Please call or text 609-379-1760 and we'll take care of it.");
        });
    });
  });

  /* ---------- Prefill the service dropdown from ?service= ---------- */
  var requested = new URLSearchParams(window.location.search).get("service");
  if (requested) {
    document.querySelectorAll("select[name=\"Service\"]").forEach(function (select) {
      Array.prototype.forEach.call(select.options, function (option) {
        if (option.value.toLowerCase() === requested.toLowerCase()) select.value = option.value;
      });
    });
  }

  /* ---------- Current year in the footer ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
