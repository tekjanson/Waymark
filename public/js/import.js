/* ============================================================
   import.js — Import existing Google Sheets into WayMark
   
   Uses code-based template detection from column headers,
   with manual column mapping for user control. Detects
   the best template match and lets users override both
   the template choice and individual column assignments.
   
   Imports are stored under Waymark/Imports/<template-type>/.
   ============================================================ */

import { api } from './api-client.js';
import { showToast } from './ui.js';
import { detectTemplate, TEMPLATES } from './templates/index.js';
import * as userData from './user-data.js';

/* ---------- Code-based import analysis ---------- */

/**
 * Human-readable descriptions for each template role.
 * Maps "templateKey.roleKey" to a user-friendly label.
 */
const ROLE_LABELS = {
  // Checklist
  'checklist.status': 'Completion Status (done/not done)',
  'checklist.text': 'Item Description',
  'checklist.category': 'Category / Section / Store',
  'checklist.date': 'Due Date',
  'checklist.notes': 'Notes',
  // Tracker
  'tracker.text': 'Goal / Item Name',
  'tracker.progress': 'Current Progress',
  'tracker.target': 'Target Value',
  'tracker.notes': 'Notes / Status',
  // Schedule
  'schedule.text': 'Activity / Event',
  'schedule.time': 'Time Slot',
  'schedule.day': 'Day / Date',
  'schedule.location': 'Location',
  // Inventory
  'inventory.text': 'Item Name',
  'inventory.quantity': 'Quantity / Stock Count',
  'inventory.category': 'Category / Section',
  'inventory.extra': 'Additional Info (price, notes, etc.)',
  // Contacts
  'contacts.name': 'Contact Name',
  'contacts.email': 'Email Address',
  'contacts.phone': 'Phone Number',
  'contacts.role': 'Role / Relationship',
  // Log
  'log.text': 'Activity / Entry',
  'log.timestamp': 'Date / Timestamp',
  'log.type': 'Category / Type',
  'log.duration': 'Duration',
  // Test Cases
  'testcases.text': 'Test Case Description',
  'testcases.result': 'Pass / Fail Result',
  'testcases.expected': 'Expected Outcome',
  'testcases.actual': 'Actual Outcome',
  'testcases.priority': 'Priority / Severity',
  'testcases.notes': 'Notes / Bug Details',
  // Budget
  'budget.text': 'Description / Item',
  'budget.amount': 'Amount ($)',
  'budget.category': 'Budget Category',
  'budget.date': 'Date',
  'budget.budget': 'Budget Limit',
  // Kanban
  'kanban.text': 'Task / Story',
  'kanban.description': 'Description / Details',
  'kanban.stage': 'Board Stage (to-do, in progress, done)',
  'kanban.project': 'Project / Epic',
  'kanban.assignee': 'Assignee',
  'kanban.priority': 'Priority Level',
  'kanban.due': 'Due Date / Deadline',
  'kanban.label': 'Label / Tag (feature, bug, etc.)',
  'kanban.note': 'Note / Comment',
  'kanban.reporter': 'Reported By / Submitter',
  // Habit
  'habit.text': 'Habit / Routine',
  'habit.weekOf': 'Week Of / Date',
  'habit.streak': 'Streak Count',
  'habit.days': 'Day Tracking (Mon–Sun)',
  // Grading
  'grading.student': 'Student Name',
  'grading.grade': 'Final Grade',
  'grading.assignments': 'Assignment Scores',
  // Timesheet
  'timesheet.text': 'Project / Task',
  'timesheet.hours': 'Hours Worked',
  'timesheet.client': 'Client / Customer',
  'timesheet.rate': 'Hourly Rate',
  'timesheet.billable': 'Billable (yes/no)',
  'timesheet.date': 'Date',
  // Poll
  'poll.text': 'Option / Choice',
  'poll.votes': 'Vote Count',
  'poll.percent': 'Percentage',
  'poll.notes': 'Notes',
  // Changelog
  'changelog.version': 'Version / Release',
  'changelog.date': 'Release Date',
  'changelog.type': 'Change Type (added, fixed, etc.)',
  'changelog.description': 'Change Description',
  // CRM
  'crm.company': 'Company / Lead',
  'crm.contact': 'Contact Person',
  'crm.stage': 'Deal Stage / Pipeline',
  'crm.value': 'Deal Value ($)',
  'crm.notes': 'Notes / Next Steps',
  // Content Workbench
  'marketing.post': 'Post / Content',
  'marketing.platform': 'Platform (Twitter, Reddit...)',
  'marketing.status': 'Status (Idea → Analyzing)',
  'marketing.topic': 'Topic / Theme',
  'marketing.date': 'Posted Date',
  'marketing.likes': 'Likes / Hearts',
  'marketing.shares': 'Shares / Reposts',
  'marketing.comments': 'Comments / Replies',
  'marketing.views': 'Views / Impressions',
  'marketing.link': 'Link / URL',
  'marketing.takeaway': 'Takeaway / Lesson',
  // Meal
  'meal.meal': 'Meal Type (breakfast, lunch, dinner)',
  'meal.recipe': 'Recipe / Dish Name',
  'meal.day': 'Day / Date',
  'meal.calories': 'Calories',
  'meal.protein': 'Protein (g)',
  // Travel
  'travel.activity': 'Activity / Booking',
  'travel.date': 'Date',
  'travel.location': 'Location / Destination',
  'travel.booking': 'Booking Reference',
  'travel.bookingLink': 'Booking Link (URL)',
  'travel.bookingDetails': 'Booking Details',
  'travel.cost': 'Cost ($)',
  // Roster
  'roster.employee': 'Employee / Team Member',
  'roster.role': 'Role / Position',
  'roster.shift': 'Shift / Schedule',
  'roster.days': 'Day Assignments',
  // Recipe (row-per-item: each ingredient and step is its own row)
  'recipe.text': 'Recipe Name',
  'recipe.servings': 'Number of Servings',
  'recipe.prepTime': 'Prep Time',
  'recipe.cookTime': 'Cook Time',
  'recipe.category': 'Cuisine / Category',
  'recipe.difficulty': 'Difficulty Level',
  'recipe.qty': 'Numeric Quantity (one per row)',
  'recipe.unit': 'Unit of Measure (g, cups, tbsp, etc.)',
  'recipe.quantity': 'Combined Quantity / Amount (legacy)',
  'recipe.ingredient': 'Ingredient Name (one per row)',
  'recipe.step': 'Step / Instruction (one per row)',
  'recipe.notes': 'Recipe Notes',
  'recipe.source': 'Source URL (attribution / re-sync)',
  // Flow Diagram
  'flow.flow': 'Flow / Process Name',
  'flow.step': 'Step / Node Label',
  'flow.type': 'Node Type (start, process, decision, end)',
  'flow.next': 'Next Step(s)',
  'flow.condition': 'Edge Label / Condition',
  'flow.notes': 'Notes / Description',
  // Social Feed
  'social.text': 'Post / Message content',
  'social.author': 'Author / Posted by',
  'social.date': 'Date / Timestamp',
  'social.category': 'Category / Type of post',
  'social.mood': 'Mood / Feeling emoji',
  'social.link': 'Link / URL',
  'social.comment': 'Comment / Reply',
  'social.likes': 'Likes / Engagement count',
  'social.image': 'Image / Photo URL',
  // Automation
  'automation.workflow': 'Workflow / Automation name',
  'automation.step': 'Step / Instruction description',
  'automation.action': 'Action (navigate, click, type, wait, assert)',
  'automation.target': 'Target (CSS selector, URL, or element)',
  'automation.value': 'Value / Input data',
  'automation.status': 'Status (pending, running, done, failed, skipped)',
  // Worker Jobs
  'worker.job': 'Job Name / Worker task name',
  'worker.handler': 'Handler / Runner type (poll, sync, notify, webhook, script)',
  'worker.config': 'Config / JSON params or URL',
  'worker.status': 'Status (pending, running, done, failed, scheduled)',
  'worker.schedule': 'Schedule / Cron expression (e.g. */5 * * * *)',
  'worker.lastRun': 'Last Run / Executed timestamp',
  'worker.result': 'Result / Output message or log line',
  // Blog
  'blog.title': 'Post Title',
  'blog.doc': 'Google Doc URL or ID (the blog post document)',
  'blog.date': 'Published Date',
  'blog.author': 'Author Name',
  'blog.category': 'Category / Topic',
  'blog.status': 'Status (Published / Draft)',
  // Instruction Guide
  'guide.guide': 'Guide / Task name',
  'guide.slide': 'Slide / Step headline',
  'guide.objective': 'Objective / Intended outcome',
  'guide.instruction': 'Instruction / Speaker notes',
  'guide.visual': 'Visual cue / Asset to show',
  'guide.duration': 'Duration / Estimated time',
  'guide.status': 'Status (Draft, In Progress, Ready, Done)',
  // Knowledge Base
  'knowledge.title': 'Article / Topic title',
  'knowledge.category': 'Category / Section',
  'knowledge.content': 'Content / Body text (one paragraph per row)',
  'knowledge.tags': 'Tags / Keywords (comma-separated)',
  'knowledge.author': 'Author / Contributor',
  'knowledge.updated': 'Last Updated Date',
  'knowledge.status': 'Status (Draft, Published, In Review, Archived)',
  'knowledge.source': 'Source URL / Reference',
  // Notification
  'notification.title': 'Title / Alert headline',
  'notification.message': 'Message / Alert body text',
  'notification.type': 'Type (alert, warning, info, success)',
  'notification.status': 'Status (Active, Read, Dismissed)',
  'notification.icon': 'Icon / Emoji',
  'notification.priority': 'Priority (high, medium, low)',
  'notification.created': 'Created / Timestamp',
  'notification.expires': 'Expires / Expiry date',
  'notification.source': 'Source / Origin system',
  'notification.sheet': 'Sheet / Related sheet ID',
  // IoT Sensor Dashboard
  'iot.sensor': 'Sensor / Device name',
  'iot.reading': 'Current sensor reading',
  'iot.unit': 'Unit of measure (C, %, V, etc.)',
  'iot.timestamp': 'Timestamp / Last update time',
  'iot.min': 'Minimum threshold',
  'iot.max': 'Maximum threshold',
  'iot.alert': 'Alert state (Normal, Watch, Alert, Offline)',
  // OKR / Goals
  'okr.objective': 'Objective / Goal name',
  'okr.keyResult': 'Key Result / Measurable outcome',
  'okr.progress': 'Progress (0%–100%)',
  'okr.target': 'Target / Success criteria',
  'okr.owner': 'Owner / DRI (Directly Responsible Individual)',
  'okr.quarter': 'Quarter (e.g. Q1 2026)',
  // Gantt Timeline
  'gantt.text': 'Task / Activity name',
  'gantt.start': 'Start Date (YYYY-MM-DD)',
  'gantt.end': 'End Date / Deadline (YYYY-MM-DD)',
  'gantt.progress': 'Progress (0%–100%)',
  'gantt.dependencies': 'Dependencies (comma-separated task names)',
  'gantt.assignee': 'Assignee / Owner',
  // Password Manager
  'passwords.site': 'Site / Service name',
  'passwords.username': 'Username / Login',
  'passwords.password': 'Password / Secret',
  'passwords.url': 'URL / Web address',
  'passwords.category': 'Category grouping',
  'passwords.notes': 'Notes',
  // Linker
  'linker.name': 'Entry Name / Community',
  'linker.description': 'Description / About',
  'linker.link': 'Sheet ID / URL',
  'linker.type': 'Entry Type (waymark or linker)',
  'linker.tags': 'Tags / Topics',
  'linker.icon': 'Icon / Emoji',
  // Arcade
  'arcade.game': 'Game Name',
  'arcade.player1': 'Player 1 / White / Home',
  'arcade.player2': 'Player 2 / Black / Away',
  'arcade.score': 'Score / Result',
  'arcade.status': 'Match Status / Outcome',
  'arcade.date': 'Date Played',
  // Photo Gallery
  'photos.photo': 'Photo URL / Google Drive Link',
  'photos.title': 'Title / Caption',
  'photos.date': 'Date Taken',
  'photos.album': 'Album / Category',
  'photos.description': 'Description / Notes',
  // Ledger
  'ledger.date': 'Date',
  'ledger.type': 'Type (Income / Expense / Transfer)',
  'ledger.category': 'Category / Account / GL Code',
  'ledger.text': 'Description / Narration',
  'ledger.amount': 'Amount ($)',
  'ledger.reference': 'Reference / Journal Entry # / Check #',
  'ledger.balance': 'Running Balance',
  // CMS — Content Scheduling and Publishing
  'cms.title': 'Post Title',
  'cms.type': 'Content Type (Blog Post, Newsletter, Page...)',
  'cms.status': 'Status (Draft, Scheduled, Published, Archived)',
  'cms.scheduled': 'Scheduled Publish Date',
  'cms.published': 'Actual Publish Date',
  'cms.author': 'Author / Writer',
  'cms.category': 'Category / Topic',
  'cms.notes': 'Notes',
  // Invoice
  'invoice.invoice': 'Invoice # / Quote # (primary row only)',
  'invoice.client': 'Client / Customer / Bill To',
  'invoice.date': 'Invoice Date',
  'invoice.due': 'Due Date / Payment Due',
  'invoice.status': 'Status (Draft, Sent, Viewed, Paid, Overdue, Cancelled)',
  'invoice.item': 'Item / Service / Product Description',
  'invoice.qty': 'Quantity / Units / Hours',
  'invoice.unitPrice': 'Unit Price / Rate / Cost',
  'invoice.notes': 'Notes / Payment Terms',
};

