(function () {
  'use strict';

  var COUNTER_ID = 113091081;

  function reachGoal(name) {
    if (typeof window.ym === 'function') {
      try { window.ym(COUNTER_ID, 'reachGoal', name); } catch (e) {}
    }
  }

  function applyBranding() {
    document.querySelectorAll('.brand').forEach(function (brand) {
      brand.setAttribute('aria-label', 'XLPlain — на главную');
      brand.innerHTML = '<img src="assets/xlplain-logo-compact.svg?v=1" alt="XLPlain">';
      brand.style.display = 'inline-flex';
      brand.style.alignItems = 'center';
      brand.style.textDecoration = 'none';
    });

    if (!document.getElementById('xlplain-brand-style')) {
      var style = document.createElement('style');
      style.id = 'xlplain-brand-style';
      style.textContent = '.brand::before{display:none!important}.brand img{display:block;width:138px;max-width:34vw;height:auto}';
      document.head.appendChild(style);
    }
  }

  function bindMetrikaGoals() {
    document.querySelectorAll('form.purchase-form').forEach(function (form) {
      form.addEventListener('submit', function () {
        var action = form.querySelector('input[name="action"]');
        reachGoal(action && /renew/i.test(action.value) ? 'renewal_start' : 'purchase_start');
      });
    });

    document.querySelectorAll('a[href^="mailto:XLPlain@yandex.com"], a[href^="mailto:xlplain@yandex.com"]').forEach(function (link) {
      link.addEventListener('click', function () { reachGoal('support_email_click'); });
    });

    document.querySelectorAll('a[href*="XLPlain_v1.0.zip"], a[href*="releases/latest/download/"]').forEach(function (link) {
      link.addEventListener('click', function () { reachGoal('download_click'); });
    });
  }

  function init() {
    applyBranding();
    bindMetrikaGoals();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
