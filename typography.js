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
      .replace(/^[«„“\"'([{—–-]+/u, '')
      .replace(/[»”\"'.,!?;:…%)\]}—–-]+$/u, '');
  }

  function protectText(text) {
    var parts = text.split(/([ \t]+)/u);

    for (var i = 0; i < parts.length - 2; i += 2) {
      var word = normalizeWord(parts[i]);
      if (!protectedWords.has(word)) continue;
      if (!/^[ \t]+$/u.test(parts[i + 1])) continue;
      if (!parts[i + 2] || !parts[i + 2].trim()) continue;
      parts[i + 1] = '\u00A0\u2060';
    }

    return parts.join('');
  }

  function shouldSkip(node) {
    var parent = node.parentElement;
    if (!parent) return true;
    return !!parent.closest('script, style, noscript, textarea, input, select, option, code, pre, [contenteditable="true"], [data-no-typography]');
  }

  function applyTypography() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    var node;

    while ((node = walker.nextNode())) {
      if (!shouldSkip(node) && node.nodeValue && node.nodeValue.trim()) nodes.push(node);
    }

    nodes.forEach(function (textNode) {
      var next = protectText(textNode.nodeValue);
      if (next !== textNode.nodeValue) textNode.nodeValue = next;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTypography, { once: true });
  } else {
    applyTypography();
  }
})();
