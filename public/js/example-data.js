/* ============================================================
   example-data.js — Sample spreadsheet definitions
   
   Pure data, no side effects.  Each entry describes a sheet
   title, folder, column headers, and row data used by
   generateExamples() to populate the user's Google Drive.
   ============================================================ */

export const EXAMPLE_SHEETS = {

  /* ---- Checklist examples ---- */
  'Grocery List': {
    folder: 'Checklists',
    headers: ['Item', 'Status', 'Quantity', 'Notes'],
    rows: [
      ['Milk',            'done', '2',      'Whole milk'],
      ['Eggs',            'done', '12',     'Free range'],
      ['Bread',           '',     '1',      'Sourdough'],
      ['Butter',          '',     '1',      'Unsalted'],
      ['Chicken Breast',  'done', '2 lbs',  'Organic'],
      ['Spinach',         '',     '1 bag',  'Baby spinach'],
      ['Tomatoes',        'done', '6',      'Roma'],
      ['Cheese',          '',     '1',      'Cheddar block'],
      ['Rice',            'done', '1 bag',  'Jasmine 5 lb'],
      ['Olive Oil',       '',     '1',      'Extra virgin'],
    ],
  },

  'Moving Day Checklist': {
    folder: 'Checklists',
    headers: ['Task', 'Done', 'Due', 'Notes'],
    rows: [
      ['Get moving boxes',        'yes', '2 weeks before', 'Home Depot or U-Haul'],
      ['Change address at USPS',  'yes', '2 weeks before', 'usps.com'],
      ['Pack non-essentials',     'yes', '1 week before',  'Books, decor, off-season clothes'],
      ['Clean out fridge',        '',    '2 days before',  'Donate perishables'],
      ['Defrost freezer',         '',    '1 day before',   'Unplug night before'],
      ['Pack an essentials box',  '',    'Day before',     'Toiletries, chargers, snacks, tools'],
      ['Final walkthrough',       '',    'Moving day',     'Check all rooms, closets, garage'],
      ['Transfer utilities',      '',    'Moving day',     'Electric, water, internet'],
      ['Update driver license',   '',    '1 week after',   'Visit DMV or online'],
      ['Unpack kitchen first',    '',    'Day 1',          'Makes everything easier'],
    ],
  },

  /* ---- Tracker examples ---- */
  'Fitness Goals': {
    folder: 'Trackers',
    headers: ['Goal', 'Progress', 'Target', 'Notes'],
    rows: [
      ['Run a 5K',           '4.2',  '5',    'Building up distance'],
      ['Pushups in a row',   '35',   '50',   'Up from 20 last month'],
      ['Plank hold (min)',   '2.5',  '5',    'Core strength'],
      ['Pull-ups',           '8',    '15',   'Wide grip'],
      ['Weight loss (lbs)',  '12',   '20',   'Since January'],
      ['Daily steps',        '8500', '10000','Average this week'],
      ['Meditation (min)',   '15',   '20',   'Morning routine'],
      ['Sleep hours',        '7.2',  '8',    'Improved from 6.5'],
    ],
  },

  'Reading List': {
    folder: 'Trackers',
    headers: ['Title', 'Progress', 'Target', 'Status'],
    rows: [
      ['Atomic Habits',              '100', '100', 'Finished!'],
      ['Deep Work',                  '75',  '100', 'Almost done'],
      ['The Design of Everyday Things','40','100', 'Reading'],
      ['Thinking, Fast and Slow',    '20',  '100', 'Started'],
      ['Clean Code',                 '60',  '100', 'Halfway'],
      ['The Pragmatic Programmer',   '0',   '100', 'On my list'],
    ],
  },

  /* ---- Schedule examples ---- */
  'Weekly Schedule': {
    folder: 'Schedules',
    headers: ['Day', 'Time', 'Activity', 'Location'],
    rows: [
      ['Monday',    '8:00 AM',  'Team Standup',     'Conference Room A'],
      ['Monday',    '10:00 AM', 'Design Review',    'Zoom'],
      ['Monday',    '2:00 PM',  'Client Call',      'Phone'],
      ['Tuesday',   '9:00 AM',  'Sprint Planning',  'Conference Room B'],
      ['Tuesday',   '1:00 PM',  'Code Review',      'Desk'],
      ['Wednesday', '8:00 AM',  'Team Standup',     'Conference Room A'],
      ['Wednesday', '11:00 AM', 'Lunch & Learn',    'Break Room'],
      ['Thursday',  '9:00 AM',  'Focus Time',       'Home Office'],
      ['Thursday',  '3:00 PM',  '1-on-1 Manager',   'Zoom'],
      ['Friday',    '8:00 AM',  'Team Standup',     'Conference Room A'],
      ['Friday',    '10:00 AM', 'Demo Day',         'All Hands Room'],
      ['Friday',    '2:00 PM',  'Retro',            'Conference Room B'],
    ],
  },

  'Meal Plan': {
    folder: 'Schedules',
    headers: ['Day', 'Time', 'Activity', 'Location'],
    rows: [
      ['Monday',    'Breakfast', 'Oatmeal with berries',    'Home'],
      ['Monday',    'Lunch',     'Grilled chicken salad',   'Work cafeteria'],
      ['Monday',    'Dinner',    'Salmon with vegetables',  'Home'],
      ['Tuesday',   'Breakfast', 'Greek yogurt & granola',  'Home'],
      ['Tuesday',   'Lunch',     'Turkey wrap',             'Desk'],
      ['Tuesday',   'Dinner',    'Pasta primavera',         'Home'],
      ['Wednesday', 'Breakfast', 'Smoothie bowl',           'Home'],
      ['Wednesday', 'Lunch',     'Leftover pasta',          'Desk'],
      ['Wednesday', 'Dinner',    'Stir fry with tofu',      'Home'],
    ],
  },

  /* ---- Inventory examples ---- */
  'Pantry Inventory': {
    folder: 'Inventories',
    headers: ['Item', 'Quantity', 'Category', 'Expires'],
    rows: [
      ['Jasmine Rice',     '5 lbs',    'Grains',   '2026-06-01'],
      ['Black Beans',      '4 cans',   'Canned',   '2027-03-15'],
      ['Pasta',            '3 boxes',  'Grains',   '2026-12-01'],
      ['Olive Oil',        '750 ml',   'Oils',     '2026-09-01'],
      ['Diced Tomatoes',   '6 cans',   'Canned',   '2027-01-10'],
      ['Flour',            '2 lbs',    'Baking',   '2026-04-15'],
      ['Sugar',            '3 lbs',    'Baking',   '2027-06-01'],
      ['Soy Sauce',        '1 bottle', 'Sauces',   '2027-01-01'],
      ['Chicken Broth',    '2 cartons','Canned',   '2026-08-20'],
      ['Peanut Butter',    '1 jar',    'Spreads',  '2026-11-15'],
    ],
  },

  /* ---- Contacts examples ---- */
  'Emergency Contacts': {
    folder: 'Contacts',
    headers: ['Name', 'Phone', 'Email', 'Relationship'],
    rows: [
      ['Dr. Sarah Johnson',  '555-0101', 'sjohnson@medical.com',   'Primary Doctor'],
      ['Mike Chen',           '555-0102', 'mike.c@email.com',      'Spouse'],
      ['Lisa Park',           '555-0103', 'lisa.park@email.com',    'Parent'],
      ['Tom Williams',        '555-0104', 'twilliam@work.com',     'Manager'],
      ['City Hospital',       '555-0911', 'info@cityhospital.org',  'Hospital'],
      ['Home Insurance',      '555-0200', 'claims@insure.com',     'Insurance'],
      ['Plumber (Joe)',       '555-0301', '',                       'Home Service'],
      ['Vet — Happy Paws',   '555-0402', 'appt@happypaws.com',    'Pet Care'],
    ],
  },

  /* ---- Log examples ---- */
  'Workout Log': {
    folder: 'Logs',
    headers: ['Timestamp', 'Activity', 'Duration', 'Type'],
    rows: [
      ['2026-02-27 07:00', 'Morning run — 5K',           '28 min',  'Cardio'],
      ['2026-02-26 18:00', 'Upper body strength',         '45 min',  'Strength'],
      ['2026-02-26 07:15', 'Yoga flow',                   '30 min',  'Flexibility'],
      ['2026-02-25 17:30', 'HIIT circuit',                '25 min',  'Cardio'],
      ['2026-02-24 07:00', 'Morning run — 3K easy',       '18 min',  'Cardio'],
      ['2026-02-23 18:00', 'Lower body strength',         '50 min',  'Strength'],
      ['2026-02-22 07:30', 'Swimming laps',               '40 min',  'Cardio'],
      ['2026-02-21 17:00', 'Rest day — stretching only',  '15 min',  'Recovery'],
    ],
  },

  /* ---- Test Cases examples ---- */
  'Login Feature Tests': {
    folder: 'Test Cases',
    headers: ['Test Case', 'Result', 'Expected', 'Actual', 'Priority', 'Notes'],
    rows: [
      ['Valid username and password',  'Pass',     'Redirect to dashboard', 'Redirect to dashboard', 'High',   ''],
      ['Invalid password',             'Fail',     'Show error message',    'Page crashes',          'High',   'Bug #142'],
      ['Empty username field',         'Pass',     'Show validation error', 'Show validation error', 'Medium', ''],
      ['Empty password field',         'Pass',     'Show validation error', 'Show validation error', 'Medium', ''],
      ['SQL injection in username',    'Pass',     'Input sanitised',       'Input sanitised',       'High',   'Security test'],
      ['Remember me checkbox',         'Blocked',  'Stay logged in 30 days','Cannot test — staging', 'Low',    'Waiting on DevOps'],
      ['Password reset link',          'Skip',     'Email sent within 1 min','',                    'Medium', 'Deferred to sprint 5'],
      ['OAuth Google login',           'Untested', 'Redirect to Google',    '',                     'High',   ''],
      ['2FA code entry',               'Fail',     'Accept valid TOTP',     'Timeout after 10 s',   'High',   'Bug #158'],
      ['Account lockout after 5 tries','Pass',     'Lock for 15 min',       'Lock for 15 min',      'High',   ''],
    ],
  },

  'API Endpoint Tests': {
    folder: 'Test Cases',
    headers: ['Test Case', 'Result', 'Expected', 'Actual', 'Priority'],
    rows: [
      ['GET /users returns 200',      'Pass',     '200 OK',         '200 OK',          'High'],
      ['POST /users creates user',    'Pass',     '201 Created',    '201 Created',     'High'],
      ['DELETE /users/:id',           'Fail',     '204 No Content', '500 Server Error', 'High'],
      ['GET /users/:id not found',    'Pass',     '404 Not Found',  '404 Not Found',   'Medium'],
      ['PUT /users/:id updates user', 'Untested', '200 OK',         '',                'Medium'],
      ['Auth token expired',          'Pass',     '401 Unauthorized','401 Unauthorized','High'],
    ],
  },

  /* ---- Budget examples ---- */
  'Monthly Budget': {
    folder: 'Budgets',
    headers: ['Description', 'Amount', 'Category', 'Date', 'Budget'],
    rows: [
      ['Salary',            '5000',  'Income',        '2026-03-01', ''],
      ['Rent',              '-1500', 'Housing',       '2026-03-01', '1500'],
      ['Groceries',         '-420',  'Food',          '2026-03-05', '500'],
      ['Electric Bill',     '-95',   'Utilities',     '2026-03-08', '120'],
      ['Internet',          '-70',   'Utilities',     '2026-03-08', '70'],
      ['Gas',               '-55',   'Transport',     '2026-03-10', '80'],
      ['Dining Out',        '-85',   'Food',          '2026-03-12', '150'],
      ['Gym Membership',    '-45',   'Health',        '2026-03-15', '45'],
      ['Freelance Work',    '800',   'Income',        '2026-03-18', ''],
      ['Streaming Services','-32',   'Entertainment', '2026-03-20', '50'],
    ],
  },

  'Vacation Budget': {
    folder: 'Budgets',
    headers: ['Description', 'Amount', 'Category', 'Budget'],
    rows: [
      ['Flight tickets',     '-650',  'Travel',        '700'],
      ['Hotel — 5 nights',   '-900',  'Accommodation', '1000'],
      ['Car rental',         '-280',  'Travel',        '300'],
      ['Restaurants',        '-350',  'Food',          '400'],
      ['Activities & tours', '-200',  'Entertainment', '250'],
      ['Souvenirs',          '-75',   'Shopping',      '100'],
      ['Travel insurance',   '-120',  'Insurance',     '120'],
      ['Emergency fund',     '500',   'Reserve',       ''],
    ],
  },

  /* ---- Kanban examples ---- */
  'Project Board': {
    folder: 'Kanban',
    headers: ['Task', 'Description', 'Stage', 'Project', 'Assignee', 'Priority', 'Due', 'Label', 'Note', 'Reported By'],
    rows: [
      ['Design login page',    'Build the auth UI with email/password and OAuth buttons', 'Done',        'Frontend', 'Alice',  'P0', '2026-02-20', 'feature', '', 'Carol'],
      ['',                     'Create wireframes in Figma',                              'Done',        '',         'Alice',  '',   '2026-02-15', '',        '', ''],
      ['',                     'Implement form validation',                               'Done',        '',         'Alice',  '',   '2026-02-18', '',        '', ''],
      ['',                     '',                                                        '',            '',         'Bob',    '',   '2026-02-20', '',        'Looks amazing, great work!', ''],
      ['Set up CI pipeline',   'Configure GitHub Actions for lint, test, and deploy',      'In Progress', 'DevOps',   'Bob',    'P1', '2026-03-10', 'infra',   '', 'Alice'],
      ['',                     'Add lint step to workflow',                                'Done',        '',         'Bob',    '',   '2026-03-05', '',        '', ''],
      ['',                     'Add Playwright test step',                                'In Progress', '',         'Bob',    '',   '2026-03-08', '',        '', ''],
      ['Write API docs',       'Document all REST endpoints with examples',                'In Progress', 'Backend',  'Carol',  'P2', '2026-03-15', 'docs',    '', 'Bob'],
      ['Add dark mode',        'Implement dark theme using CSS custom properties',         'To Do',       'Frontend', 'Alice',  'P2', '2026-03-20', 'feature', '', 'Carol'],
      ['Fix nav bug',          'Sidebar collapses unexpectedly on mobile viewports',       'Done',        'Frontend', 'Bob',    'P0', '2026-02-25', 'bug',     '', 'Alice'],
      ['Implement search',     'Full-text search across all sheets with highlighting',     'Backlog',     'Frontend', '',       'P1', '',           'feature', '', 'Bob'],
      ['Database migration',   'Migrate user settings from v1 to v2 schema',               'To Do',       'Backend',  'Carol',  'P1', '2026-03-12', 'infra',   '', 'Carol'],
      ['User onboarding flow', 'Interactive tutorial for first-time users',                 'Backlog',     'Frontend', '',       'P2', '',           'feature', '', 'Alice'],
      ['Performance audit',    'Profile and optimize initial load and sheet rendering',     'In Progress', 'Frontend', 'Alice',  'P1', '2026-03-08', 'infra',   '', 'Bob'],
    ],
  },

  'Product Roadmap': {
    folder: 'Kanban',
    headers: ['Task', 'Description', 'Stage', 'Project', 'Assignee', 'Priority', 'Due', 'Label', 'Note', 'Reported By'],
    rows: [
      ['Multi-language support', 'Add i18n framework and translate all UI strings',         'Backlog',     'Platform',  'Product', 'P2', '',           'feature', '', 'Product'],
      ['Mobile app v2',          'Complete redesign of the mobile experience',               'In Progress', 'Mobile',    'Mobile',  'P0', '2026-04-01', 'feature', '', 'Product'],
      ['',                       'Redesign navigation for thumb-friendly use',               'Done',        '',          'Mobile',  '',   '2026-03-10', '',        '', ''],
      ['',                       'Implement offline sync',                                   'In Progress', '',          'Mobile',  '',   '2026-03-25', '',        '', ''],
      ['Analytics dashboard',    'Build real-time usage analytics with charts',              'To Do',       'Data',      'Data',    'P1', '2026-03-30', 'feature', '', 'Frontend'],
      ['SSO integration',        'Support SAML and OIDC for enterprise customers',          'Done',        'Platform',  'Backend', 'P1', '2026-02-15', 'infra',   '', 'Backend'],
      ['Notification system',    'Email and in-app notifications for sheet changes',        'In Progress', 'Platform',  'Backend', 'P2', '2026-03-20', 'feature', '', 'Product'],
      ['Dark theme',             'System-preference-aware dark mode toggle',                'To Do',       'Frontend',  'Frontend','P3', '2026-04-15', 'design',  '', 'Mobile'],
    ],
  },

  /* ---- Habit Tracker examples ---- */
  'Morning Routine': {
    folder: 'Habits',
    headers: ['Habit', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Streak'],
    rows: [
      ['Wake up at 6 AM',    '✓', '✓', '✓', '',  '✓', '',  '',  '4'],
      ['Meditate 10 min',    '✓', '✓', '',  '✓', '✓', '✓', '',  '5'],
      ['Exercise 30 min',    '✓', '',  '✓', '',  '✓', '',  '✓', '4'],
      ['Read 20 pages',      '',  '✓', '',  '✓', '',  '✓', '✓', '3'],
      ['Journal',            '✓', '✓', '✓', '✓', '✓', '✓', '✓', '7'],
      ['Drink water (500ml)','✓', '✓', '✓', '✓', '',  '✓', '',  '5'],
      ['No phone first hour','',  '',  '✓', '',  '✓', '',  '✓', '2'],
      ['Healthy breakfast',  '✓', '✓', '',  '✓', '✓', '✓', '',  '5'],
    ],
  },

  'Fitness Habits': {
    folder: 'Habits',
    headers: ['Habit', 'Week Of', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Streak'],
    rows: [
      /* Week 1 */
      ['10K steps',        '2026-03-02', '✓', '✓', '',  '✓', '✓', '✓', '',  '5'],
      ['Strength training','2026-03-02', '✓', '',  '✓', '',  '✓', '',  '',  '3'],
      ['Stretch routine',  '2026-03-02', '✓', '✓', '✓', '✓', '',  '✓', '✓', '6'],
      ['Track calories',   '2026-03-02', '',  '✓', '✓', '',  '✓', '',  '✓', '3'],
      ['Sleep by 10 PM',   '2026-03-02', '✓', '',  '✓', '✓', '',  '✓', '',  '4'],
      /* Week 2 */
      ['10K steps',        '2026-03-09', '✓', '✓', '✓', '',  '✓', '',  '✓', '5'],
      ['Strength training','2026-03-09', '',  '✓', '',  '✓', '',  '✓', '',  '3'],
      ['Stretch routine',  '2026-03-09', '✓', '✓', '✓', '',  '✓', '✓', '',  '5'],
      ['Track calories',   '2026-03-09', '✓', '',  '✓', '✓', '',  '✓', '',  '4'],
      ['Sleep by 10 PM',   '2026-03-09', '',  '✓', '',  '✓', '✓', '',  '✓', '3'],
      /* Week 3 */
      ['10K steps',        '2026-03-16', '',  '',  '',  '',  '',  '',  '',  '0'],
      ['Strength training','2026-03-16', '',  '',  '',  '',  '',  '',  '',  '0'],
      ['Stretch routine',  '2026-03-16', '',  '',  '',  '',  '',  '',  '',  '0'],
      ['Track calories',   '2026-03-16', '',  '',  '',  '',  '',  '',  '',  '0'],
      ['Sleep by 10 PM',   '2026-03-16', '',  '',  '',  '',  '',  '',  '',  '0'],
    ],
  },

  /* ---- Gradebook examples ---- */
  'Math 101 Grades': {
    folder: 'Gradebook',
    headers: ['Student', 'Homework 1', 'Homework 2', 'Midterm', 'Final', 'Grade'],
    rows: [
      ['Emma Wilson',     '92', '88', '85', '90', 'A-'],
      ['James Lee',       '78', '82', '75', '80', 'B'],
      ['Sofia Martinez',  '95', '97', '93', '96', 'A'],
      ['Liam Johnson',    '65', '70', '60', '68', 'D+'],
      ['Olivia Brown',    '88', '85', '90', '87', 'B+'],
      ['Noah Davis',      '72', '68', '71', '74', 'C'],
      ['Ava Garcia',      '98', '95', '97', '99', 'A+'],
      ['Ethan Miller',    '80', '76', '82', '79', 'B-'],
    ],
  },

  'English 201 Grades': {
    folder: 'Gradebook',
    headers: ['Student', 'Essay 1', 'Quiz 1', 'Midterm', 'Essay 2', 'Grade'],
    rows: [
      ['Mia Thompson',    '90', '85', '88', '92', 'A-'],
      ['Aiden Clark',     '75', '80', '72', '78', 'B-'],
      ['Harper Lewis',    '95', '92', '96', '94', 'A'],
      ['Lucas Walker',    '82', '78', '80', '85', 'B'],
      ['Ella Martinez',   '88', '90', '85', '91', 'A-'],
    ],
  },

  /* ---- Timesheet examples ---- */
  'Weekly Timesheet': {
    folder: 'Timesheets',
    headers: ['Project', 'Client', 'Hours', 'Rate', 'Billable', 'Date'],
    rows: [
      ['Website Redesign',       'Acme Corp',  '8',   '150', 'Yes', '2026-03-03'],
      ['API Integration',        'Acme Corp',  '6',   '150', 'Yes', '2026-03-03'],
      ['Internal Meeting',       '',           '2',   '',    'No',  '2026-03-04'],
      ['Mobile App',             'Beta Inc',   '7',   '175', 'Yes', '2026-03-04'],
      ['Bug Fixes',              'Acme Corp',  '3',   '150', 'Yes', '2026-03-05'],
      ['Code Review',            '',           '2',   '',    'No',  '2026-03-05'],
      ['Dashboard Feature',      'Beta Inc',   '8',   '175', 'Yes', '2026-03-06'],
      ['Training Session',       '',           '1.5', '',    'No',  '2026-03-07'],
      ['Database Optimization',  'Gamma LLC',  '5',   '200', 'Yes', '2026-03-07'],
    ],
  },

  'Freelance Hours': {
    folder: 'Timesheets',
    headers: ['Project', 'Client', 'Hours', 'Rate', 'Billable', 'Date'],
    rows: [
      ['Logo Design',     'StartUp Co',  '6',   '125', 'Yes', '2026-03-10'],
      ['Brand Guidelines','StartUp Co',  '4',   '125', 'Yes', '2026-03-11'],
      ['Portfolio Update', '',            '3',   '',    'No',  '2026-03-12'],
      ['Social Media',    'CafeBloom',   '2',   '100', 'Yes', '2026-03-12'],
      ['Admin & Invoicing','',            '1',   '',    'No',  '2026-03-13'],
    ],
  },

  /* ---- Poll examples ---- */
  'Team Lunch Poll': {
    folder: 'Polls',
    headers: ['Option', 'Votes', 'Percent', 'Notes'],
    rows: [
      ['Pizza Palace',  '8', '32%', 'Has vegan options'],
      ['Sushi Garden',  '6', '24%', 'Lunch special'],
      ['Taco Truck',    '5', '20%', 'Near the office'],
      ['Burger Barn',   '4', '16%', ''],
      ['Salad Bar',     '2', '8%',  'Healthy option'],
    ],
  },

  'Tech Stack Vote': {
    folder: 'Polls',
    headers: ['Option', 'Votes', 'Percent', 'Notes'],
    rows: [
      ['React + TypeScript', '12', '40%', 'Team is experienced'],
      ['Vue 3',              '8',  '27%', 'Simpler learning curve'],
      ['Svelte',             '6',  '20%', 'Performance benefits'],
      ['Angular',            '4',  '13%', 'Enterprise support'],
    ],
  },

  /* ---- Changelog examples ---- */
  'App Changelog': {
    folder: 'Changelogs',
    headers: ['Version', 'Date', 'Type', 'What Changed'],
    rows: [
      ['2.3.0', '2026-03-15', 'Added',    'Dark mode support across all screens'],
      ['2.3.0', '2026-03-15', 'Added',    'Export data as CSV and PDF'],
      ['2.2.1', '2026-03-10', 'Fixed',    'Login timeout on slow connections'],
      ['2.2.1', '2026-03-10', 'Fixed',    'Search results not updating in real-time'],
      ['2.2.0', '2026-03-01', 'Added',    'Team collaboration features'],
      ['2.2.0', '2026-03-01', 'Changed',  'Redesigned settings page layout'],
      ['2.1.0', '2026-02-20', 'Added',    'Push notification preferences'],
      ['2.1.0', '2026-02-20', 'Breaking', 'API v1 endpoints deprecated'],
      ['2.0.0', '2026-02-01', 'Breaking', 'Complete UI rewrite — see migration guide'],
    ],
  },

  'API Changelog': {
    folder: 'Changelogs',
    headers: ['Version', 'Date', 'Type', 'What Changed'],
    rows: [
      ['3.0.0', '2026-04-01', 'Breaking', 'REST → GraphQL migration'],
      ['2.5.0', '2026-03-20', 'Added',    'Batch endpoint for bulk operations'],
      ['2.4.2', '2026-03-15', 'Fixed',    'Rate limiter edge case'],
      ['2.4.1', '2026-03-10', 'Fixed',    'Pagination cursor encoding'],
      ['2.4.0', '2026-03-01', 'Added',    'Webhook retry with exponential backoff'],
    ],
  },

  /* ---- CRM examples ---- */
  'Sales Pipeline': {
    folder: 'CRM',
    headers: ['Company', 'Contact', 'Deal Stage', 'Value', 'Notes'],
    rows: [
      ['Acme Corp',     'John Smith', 'Proposal',  '$50,000',  'Follow up Friday'],
      ['TechStart Inc', 'Sarah Lee',  'Qualified', '$25,000',  'Demo scheduled'],
      ['Global Media',  'Mike Chen',  'Won',       '$120,000', 'Contract signed'],
      ['FreshFoods Co', 'Lisa Park',  'Lead',      '$15,000',  'Inbound inquiry'],
      ['DataFlow',      'Tom Brown',  'Contacted', '$35,000',  'Sent intro email'],
      ['CloudNine',     'Amy Davis',  'Lost',      '$80,000',  'Went with competitor'],
      ['BuildRight',    'Dave Wilson','Proposal',  '$45,000',  'Awaiting budget approval'],
      ['EduLearn',      'Nina Garcia','Qualified', '$30,000',  'Needs security review'],
    ],
  },

  'Partnership Tracker': {
    folder: 'CRM',
    headers: ['Company', 'Contact', 'Deal Stage', 'Value', 'Notes'],
    rows: [
      ['MegaRetail',   'Jan Adams',   'Won',       '$200,000', 'Multi-year deal'],
      ['SmartHome',    'Leo Park',    'Proposal',  '$75,000',  'Pilot in Q2'],
      ['GreenEnergy',  'Maya Singh',  'Lead',      '$40,000',  'Intro call booked'],
      ['HealthPlus',   'Bill Torres', 'Contacted', '$55,000',  'Awaiting reply'],
    ],
  },

  /* ---- Meal Planner examples ---- */
  'Weekly Meal Plan': {
    folder: 'Meal Plans',
    headers: ['Day', 'Meal', 'Recipe', 'Calories', 'Protein'],
    rows: [
      ['Monday',    'Breakfast', 'Oatmeal with berries',     '350', '12g'],
      ['Monday',    'Lunch',     'Grilled chicken salad',    '480', '38g'],
      ['Monday',    'Dinner',    'Salmon with asparagus',    '520', '42g'],
      ['Tuesday',   'Breakfast', 'Greek yogurt parfait',     '280', '20g'],
      ['Tuesday',   'Lunch',     'Turkey club wrap',         '450', '30g'],
      ['Tuesday',   'Dinner',    'Beef stir-fry with rice',  '580', '35g'],
      ['Wednesday', 'Breakfast', 'Smoothie bowl',            '320', '15g'],
      ['Wednesday', 'Lunch',     'Lentil soup with bread',   '420', '22g'],
      ['Wednesday', 'Dinner',    'Pasta primavera',          '550', '18g'],
    ],
  },

  'Meal Prep Sunday': {
    folder: 'Meal Plans',
    headers: ['Day', 'Meal', 'Recipe', 'Calories', 'Protein'],
    rows: [
      ['Prep Day', 'Breakfast', 'Overnight oats (x5)',       '300', '14g'],
      ['Prep Day', 'Lunch',     'Chicken & rice bowls (x5)', '500', '40g'],
      ['Prep Day', 'Dinner',    'Sheet pan veggies (x3)',    '400', '15g'],
      ['Prep Day', 'Snack',     'Trail mix portions (x5)',   '200', '8g'],
    ],
  },

  /* ---- Travel Itinerary examples ---- */
  'Europe Trip': {
    folder: 'Travel',
    headers: ['Activity', 'Date', 'Location', 'Booking', 'Cost'],
    rows: [
      ['Flight to Paris',    '2026-06-15', 'JFK → CDG',         'AA-1234',  '$650'],
      ['Hotel Le Marais',    '2026-06-15', 'Paris',             'BK-5678',  '$180/night'],
      ['Eiffel Tower Tour',  '2026-06-16', 'Paris',             'TK-9012',  '$35'],
      ['Louvre Museum',       '2026-06-17', 'Paris',             'TK-9013',  '$20'],
      ['Train to Amsterdam', '2026-06-18', 'Paris → Amsterdam', 'TH-3456',  '$120'],
      ['Canal Hotel',        '2026-06-18', 'Amsterdam',         'BK-7890',  '$160/night'],
      ['Van Gogh Museum',    '2026-06-19', 'Amsterdam',         'TK-2345',  '$22'],
      ['Bike Tour',          '2026-06-20', 'Amsterdam',         'TK-6789',  '$45'],
      ['Flight Home',        '2026-06-21', 'AMS → JFK',         'KL-5678',  '$700'],
    ],
  },

  'Tokyo Trip': {
    folder: 'Travel',
    headers: ['Activity', 'Date', 'Location', 'Booking', 'Cost'],
    rows: [
      ['Flight to Tokyo',      '2026-09-01', 'LAX → NRT',  'JL-100',   '$1,100'],
      ['Shinjuku Hotel',       '2026-09-01', 'Tokyo',       'BK-4321',  '$120/night'],
      ['Senso-ji Temple',      '2026-09-02', 'Asakusa',     '',         'Free'],
      ['Tsukiji Market Tour',  '2026-09-03', 'Chuo',        'TK-1111',  '$60'],
      ['Day trip to Hakone',   '2026-09-04', 'Hakone',      'TK-2222',  '$80'],
      ['Return Flight',        '2026-09-05', 'NRT → LAX',  'JL-101',   '$1,100'],
    ],
  },

  /* ---- Roster examples ---- */
  'Team Roster': {
    folder: 'Rosters',
    headers: ['Employee', 'Role', 'Shift', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    rows: [
      ['Alice Chen',    'Manager',   'Morning',   '✓', '✓', '✓', '✓', '✓'],
      ['Bob Martinez',  'Developer', 'Morning',   '✓', '✓', '',  '✓', '✓'],
      ['Carol Kim',     'Designer',  'Afternoon', '',  '✓', '✓', '✓', ''],
      ['Dave Johnson',  'Developer', 'Night',     '✓', '',  '✓', '',  '✓'],
      ['Eva Williams',  'Support',   'Morning',   '✓', '✓', '✓', '',  '✓'],
      ['Frank Davis',   'Developer', 'Afternoon', '✓', '',  '✓', '✓', ''],
      ['Grace Lee',     'QA',        'Morning',   '',  '✓', '',  '✓', '✓'],
      ['Henry Park',    'DevOps',    'Night',     '✓', '✓', '',  '',  '✓'],
    ],
  },

  'Weekend Coverage': {
    folder: 'Rosters',
    headers: ['Employee', 'Role', 'Shift', 'Sat', 'Sun'],
    rows: [
      ['Alice Chen',    'Manager',  'Morning',   '✓', ''],
      ['Dave Johnson',  'Developer','Afternoon', '✓', '✓'],
      ['Eva Williams',  'Support',  'Morning',   '',  '✓'],
      ['Henry Park',    'DevOps',   'Night',     '✓', '✓'],
    ],
  },

  /* ---- Recipe examples ---- */
  /* Single-recipe-per-sheet: each sheet holds one recipe.
     Metadata (name, servings, etc.) goes on the first row only;
     continuation rows carry additional ingredients and steps.
     Qty and Unit are separate columns for scaling and unit conversion.
     Notes column holds recipe-level or per-item notes.
     Source column stores the original URL for attribution. */
  'Spaghetti Bolognese': {
    folder: 'Recipes',
    headers: ['Recipe', 'Servings', 'Prep Time', 'Cook Time', 'Category', 'Difficulty', 'Qty', 'Unit', 'Ingredient', 'Step', 'Notes', 'Source'],
    rows: [
      ['Spaghetti Bolognese', '4', '15 min', '45 min', 'Italian', 'Easy', '400',  'g',      'spaghetti',       'Cook spaghetti',             'A classic Italian comfort dish', ''],
      ['',                    '',  '',       '',       '',        '',     '500',  'g',      'ground beef',     'Brown beef',                 '',                               ''],
      ['',                    '',  '',       '',       '',        '',     '1',    '',       'onion, diced',    'Add onion and garlic 3 min', '',                               ''],
      ['',                    '',  '',       '',       '',        '',     '3',    'cloves', 'garlic',          'Stir in tomatoes and paste', '',                               ''],
      ['',                    '',  '',       '',       '',        '',     '800',  'g',      'canned tomatoes', 'Simmer 30 min',              '',                               ''],
      ['',                    '',  '',       '',       '',        '',     '2',    'tbsp',   'tomato paste',    'Season',                     '',                               ''],
      ['',                    '',  '',       '',       '',        '',     '1',    'tsp',    'oregano',         'Serve over pasta',           '',                               ''],
      ['',                    '',  '',       '',       '',        '',     '',     '',       'salt and pepper',  'Top with parmesan',         '',                               ''],
      ['',                    '',  '',       '',       '',        '',     '',     '',       'parmesan',         '',                          '',                               ''],
    ],
  },

  'Chicken Tikka Masala': {
    folder: 'Recipes',
    headers: ['Recipe', 'Servings', 'Prep Time', 'Cook Time', 'Category', 'Difficulty', 'Qty', 'Unit', 'Ingredient', 'Step', 'Notes', 'Source'],
    rows: [
      ['Chicken Tikka Masala', '4', '20 min', '35 min', 'Indian', 'Medium', '600',  'g',    'chicken breast',  'Marinate chicken in yogurt and tikka paste', 'Great with naan bread', ''],
      ['',                     '',  '',       '',       '',       '',       '200',  'ml',   'yogurt',          'Fry onion',                                 '',                      ''],
      ['',                     '',  '',       '',       '',       '',       '2',    'tbsp', 'tikka paste',     'Add chicken until browned',                  '',                     ''],
      ['',                     '',  '',       '',       '',       '',       '1',    '',     'onion',           'Add tomatoes, simmer 20 min',                '',                     ''],
      ['',                     '',  '',       '',       '',       '',       '400',  'g',    'canned tomatoes', 'Stir in cream',                              '',                     ''],
      ['',                     '',  '',       '',       '',       '',       '200',  'ml',   'coconut cream',   'Serve with rice',                            '',                     ''],
      ['',                     '',  '',       '',       '',       '',       '',     '',     'garam masala',    '',                                           '',                     ''],
      ['',                     '',  '',       '',       '',       '',       '',     '',     'coriander',       '',                                           '',                     ''],
      ['',                     '',  '',       '',       '',       '',       '',     '',     'rice',            '',                                           '',                     ''],
    ],
  },

  'Beef Stir Fry': {
    folder: 'Recipes',
    headers: ['Recipe', 'Servings', 'Prep Time', 'Cook Time', 'Category', 'Difficulty', 'Qty', 'Unit', 'Ingredient', 'Step', 'Notes', 'Source'],
    rows: [
      ['Beef Stir Fry', '3', '15 min', '20 min', 'Asian', 'Easy', '400',  'g',      'beef sirloin',  'Cook rice',               'Quick weeknight dinner', ''],
      ['',              '',  '',       '',       '',      '',     '2',    '',       'bell peppers',  'Mix sauce',               '',                       ''],
      ['',              '',  '',       '',       '',      '',     '1',    'head',   'broccoli',      'Stir-fry beef 3 min',     '',                       ''],
      ['',              '',  '',       '',       '',      '',     '3',    'tbsp',   'soy sauce',     'Add vegetables 4 min',    '',                       ''],
      ['',              '',  '',       '',       '',      '',     '1',    'tbsp',   'sesame oil',    'Return beef with sauce',  '',                       ''],
      ['',              '',  '',       '',       '',      '',     '2',    'cloves', 'garlic',        'Toss until thick',        '',                       ''],
      ['',              '',  '',       '',       '',      '',     '1',    'tbsp',   'cornstarch',    'Serve over rice',         '',                       ''],
      ['',              '',  '',       '',       '',      '',     '',     '',       'rice',          '',                        '',                       ''],
    ],
  },

  /* ---- Flow Diagram examples ---- */
  'User Login Flow': {
    folder: 'Flows',
    headers: ['Flow', 'Step', 'Type', 'Next', 'Condition', 'Notes'],
    rows: [
      ['User Login Flow', 'User Opens App',    'start',    'Show Login Form',                  '',            'Entry point'],
      ['',                'Show Login Form',   'process',  'Enter Credentials',                '',            'Display email and password fields'],
      ['',                'Enter Credentials', 'input',    'Validate Input',                   '',            'User types email and password'],
      ['',                'Validate Input',    'decision', 'Check Auth,Show Login Form',       'Valid,Invalid','Client-side validation'],
      ['',                'Check Auth',        'process',  'Auth OK?',                         '',            'Call authentication API'],
      ['',                'Auth OK?',          'decision', 'Load Dashboard,Show Error',        'Yes,No',      'Server response check'],
      ['',                'Show Error',        'process',  'Show Login Form',                  '',            'Display error toast'],
      ['',                'Load Dashboard',    'process',  'Done',                             '',            'Fetch user data and render'],
      ['',                'Done',              'end',      '',                                 '',            'User is logged in'],
    ],
  },

  'Order Processing': {
    folder: 'Flows',
    headers: ['Flow', 'Step', 'Type', 'Next', 'Condition', 'Notes'],
    rows: [
      ['Order Processing', 'Receive Order',     'start',    'Validate Order',                    '',            'New order from customer'],
      ['',                 'Validate Order',    'decision', 'Check Inventory,Reject Order',      'Valid,Invalid','Verify required fields'],
      ['',                 'Reject Order',      'output',   'Done',                              '',            'Notify customer of rejection'],
      ['',                 'Check Inventory',   'process',  'In Stock?',                         '',            'Query warehouse system'],
      ['',                 'In Stock?',         'decision', 'Process Payment,Backorder',         'Yes,No',      'Check availability'],
      ['',                 'Backorder',         'delay',    'Notify Customer',                   '',            'Wait for restock'],
      ['',                 'Notify Customer',   'output',   'Done',                              '',            'Send backorder email'],
      ['',                 'Process Payment',   'subprocess','Payment OK?',                      '',            'Stripe payment flow'],
      ['',                 'Payment OK?',       'decision', 'Ship Order,Retry Payment',          'Yes,No',      'Payment gateway response'],
      ['',                 'Retry Payment',     'process',  'Process Payment',                   '',            'Allow retry up to 3 times'],
      ['',                 'Ship Order',        'process',  'Send Confirmation',                 '',            'Generate shipping label'],
      ['',                 'Send Confirmation', 'output',   'Done',                              '',            'Email with tracking number'],
      ['',                 'Done',              'end',      '',                                  '',            'Order complete'],
    ],
  },

  /* ---- Social Feed examples ---- */
  "Jamie's Wall": {
    folder: 'Social',
    headers: ['Post', 'Author', 'Date', 'Category', 'Mood', 'Link', 'Comment'],
    rows: [
      ['Just shipped a major update to Waymark! The kanban board now has reject tickets, reporter column, and a directory view.', 'Jamie', '2026-03-10', 'milestone', 'excited', '', ''],
      ['', 'Alex', '2026-03-10', '', '', '', 'Congrats! The new features look awesome.'],
      ['', 'Sam', '2026-03-10', '', '', '', 'Can\'t wait to try the directory view!'],
      ['Working on the social template today. Each Google Sheet becomes a personal wall.', 'Jamie', '2026-03-09', 'update', 'thinking', '', ''],
      ['Check out this article on building apps with vanilla JS!', 'Jamie', '2026-03-08', 'link', '', 'https://developer.mozilla.org/en-US/docs/Learn/JavaScript', ''],
      ['', 'Alex', '2026-03-08', '', '', '', 'Great read! Vanilla JS is underrated.'],
      ['Had an amazing dinner tonight. Tried the gluten-free pasta recipe.', 'Jamie', '2026-03-07', 'update', 'happy', '', ''],
      ['What\'s everyone\'s favorite productivity tool?', 'Jamie', '2026-03-06', 'question', '', '', ''],
      ['', 'Sam', '2026-03-06', '', '', '', 'I love Waymark of course!'],
      ['', 'Riley', '2026-03-06', '', '', '', 'Obsidian for notes, Waymark for everything else.'],
      ['Feeling grateful for this community. Building things together is the best.', 'Jamie', '2026-03-05', 'thought', 'grateful', '', ''],
    ],
  },

  "Team Updates": {
    folder: 'Social',
    headers: ['Post', 'Author', 'Date', 'Category', 'Mood', 'Link', 'Comment'],
    rows: [
      ['Sprint review went great! All 5 stories completed ahead of schedule.', 'Alex', '2026-03-09', 'milestone', 'proud', '', ''],
      ['', 'Jamie', '2026-03-09', '', '', '', 'Nice work team! Keep the momentum going.'],
      ['New design system tokens are live. Check the Figma link.', 'Sam', '2026-03-08', 'link', '', 'https://figma.com/design-system', ''],
      ['', 'Alex', '2026-03-08', '', '', '', 'Love the new color palette!'],
      ['Who wants to pair on the API migration? Need a buddy.', 'Riley', '2026-03-07', 'question', '', '', ''],
      ['', 'Alex', '2026-03-07', '', '', '', 'I\'m free Thursday afternoon!'],
      ['', 'Sam', '2026-03-07', '', '', '', 'Count me in too.'],
      ['Deployed v2.5 to staging. Please test your flows before end of day.', 'Alex', '2026-03-06', 'update', '', '', ''],
      ['Friday lunch at the new Thai place? Lets go at noon.', 'Jamie', '2026-03-05', 'update', 'happy', '', ''],
      ['', 'Riley', '2026-03-05', '', '', '', 'Im in! Love Thai food.'],
    ],
  },

  /* ---- Automation examples ---- */
  "Login Test Suite": {
    folder: 'Automation',
    headers: ['Workflow', 'Step', 'Action', 'Target', 'Value', 'Status'],
    rows: [
      ['Login Flow', 'Open login page', 'navigate', 'https://app.example.com/login', '', 'Done'],
      ['', 'Enter email address', 'type', '#email-input', 'user@example.com', 'Done'],
      ['', 'Enter password', 'type', '#password-input', 'P@ssw0rd!', 'Done'],
      ['', 'Click Sign In', 'click', '.btn-primary', '', 'Done'],
      ['', 'Wait for dashboard', 'wait', '.dashboard-container', '', 'Done'],
      ['', 'Verify username displayed', 'assert', '.user-name', 'User', 'Done'],
      ['Password Reset', 'Open login page', 'navigate', 'https://app.example.com/login', '', 'Pending'],
      ['', 'Click forgot password', 'click', 'a.forgot-password', '', 'Pending'],
      ['', 'Enter email', 'type', '#reset-email', 'user@example.com', 'Pending'],
      ['', 'Click send reset link', 'click', '#send-reset', '', 'Pending'],
      ['', 'Verify success message', 'assert', '.alert-success', 'Reset link sent', 'Pending'],
    ],
  },

  "E-Commerce Checkout": {
    folder: 'Automation',
    headers: ['Workflow', 'Step', 'Action', 'Target', 'Value', 'Status'],
    rows: [
      ['Add to Cart', 'Open product page', 'navigate', '/products/widget-pro', '', 'Done'],
      ['', 'Select quantity', 'type', '#quantity', '2', 'Done'],
      ['', 'Click Add to Cart', 'click', '.add-to-cart-btn', '', 'Done'],
      ['', 'Verify cart badge count', 'assert', '.cart-badge', '2', 'Done'],
      ['Checkout', 'Open cart', 'click', '.cart-icon', '', 'Running'],
      ['', 'Click Proceed to Checkout', 'click', '.checkout-btn', '', 'Pending'],
      ['', 'Fill shipping address', 'type', '#address', '123 Main St', 'Pending'],
      ['', 'Select payment method', 'click', '#card-payment', '', 'Pending'],
      ['', 'Click Place Order', 'click', '.place-order', '', 'Pending'],
      ['', 'Take confirmation screenshot', 'screenshot', 'viewport', '', 'Pending'],
      ['', 'Verify order number', 'assert', '.order-number', '', 'Pending'],
    ],
  },

<<<<<<< HEAD
  /* ---- Knowledge Base examples ---- */
  'Waymark Knowledge Base': {
    folder: 'Knowledge',
    headers: ['Title', 'Category', 'Content', 'Tags', 'Author', 'Updated', 'Status', 'Source'],
    rows: [
      // Architecture
      ['Waymark Architecture Overview', 'Architecture', 'Waymark is a zero-framework, zero-build-step single-page application that uses Google Sheets as its database and Google Drive as its file system.', 'architecture, overview', 'Jamie', '2026-03-10', 'Published', ''],
      ['', '', 'All business logic runs entirely in the browser — the Express server only serves static files and brokers OAuth refresh tokens.', '', '', '', '', ''],
      ['', '', 'ES Modules are loaded directly in the browser via <script type="module">. No bundler, no transpiler, no build step required.', '', '', '', '', ''],
      ['', '', 'Google Sheets data is accessed through a unified api-client.js gateway that supports both live Google APIs and a local mock mode for tests.', '', '', '', '', ''],
      ['', '', 'Hash-based routing (#/sheet/{id}) allows deep-linking to any sheet without server-side routing logic.', '', '', '', '', ''],
      ['Frontend-Only Design Principle', 'Architecture', 'The server stores no state, has no database, and processes no business logic. The httpOnly cookie holds only the Google OAuth refresh token.', 'architecture, design, principles', 'Jamie', '2026-03-01', 'Published', ''],
      ['', '', 'All user data lives in Google Drive via user-data.js or in browser localStorage via storage.js.', '', '', '', '', ''],
      ['', '', 'This design means Waymark can be self-hosted with a dead-simple server — just static file serving and OAuth brokering.', '', '', '', '', ''],
      ['Module Organization', 'Architecture', 'api-client.js is the sole gateway to all Google APIs. No template or UI module may import drive.js or sheets.js directly.', 'architecture, modules', 'Jamie', '2026-02-28', 'Published', ''],
      ['', '', 'templates/shared.js re-exports el() from ui.js for template use. Templates import exclusively from shared.js — never from ui.js or api-client.js.', '', '', '', '', ''],
      ['', '', 'Templates self-register via registerTemplate(\'key\', definition). templates/index.js just side-effect-imports all template files.', '', '', '', '', ''],
      ['Server Architecture', 'Architecture', 'server/index.js serves the /public directory as static files and injects the window.__WAYMARK_LOCAL runtime flag.', 'architecture, server, express', 'Jamie', '2026-01-15', 'Published', ''],
      ['', '', 'server/auth.js implements four OAuth routes: /auth/login, /auth/callback, /auth/refresh, /auth/logout.', '', '', '', '', ''],
      ['', '', 'The server creates no database, stores no user data, and holds zero application state.', '', '', '', '', ''],
      // Template System
      ['Template System Overview', 'Templates', 'Waymark\'s template system detects the type of a Google Sheet from its column headers, then renders it with a purpose-built UI.', 'templates, system, overview', 'Jamie', '2026-03-10', 'Published', ''],
      ['', '', 'Every template exports a definition object with: name, icon, color, priority, detect(), columns(), and render().', '', '', '', '', ''],
      ['', '', 'detectTemplate() in templates/index.js runs every registered template\'s detect() against lowercased headers and picks the highest-priority match.', '', '', '', '', ''],
      ['', '', 'The Checklist template (priority 10) is the universal fallback — it always matches, so every sheet gets rendered.', '', '', '', '', ''],
      ['Template Definition Shape', 'Templates', 'detect(lower) receives an array of lowercased, trimmed header strings and returns a boolean. It uses regex.test() — never plain string equality.', 'templates, definition, api', 'Jamie', '2026-02-20', 'Published', ''],
      ['', '', 'columns(lower) returns a cols object mapping role names to column indices using lower.findIndex(h => /pattern/.test(h)).', '', '', '', '', ''],
      ['', '', 'render(container, rows, cols, template) clears container with innerHTML = \'\' then builds all DOM via el() and editableCell() from shared.js.', '', '', '', '', ''],
      ['', '', 'rowIndex in emitEdit() is 1-based — it represents the offset from the header row in the original Google Sheet.', '', '', '', '', ''],
      ['Adding a New Template', 'Templates', 'Every new template requires: template JS, template CSS, CSS import in style.css, JS import in templates/index.js.', 'templates, new, checklist', 'Jamie', '2026-03-05', 'Published', ''],
      ['', '', 'Also required: fixture JSON in tests/fixtures/sheets/, fixture ID mapping in api-client.js, folder entry in folders.json.', '', '', '', '', ''],
      ['', '', 'Also required: E2E test file in tests/e2e/, registry entry in template-registry.json, example data in example-data.js, import roles in import.js.', '', '', '', '', ''],
      ['Folder Layout for Complex Templates', 'Templates', 'Templates exceeding ~300 lines use a folder layout: templates/{key}/index.js as the barrel module.', 'templates, folder, layout', 'Jamie', '2026-02-15', 'Published', ''],
      ['', '', 'Sub-modules: helpers.js (constants and pure functions), cards.js (DOM builders), modal.js (overlay UI).', '', '', '', '', ''],
      ['', '', 'Sub-modules import from ../shared.js and may import siblings within the same folder. The kanban/ folder is the reference implementation.', '', '', '', '', ''],
      // Development Workflow
      ['Git Branching Strategy', 'Development Workflow', 'Every task starts by syncing to tip of main: git checkout main && git fetch origin && git reset --hard origin/main.', 'git, branching, workflow', 'Jamie', '2026-03-10', 'Published', ''],
      ['', '', 'Create a feature branch immediately: git checkout -b feature/{kebab-case-task-name}. Never write code while on main.', '', '', '', '', ''],
      ['', '', 'Run git branch --show-current before every commit. If output is main, STOP — this is a hard reject violation.', '', '', '', '', ''],
      ['', '', 'Branch naming: feature/{task-key} for features, fix/{description} for bug fixes. Lowercase kebab-case, max 50 chars.', '', '', '', '', ''],
      ['AI Laws — Non-Negotiable Rules', 'Development Workflow', 'The five absolute rules: no backend business logic, vanilla stack (no frameworks/build tools), zero server state, all API access through api-client.js, templates only import from shared.js.', 'ai-laws, rules, compliance', 'Jamie', '2026-03-01', 'Published', ''],
      ['', '', 'No CSS frameworks (Tailwind, Bootstrap), no JS frameworks (React, Vue, Svelte), no bundlers (Webpack, Vite), no TypeScript, no SCSS.', '', '', '', '', ''],
      ['', '', 'DOM construction exclusively via el(). Never use innerHTML with dynamic content (XSS risk). innerHTML = \'\' is only acceptable for clearing containers.', '', '', '', '', ''],
      ['Commit Message Convention', 'Development Workflow', 'Waymark uses Conventional Commits: feat(scope): description for new features, fix(scope): description for bug fixes.', 'git, commits, conventions', 'Jamie', '2026-01-20', 'Published', ''],
      ['', '', 'Other types: test(scope):, refactor(scope):, chore(scope): for tooling/config changes.', '', '', '', '', ''],
      ['', '', 'Scope is the template key or module name: feat(kanban), fix(recipe), test(budget).', '', '', '', '', ''],
      ['Human-Friendly Sheet Data Format', 'Development Workflow', 'All template data in Google Sheets must be easy for humans to read and edit directly — never pack multiple values into one cell with delimiters.', 'data, sheets, format', 'Jamie', '2026-02-25', 'Published', ''],
      ['', '', 'If a field is a list (ingredients, steps, tasks), each item must have its own row. Group membership is determined by leaving the primary identifier column blank.', '', '', '', '', ''],
      ['', '', 'Use singular column headers for per-row items: \'Ingredient\' not \'Ingredients\', \'Step\' not \'Instructions\'.', '', '', '', '', ''],
      // Testing
      ['E2E Test Architecture', 'Testing', 'All E2E tests use Playwright with CSS selector strategy. No XPath, no text= selectors, no data-testid attributes.', 'testing, e2e, playwright', 'Jamie', '2026-03-10', 'Published', ''],
      ['', '', 'Flat test() calls only — no describe() blocks, no beforeAll/beforeEach/afterAll hooks. Each test must be fully isolated.', '', '', '', '', ''],
      ['', '', 'Every test starts with: await setupApp(page). Use page.waitForSelector() with explicit timeout — never waitForTimeout().', '', '', '', '', ''],
      ['Unit Test Strategy', 'Testing', 'Unit tests verify pure functions in isolation using Playwright\'s page.evaluate() with dynamic import() — no build tools, no Node.js ESM shims.', 'testing, unit, pure-functions', 'Jamie', '2026-03-05', 'Published', ''],
      ['', '', 'Unit test files are named tests/e2e/unit-{module-name}.spec.js. Test state classifiers, parsers, formatters, and data transformers.', '', '', '', '', ''],
      ['', '', 'For time-dependent functions, freeze Date.now() inside page.evaluate() to test exact urgency levels.', '', '', '', '', ''],
      ['Test Fixture Format', 'Testing', 'Fixture files live in tests/fixtures/sheets/{key}-{descriptor}.json with shape: { id, title, sheetTitle, values }.', 'testing, fixtures', 'Jamie', '2026-02-20', 'Published', ''],
      ['', '', 'The values array is a 2D array of strings. Row 0 is headers. All cell values must be strings.', '', '', '', '', ''],
      ['', '', 'Register every fixture in api-client.js: \'sheet-NNN\': \'{key}-{descriptor}\'. Add to tests/fixtures/folders.json.', '', '', '', '', ''],
      // CSS & Design
      ['Design Token Architecture', 'CSS & Design', 'All colors in Waymark come from CSS custom properties defined in base.css under :root. Never use hardcoded hex colors for shared tokens.', 'css, design-tokens', 'Jamie', '2026-03-10', 'Published', ''],
      ['', '', 'Core tokens: --color-primary (#2563eb), --color-bg (#f1f5f9), --color-surface (#ffffff), --color-text (#1e293b), --color-border (#e2e8f0).', '', '', '', '', ''],
      ['', '', 'Utility tokens: --color-success (#16a34a), --color-error (#dc2626), --radius (8px), --radius-sm (4px), --shadow, --transition (200ms ease).', '', '', '', '', ''],
      ['CSS Class Naming Conventions', 'CSS & Design', 'Flat, descriptive class names using pattern .{key}-{element}. Examples: .budget-summary, .kanban-lane, .recipe-card, .knowledge-toolbar.', 'css, naming, conventions', 'Jamie', '2026-02-10', 'Published', ''],
      ['', '', 'No BEM (no __ or -- suffixes). No utility-first classes. State modifiers are chained directly: .checklist-row.completed.', '', '', '', '', ''],
      ['', '', 'The only !important in the codebase is on .hidden { display: none !important; }. All other overrides use specificity.', '', '', '', '', ''],
      // AI Agent
      ['Builder Agent Overview', 'AI Agent', 'The Waymark Builder is an autonomous AI agent that reads the Waymark Workboard for tasks, implements them in feature branches, and submits them for QA.', 'ai-agent, builder, overview', 'Jamie', '2026-03-10', 'Published', ''],
      ['', '', 'The agent runs in a persistent loop: sleep 60 seconds → query workboard → pick highest-priority To Do item → implement → test → push → mark QA.', '', '', '', '', ''],
      ['', '', 'The agent uses check-workboard.js to query Google Sheets directly each cycle — no background watchers, no stale data.', '', '', '', '', ''],
      ['Workboard Task Lifecycle', 'AI Agent', 'Task lifecycle: To Do → (agent claims) → In Progress → (agent implements) → QA → (human reviews, merges) → Done.', 'ai-agent, workboard, lifecycle', 'Jamie', '2026-03-08', 'Published', ''],
      ['', '', 'The agent claims tasks using: node scripts/update-workboard.js claim {row}. This sets Stage to In Progress and Assignee to AI.', '', '', '', '', ''],
      ['', '', 'The agent NEVER moves a task to Done. Only the human moves items to Done after reviewing and merging the PR.', '', '', '', '', ''],
      ['QA Rejection Protocol', 'AI Agent', 'When a human moves a task from QA back to To Do, that is a rejection — equal in severity to committing to main.', 'ai-agent, qa, rejection', 'Jamie', '2026-03-05', 'Published', ''],
      ['', '', 'check-workboard.js flags rejected items with rejected: true when a task has AI notes AND has been moved back to To Do.', '', '', '', '', ''],
      ['', '', 'The agent reads ALL sub-row notes, addresses every point of feedback, reuses the existing branch, and rebases against latest main before re-submitting.', '', '', '', '', ''],
      // Google Integration
      ['OAuth Authentication Flow', 'Google Integration', 'Waymark uses Google OAuth 2.0 with offline access to get a refresh token that persists across page loads.', 'oauth, authentication, google', 'Jamie', '2026-02-20', 'Published', ''],
      ['', '', 'Flow: /auth/login redirects to Google → /auth/callback exchanges code for tokens → refresh_token stored in httpOnly cookie.', '', '', '', '', ''],
      ['', '', '/auth/refresh reads the httpOnly cookie and calls Google token API to get a fresh access token. Access tokens expire in 1 hour.', '', '', '', '', ''],
      ['Google Sheets API Access', 'Google Integration', 'sheets.js wraps the Google Sheets REST v4 API. api-client.js is the sole consumer — templates never import sheets.js directly.', 'google-sheets, api', 'Jamie', '2026-02-15', 'Published', ''],
      ['', '', 'In local mock mode (window.__WAYMARK_LOCAL), api-client.js intercepts all Sheets API calls and serves data from tests/fixtures/sheets/.', '', '', '', '', ''],
      ['', '', 'Sheet data format: values[0] is always the header row. values[1..n] are data rows. Each cell is a string.', '', '', '', '', ''],
      ['Google Drive API & Explorer', 'Google Integration', 'drive.js wraps the Google Drive REST v3 API for folder listing, file creation/update, and metadata queries.', 'google-drive, api, explorer', 'Jamie', '2026-02-10', 'Published', ''],
      ['', '', 'explorer.js implements the sidebar drive tree view with collapsible folders. user-data.js uses Drive to persist user preferences.', '', '', '', '', ''],
      ['', '', 'search.js queries Drive for files matching keyword queries — file names and metadata, not cell-level sheet data.', '', '', '', '', ''],
      // Features
      ['Kanban Board Template', 'Features', 'The Kanban template renders a multi-stage project board with columns for each status (Backlog, To Do, In Progress, QA, Done).', 'kanban, template, features', 'Jamie', '2026-03-10', 'Published', ''],
      ['', '', 'Cards show title, priority badge, due date badge, assignee, labels, and note count. Click the badge to cycle status.', '', '', '', '', ''],
      ['', '', 'Priority badges: P0 (red), P1 (orange), P2 (blue), P3 (gray). Due date badges: overdue (red), soon (orange), upcoming (green).', '', '', '', '', ''],
      ['', '', 'The kanban/ folder layout is the reference implementation: index.js, helpers.js, cards.js, modal.js.', '', '', '', '', ''],
      ['Recipe Book Template', 'Features', 'The Recipe template uses the row-per-item format: each ingredient and step occupies its own row. Metadata is on the first row only.', 'recipe, template, features', 'Jamie', '2026-03-05', 'Published', ''],
      ['', '', 'A servings scaler lets users adjust the portion count and automatically rescales all ingredient quantities.', '', '', '', '', ''],
      ['', '', 'The recipe scraper (recipe-scraper.js) imports recipes from any URL by extracting structured data (JSON-LD, microdata).', '', '', '', '', ''],
      ['Knowledge Base Template', 'Features', 'The Knowledge Base template organizes articles by category with full-text search, tag-based filtering, and expand/collapse for long content.', 'knowledge, template, features', 'Jamie', '2026-03-10', 'Published', ''],
      ['', '', 'Articles are grouped by Category. Each article has a title, snippet preview, status badge, and full content expandable on click.', '', '', '', '', ''],
      ['', '', 'Status cycling: Draft → In Review → Published → Archived. Toolbar includes live search, category pills, and tag cloud.', '', '', '', '', ''],
      ['Checklist Template', 'Features', 'The Checklist template is the universal fallback (priority 10). It renders rows with done/todo toggle states and inline-editable notes.', 'checklist, template, features', 'Jamie', '2026-01-10', 'Published', ''],
      ['', '', 'Status values that mean done: ✓, yes, done, x, true, 1, complete. Completion percentage appears in the header.', '', '', '', '', ''],
      ['Test Cases Template', 'Features', 'The TestCases template displays a QA test suite with Pass/Fail/Blocked/Skip status cycling. A summary bar shows overall pass rate.', 'testcases, template, qa', 'Jamie', '2026-02-20', 'Published', ''],
      ['', '', 'Used by the AI builder agent to upload test results to the Waymark QA folder on Google Drive for human review.', '', '', '', '', ''],
      ['Budget & Finance Template', 'Features', 'The Budget template tracks income and expense rows with category, amount, date, and notes columns. Inline editing is supported on all cells.', 'budget, template, features', 'Jamie', '2026-02-28', 'Published', ''],
      ['', '', 'A summary bar shows total income, total expenses, and net balance with color-coded indicators. Category pills filter the transaction list.', '', '', '', '', ''],
    ],
  },

  /* ---- Notification examples ---- */
  "Waymark Notifications": {
    folder: 'Notifications',
    headers: ['Title', 'Message', 'Type', 'Status', 'Icon', 'Priority', 'Created', 'Expires', 'Source', 'Sheet'],
    rows: [
      ['Kanban P0 task overdue', 'Task "API integration" has been in Active status past its due date', 'alert', 'Active', '🔴', 'High', '2026-06-15T08:00:00Z', '', 'Kanban', 'sheet-028'],
      ['Budget over limit', 'June expenses exceed income by $340', 'warning', 'Active', '💸', 'High', '2026-06-14T09:30:00Z', '', 'Budget', 'sheet-016'],
      ['Checklist item overdue', '"Review test coverage" was due 2 days ago', 'warning', 'Active', '⏰', 'Medium', '2026-06-13T10:00:00Z', '', 'Checklist', ''],
      ['Deployment complete', 'Production deploy v2.4.1 finished successfully', 'success', 'Read', '✅', 'Low', '2026-06-12T14:00:00Z', '', 'CI/CD', ''],
      ['Security scan passed', 'Weekly vulnerability scan found no issues', 'success', 'Read', '🛡️', 'Low', '2026-06-10T07:00:00Z', '', 'Security', ''],
      ['Team sync reminder', 'Daily standup starts in 10 minutes', 'info', 'Dismissed', '📅', 'Medium', '2026-06-15T09:50:00Z', '2026-06-15T10:00:00Z', 'Calendar', ''],
      ['Sync error resolved', 'Google Sheets sync failure from yesterday has been resolved', 'info', 'Dismissed', '🔄', 'Low', '2026-06-14T11:00:00Z', '', 'Sync', ''],
      ['Recipe import complete', '14 recipes imported from Mimi\'s Kitchen successfully', 'success', 'Dismissed', '🍳', 'Low', '2026-06-13T16:00:00Z', '', 'Import', ''],
    ],
  },
};
