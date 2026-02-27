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
    headers: ['Task', 'Stage', 'Assignee', 'Priority'],
    rows: [
      ['Design login page',    'Done',        'Alice',  'High'],
      ['Set up CI pipeline',   'In Progress', 'Bob',    'High'],
      ['Write API docs',       'In Progress', 'Carol',  'Medium'],
      ['Add dark mode',        'To Do',       'Alice',  'Low'],
      ['Fix nav bug',          'Done',        'Bob',    'High'],
      ['Implement search',     'Backlog',     '',       'Medium'],
      ['Database migration',   'To Do',       'Carol',  'High'],
      ['User onboarding flow', 'Backlog',     '',       'Medium'],
      ['Performance audit',    'In Progress', 'Alice',  'High'],
    ],
  },

  'Product Roadmap': {
    folder: 'Kanban',
    headers: ['Feature', 'Stage', 'Owner', 'Priority'],
    rows: [
      ['Multi-language support', 'Backlog',     'Product', 'Medium'],
      ['Mobile app v2',          'In Progress', 'Mobile',  'High'],
      ['Analytics dashboard',    'To Do',       'Data',    'High'],
      ['SSO integration',        'Done',        'Backend', 'High'],
      ['Notification system',    'In Progress', 'Backend', 'Medium'],
      ['Dark theme',             'To Do',       'Frontend','Low'],
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
    headers: ['Habit', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Streak'],
    rows: [
      ['10K steps',        '✓', '✓', '',  '✓', '✓', '✓', '',  '5'],
      ['Strength training','✓', '',  '✓', '',  '✓', '',  '',  '3'],
      ['Stretch routine',  '✓', '✓', '✓', '✓', '',  '✓', '✓', '6'],
      ['Track calories',   '',  '✓', '✓', '',  '✓', '',  '✓', '3'],
      ['Sleep by 10 PM',   '✓', '',  '✓', '✓', '',  '✓', '',  '4'],
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
};
