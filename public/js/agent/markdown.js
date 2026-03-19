/* ============================================================
   markdown.js — Agent markdown rendering helpers
   DOM-safe markdown rendering for chat messages and code blocks.
   ============================================================ */

import { el } from '../ui.js';

/**
 * Render markdown text into container.
 * Handles: fenced code blocks, headings (h1-h3), horizontal rules,
 * ordered lists, unordered lists, tables, and paragraphs.
 * @param {HTMLElement} container
 * @param {string} text
 */
export function renderMarkdown(container, text) {
  const parts = text.split(/(```[\s\S]*?```)/g);

  parts.forEach(part => {
    if (part.startsWith('```')) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (match) {
        container.appendChild(buildCodeBlock(match[2].trim(), match[1] || ''));
      }
      return;
    }

    const lines = part.split('\n');
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trimEnd();

      if (!line.trim()) {
        i++;
        continue;
      }

      if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
        container.appendChild(el('hr', { className: 'agent-md-hr' }));
        i++;
        continue;
      }

      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const tagName = `h${level}`;
        const heading = el(tagName, { className: `agent-md-h${level}` });
        renderInlineMarkdown(heading, headingMatch[2].trim());
        container.appendChild(heading);
        i++;
        continue;
      }

      if (/^\|.+\|/.test(line)) {
        const tableLines = [];
        while (i < lines.length && /^\|.+\|/.test(lines[i].trimEnd())) {
          tableLines.push(lines[i].trimEnd());
          i++;
        }
        container.appendChild(buildMarkdownTable(tableLines));
        continue;
      }

      if (/^[-*+]\s/.test(line)) {
        const ul = el('ul', { className: 'agent-md-ul' });
        while (i < lines.length && /^[-*+]\s/.test(lines[i].trimEnd())) {
          const li = el('li', {});
          renderInlineMarkdown(li, lines[i].trimEnd().replace(/^[-*+]\s/, ''));
          ul.appendChild(li);
          i++;
        }
        container.appendChild(ul);
        continue;
      }

      if (/^\d+\.\s/.test(line)) {
        const ol = el('ol', { className: 'agent-md-ol' });
        while (i < lines.length && /^\d+\.\s/.test(lines[i].trimEnd())) {
          const li = el('li', {});
          renderInlineMarkdown(li, lines[i].trimEnd().replace(/^\d+\.\s/, ''));
          ol.appendChild(li);
          i++;
        }
        container.appendChild(ol);
        continue;
      }

      const paraLines = [];
      while (i < lines.length) {
        const current = lines[i].trimEnd();
        if (!current.trim()) {
          i++;
          break;
        }
        if (/^(#{1,3})\s|^[-*+]\s|^\d+\.\s|^\|.+\||^(\s*[-*_]){3,}\s*$/.test(current)) break;
        paraLines.push(current);
        i++;
      }
      if (paraLines.length) {
        const p = el('p', {});
        renderInlineMarkdown(p, paraLines.join(' ').trim());
        container.appendChild(p);
      }
    }
  });
}

/**
 * Build a table element from markdown table lines.
 * @param {string[]} lines
 * @returns {HTMLElement}
 */
function buildMarkdownTable(lines) {
  const parseRow = (line) =>
    line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

  const table = el('table', { className: 'agent-md-table' });
  let headerDone = false;

  lines.forEach(line => {
    if (/^\|[\s\-|:]+\|$/.test(line)) return;

    const cells = parseRow(line);
    const row = el('tr', {});
    const isHeader = !headerDone;
    cells.forEach(cellText => {
      const td = el(isHeader ? 'th' : 'td', {});
      renderInlineMarkdown(td, cellText);
      row.appendChild(td);
    });
    if (isHeader) {
      const thead = el('thead', {}, [row]);
      table.appendChild(thead);
      table.appendChild(el('tbody', {}));
      headerDone = true;
    } else {
      table.querySelector('tbody').appendChild(row);
    }
  });

  return el('div', { className: 'agent-md-table-wrap' }, [table]);
}

/**
 * Handle inline markdown: bold, italic, inline code, and links.
 * @param {HTMLElement} parent
 * @param {string} text
 */
function renderInlineMarkdown(parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      parent.appendChild(el('code', { className: 'agent-inline-code' }, [token.slice(1, -1)]));
    } else if (token.startsWith('**')) {
      parent.appendChild(el('strong', {}, [token.slice(2, -2)]));
    } else if (token.startsWith('*')) {
      parent.appendChild(el('em', {}, [token.slice(1, -1)]));
    } else if (token.startsWith('[')) {
      const label = match[2];
      const href = match[3];
      const safeSrc = /^(https?:\/\/|#)/.test(href) ? href : '#';
      const link = el('a', {
        className: 'agent-md-link',
        href: safeSrc,
        target: safeSrc.startsWith('#') ? '_self' : '_blank',
        rel: 'noopener noreferrer',
      }, [label]);
      parent.appendChild(link);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

/**
 * Build a code block with a copy button.
 * @param {string} code
 * @param {string} lang
 * @returns {HTMLElement}
 */
function buildCodeBlock(code, lang) {
  const copyBtn = el('button', {
    className: 'agent-code-copy',
    title: 'Copy to clipboard',
    on: {
      click: () => {
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
        });
      },
    },
  }, ['📋 Copy']);

  const header = el('div', { className: 'agent-code-header' }, [
    el('span', { className: 'agent-code-lang' }, [lang || 'code']),
    copyBtn,
  ]);

  const pre = el('pre', { className: 'agent-code-pre' }, [
    el('code', { className: 'agent-code' }, [code]),
  ]);

  return el('div', { className: 'agent-code-block' }, [header, pre]);
}