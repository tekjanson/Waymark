(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.WebJSCLI = {}));
})(this, (function (exports) { 'use strict';

  /**
   * @file scanner.js
   * Scans a DOM document and identifies all interactive elements,
   * assigning stable `data-wjc` IDs. Works in real browsers and jsdom.
   */

  /** @typedef {{ id: string, prefix: string, label: string, tag: string, type: string, [key: string]: any }} ScannedElement */
  /** @typedef {{ url: string, title: string, elements: ScannedElement[], forms: object[], content: string, elementMap: Map<string, Element> }} ScanResult */

  const INTERACTIVE_SELECTORS = [
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[role="button"]:not([disabled])',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[contenteditable="true"]',
  ].join(', ');

  /**
   * Determine the element ID prefix based on tag/type/role.
   * @param {Element} el
   * @returns {string}
   */
  function getPrefix(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    if (tag === 'button' || type === 'submit' || type === 'button' || type === 'reset' || role === 'button') return 'B';
    if (tag === 'input' && type === 'checkbox') return 'C';
    if (tag === 'input' && type === 'radio') return 'R';
    if (tag === 'select') return 'S';
    if (tag === 'textarea') return 'T';
    if (tag === 'a' || role === 'link') return 'A';
    if (tag === 'input') return 'I';
    if (el.getAttribute('contenteditable') === 'true') return 'T';
    if (role === 'checkbox') return 'C';
    if (role === 'radio') return 'R';
    return 'I';
  }

  /**
   * Slugify a string to a stable, lowercase, dash-separated ID fragment.
   * @param {string} str
   * @param {number} [maxLen=20]
   * @returns {string}
   */
  function slugify(str, maxLen = 20) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen) || 'el';
  }

  /**
   * Resolve a human-readable label for an element.
   * Priority: aria-label > associated label > title > placeholder > name > id > textContent/value
   * @param {Element} el
   * @param {Document} doc
   * @returns {string}
   */
  function resolveLabel(el, doc) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().slice(0, 50);

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = doc.getElementById(ariaLabelledBy);
      if (labelEl && labelEl.textContent.trim()) return labelEl.textContent.trim().slice(0, 50);
    }

    const id = el.getAttribute('id');
    if (id) {
      const labelEl = doc.querySelector(`label[for="${CSS.escape ? CSS.escape(id) : id}"]`);
      if (labelEl && labelEl.textContent.trim()) return labelEl.textContent.trim().slice(0, 50);
    }

    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim().slice(0, 50);

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim().slice(0, 50);

    const name = el.getAttribute('name');
    if (name && name.trim()) return name.trim().slice(0, 50);

    if (id && id.trim()) return id.trim().slice(0, 50);

    const text = el.textContent ? el.textContent.trim() : '';
    if (text) return text.slice(0, 50);

    const value = el.getAttribute('value');
    if (value && value.trim()) return value.trim().slice(0, 50);

    return el.tagName.toLowerCase();
  }

  /**
   * Derive the slug portion of a WJC ID from an element.
   * @param {Element} el
   * @returns {string}
   */
  function deriveSlug(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return slugify(ariaLabel.trim());

    const id = el.getAttribute('id');
    if (id && id.trim()) return slugify(id.trim());

    const name = el.getAttribute('name');
    if (name && name.trim()) return slugify(name.trim());

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return slugify(placeholder.trim());

    const title = el.getAttribute('title');
    if (title && title.trim()) return slugify(title.trim());

    const text = el.textContent ? el.textContent.trim() : '';
    if (text) return slugify(text);

    const value = el.getAttribute('value');
    if (value && value.trim()) return slugify(value.trim());

    return 'el';
  }

  /**
   * Check if an element is visible. Falls back to true in jsdom environments
   * where getComputedStyle may not reflect real layout.
   * @param {Element} el
   * @returns {boolean}
   */
  function isVisible(el) {
    try {
      const win = el.ownerDocument && el.ownerDocument.defaultView;
      if (!win || !win.getComputedStyle) return true;

      const style = win.getComputedStyle(el);
      // In jsdom, getComputedStyle returns empty/default values — treat as visible
      if (!style || style.length === 0) return true;

      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;

      // offsetParent is null for hidden elements in real browsers; jsdom may not support it
      if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null) {
        // Check if the element itself has position:fixed (which also sets offsetParent to null)
        if (style.position !== 'fixed') return false;
      }

      return true;
    } catch {
      return true;
    }
  }

  /**
   * Extract a brief text summary from meaningful page content elements.
   * @param {Document} doc
   * @returns {string}
   */
  function extractContent(doc) {
    const selector = 'h1, h2, h3, main p, [role="main"] p, .content p';
    const nodes = Array.from(doc.querySelectorAll(selector)).slice(0, 5);
    const texts = nodes
      .map((n) => n.textContent.trim())
      .filter(Boolean);
    return texts.join(' | ').slice(0, 500);
  }

  /**
   * Build form records from all <form> elements in the document.
   * @param {Document} doc
   * @param {Map<string, string>} elementIdMap - Map from Element to WJC ID
   * @returns {object[]}
   */
  function scanForms(doc, elementIdMap) {
    const forms = [];
    const formEls = Array.from(doc.querySelectorAll('form'));
    const formSlugs = new Map();

    for (const form of formEls) {
      const rawSlug = slugify(
        form.getAttribute('id') || form.getAttribute('name') || form.getAttribute('aria-label') || 'form',
      );

      let slug = rawSlug;
      let count = formSlugs.get(rawSlug) || 0;
      count++;
      formSlugs.set(rawSlug, count);
      if (count > 1) slug = `${rawSlug}-${count}`;

      const formId = `F:${slug}`;

      // Collect field IDs for inputs inside this form
      const fieldIds = [];
      const formInputs = Array.from(
        form.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea',
        ),
      );
      for (const input of formInputs) {
        const wjcId = elementIdMap.get(input);
        if (wjcId) fieldIds.push(wjcId);
      }

      // Find submit button
      let submitId = null;
      const submitBtn =
        form.querySelector('[type="submit"]') ||
        form.querySelector('button:not([type="button"]):not([type="reset"])');
      if (submitBtn) {
        submitId = elementIdMap.get(submitBtn) || null;
      }

      forms.push({ id: formId, el: form, fields: fieldIds, submitId });
    }

    return forms;
  }

  /**
   * Scan a DOM document and return a structured ScanResult.
   * Assigns `data-wjc` attributes to all detected interactive elements.
   *
   * @param {Document} [doc=document]
   * @returns {ScanResult}
   */
  function scan(doc = document) {
    const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    const url = (win && win.location && win.location.href) || '';
    const title = doc.title || '';

    const rawElements = Array.from(doc.querySelectorAll(INTERACTIVE_SELECTORS));

    // Deduplicate: same DOM node can match multiple selectors
    const uniqueElements = [...new Set(rawElements)];

    const slugCounts = new Map();
    const elementIdMap = new Map(); // Element -> WJC ID
    const elements = [];
    const elementMap = new Map(); // WJC ID -> Element

    for (const el of uniqueElements) {
      if (!isVisible(el)) continue;

      const prefix = getPrefix(el);
      const slugBase = deriveSlug(el);
      const key = `${prefix}:${slugBase}`;

      const count = (slugCounts.get(key) || 0) + 1;
      slugCounts.set(key, count);

      const id = count === 1 ? key : `${key}-${count}`;

      // Assign stable data-wjc attribute
      el.setAttribute('data-wjc', id);
      elementIdMap.set(el, id);
      elementMap.set(id, el);

      const tag = el.tagName.toLowerCase();
      const inputType = el.getAttribute('type') || tag;
      const label = resolveLabel(el, doc);

      /** @type {ScannedElement} */
      const entry = { id, prefix, label, tag, type: inputType };

      if (prefix === 'I' || prefix === 'T') {
        entry.inputType = inputType;
        entry.value = el.value !== undefined ? el.value : '';
        entry.placeholder = el.getAttribute('placeholder') || '';
        entry.required = el.hasAttribute('required');
      } else if (prefix === 'S') {
        const opts = Array.from(el.options || []).map((o) => o.text || o.value);
        const selected = el.options && el.selectedIndex >= 0
          ? (el.options[el.selectedIndex].text || el.options[el.selectedIndex].value)
          : '';
        entry.options = opts;
        entry.value = selected;
      } else if (prefix === 'C' || prefix === 'R') {
        entry.checked = el.checked || false;
      } else if (prefix === 'A') {
        entry.href = el.getAttribute('href') || '';
      }

      elements.push(entry);
    }

    const forms = scanForms(doc, elementIdMap);
    const content = extractContent(doc);

    return { url, title, elements, forms, content, elementMap };
  }

  /**
   * @file manifest.js
   * Converts a ScanResult into a compact, token-efficient text manifest
   * suitable for consumption by AI agents.
   */

  /**
   * Format a single scanned element into a manifest line.
   * @param {import('./scanner.js').ScannedElement} el
   * @returns {string}
   */
  function formatElement(el) {
    const id = `[${el.id}]`;

    switch (el.prefix) {
      case 'B': {
        return `${id} BUTTON "${el.label}"`;
      }

      case 'I': {
        let line = `${id} INPUT "${el.label}" type=${el.inputType || el.type}`;
        if (el.required) line += ' required';
        if (el.placeholder) line += ` placeholder="${el.placeholder}"`;
        line += ` value="${el.value ?? ''}"`;
        return line;
      }

      case 'T': {
        let line = `${id} TEXTAREA "${el.label}"`;
        if (el.required) line += ' required';
        if (el.placeholder) line += ` placeholder="${el.placeholder}"`;
        line += ` value="${el.value ?? ''}"`;
        return line;
      }

      case 'S': {
        const opts = (el.options || []).join(' | ');
        return `${id} SELECT "${el.label}" | ${opts} (selected: ${el.value ?? ''})`;
      }

      case 'C': {
        return `${id} CHECKBOX "${el.label}" checked=${el.checked ? 'true' : 'false'}`;
      }

      case 'R': {
        return `${id} RADIO "${el.label}" checked=${el.checked ? 'true' : 'false'}`;
      }

      case 'A': {
        return `${id} LINK "${el.label}" -> ${el.href || ''}`;
      }

      default: {
        return `${id} ELEMENT "${el.label}" type=${el.type}`;
      }
    }
  }

  const COMMANDS_SECTION = `--- COMMANDS ---
click <id>           - Click a button or link
type <id> <text>     - Type into an input field
select <id> <value>  - Choose a select option (partial match ok)
check <id>           - Check a checkbox/radio
uncheck <id>         - Uncheck a checkbox
submit <form-id>     - Submit a form
clear <id>           - Clear an input field
scroll <up|down|id>  - Scroll the page or to an element
navigate <url>       - Navigate to a URL
get_state            - Refresh and get current page state
done <message>       - Signal task completion`;

  /**
   * Build a complete manifest string from a ScanResult.
   *
   * @param {import('./scanner.js').ScanResult} scanResult
   * @param {{ omitCommands?: boolean }} [options={}]
   * @returns {string}
   */
  function buildManifest(scanResult, options = {}) {
    const { url, title, elements, forms, content } = scanResult;
    const { omitCommands = false } = options;

    const lines = [];

    lines.push('=== WEB-JS-CLI PAGE STATE ===');
    if (url) lines.push(`URL: ${url}`);
    if (title) lines.push(`TITLE: ${title}`);

    // Interactive elements
    if (elements && elements.length > 0) {
      lines.push('');
      lines.push('--- INTERACTIVE ELEMENTS ---');
      for (const el of elements) {
        lines.push(formatElement(el));
      }
    }

    // Forms
    if (forms && forms.length > 0) {
      lines.push('');
      lines.push('--- FORMS ---');
      for (const form of forms) {
        const fields = (form.fields || []).join(', ');
        const submit = form.submitId ? `[${form.submitId}]` : 'none';
        lines.push(`[${form.id}] fields=[${fields}] submit=${submit}`);
      }
    }

    // Page content
    if (content && content.trim()) {
      lines.push('');
      lines.push('--- PAGE CONTENT ---');
      lines.push(content);
    }

    // Commands
    if (!omitCommands) {
      lines.push('');
      lines.push(COMMANDS_SECTION);
    }

    lines.push('=============================');

    return lines.join('\n');
  }

  /**
   * Build a compact manifest (same as buildManifest with omitCommands: true).
   * Use for follow-up messages after the first to reduce token usage.
   *
   * @param {import('./scanner.js').ScanResult} scanResult
   * @returns {string}
   */
  function buildCompactManifest(scanResult) {
    return buildManifest(scanResult, { omitCommands: true });
  }

  /**
   * @file executor.js
   * Parses and executes CLI commands against the DOM.
   * Works in both real browser environments and jsdom (for testing).
   */

  /**
   * @typedef {{ success: boolean, action?: string, done?: boolean, message?: string, error?: string }} CommandResult
   */

  /**
   * Resolve an element by WJC ID using the elementMap or data-wjc fallback.
   * @param {string} id
   * @param {import('./scanner.js').ScanResult} scanResult
   * @param {Document} doc
   * @returns {Element|null}
   */
  function resolveElement(id, scanResult, doc) {
    if (scanResult && scanResult.elementMap) {
      const el = scanResult.elementMap.get(id);
      if (el) return el;
    }
    return doc.querySelector(`[data-wjc="${CSS.escape ? CSS.escape(id) : id}"]`);
  }

  /**
   * Dispatch a synthetic event on an element using the document's window context,
   * so it works correctly in jsdom (where MouseEvent lives on the window object).
   * @param {Element} el
   * @param {string} type
   * @param {'mouse'|'input'|'change'|'submit'} [kind='input']
   */
  function dispatchEvent(el, type, kind = 'input') {
    const win = (el.ownerDocument && el.ownerDocument.defaultView) || globalThis;
    let event;
    if (kind === 'mouse') {
      event = new (win.MouseEvent || MouseEvent)(type, { bubbles: true, cancelable: true });
    } else {
      event = new (win.Event || Event)(type, { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(event);
  }

  /**
   * Executor — parses and runs WEB-JS-CLI commands against a document.
   */
  class Executor {
    /**
     * @param {Document} [doc=document]
     */
    constructor(doc = document) {
      this.doc = doc;
    }

    /**
     * Execute a single CLI command string.
     *
     * @param {string} commandString - e.g. "click B:submit" or "type I:email foo@bar.com"
     * @param {import('./scanner.js').ScanResult} [scanResult] - optional, used for elementMap lookup
     * @returns {Promise<CommandResult>}
     */
    async execute(commandString, scanResult) {
      const trimmed = (commandString || '').trim();
      if (!trimmed) return { success: false, error: 'Empty command' };

      const spaceIdx = trimmed.indexOf(' ');
      const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

      switch (cmd.toLowerCase()) {
        case 'click':
          return this._click(rest, scanResult);

        case 'type': {
          const firstSpace = rest.indexOf(' ');
          if (firstSpace === -1) return { success: false, error: `type requires <id> <text>` };
          const id = rest.slice(0, firstSpace);
          const text = rest.slice(firstSpace + 1);
          return this._type(id, text, scanResult);
        }

        case 'select': {
          const firstSpace = rest.indexOf(' ');
          if (firstSpace === -1) return { success: false, error: `select requires <id> <value>` };
          const id = rest.slice(0, firstSpace);
          const value = rest.slice(firstSpace + 1);
          return this._select(id, value, scanResult);
        }

        case 'check':
          return this._setChecked(rest, true, scanResult);

        case 'uncheck':
          return this._setChecked(rest, false, scanResult);

        case 'submit':
          return this._submit(rest, scanResult);

        case 'clear':
          return this._clear(rest, scanResult);

        case 'scroll':
          return this._scroll(rest, scanResult);

        case 'navigate':
          return this._navigate(rest);

        case 'get_state':
          return { success: true, action: 'state_refreshed' };

        case 'done': {
          const message = rest || 'Task complete';
          return { success: true, done: true, message };
        }

        default:
          return { success: false, error: `Unknown command: ${cmd}` };
      }
    }

    /**
     * @param {string} id
     * @param {import('./scanner.js').ScanResult} [scanResult]
     * @returns {CommandResult}
     */
    _click(id, scanResult) {
      const el = resolveElement(id, scanResult, this.doc);
      if (!el) return { success: false, error: `Element not found: ${id}` };
      if (typeof el.click === 'function') {
        el.click();
      } else {
        dispatchEvent(el, 'click', 'mouse');
      }
      return { success: true, action: `clicked ${id}` };
    }

    /**
     * @param {string} id
     * @param {string} text
     * @param {import('./scanner.js').ScanResult} [scanResult]
     * @returns {CommandResult}
     */
    _type(id, text, scanResult) {
      const el = resolveElement(id, scanResult, this.doc);
      if (!el) return { success: false, error: `Element not found: ${id}` };

      if (typeof el.focus === 'function') el.focus();

      if ('value' in el) {
        el.value = text;
      } else if (el.getAttribute('contenteditable') === 'true') {
        el.textContent = text;
      } else {
        return { success: false, error: `Element ${id} is not typeable` };
      }

      dispatchEvent(el, 'input');
      dispatchEvent(el, 'change');

      return { success: true, action: `typed into ${id}` };
    }

    /**
     * @param {string} id
     * @param {string} value - partial or full option text/value (case-insensitive)
     * @param {import('./scanner.js').ScanResult} [scanResult]
     * @returns {CommandResult}
     */
    _select(id, value, scanResult) {
      const el = resolveElement(id, scanResult, this.doc);
      if (!el) return { success: false, error: `Element not found: ${id}` };
      if (el.tagName.toLowerCase() !== 'select') {
        return { success: false, error: `Element ${id} is not a <select>` };
      }

      const needle = value.toLowerCase();
      const options = Array.from(el.options || []);
      const match = options.find(
        (o) => o.text.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle),
      );

      if (!match) {
        return { success: false, error: `No option matching "${value}" in ${id}` };
      }

      el.value = match.value;
      dispatchEvent(el, 'change');

      return { success: true, action: `selected "${match.text}" in ${id}` };
    }

    /**
     * @param {string} id
     * @param {boolean} checked
     * @param {import('./scanner.js').ScanResult} [scanResult]
     * @returns {CommandResult}
     */
    _setChecked(id, checked, scanResult) {
      const el = resolveElement(id, scanResult, this.doc);
      if (!el) return { success: false, error: `Element not found: ${id}` };
      el.checked = checked;
      dispatchEvent(el, 'change');
      return { success: true, action: `${checked ? 'checked' : 'unchecked'} ${id}` };
    }

    /**
     * @param {string} formId - e.g. "F:contact"
     * @param {import('./scanner.js').ScanResult} [scanResult]
     * @returns {CommandResult}
     */
    _submit(formId, scanResult) {
      // Try to find submit button for the form first
      if (scanResult && scanResult.forms) {
        const form = scanResult.forms.find((f) => f.id === formId);
        if (form) {
          if (form.submitId) {
            const submitBtn = resolveElement(form.submitId, scanResult, this.doc);
            if (submitBtn) {
              if (typeof submitBtn.click === 'function') submitBtn.click();
              else dispatchEvent(submitBtn, 'click', 'mouse');
              return { success: true, action: `submitted ${formId}` };
            }
          }
          // Dispatch submit event on the form element directly
          if (form.el) {
            dispatchEvent(form.el, 'submit');
            return { success: true, action: `submitted ${formId}` };
          }
        }
      }

      // Fallback: query by data-wjc
      const formEl = this.doc.querySelector(`[data-wjc="${formId}"]`) || this.doc.querySelector('form');
      if (!formEl) return { success: false, error: `Form not found: ${formId}` };

      const submitBtn = formEl.querySelector('[type="submit"], button:not([type="button"]):not([type="reset"])');
      if (submitBtn) {
        if (typeof submitBtn.click === 'function') submitBtn.click();
        else dispatchEvent(submitBtn, 'click', 'mouse');
      } else {
        dispatchEvent(formEl, 'submit');
      }

      return { success: true, action: `submitted ${formId}` };
    }

    /**
     * @param {string} id
     * @param {import('./scanner.js').ScanResult} [scanResult]
     * @returns {CommandResult}
     */
    _clear(id, scanResult) {
      const el = resolveElement(id, scanResult, this.doc);
      if (!el) return { success: false, error: `Element not found: ${id}` };

      if ('value' in el) {
        el.value = '';
      } else if (el.getAttribute('contenteditable') === 'true') {
        el.textContent = '';
      }

      dispatchEvent(el, 'input');
      dispatchEvent(el, 'change');

      return { success: true, action: `cleared ${id}` };
    }

    /**
     * @param {string} target - "up", "down", or an element ID
     * @param {import('./scanner.js').ScanResult} [scanResult]
     * @returns {CommandResult}
     */
    _scroll(target, scanResult) {
      const win = this.doc.defaultView || (typeof window !== 'undefined' ? window : null);

      if (target === 'up') {
        if (win) win.scrollBy(0, -300);
        return { success: true, action: 'scrolled up' };
      }
      if (target === 'down') {
        if (win) win.scrollBy(0, 300);
        return { success: true, action: 'scrolled down' };
      }

      // Scroll to element
      const el = resolveElement(target, scanResult, this.doc);
      if (!el) return { success: false, error: `Element not found: ${target}` };

      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      return { success: true, action: `scrolled to ${target}` };
    }

    /**
     * @param {string} url
     * @returns {CommandResult}
     */
    _navigate(url) {
      const win = this.doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (!win) return { success: false, error: 'No window available for navigation' };

      if (!url) return { success: false, error: 'navigate requires a URL' };

      win.location.href = url;
      return { success: true, action: `navigated to ${url}` };
    }
  }

  /**
   * @file agent.js
   * AI agent runner. Model-agnostic, ships with OpenAI adapter pattern.
   * Runs entirely in Node.js — not bundled for browser.
   */

  /**
   * System prompt that instructs the AI to act as a precise web automation agent.
   * @type {string}
   */
  const SYSTEM_PROMPT = `You are a precise web automation agent that controls web pages via a CLI interface.

RULES:
- Respond with exactly ONE command per message — a single line, no explanation.
- Use the element IDs exactly as shown in brackets, e.g. [B:submit] → use "B:submit".
- When the task is complete, respond: done <brief summary of what you did>
- If you cannot complete the task, respond: done FAILED: <reason>
- Never add commentary, apologies, or multi-line responses — command only.
- Prefer the most direct path to the goal.

AVAILABLE COMMANDS:
click <id>           - Click a button or link
type <id> <text>     - Type into an input field
select <id> <value>  - Choose a select option (partial match ok)
check <id>           - Check a checkbox/radio
uncheck <id>         - Uncheck a checkbox
submit <form-id>     - Submit a form
clear <id>           - Clear an input field
scroll <up|down|id>  - Scroll the page or to an element
navigate <url>       - Navigate to a URL
get_state            - Refresh and get current page state
done <message>       - Signal task completion`;

  // Cost per million tokens (gpt-4o-mini rates)
  const COST_INPUT_PER_M = 0.15;
  const COST_OUTPUT_PER_M = 0.60;

  /**
   * @typedef {{ step: number, command: string, result: object, usage: { inputTokens: number, outputTokens: number } }} StepInfo
   */

  /**
   * Run an AI agent that controls a web page using the WEB-JS-CLI manifest protocol.
   *
   * @param {string} task - Natural language description of what to accomplish.
   * @param {() => Promise<string>} getManifest - Returns the current page manifest.
   * @param {(command: string) => Promise<{ success: boolean, action?: string, done?: boolean, message?: string, error?: string, manifest?: string }>} executeCmd - Executes a command.
   * @param {{ apiKey?: string, model?: string, maxSteps?: number, onStep?: (info: StepInfo) => void, baseURL?: string }} [options={}]
   * @returns {Promise<{ success: boolean, steps: StepInfo[], message: string, totalInputTokens: number, totalOutputTokens: number, totalCost: number }>}
   */
  async function runAgent(task, getManifest, executeCmd, options = {}) {
    const {
      apiKey,
      model = 'gpt-4o-mini',
      maxSteps = 20,
      onStep,
      baseURL,
    } = options;

    // Dynamically import openai — it's a dev/Node dep, not bundled in browser UMD
    const { default: OpenAI } = await import('openai');

    const clientOptions = { apiKey };
    if (baseURL) clientOptions.baseURL = baseURL;
    const client = new OpenAI(clientOptions);

    const steps = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Fetch initial manifest
    const initialManifest = await getManifest();

    /** @type {Array<{ role: string, content: string }>} */
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `TASK: ${task}\n\n${initialManifest}`,
      },
    ];

    for (let step = 1; step <= maxSteps; step++) {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: 60,
        temperature: 0,
      });

      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      const command = (response.choices[0]?.message?.content || '').trim();

      // Execute the command
      const result = await executeCmd(command);

      /** @type {StepInfo} */
      const stepInfo = {
        step,
        command,
        result,
        usage: { inputTokens, outputTokens },
      };

      steps.push(stepInfo);
      if (onStep) onStep(stepInfo);

      // Check for task completion
      if (result.done) {
        const totalCost =
          (totalInputTokens * COST_INPUT_PER_M) / 1_000_000 +
          (totalOutputTokens * COST_OUTPUT_PER_M) / 1_000_000;

        return {
          success: !result.message?.startsWith('FAILED:'),
          steps,
          message: result.message || 'done',
          totalInputTokens,
          totalOutputTokens,
          totalCost,
        };
      }

      // Append assistant command and the updated page state for the next turn.
      // Use compact manifest (no commands section) to save tokens on follow-up messages.
      messages.push({ role: 'assistant', content: command });

      let nextManifest;
      if (result.manifest) {
        nextManifest = result.manifest;
      } else {
        nextManifest = await getManifest();
      }

      // Report errors clearly so the model can recover
      const userContent = result.success
        ? `OK: ${result.action || command}\n\n${nextManifest}`
        : `ERROR: ${result.error || 'Command failed'}\n\n${nextManifest}`;

      messages.push({ role: 'user', content: userContent });
    }

    // maxSteps reached without completion
    const totalCost =
      (totalInputTokens * COST_INPUT_PER_M) / 1_000_000 +
      (totalOutputTokens * COST_OUTPUT_PER_M) / 1_000_000;

    return {
      success: false,
      steps,
      message: `Max steps (${maxSteps}) reached without task completion`,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
    };
  }

  /**
   * @file index.js
   * Main entry point for web-js-cli.
   * Exports the WebJSCLI class and all core primitives.
   */


  /**
   * WebJSCLI — high-level facade that combines scanning, manifest generation,
   * and command execution into a single convenient API.
   */
  class WebJSCLI {
    /**
     * @param {{ document?: Document }} [options={}]
     */
    constructor(options = {}) {
      this._doc = options.document || (typeof globalThis !== 'undefined' ? globalThis.document : undefined);
      this._lastScan = null;
      this._executor = new Executor(this._doc);
    }

    /**
     * Scan the document for interactive elements.
     * Result is cached in `this._lastScan`.
     *
     * @returns {import('./scanner.js').ScanResult}
     */
    scan() {
      this._lastScan = scan(this._doc);
      return this._lastScan;
    }

    /**
     * Scan the document and build a manifest string.
     *
     * @param {{ omitCommands?: boolean }} [opts={}]
     * @returns {string}
     */
    getManifest(opts = {}) {
      const result = this.scan();
      return buildManifest(result, opts);
    }

    /**
     * Execute a CLI command string against the current document.
     * Re-scans after execution so the cached scan stays fresh.
     *
     * @param {string} command
     * @returns {Promise<import('./executor.js').CommandResult>}
     */
    async execute(command) {
      if (!this._lastScan) this.scan();
      const result = await this._executor.execute(command, this._lastScan);
      // Re-scan to reflect DOM changes
      this.scan();
      return result;
    }

    /**
     * Execute a command and return both the result and an updated compact manifest.
     *
     * @param {string} command
     * @returns {Promise<{ result: import('./executor.js').CommandResult, manifest: string }>}
     */
    async executeAndGetManifest(command) {
      const result = await this.execute(command);
      const manifest = buildCompactManifest(this._lastScan);
      return { result, manifest };
    }
  }

  // Auto-expose on window in browser environments
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.WebJSCLI = WebJSCLI;
  }

  exports.Executor = Executor;
  exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
  exports.WebJSCLI = WebJSCLI;
  exports.buildCompactManifest = buildCompactManifest;
  exports.buildManifest = buildManifest;
  exports.default = WebJSCLI;
  exports.runAgent = runAgent;
  exports.scan = scan;

  Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=web-js-cli.umd.js.map