/**
 * Canonical header names that each template's detect() / columns() functions
 * recognise.  Used to rename columns when a user overrides the auto-detected
 * template so the imported sheet renders correctly when opened.
 *
 * Convention: pick the header name used in the existing fixtures / examples.
 */
const CANONICAL_HEADERS = {
  // Checklist
  'checklist.status': 'Status', 'checklist.text': 'Item',
  'checklist.date': 'Date', 'checklist.notes': 'Notes', 'checklist.category': 'Category',
  // Tracker
  'tracker.text': 'Goal', 'tracker.progress': 'Progress',
  'tracker.target': 'Target', 'tracker.notes': 'Notes',
  // Schedule
  'schedule.text': 'Activity', 'schedule.time': 'Time',
  'schedule.day': 'Day', 'schedule.location': 'Location',
  // Inventory
  'inventory.text': 'Item', 'inventory.quantity': 'Quantity',
  'inventory.category': 'Category', 'inventory.extra': 'Price',
  // Contacts
  'contacts.name': 'Name', 'contacts.email': 'Email',
  'contacts.phone': 'Phone', 'contacts.role': 'Role',
  // Log
  'log.text': 'Activity', 'log.timestamp': 'Date',
  'log.type': 'Type', 'log.duration': 'Duration',
  // Test Cases
  'testcases.text': 'Test Case', 'testcases.result': 'Result',
  'testcases.expected': 'Expected', 'testcases.actual': 'Actual',
  'testcases.priority': 'Priority', 'testcases.notes': 'Notes',
  // Budget
  'budget.text': 'Description', 'budget.amount': 'Amount',
  'budget.category': 'Category', 'budget.date': 'Date', 'budget.budget': 'Budget',
  // Kanban
  'kanban.text': 'Task', 'kanban.description': 'Description', 'kanban.stage': 'Stage',
  'kanban.project': 'Project', 'kanban.assignee': 'Assignee', 'kanban.priority': 'Priority',
  'kanban.due': 'Due', 'kanban.label': 'Label', 'kanban.note': 'Note',
  'kanban.reporter': 'Reported By',
  // Habit
  'habit.text': 'Habit', 'habit.weekOf': 'Week Of', 'habit.streak': 'Streak',
  // Grading
  'grading.student': 'Student', 'grading.grade': 'Grade',
  // Timesheet
  'timesheet.text': 'Project', 'timesheet.hours': 'Hours',
  'timesheet.client': 'Client', 'timesheet.rate': 'Rate',
  'timesheet.billable': 'Billable', 'timesheet.date': 'Date',
  // Poll
  'poll.text': 'Option', 'poll.votes': 'Votes',
  'poll.percent': 'Percent', 'poll.notes': 'Notes',
  // Changelog
  'changelog.version': 'Version', 'changelog.date': 'Date',
  'changelog.type': 'Type', 'changelog.description': 'Description',
  // CRM
  'crm.company': 'Company', 'crm.contact': 'Contact',
  'crm.stage': 'Deal Stage', 'crm.value': 'Value', 'crm.notes': 'Notes',
  // Content Workbench
  'marketing.post': 'Post', 'marketing.platform': 'Platform',
  'marketing.status': 'Status', 'marketing.topic': 'Topic',
  'marketing.date': 'Posted Date', 'marketing.likes': 'Likes',
  'marketing.shares': 'Shares', 'marketing.comments': 'Comments',
  'marketing.views': 'Views', 'marketing.link': 'Link',
  'marketing.takeaway': 'Takeaway',
  // Meal
  'meal.meal': 'Meal', 'meal.day': 'Day',
  'meal.recipe': 'Recipe', 'meal.calories': 'Calories', 'meal.protein': 'Protein',
  // Travel
  'travel.activity': 'Activity', 'travel.date': 'Date',
  'travel.location': 'Location', 'travel.booking': 'Booking',
  'travel.bookingLink': 'Booking Link', 'travel.bookingDetails': 'Booking Details',
  'travel.cost': 'Cost',
  // Roster
  'roster.employee': 'Employee', 'roster.role': 'Role', 'roster.shift': 'Shift',
  // Flow Diagram
  'flow.flow': 'Flow', 'flow.step': 'Step', 'flow.type': 'Type',
  'flow.next': 'Next', 'flow.condition': 'Condition', 'flow.notes': 'Notes',
  // Social Feed
  'social.text': 'Post', 'social.author': 'Author', 'social.date': 'Date',
  'social.category': 'Category', 'social.mood': 'Mood', 'social.link': 'Link',
  'social.comment': 'Comment', 'social.likes': 'Likes', 'social.image': 'Image',
  // Recipe
  'recipe.text': 'Recipe', 'recipe.servings': 'Servings',
  'recipe.prepTime': 'Prep Time', 'recipe.cookTime': 'Cook Time',
  'recipe.category': 'Category', 'recipe.difficulty': 'Difficulty',
  'recipe.qty': 'Qty', 'recipe.unit': 'Unit',
  'recipe.quantity': 'Quantity', 'recipe.ingredient': 'Ingredient',
  'recipe.step': 'Step', 'recipe.notes': 'Notes', 'recipe.source': 'Source',
  // Automation
  'automation.workflow': 'Workflow', 'automation.step': 'Step',
  'automation.action': 'Action', 'automation.target': 'Target',
  'automation.value': 'Value', 'automation.status': 'Status',
  // Instruction Guide
  'guide.guide': 'Guide', 'guide.slide': 'Slide',
  'guide.objective': 'Objective', 'guide.instruction': 'Instruction',
  'guide.visual': 'Visual', 'guide.duration': 'Duration',
  'guide.status': 'Status',
  // Knowledge Base
  'knowledge.title': 'Title', 'knowledge.category': 'Category',
  'knowledge.content': 'Content', 'knowledge.tags': 'Tags',
  'knowledge.author': 'Author', 'knowledge.updated': 'Updated',
  'knowledge.status': 'Status', 'knowledge.source': 'Source',
  // IoT Sensor Dashboard
  'iot.sensor': 'Sensor', 'iot.reading': 'Reading',
  'iot.unit': 'Unit', 'iot.timestamp': 'Timestamp',
  'iot.min': 'Min', 'iot.max': 'Max', 'iot.alert': 'Alert',
  // OKR / Goals
  'okr.objective': 'Objective', 'okr.keyResult': 'Key Result',
  'okr.progress': 'Progress', 'okr.target': 'Target',
  'okr.owner': 'Owner', 'okr.quarter': 'Quarter',
  // Gantt Timeline
  'gantt.text': 'Task', 'gantt.start': 'Start Date',
  'gantt.end': 'End Date', 'gantt.progress': 'Progress',
  'gantt.dependencies': 'Dependencies', 'gantt.assignee': 'Assignee',
  // Password Manager
  'passwords.site': 'Site', 'passwords.username': 'Username',
  'passwords.password': 'Password', 'passwords.url': 'URL',
  'passwords.category': 'Category', 'passwords.notes': 'Notes',
  // Linker
  'linker.name': 'Name', 'linker.description': 'Description',
  'linker.link': 'Link', 'linker.type': 'Type',
  'linker.tags': 'Tags', 'linker.icon': 'Icon',
  // Arcade
  'arcade.game': 'Game', 'arcade.player1': 'Player 1',
  'arcade.player2': 'Player 2', 'arcade.score': 'Score',
  'arcade.status': 'Status', 'arcade.date': 'Date',
  // Worker Jobs
  'worker.job': 'Job', 'worker.handler': 'Handler',
  'worker.config': 'Config', 'worker.status': 'Status',
  'worker.schedule': 'Schedule', 'worker.lastRun': 'Last Run',
  'worker.result': 'Result',
  // Photo Gallery
  'photos.photo': 'Photo', 'photos.title': 'Title',
  'photos.date': 'Date', 'photos.album': 'Album',
  'photos.description': 'Description',
  // Ledger
  'ledger.date': 'Date', 'ledger.type': 'Type',
  'ledger.category': 'Category', 'ledger.text': 'Description',
  'ledger.amount': 'Amount', 'ledger.reference': 'Reference',
  'ledger.balance': 'Balance',
  // Invoice
  'invoice.invoice': 'Invoice #', 'invoice.client': 'Client',
  'invoice.date': 'Date', 'invoice.due': 'Due Date',
  'invoice.status': 'Status', 'invoice.item': 'Item',
  'invoice.qty': 'Qty', 'invoice.unitPrice': 'Unit Price',
  'invoice.notes': 'Notes',
  // CMS
  'cms.title': 'Title', 'cms.type': 'Type',
  'cms.status': 'Status', 'cms.scheduled': 'Scheduled',
  'cms.published': 'Published', 'cms.author': 'Author',
  'cms.category': 'Category', 'cms.notes': 'Notes',
};

