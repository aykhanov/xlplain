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

  function shouldSkip(node) {
    var parent = node.parentElement;
    if (!parent) return true;
    return !!parent.closest('script, style, noscript, textarea, input, select, option, code, pre, [contenteditable="true"], [data-no-typography], .xlplain-nobr');
  }

  function processTextNode(textNode) {
    var text = textNode.nodeValue;
    var re = /(^|\s)(\S+)(\s+)(\S+)/gu;
    var match;
    var lastIndex = 0;
    var fragment = document.createDocumentFragment();
    var changed = false;

    while ((match = re.exec(text)) !== null) {
      var before = match[1];
      var first = match[2];
      var gap = match[3];
      var second = match[4];
      var firstStart = match.index + before.length;
      var wholeStart = match.index;

      if (!protectedWords.has(normalizeWord(first))) continue;

      if (wholeStart > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, wholeStart)));
      }
      if (before) fragment.appendChild(document.createTextNode(before));

      var span = document.createElement('span');
      span.className = 'xlplain-nobr';
      span.style.whiteSpace = 'nowrap';
      span.textContent = first + gap + second;
      fragment.appendChild(span);

      lastIndex = firstStart + first.length + gap.length + second.length;
      re.lastIndex = lastIndex;
      changed = true;
    }

    if (!changed) return;
    if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    textNode.parentNode.replaceChild(fragment, textNode);
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
