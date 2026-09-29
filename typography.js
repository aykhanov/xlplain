(function () {
  'use strict';

  var protectedWords = new Set([
    'и','а','но','да','или','либо','ни','не','бы','же','ли','то',
    'в','во','на','к','ко','с','со','у','о','об','обо','от','до','за','из','изо','по',
    'под','над','при','про','для','без','через','между','перед','после','около','вокруг',
    'чтобы','что','как','если','когда','пока','хотя','чем','чего','где','куда','откуда',
    'зато','ведь','даже','лишь','только','ещё','еще','уже','также','тоже'
  ]);

  function normalizeWord(token) {
    return token
      .toLowerCase()
      .replace(/^[^А-Яа-яЁёA-Za-z0-9]+/u, '')
      .replace(/[^А-Яа-яЁёA-Za-z0-9]+$/u, '');
  }

  function shouldSkip(node) {
    var parent = node.parentElement;
    if (!parent) return true;
    return !!parent.closest('script, style, noscript, textarea, input, select, option, code, pre, [contenteditable="true"], [data-no-typography], .xlplain-nobr');
  }

  function processTextNode(textNode) {
    var text = textNode.nodeValue;
    var tokens = text.match(/\s+|\S+/gu);
    if (!tokens || tokens.length < 3) return;

    var fragment = document.createDocumentFragment();
    var changed = false;
    var i = 0;

    while (i < tokens.length) {
      var token = tokens[i];

      if (/^\s+$/u.test(token) || !protectedWords.has(normalizeWord(token))) {
        fragment.appendChild(document.createTextNode(token));
        i += 1;
        continue;
      }

      var group = token;
      var j = i + 1;
      var hasFollowingWord = false;

      while (j + 1 < tokens.length && /^\s+$/u.test(tokens[j]) && !/^\s+$/u.test(tokens[j + 1])) {
        group += tokens[j] + tokens[j + 1];
        hasFollowingWord = true;
        j += 2;

        if (!protectedWords.has(normalizeWord(tokens[j - 1]))) break;
      }

      if (hasFollowingWord) {
        var span = document.createElement('span');
        span.className = 'xlplain-nobr';
        span.style.whiteSpace = 'nowrap';
        span.textContent = group;
        fragment.appendChild(span);
        i = j;
        changed = true;
      } else {
        fragment.appendChild(document.createTextNode(token));
        i += 1;
      }
    }

    if (changed) textNode.parentNode.replaceChild(fragment, textNode);
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTypography, { once: true });
  } else {
    applyTypography();
  }
})();
