import { registerTemplate } from './shared.js';

const STATUS_CYCLE = ['Draft', 'Open', 'Pending', 'Closed'];

function detect(headers) {
  const lowerHeaders = headers.map(h => h.toLowerCase());
  return lowerHeaders.includes('rfi number') && lowerHeaders.includes('status');
}

function render(sheetData, writeBack) {
  const container = document.createElement('div');
  container.className = 'rfi-board';

  // 1. Status Summary Bar
  const summaryBar = document.createElement('div');
  summaryBar.className = 'rfi-summary-bar';
  
  const counts = STATUS_CYCLE.reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
  sheetData.rows.forEach(row => {
    const status = row['Status'] || 'Draft';
    if (counts[status] !== undefined) counts[status]++;
  });

  summaryBar.innerHTML = `
    <div class="rfi-badge rfi-badge-open">Total Open: <span class="count-open">${counts['Open']}</span></div>
    <div class="rfi-badge rfi-badge-pending">Pending: <span class="count-pending">${counts['Pending']}</span></div>
    <div class="rfi-badge rfi-badge-closed">Closed: <span class="count-closed">${counts['Closed']}</span></div>
  `;
  container.appendChild(summaryBar);

  // 2. Kanban Swim-Lanes
  const kanban = document.createElement('div');
  kanban.className = 'rfi-kanban';

  const columns = {};
  STATUS_CYCLE.forEach(status => {
    const col = document.createElement('div');
    col.className = 'rfi-column';
    col.innerHTML = `<h3>${status}</h3><div class="rfi-cards"></div>`;
    columns[status] = col.querySelector('.rfi-cards');
    kanban.appendChild(col);
  });

  // 3. Render Interactive Cards
  sheetData.rows.forEach(row => {
    const card = document.createElement('div');
    card.className = 'rfi-card';

    const rfiNum = document.createElement('h4');
    rfiNum.textContent = row['RFI Number'] || 'Unknown RFI';

    const subject = document.createElement('p');
    subject.textContent = row['Subject'] || 'No subject provided';

    // Interactive Status Badge
    const statusBadge = document.createElement('button');
    let currentStatus = row['Status'] || 'Draft';
    statusBadge.className = `rfi-status-btn ${currentStatus.toLowerCase()}`;
    statusBadge.textContent = currentStatus;

    statusBadge.addEventListener('click', () => {
      // Cycle status
      const currentIndex = STATUS_CYCLE.indexOf(currentStatus);
      const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];
      
      // Update DOM
      currentStatus = nextStatus;
      statusBadge.textContent = nextStatus;
      statusBadge.className = `rfi-status-btn ${nextStatus.toLowerCase()}`;
      
      // Move card to new swim-lane
      columns[nextStatus].appendChild(card);
      
      // Call Waymark's writeBack
      writeBack(row.rowIndex, 'Status', nextStatus);
    });

    // Official Response Textarea
    const textarea = document.createElement('textarea');
    textarea.value = row['Official Response'] || '';
    textarea.placeholder = "Enter official response...";
    
    textarea.addEventListener('blur', (e) => {
      writeBack(row.rowIndex, 'Official Response', e.target.value);
    });

    card.append(rfiNum, subject, statusBadge, textarea);
    
    // Place into initial column
    if (columns[currentStatus]) {
      columns[currentStatus].appendChild(card);
    } else {
      columns['Draft'].appendChild(card); // Fallback
    }
  });

  container.appendChild(kanban);
  return container;
}

// Execute Waymark registration
registerTemplate("rfi",{
  name: 'Construction RFI',
  priority: 25, 
  detect,
  render
});
                                                