/**
 * Score each template against the given headers and return a sorted ranking.
 * Examines both header-name detection and how many column roles can be filled.
 * @param {string[]} headers  original header strings
 * @returns {{ key: string, name: string, score: number, matchCount: number, totalRoles: number, colMap: Object }[]}
 */
function scoreAllTemplates(headers) {
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  const results = [];

  for (const [key, template] of Object.entries(TEMPLATES)) {
    const detected = template.detect(lower);
    let matchCount = 0;
    let totalRoles = 0;
    let colMap = {};

    if (typeof template.columns === 'function') {
      try {
        colMap = template.columns(lower);
        for (const [role, idx] of Object.entries(colMap)) {
          if (Array.isArray(idx)) {
            // Array roles (days, assignments) — count matched entries
            totalRoles += 1;
            if (idx.length > 0) matchCount += 1;
          } else {
            totalRoles += 1;
            if (idx >= 0 && idx < headers.length) matchCount += 1;
          }
        }
      } catch { /* skip */ }
    }

    // Score: 0-1 range
    // - 40% weight: whether detect() returned true
    // - 40% weight: ratio of filled column roles
    // - 20% weight: bonus for higher template priority (more specific patterns)
    const detectScore = detected ? 0.4 : 0;
    const fillRatio = totalRoles > 0 ? (matchCount / totalRoles) * 0.4 : 0;
    const priorityBonus = Math.min(template.priority / 30, 1) * 0.2;
    const score = detectScore + fillRatio + priorityBonus;

    results.push({
      key,
      name: template.name,
      score: Math.round(score * 100) / 100,
      matchCount,
      totalRoles,
      colMap,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Analyze a spreadsheet using the built-in template detection engine.
 * Pure column-header heuristics with comprehensive
 * multi-template scoring and user-friendly column descriptions.
 * @param {Object} sheetData  { id, title, sheetTitle, values }
 * @returns {Object}  analysis result
 */
export function analyzeWithCode(sheetData) {
  const headers = sheetData.values?.[0] || [];
  const lowerHeaders = headers.map(h => (h || '').toLowerCase().trim());
  const dataRows = (sheetData.values || []).slice(1);

  // Score every template and pick the best
  const ranking = scoreAllTemplates(headers);
  const best = ranking[0] || { key: 'checklist', name: 'Checklist', score: 0.3, colMap: {}, matchCount: 0, totalRoles: 1 };

  // Also get the canonical detection result for comparison
  const { key: detectedKey, template: detectedTemplate } = detectTemplate(headers);
  const actualKey = best.score > 0.35 ? best.key : detectedKey;
  const actualTemplate = TEMPLATES[actualKey] || detectedTemplate;

  // Build column mapping with friendly labels
  const columnMapping = {};
  let colMap = best.colMap;

  // If we switched template from scoring, re-compute columns
  if (actualKey !== best.key && typeof actualTemplate.columns === 'function') {
    try { colMap = actualTemplate.columns(lowerHeaders); } catch { /* keep best.colMap */ }
  }

  // Reverse-map: column index → role key
  const indexToRole = {};
  for (const [role, idx] of Object.entries(colMap)) {
    if (Array.isArray(idx)) {
      // Array roles: mark each index
      for (const i of idx) {
        if (i >= 0 && i < headers.length) {
          indexToRole[i] = role;
        }
      }
    } else if (idx >= 0 && idx < headers.length) {
      indexToRole[idx] = role;
    }
  }

  // For each header, provide a user-friendly description
  headers.forEach((h, i) => {
    const role = indexToRole[i];
    if (role) {
      const friendlyLabel = ROLE_LABELS[`${actualKey}.${role}`];
      columnMapping[h] = friendlyLabel || role;
    } else {
      columnMapping[h] = '(unmatched — will be kept as-is)';
    }
  });

  // Calculate confidence based on multiple signals
  const detected = actualTemplate.detect(lowerHeaders);
  let confidence;
  if (!detected) {
    confidence = 0.2 + (best.matchCount > 0 ? 0.1 : 0);
  } else {
    // Base 0.5 for detection, up to +0.35 for column fill, +0.15 for data rows
    const totalRoles = best.totalRoles || 1;
    const fillBonus = (best.matchCount / totalRoles) * 0.35;
    const dataBonus = dataRows.length > 0 ? Math.min(dataRows.length / 10, 1) * 0.15 : 0;
    confidence = Math.min(0.5 + fillBonus + dataBonus, 0.95);
  }

  // Build a helpful summary
  const matchInfo = best.totalRoles > 0
    ? `Matched ${best.matchCount} of ${best.totalRoles} expected column roles.`
    : '';
  const runner = ranking[1];
  const runnerNote = runner && runner.score > 0.3
    ? ` Runner-up: "${runner.name}" (${Math.round(runner.score * 100)}%).`
    : '';
  const summary = `Detected as "${actualTemplate.name}" template using column pattern matching (${Math.round(confidence * 100)}% confidence). ${matchInfo}${runnerNote}`.trim();

  return {
    method: 'code',
    suggestedTemplate: actualKey,
    templateName: actualTemplate.name,
    confidence: Math.round(confidence * 100) / 100,
    columnMapping,
    suggestedHeaders: headers,
    summary,
    originalHeaders: headers,
    rowCount: Math.max(0, (sheetData.values?.length || 1) - 1),
  };
}

/* ---------- Template roles for manual column mapping ---------- */

/**
 * Get the available column roles for a given template.
 * Used by the import UI to let users manually assign columns.
 * @param {string} templateKey
 * @returns {{ key: string, label: string }[]}
 */
export function getTemplateRoles(templateKey) {
  const roles = [];
  const prefix = `${templateKey}.`;
  for (const [fullKey, label] of Object.entries(ROLE_LABELS)) {
    if (fullKey.startsWith(prefix)) {
      roles.push({ key: fullKey.slice(prefix.length), label });
    }
  }
  return roles;
}

/* ---------- Import execution ---------- */

/**
 * Import a spreadsheet into WayMark by copying it into a WayMark-managed folder.
 * Creates sheets inside the Waymark/Imports/<template-type>/ directory.
 * @param {Object} sheetData    full sheet data { id, title, values }
 * @param {Object} analysis     analysis result from analyzeWithCode
 * @param {Object} [options]    import options
 * @param {boolean} [options.remap]        whether to remap columns per analysis suggestion (default: false)
 * @param {string}  [options.template]     override template key
 * @param {function} [options.onProgress]  progress callback
 * @returns {Promise<{sheetId: string, folderId: string}>}
 */
export async function importSheet(sheetData, analysis, options = {}) {
  const { remap = false, template, columnMapping, onProgress = () => {} } = options;

  onProgress('Setting up Waymark/Imports folder…');

  // Get the Imports folder inside the Waymark directory
  const importsFolderId = await userData.getImportsFolderId();

  // Determine the template subfolder name
  const templateKey = template || analysis.suggestedTemplate;
  const templateDef = TEMPLATES[templateKey];
  const subfolderName = templateDef?.name || templateKey;

  // Find or create template subfolder inside Waymark/Imports/
  onProgress(`Setting up "${subfolderName}" folder…`);
  let subfolder = await api.drive.findFolder(subfolderName, importsFolderId);
  if (!subfolder) {
    subfolder = await api.drive.createFile(
      subfolderName,
      'application/vnd.google-apps.folder',
      [importsFolderId]
    );
  }

  // Build the data rows
  let headers = sheetData.values?.[0] || [];
  let dataRows = (sheetData.values || []).slice(1);

  // When user overrides the template, rename headers so the chosen
  // template's detect() / columns() recognise them when the sheet is
  // next opened.  This uses the user's column-role assignments from
  // the mapping editor + the CANONICAL_HEADERS table.
  if (columnMapping && templateKey) {
    onProgress('Remapping columns…');
    const remapped = remapForTemplate(headers, dataRows, templateKey, columnMapping);
    headers = remapped.headers;
    dataRows = remapped.rows;
  } else if (remap && analysis.suggestedHeaders && analysis.columnMapping) {
    // Legacy remap path — reorder columns per analysis suggestion
    onProgress('Remapping columns…');
    const remapped = remapData(headers, dataRows, analysis);
    headers = remapped.headers;
    dataRows = remapped.rows;
  }

  // Create the new spreadsheet
  const title = sheetData.title || 'Imported Sheet';
  onProgress(`Creating "${title}"…`);
  const rows = [headers, ...dataRows];
  const created = await api.sheets.createSpreadsheet(title, rows, subfolder.id);

  onProgress(`Imported "${title}" into ${subfolderName} folder.`);
  showToast(`Imported "${title}" successfully`, 'success');

  // Record in import history
  userData.addImportEntry({
    sheetId: created.spreadsheetId,
    sheetName: title,
    templateKey: templateKey,
  });

  return {
    sheetId: created.spreadsheetId,
    folderId: subfolder.id,
  };
}

/**
 * Rename headers so the target template's detect() / columns() recognise them.
 * Uses the user's column-role assignments (from the mapping editor UI) and the
 * CANONICAL_HEADERS lookup to derive the correct header name for each column.
 *
 * Data rows are returned unchanged — only header strings are renamed.
 *
 * @param {string[]} origHeaders
 * @param {string[][]} origRows
 * @param {string} templateKey   target template key (e.g. 'recipe')
 * @param {Object} columnMapping  { sourceHeader: roleKey | '(keep as-is)' }
 * @returns {{ headers: string[], rows: string[][] }}
 */
function remapForTemplate(origHeaders, origRows, templateKey, columnMapping) {
  const newHeaders = origHeaders.map(h => {
    const role = columnMapping[h];
    if (!role || role === '(keep as-is)') return h;
    const canonical = CANONICAL_HEADERS[`${templateKey}.${role}`];
    return canonical || h;
  });
  return { headers: newHeaders, rows: origRows };
}

/**
 * Remap data rows according to the suggested column mapping.
 * @param {string[]} origHeaders
 * @param {string[][]} origRows
 * @param {Object} analysis
 * @returns {{ headers: string[], rows: string[][] }}
 */
function remapData(origHeaders, origRows, analysis) {
  const { suggestedHeaders, columnMapping } = analysis;

  // If no meaningful remap, return as-is
  if (!suggestedHeaders || suggestedHeaders.length === 0) {
    return { headers: origHeaders, rows: origRows };
  }

  // Build a reverse map: suggested header → original column index
  const origIndex = {};
  origHeaders.forEach((h, i) => { origIndex[h] = i; });

  // Map: for each suggested header, find the original column
  const reverseMap = {};
  for (const [origCol, mappedName] of Object.entries(columnMapping)) {
    reverseMap[mappedName] = origIndex[origCol];
  }

  // Use suggested headers as the new header row
  const newHeaders = suggestedHeaders;
  const newRows = origRows.map(row => {
    return newHeaders.map(h => {
      // Try reverse map first
      const idx = reverseMap[h];
      if (idx !== undefined && idx < row.length) return row[idx] || '';
      // Try matching original header directly
      const directIdx = origIndex[h];
      if (directIdx !== undefined && directIdx < row.length) return row[directIdx] || '';
      return '';
    });
  });

  return { headers: newHeaders, rows: newRows };
}

/* ---------- Browse & fetch files for import ---------- */

/**
 * Open the Google Picker to let the user select importable files.
 * Replaces the old listImportableSheets() which needed drive.readonly.
 * @returns {Promise<Object[]|null>}  array of { id, name, mimeType } or null if cancelled
 */
export async function pickImportFiles() {
  return api.picker.pickFilesForImport();
}

/**
 * List available files (spreadsheets + documents) the user can import.
 * @deprecated Use pickImportFiles() instead — this requires drive.readonly scope.
 * @returns {Promise<Object[]>}
 */
export async function listImportableSheets() {
  const result = await api.drive.listImportableFiles();
  return result.files || [];
}

/**
 * Fetch a sheet's full data for import preview.
 * @param {string} sheetId
 * @returns {Promise<Object>}
 */
export async function fetchSheetForImport(sheetId) {
  return api.sheets.getSpreadsheet(sheetId);
}

/**
 * Fetch a Google Doc's content and convert to sheet-like rows for import.
 * Handles:
 *   - Tab-separated or comma-separated structured tables
 *   - Plain-text lists with section/category headers (lines ending in ":")
 *   - Simple unstructured lists (one item per line)
 *
 * Section headers (e.g. "Dairy & Juice:", "From White Barn Farm:") are detected
 * and turned into a Category column, producing a proper [Item, Category, Status]
 * table so template detection picks "Checklist" correctly.
 *
 * @param {string} docId
 * @param {string} docName
 * @returns {Promise<Object>}  { id, title, values: string[][] }
 */
export async function fetchDocForImport(docId, docName) {
  const text = await api.drive.exportDoc(docId);

  // Try to parse as a table: lines → rows, split by tabs or commas
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) {
    return { id: docId, title: docName, values: [] };
  }

  // Detect delimiter: prefer tabs, then commas, then treat lines as free-text list
  const tabCount = (lines[0].match(/\t/g) || []).length;
  const commaCount = (lines[0].match(/,/g) || []).length;
  let delimiter;
  if (tabCount >= 1) delimiter = '\t';
  else if (commaCount >= 2) delimiter = ',';
  else delimiter = null; // free-text

  let values;
  if (delimiter) {
    values = lines.map(line => line.split(delimiter).map(cell => cell.trim()));
  } else {
    // Free-text: detect section-header pattern (lines ending with ":")
    // e.g. "From White Barn Farm:", "Dairy & Juice:", "And most importantly:"
    values = parseTextList(lines);
  }

  return { id: docId, title: docName, values };
}

/**
 * Parse a plain-text list into a spreadsheet-like 2D array.
 *
 * Recognises:
 *   - **Section headers** — lines ending with `:` (optionally with only capital
 *     letters / short phrases).  These become the Category value for subsequent items.
 *   - **Items with quantity** — e.g. "Bagels x2" → item "Bagels", quantity "x2"
 *   - **Plain items** — one item per remaining line
 *
 * Output always has the header row  ["Item", "Category", "Status"]  so template
 * detection reliably matches Checklist.
 *
 * @param {string[]} lines  trimmed, non-empty lines
 * @returns {string[][]}
 */
function parseTextList(lines) {
  // Heuristic: a line is a section header if it ends with ":" and is
  // reasonably short (≤ 60 chars), OR is ALL-CAPS with no colon.
  const isSectionHeader = (line) => {
    if (/:\s*$/.test(line) && line.length <= 60) return true;
    // ALL-CAPS lines that look like emphasis headers (e.g. "CHOCOLATE")
    // are NOT section headers — they're items.  Only treat all-caps lines
    // that end with ":" as headers.
    return false;
  };

  const rows = [['Item', 'Category', 'Status']];
  let currentCategory = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isSectionHeader(line)) {
      // Strip trailing colon for a clean category name
      currentCategory = line.replace(/:\s*$/, '').trim();
      continue;
    }

    // Extract optional quantity suffix like "x2", "× 3"
    const qtyMatch = line.match(/^(.+?)\s+[x×]\s*(\d+)\s*$/i);
    const item = qtyMatch ? qtyMatch[1].trim() : line;
    // We don't add a Quantity column to keep things simple — the "x2"
    // stays in the item name which is perfectly fine for a shopping list.

    rows.push([item, currentCategory, '']);
  }

  return rows;
}

/* ---------- Template list for UI ---------- */

/**
 * Get all available templates for manual template selection.
 * @returns {{ key: string, name: string, icon: string }[]}
 */
export function getTemplateList() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key,
    name: t.name,
    icon: t.icon || '📋',
  }));
}
