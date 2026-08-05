/* ============================================================
   templates/index.js — Lazy-loading template registry
   
   Lightweight template metadata for detection, with on-demand
   loading of full template modules. This dramatically reduces
   initial page load (~500KB → ~50KB) for better laptop hosting.
   
   Exports:
   - TEMPLATES — lazy-loading registry (use after loadTemplate)
   - detectTemplate(headers) — pick the best template for headers  
   - loadTemplate(key) — dynamically load a template module
   - onEdit(fn) — register a cell-edit callback
   ============================================================ */

import { TEMPLATES, onEdit } from './shared.js';
import { loadTemplate, isTemplateLoaded } from './template-loader.js';

/* Export the lazy loader for external use */
export { loadTemplate, isTemplateLoaded };

/* Export TEMPLATES and onEdit for backward compatibility */
export { TEMPLATES, onEdit };

/* ---------- Lightweight Template Metadata ---------- */
/* Detection functions only — render functions loaded on demand */
/* IMPORTANT: These detect functions are extracted from the source template files. */
/* DO NOT hand-write detect logic — always extract from the template source. */

const TEMPLATE_METADATA = {
  agents: {
    name: 'Agent Registry',
    icon: '🤖',
    color: '#7c3aed',
    priority: 24,
    detect: (h) => {
      const hasTuning = h.some(h => /\btuning\b|\bpersonality\b|\bprompt\b/.test(h));
      const hasAgent  = h.some(h => /\bagent\b|\bworker\b/.test(h));
      return hasTuning || (hasAgent && h.some(h => /\bstatus\b|\bheartbeat\b|\bmodel\b/.test(h)));
    }
  },
  arcade: {
    name: 'Arcade',
    icon: '🎮',
    color: '#7c3aed',
    priority: 20,
    detect: (h) => {
      // Direct keyword match
      if (h.some(h => /\b(arcade|game\s*lobby|game\s*room|multiplayer)\b/i.test(h))) return true;
      // Combination: "game" header + "player" header
      const hasGame = h.some(h => /^\s*game\s*$/i.test(h));
      const hasPlayer = h.some(h => /\bplayer\b/i.test(h));
      return hasGame && hasPlayer;
    }
  },
  automation: {
    name: 'Automation',
    icon: '🤖',
    color: '#7c3aed',
    priority: 21,
    detect: (h) => {
      const hasAction = h.some(h => /^(action|command|operation|do)$/.test(h));
      const hasTarget = h.some(h => /^(target|selector|element|locator)/.test(h));
      const hasWorkflow = h.some(h => /^(workflow|automation|flow|script|scenario)/.test(h));
      const hasStep = h.some(h => /^(step|instruction|task|description)/.test(h));
      // Must have action+target, or workflow+action
      return (hasAction && hasTarget) || (hasWorkflow && hasAction);
    }
  },
  blog: {
    name: 'Blog',
    icon: '✍️',
    color: '#0f766e',
    priority: 20,
    detect: (h) => {
      // Requires a title column AND a doc link column
      // Excludes knowledge sheets (which have inline content column)
      const hasTitle   = h.some(h => /^(title|headline|post|article)$/.test(h));
      const hasDocLink = h.some(h => /^(doc|document|google.?doc|article.?url|post.?url|doc.?link)$/.test(h));
      const hasInline  = h.some(h => /^(content|body|text|answer)$/.test(h));
      return hasTitle && hasDocLink && !hasInline;
    }
  },
  budget: {
    name: 'Budget',
    icon: '💰',
    color: '#059669',
    priority: 20,
    detect: (h) => {
      return h.some(h => /^(budget|income|expense|spent|balance)/.test(h))
        && h.some(h => /^(amount|cost|price|total|sum|\$)/.test(h) || /^(budget|income|expense)/.test(h));
    }
  },
  changelog: {
    name: 'Changelog',
    icon: '📋',
    color: '#374151',
    priority: 18,
    detect: (h) => {
      return h.some(h => /^(version|release|v\d|build)/.test(h))
        && h.some(h => /^(change|what.?changed|description|detail|summary|added|fixed|removed|breaking)/.test(h) || /^(type|kind|tag|label)/.test(h));
    }
  },
  checklist: {
    name: 'Checklist',
    icon: '✓',
    color: '#16a34a',
    priority: 10,
    detect: (h) => {
      return h.some(h => /^(status|done|complete|check|✓|✔)/.test(h));
    }
  },
  contacts: {
    name: 'Contacts',
    icon: '📇',
    color: '#ec4899',
    priority: 15,
    detect: (h) => {
      return h.some(h => /^(email|phone|mobile|cell|telephone)/.test(h))
        && h.some(h => /^(name|contact|person|who|first|last)/.test(h));
    }
  },
  crm: {
    name: 'CRM',
    icon: '🤝',
    color: '#b45309',
    priority: 23,
    detect: (h) => {
      return h.some(h => /^(company|lead|prospect|account|organization|org)/.test(h))
        && h.some(h => /^(deal|stage|pipeline|status|phase)/.test(h) || /^(value|worth|revenue|amount|\$)/.test(h));
    }
  },
  flow: {
    name: 'Flow Diagram',
    icon: '🔀',
    color: '#6366f1',
    priority: 20,
    detect: (h) => {
      const hasFlow = h.some(h => /^(flow|diagram|process|workflow|pipeline|flowchart)/.test(h));
      const hasStep = h.some(h => /^(step|node|block|stage|action|task|activity)/.test(h));
      const hasType = h.some(h => /^(type|shape|kind|node.?type)/.test(h));
      const hasNext = h.some(h => /^(next|to|target|connects?.?to|goto|arrow|transition|leads?.?to)/.test(h));
      return hasFlow && hasStep && (hasType || hasNext);
    }
  },
  gantt: {
    name: 'Gantt Timeline',
    icon: '📅',
    color: '#059669',
    priority: 21,
    detect: (h) => {
      const hasStartDate = h.some(h => /^(start.?date?|begins?|from\.?date)$/.test(h) || h === 'start');
      const hasEndDate   = h.some(h => /^(end.?date?|finish|deadline|until|to\.?date)$/.test(h) || h === 'end');
      const hasTask      = h.some(h => /^(task|activity|milestone|deliverable)$/.test(h));
      return hasTask && hasStartDate && hasEndDate;
    }
  },
  grading: {
    name: 'Gradebook',
    icon: '🎓',
    color: '#7c2d12',
    priority: 21,
    detect: (h) => {
      return h.some(h => /^(student|pupil|name)/.test(h))
        && h.some(h => /^(grade|assignment|homework|exam|quiz|midterm|final|score|test\b|hw)/.test(h));
    }
  },
  guide: {
    name: 'Instruction Guide',
    icon: '🪴',
    color: '#15803d',
    priority: 22,
    detect: (h) => {
      const hasGuide = h.some(h => /^(guide|deck|playbook|workflow|lesson|module|process|task)/.test(h));
      const hasSlide = h.some(h => /^(slide|step|screen|page|title|instruction)/.test(h));
      const hasInstruction = h.some(h => /^(instruction|content|details|script|body|copy|talk.?track|notes?)/.test(h));
      const hasObjective = h.some(h => /^(objective|goal|outcome|purpose|why)/.test(h));
      const hasVisual = h.some(h => /^(visual|asset|demo|cue|illustration|media|callout)/.test(h));
      return (hasGuide && hasSlide && (hasInstruction || hasObjective))
        || (hasSlide && hasInstruction && hasVisual);
    }
  },
  habit: {
    name: 'Habit Tracker',
    icon: '🔄',
    color: '#d97706',
    priority: 22,
    detect: (h) => {
      return h.some(h => /^(habit|routine|daily)/.test(h))
        && h.some(h => /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|streak)/.test(h));
    }
  },
  inventory: {
    name: 'Inventory',
    icon: '📦',
    color: '#f59e0b',
    priority: 15,
    detect: (h) => {
      return h.some(h => /^(quantity|qty|count|stock|amount|price|cost|sku|upc|in.?stock)/.test(h))
        && !h.some(h => /^(status|done|complete|check|✓|✔)/.test(h));
    }
  },
  invoice: {
    name: 'Invoice',
    icon: '🧾',
    color: '#7c3aed',
    priority: 22,
    detect: (h) => {
      const hasInvoice = h.some(h => /^(invoice|inv\.?\s*#|inv\.?\s*num|invoice.?no|quote\.?\s*#|quote.?no)/.test(h));
      const hasClient  = h.some(h => /^(client|customer|bill\.?to|company|account)/.test(h));
      const hasDue     = h.some(h => /^(due|due.?date|payment.?due)/.test(h));
      const hasItem    = h.some(h => /^(item|description|service|product|line.?item)/.test(h));
      const hasPrice   = h.some(h => /^(unit.?price|price|rate|cost|amount|\$)/.test(h));
      // Must have invoice # as primary signal, plus at least one other finance signal
      return hasInvoice && (hasClient || hasDue || hasItem || hasPrice);
    }
  },
  iot: {
    name: 'IoT Sensor Log',
    icon: '📡',
    color: '#0f766e',
    priority: 24,
    detect: (h) => {
      const hasSensor = h.some(h => /^(sensor|device|probe|node|meter)/.test(h));
      const hasReading = h.some(h => /^(reading|value|measurement|current)/.test(h));
      return hasSensor && hasReading;
    }
  },
  kanban: {
    name: 'Kanban Board',
    icon: '📋',
    color: '#0284c7',
    priority: 23,
    detect: (h) => {
      return h.some(h => /^(stage|column|lane|board|swim)/.test(h) || /backlog|in.?progress|to.?do|doing/.test(h))
        && h.some(h => /^(task|story|ticket|item|feature|issue|title|name|description)/.test(h));
    }
  },
  knowledge: {
    name: 'Knowledge Base',
    icon: '📚',
    color: '#6366f1',
    priority: 18,
    detect: (h) => {
      const hasKnowledge = h.some(h =>
        /^(knowledge|wiki|article|documentation|doc|faq|guide|kb)/.test(h)
        || /knowledge.?base|help.?center/i.test(h),
      );
      const hasContent = h.some(h =>
        /^(content|body|text|answer|detail|description|article)/.test(h),
      );
      const hasCategory = h.some(h =>
        /^(category|section|topic|subject|area|domain|group)/.test(h),
      );
      // Need either a strong knowledge signal or content+category together
      // with a title/article column
      const hasTitle = h.some(h =>
        /^(title|article|topic|question|subject|entry|name|heading)/.test(h),
      );
      return (hasKnowledge && (hasContent || hasTitle))
        || (hasTitle && hasContent && hasCategory);
    }
  },
  ledger: {
    name: 'Ledger',
    icon: '📒',
    color: '#0f766e',
    priority: 22,
    detect: (h) => {
      const hasRef      = h.some(h => /^(reference|ref\b|journal|memo|entry.?#|folio)/.test(h));
      const hasBalance  = h.some(h => /^(balance|running.?balance|closing)/.test(h));
      const hasType     = h.some(h => /^(type|entry.?type|txn.?type|transaction.?type)/.test(h));
      const hasAmount   = h.some(h => /^(amount|debit|credit|value|\$)/.test(h));
      const hasCategory = h.some(h => /^(category|account|ledger.?account|gl.?code|dept)/.test(h));
      // Strong signal: explicit "reference" column + amount, or "balance" column, or type+category+amount
      return (hasRef && hasAmount)
        || hasBalance
        || (hasType && hasCategory && hasAmount);
    }
  },
  linker: {
    name: 'Community Linker',
    icon: '🔗',
    color: '#7c3aed',
    priority: 22,
    detect: (h) => {
      const hasLink = h.some(h => /^(link|url|sheet|waymark.?link|sheet.?id|public.?link)/.test(h));
      const hasType = h.some(h => /^(type|kind|entry.?type)/.test(h));
      const hasName = h.some(h => /^(name|title|community|label)/.test(h));
      return hasLink && hasType && hasName;
    }
  },
  log: {
    name: 'Activity Log',
    icon: '📝',
    color: '#0891b2',
    priority: 15,
    detect: (h) => {
      return h.some(h => /^(timestamp|logged|entry.?date|log.?date|recorded|created.?at)/.test(h));
    }
  },
  marketing: {
    name: 'Content Workbench',
    icon: '📣',
    color: '#e11d48',
    priority: 24,
    detect: (h) => {
      /* Needs post/content column + platform column + at least one engagement metric */
      const hasPost = h.some(h => /^(post|content|draft|copy|caption|message|tweet|text)/.test(h));
      const hasPlatform = h.some(h => /^(platform|channel|network|where|site|medium)/.test(h));
      const hasEngagement = h.some(h => /^(like|share|repost|comment|reply|view|impression|click|engagement|reach)/.test(h));
      const hasTakeaway = h.some(h => /^(takeaway|lesson|learning|insight|worked|what.?worked|voice|tone)/.test(h));
      return hasPost && hasPlatform && (hasEngagement || hasTakeaway);
    }
  },
  meal: {
    name: 'Meal Planner',
    icon: '🍽️',
    color: '#65a30d',
    priority: 22,
    detect: (h) => {
      return h.some(h => /^(meal|recipe|dish|food)/.test(h))
        && h.some(h => /^(calorie|protein|carb|fat|macro|nutrition)/.test(h) || h.some(h2 => /^(breakfast|lunch|dinner|snack)/.test(h2)));
    }
  },
  notification: {
    name: 'Push Notification Rules',
    icon: '📲',
    color: '#7c3aed',
    priority: 22,
    detect: (h) => {
      return (
        h.some(h => /\btitle\b/.test(h)) &&
        h.some(h => /\bmessage\b|\bbody\b/.test(h)) &&
        h.some(h => /\bstatus\b/.test(h)) &&
        h.some(h => /\btype\b/.test(h))
      );
    }
  },
  okr: {
    name: 'OKR / Goals',
    icon: '🎯',
    color: '#7c3aed',
    priority: 22,
    detect: (h) => {
      const hasOkr = h.some(h => /^(okr|objective|outcome)/.test(h));
      const hasKr  = h.some(h => /^(key.?result|kr\b)/.test(h));
      /* Require an explicit key-result column to avoid false positives on
         generic "Goal/Progress" tracker sheets */
      return hasOkr && hasKr;
    }
  },
  passwords: {
    name: 'Password Manager',
    icon: '🔑',
    color: '#7c3aed',
    priority: 22,
    detect: (h) => {
      return h.some(h => /^(password|passwd|secret|credential)/.test(h))
        && h.some(h => /^(site|service|website|domain|app|account|login|user.?name)/.test(h));
    }
  },
  photos: {
    name: 'Photo Gallery',
    icon: '📷',
    color: '#ec4899',
    priority: 20,
    detect: (h) => {
      // Exclude Social Feed sheets (post/message + author columns) so the Social template
      // is not replaced when social sheets happen to include an Image column.
      const isSocial = h.some(h => /^(post|message|status|wall|feed|update)/.test(h))
        && h.some(h => /^(author|poster|user|posted.?by|from|who)/.test(h));
      if (isSocial) return false;

      return h.some(h => /^(photo|image|picture|pic)\s*(url|link|src)?$/.test(h))
        || (h.some(h => /\bphoto\b|\bimage\b|\bpicture\b/.test(h))
          && h.some(h => /\btitle\b|\bcaption\b|\balbum\b|\bdate\b/.test(h)));
    }
  },
  poll: {
    name: 'Poll / Survey',
    icon: '📊',
    color: '#be185d',
    priority: 18,
    detect: (h) => {
      return h.some(h => /^(vote|votes|response|responses|poll|ballot|tally)/.test(h))
        && h.some(h => /^(option|choice|answer|candidate|selection|question|item)/.test(h));
    }
  },
  recipe: {
    name: 'Recipe',
    icon: '📖',
    color: '#ea580c',
    priority: 24,
    detect: (h) => {
      // Detect when headers suggest a recipe sheet
      const hasRecipeSignal = h.some(h => /^(recipe|dish|name)/.test(h));
      const hasIngredient   = h.some(h => /^(ingredients?|ingredient)/.test(h));
      const hasInstruction  = h.some(h => /^(instructions?|steps?|directions?|method)/.test(h));
      const hasPrepCook     = h.some(h => /^(prep|cook|servings|cuisine|difficulty|category)/.test(h));
      const hasQuantity     = h.some(h => /^(qty|quantity|amount|units?)/.test(h));

      // Strong signal: ingredient + instruction columns
      if (hasIngredient && hasInstruction) return true;
      // Recipe + at least one supporting column
      if (hasRecipeSignal && (hasIngredient || hasInstruction || hasPrepCook)) return true;
      // Quantity + ingredient is a strong recipe signal
      if (hasQuantity && hasIngredient) return true;

      return false;
    }
  },
  rfi: {
    name: 'Construction RFI',
    icon: '📋',
    color: '#0284c7',
    priority: 25,
    detect: (h) => {
      return h.some(h => /^(rfi|rfi\s*number|reference|id)/.test(h)) && h.some(h => /^(status|state|stage)/.test(h));
    }
  },
  roster: {
    name: 'Roster',
    icon: '👥',
    color: '#6366f1',
    priority: 18,
    detect: (h) => {
      return h.some(h => /^(employee|staff|team.?member|worker|person|name)/.test(h))
        && h.some(h => /^(shift|roster|rotation|schedule|availability|on.?call)/.test(h));
    }
  },
  schedule: {
    name: 'Schedule',
    icon: '📅',
    color: '#8b5cf6',
    priority: 20,
    detect: (h) => {
      return h.some(h => /^(time\b|start\s*time|end\s*time|slot|period|block)/.test(h));
    }
  },
  social: {
    name: 'Social Feed',
    icon: '💬',
    color: '#6366f1',
    priority: 19,
    detect: (h) => {
      return h.some(h => /^(post|message|status|update|wall|feed|content)/.test(h))
        && h.some(h => /^(author|poster|user|posted.?by|from|name|who)/.test(h))
        && h.some(h => /^(date|time|posted|timestamp|when|created)/.test(h));
    }
  },
  testcases: {
    name: 'Test Cases',
    icon: '🧪',
    color: '#7c3aed',
    priority: 25,
    detect: (h) => {
      return h.some(h => /^(result|pass|fail|test.?status|outcome|verdict)/.test(h))
        && h.some(h => /^(test|case|scenario|step|expected|actual|description)/.test(h));
    }
  },
  timesheet: {
    name: 'Timesheet',
    icon: '⏱️',
    color: '#4338ca',
    priority: 20,
    detect: (h) => {
      return h.some(h => /^(hours|time.?spent|duration|hrs)/.test(h))
        && h.some(h => /^(project|client|task|work|activity|description)/.test(h))
        && h.some(h => /^(billable|rate|client|project)/.test(h));
    }
  },
  tracker: {
    name: 'Progress Tracker',
    icon: '📊',
    color: '#2563eb',
    priority: 20,
    detect: (h) => {
      return h.some(h => /^(progress|percent|%|score|rating|level|grade|completion)/.test(h))
        && h.some(h => /^(item|task|name|goal|metric|title|description|activity|habit)/.test(h));
    }
  },
  travel: {
    name: 'Travel Itinerary',
    icon: '✈️',
    color: '#0891b2',
    priority: 20,
    detect: (h) => {
      return h.some(h => /^(flight|hotel|booking|itinerary|accommodation|departure|arrival|transport)/.test(h) || /^(activity|event|attraction)/.test(h))
        && h.some(h => /^(booking|confirmation|ref|reservation|link|url|cost|price)/.test(h) || /flight|hotel|hostel|airbnb/.test(h));
    }
  },
  worker: {
    name: 'Worker Jobs',
    icon: '⚙️',
    color: '#0369a1',
    priority: 20,
    detect: (h) => {
      const hasJob      = h.some(h => /^(job|task|worker)$/.test(h));
      const hasHandler  = h.some(h => /^(handler|runner|type|kind)$/.test(h));
      const hasSchedule = h.some(h => /^(schedule|cron|interval|frequency|every)/.test(h));
      return hasJob && (hasHandler || hasSchedule);
    }
  },
};

/* ---------- Detection ---------- */

/**
 * Detect the best-matching template for the given headers.
 * Returns { key, template } where template is metadata.
 * Call loadTemplate(key) before using render functions.
 */
export function detectTemplate(headers) {
  if (!headers || headers.length === 0) {
    return { key: 'checklist', template: TEMPLATE_METADATA.checklist };
  }

  const lower = headers.map(h => (h || '').toLowerCase().trim());

  // Sort by priority (higher = more specific = preferred)
  const candidates = Object.entries(TEMPLATE_METADATA)
    .filter(([, t]) => t.detect(lower))
    .sort((a, b) => b[1].priority - a[1].priority);

  if (candidates.length > 0) {
    const [key, metadata] = candidates[0];
    return { key, template: metadata };
  }

  // Default to checklist
  return { key: 'checklist', template: TEMPLATE_METADATA.checklist };
}

/* ---------- Initialize TEMPLATES with Metadata ---------- */
/* Pre-populate the registry with lightweight metadata so */
/* code can access template.icon, template.name, etc. without */
/* waiting for lazy load. Full render functions added on loadTemplate(). */

for (const [key, metadata] of Object.entries(TEMPLATE_METADATA)) {
  if (!TEMPLATES[key]) {
    TEMPLATES[key] = metadata;
  }
}
