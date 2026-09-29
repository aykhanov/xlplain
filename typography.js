(function () {
  'use strict';

  var protectedWords = [
    'и','а','но','да','или','либо','ни','не','бы','же','ли',
    'в','во','на','к','ко','с','со','у','о','об','обо','от','до','за','из','изо','по',
    'под','над','при','про','для','без','через','между',
    'чтобы','что','как','если','когда','хотя','пока','зато','ведь','даже','лишь','только','ещё','уже','также','тоже'
  ];

  var pattern = new RegExp(
    '(^|[\\s(«„“\\"—–-])(' + protectedWords.join('|') + ')[ \\t]+(?=\\S)',
    'giu'
  );

  function protectText(text) {
    return text.replace(pattern, function (_, before, word) {
      return before + word + '\u00A0';
    });
  }

  function shouldSkip(node) {
    var parent = node.parentElement;
    if (!parent) return true;
    if (parent.closest('script, style, noscript, textarea, input, select, option, code, pre, [contenteditable="true"], [data-no-typography]')) return true;
    return false;
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
