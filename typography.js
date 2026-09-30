(function () {
  'use strict';

  var COUNTER_ID = 113091081;
  var protectedWords = new Set([
    'и','а','но','да','или','либо','ни','не','бы','же','ли','то',
    'в','во','на','к','ко','с','со','у','о','об','обо','от','до','за','из','изо','по',
    'под','над','при','про','для','без','через','между','перед','после','около','вокруг',
    'чтобы','что','как','если','когда','пока','хотя','чем','чего','где','куда','откуда',
    'зато','ведь','даже','лишь','только','ещё','еще','уже','также','тоже'
  ]);

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

  function normalizeWord(token) {
    return token
      .toLowerCase()
      .replace(/^[^А-Яа-яЁёA-Za-z0-9]+/u, '')
      .replace(/[^А-Яа-яЁёA-Za-z0-9]+$/u, '');
  }

  function shouldSkip(node) {
    var parent = node.parentElement;
    if (!parent) return true;
    return !!parent.closest('script, style, noscript, textarea, input, select, option, code, pre, [contenteditable="true"], [data-no-typography]');
  }

  function processTextNode(node) {
    var tokens = node.nodeValue.match(/\s+|\S+/gu);
    if (!tokens || tokens.length < 3) return;

    var changed = false;
    for (var i = 0; i < tokens.length - 2; i++) {
      if (/^\s+$/u.test(tokens[i])) continue;
      if (!protectedWords.has(normalizeWord(tokens[i]))) continue;
      if (!/^\s+$/u.test(tokens[i + 1])) continue;
      if (/^\s+$/u.test(tokens[i + 2])) continue;

      tokens[i + 1] = '\u00A0';
      changed = true;
    }

    if (changed) node.nodeValue = tokens.join('');
  }

  function applyTypography() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    var node;

    while ((node = walker.nextNode())) {
      if (!shouldSkip(node) && node.nodeValue && node.nodeValue.trim()) nodes.push(node);
    }

    nodes.forEach(processTextNode);
  }

  function addStructuredData() {
    var path = window.location.pathname.replace(/\/+$/, '');
    if (path !== '/xlplain' && path !== '') return;
    if (document.getElementById('xlplain-software-schema')) return;

    var data = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'XLPlain',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Windows',
      description: 'Надстройка для Microsoft Excel: сверка данных, объединение таблиц, очистка, поиск дублей, работа с папками и файлами, сводные таблицы и дашборды.',
      url: 'https://aykhanov.github.io/xlplain/',
      softwareRequirements: 'Настольный Microsoft Excel для Windows с разрешённым запуском VBA-макросов',
      offers: {
        '@type': 'Offer',
        price: '3990',
        priceCurrency: 'RUB',
        availability: 'https://schema.org/InStock',
        url: 'https://aykhanov.github.io/xlplain/#buy'
      },
      featureList: [
        'Сверка данных по ключевым полям',
        'Пакетная сверка двух папок с файлами',
        'Объединение 2–6 таблиц по одному или составному ключу',
        'Очистка и нормализация данных',
        'Поиск дублей по одному или нескольким полям',
        'Сводные таблицы и дашборды',
        'Работа с папками и Excel-файлами'
      ]
    };

    var script = document.createElement('script');
    script.id = 'xlplain-software-schema';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
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

  function trackPageGoal() {
    var path = window.location.pathname.toLowerCase();
    if (path.endsWith('/success.html')) reachGoal('purchase_success');
    else if (path.endsWith('/fail.html')) reachGoal('purchase_fail');
    else if (path.endsWith('/download.html')) reachGoal('download_page');
  }

  function init() {
    applyBranding();
    applyTypography();
    addStructuredData();
    bindMetrikaGoals();
    window.setTimeout(trackPageGoal, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
