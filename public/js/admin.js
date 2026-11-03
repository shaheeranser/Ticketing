/**
 * Mehfil-e-Sama Qawwali Ticketing System - Admin Controller
 * Standalone Portal (/admin): Attendee Verification, Approval Dispatch, & Gate Check-in
 */

const ADMIN_STATE = {
  currentUser: null,
  activeFilter: 'All',
  searchQuery: '',
  entries: [],
  qrScanner: null,
  searchDebounceTimer: null
};

// -----------------------------------------------------------------------------
// DOM Ready Initialization
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const savedSession = localStorage.getItem('mehfil_admin_session');
  if (savedSession) {
    try {
      ADMIN_STATE.currentUser = JSON.parse(savedSession);
      showDashboard();
      loadEntries();
    } catch (e) {
      localStorage.removeItem('mehfil_admin_session');
      showLogin();
    }
  } else {
    showLogin();
  }
});

// -----------------------------------------------------------------------------
// Authentication Flow
// -----------------------------------------------------------------------------
function showLogin() {
  document.getElementById('view-login').style.display = 'block';
  document.getElementById('view-dashboard').style.display = 'none';
}

function showDashboard() {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-dashboard').style.display = 'block';
  const nameEl = document.getElementById('admin-display-name');
  if (nameEl && ADMIN_STATE.currentUser) {
    nameEl.textContent = ADMIN_STATE.currentUser.role || ADMIN_STATE.currentUser.username;
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();

  const user = document.getElementById('admin-user').value.trim();
  const pass = document.getElementById('admin-pass').value.trim();
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Invalid username or password.');
    }

    ADMIN_STATE.currentUser = data.user;
    localStorage.setItem('mehfil_admin_session', JSON.stringify(data.user));

    showDashboard();
    loadEntries();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In to Secretariat';
  }
}

function handleAdminLogout() {
  localStorage.removeItem('mehfil_admin_session');
  ADMIN_STATE.currentUser = null;
  showLogin();
}

// -----------------------------------------------------------------------------
// Load Entries & KPI Statistics
// -----------------------------------------------------------------------------
async function loadEntries(showLoading = false) {
  const tbody = document.getElementById('entries-tbody');
  if (showLoading && tbody) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--gold-light);">Refreshing records...</td></tr>`;
  }

  try {
    const params = new URLSearchParams();
    if (ADMIN_STATE.activeFilter !== 'All') {
      params.append('status', ADMIN_STATE.activeFilter);
    }
    if (ADMIN_STATE.searchQuery) {
      params.append('search', ADMIN_STATE.searchQuery);
    }

    const res = await fetch(`/api/admin/entries?${params.toString()}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load attendee records.');
    }

    ADMIN_STATE.entries = data.entries || [];

    // Update KPI counters
    const s = data.stats || {};
    document.getElementById('stat-total').textContent = s.total || 0;
    document.getElementById('stat-pending').textContent = s.pending || 0;
    document.getElementById('stat-approved').textContent = s.approved || 0;
    document.getElementById('stat-scanned').textContent = s.scanned || 0;

    renderTableRows(ADMIN_STATE.entries);
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: #f43f5e;">Error: ${err.message}</td></tr>`;
    }
  }
}

function renderTableRows(entries) {
  const tbody = document.getElementById('entries-tbody');
  if (!tbody) return;

  if (entries.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No registration records found matching the active criteria.
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  entries.forEach(r => {
    // Status Badge
    let statusBadge = '<span class="pass-status-pill status-pending" style="margin: 0; padding: 3px 10px; font-size: 11px;">Pending</span>';
    if (r.status === 'Approved') {
      statusBadge = '<span class="pass-status-pill status-approved" style="margin: 0; padding: 3px 10px; font-size: 11px;">Approved</span>';
    } else if (r.status === 'Declined') {
      statusBadge = '<span class="pass-status-pill status-declined" style="margin: 0; padding: 3px 10px; font-size: 11px;">Declined</span>';
    }

    // Gate Scanned Badge
    let gateBadge = r.qr_scanned
      ? '<span style="color: #6ee7b7; font-weight: 700; font-size: 11px;"><i class="fa-solid fa-circle-check"></i> Checked-In</span>'
      : '<span style="color: #94a3b8; font-size: 11px;"><i class="fa-regular fa-clock"></i> Not Scanned</span>';

    // Receipt Thumbnail
    let receiptCell = '<span style="color: #64748b; font-size: 12px;">No proof</span>';
    if (r.payment_screenshot_url) {
      receiptCell = `
        <img src="${r.payment_screenshot_url}" class="table-thumb" alt="Receipt" 
             onclick="openReceiptModal('${r.payment_screenshot_url}', '${escapeHtml(r.transaction_id || 'N/A')}', '${escapeHtml(r.sender_account_title || 'N/A')}', '${escapeHtml(r.sender_bank || 'N/A')}')" 
             title="Click to view payment proof">
      `;
    }

    // Action buttons
    let actionButtons = '';
    const deleteBtn = `
      <button class="btn-action btn-action-delete" onclick="deleteEntry('${r.ticket_id}')" title="Permanently Delete Registration from Database">
        <i class="fa-solid fa-trash-can"></i> Delete
      </button>
    `;

    if (r.status === 'Pending') {
      actionButtons = `
        <div class="action-btn-group">
          <button class="btn-action btn-action-approve" onclick="updateStatus('${r.ticket_id}', 'Approved')" title="Approve & Send Stylized QR Pass Email">
            <i class="fa-solid fa-paper-plane"></i> Approve
          </button>
          <button class="btn-action btn-action-decline" onclick="updateStatus('${r.ticket_id}', 'Declined')" title="Decline Registration">
            <i class="fa-solid fa-xmark"></i> Decline
          </button>
          ${deleteBtn}
        </div>
      `;
    } else if (r.status === 'Approved') {
      actionButtons = `
        <div class="action-btn-group">
          <button class="btn-action btn-action-resend" onclick="resendTicketEmail('${r.ticket_id}')" title="Re-dispatch stylized pass email">
            <i class="fa-solid fa-rotate-right"></i> Resend
          </button>
          <button class="btn-action btn-action-decline" onclick="updateStatus('${r.ticket_id}', 'Declined')" title="Revoke Pass">
            <i class="fa-solid fa-ban"></i> Revoke
          </button>
          ${deleteBtn}
        </div>
      `;
    } else {
      actionButtons = `
        <div class="action-btn-group">
          <button class="btn-action btn-action-approve" onclick="updateStatus('${r.ticket_id}', 'Approved')" title="Re-Approve and dispatch pass">
            <i class="fa-solid fa-check"></i> Re-Approve
          </button>
          ${deleteBtn}
        </div>
      `;
    }

    html += `
      <tr>
        <td>
          <div style="font-family: var(--font-mono); font-weight: 700; color: var(--gold-light); letter-spacing: 1px;">
            ${r.ticket_id}
          </div>
          <div style="font-size: 11px; color: var(--text-muted);">
            ${new Date(r.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </td>
        <td>
          <strong style="color: #ffffff;">${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</strong>
          <div style="font-size: 12px; color: #a1a1aa;">${escapeHtml(r.email)}</div>
          ${r.organization ? `<div style="font-size: 11px; color: #71717a;">${escapeHtml(r.organization)}</div>` : ''}
        </td>
        <td>
          <div style="font-family: var(--font-mono);">${escapeHtml(r.cnic)}</div>
          <div style="font-size: 12px; color: #a1a1aa;">${escapeHtml(r.phone)}</div>
        </td>
        <td>
          <div style="color: var(--gold-light); font-weight: 600;">${escapeHtml(r.category)}</div>
          <div style="font-size: 12px; color: #a1a1aa;">${escapeHtml(r.fee_amount)}</div>
        </td>
        <td>${receiptCell}</td>
        <td>${statusBadge}</td>
        <td>${gateBadge}</td>
        <td>${actionButtons}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

// -----------------------------------------------------------------------------
// Filters & Search
// -----------------------------------------------------------------------------
function setFilter(filterName, btn) {
  ADMIN_STATE.activeFilter = filterName;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadEntries(true);
}

function handleSearchInput(e) {
  clearTimeout(ADMIN_STATE.searchDebounceTimer);
  ADMIN_STATE.searchDebounceTimer = setTimeout(() => {
    ADMIN_STATE.searchQuery = e.target.value.trim();
    loadEntries(false);
  }, 300);
}

// -----------------------------------------------------------------------------
// Approve / Decline Status & Automatic Email Delivery
// -----------------------------------------------------------------------------
async function updateStatus(ticketId, newStatus) {
  const confirmMsg = newStatus === 'Approved'
    ? `Approve registration for ${ticketId}?\n\nThis will automatically generate the attendee's QR Pass and dispatch the stylized Sur o Suroor invitation email.`
    : `Set status of ${ticketId} to "${newStatus}"?`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/admin/update_status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_id: ticketId,
        status: newStatus,
        handled_by: ADMIN_STATE.currentUser?.role || 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update status.');
    }

    alert(data.message);
    loadEntries(false);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function resendTicketEmail(ticketId) {
  try {
    const res = await fetch('/api/admin/resend_ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketId })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to resend pass email.');
    }

    alert(data.message || 'Pass email re-sent successfully.');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Hard Delete Registration
// -----------------------------------------------------------------------------
async function deleteEntry(ticketId) {
  const confirmed = confirm(
    `PERMANENT DELETION WARNING:\n\nAre you sure you want to permanently delete registration "${ticketId}" from the database?\n\nThis will perform a hard delete and cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/entry/${encodeURIComponent(ticketId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete record.');
    }

    alert(data.message || `Registration ${ticketId} deleted successfully.`);
    loadEntries(false);
  } catch (err) {
    alert(`Delete Error: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Receipt Screenshot Modal
// -----------------------------------------------------------------------------
function openReceiptModal(imageUrl, transId, senderTitle, senderBank) {
  const modal = document.getElementById('receipt-modal');
  const img = document.getElementById('modal-receipt-img');
  const meta = document.getElementById('modal-receipt-meta');

  img.src = imageUrl;
  meta.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px;">
      <div><strong>Transaction ID:</strong><br>${transId}</div>
      <div><strong>Sender Title:</strong><br>${senderTitle}</div>
      <div><strong>Sender Bank / Channel:</strong><br>${senderBank}</div>
    </div>
  `;
  modal.classList.add('active');
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').classList.remove('active');
}

// -----------------------------------------------------------------------------
// Gate Admission QR Scanner
// -----------------------------------------------------------------------------
function openGateScannerModal() {
  const modal = document.getElementById('scanner-modal');
  const banner = document.getElementById('scan-result-banner');
  banner.style.display = 'none';
  modal.classList.add('active');

  // Start Html5Qrcode Scanner if available
  if (typeof Html5Qrcode !== 'undefined') {
    try {
      if (!ADMIN_STATE.qrScanner) {
        ADMIN_STATE.qrScanner = new Html5Qrcode('qr-reader-container');
      }
      ADMIN_STATE.qrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          handleScannedTicket(decodedText);
        },
        (error) => {
          // ignore scan frame errors
        }
      ).catch(err => {
        console.warn('Camera access error:', err);
      });
    } catch (e) {
      console.warn('Scanner init error:', e);
    }
  }
}

function closeGateScannerModal() {
  if (ADMIN_STATE.qrScanner) {
    try {
      ADMIN_STATE.qrScanner.stop().then(() => {
        ADMIN_STATE.qrScanner.clear();
      }).catch(() => {});
    } catch (e) {}
  }
  document.getElementById('scanner-modal').classList.remove('active');
  loadEntries(false);
}

function validateManualTicket() {
  const input = document.getElementById('manual-ticket-input');
  const val = input.value.trim();
  if (!val) return;
  handleScannedTicket(val);
}

async function handleScannedTicket(ticketString) {
  const banner = document.getElementById('scan-result-banner');
  banner.style.display = 'block';
  banner.style.background = 'rgba(212, 175, 55, 0.15)';
  banner.style.border = '1px solid var(--gold-primary)';
  banner.style.color = 'var(--gold-light)';
  banner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Validating ticket with secretariat records...';

  try {
    const res = await fetch('/api/admin/scan_qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketString })
    });

    const data = await res.json();

    if (data.valid && data.success) {
      banner.style.background = 'rgba(16, 185, 129, 0.2)';
      banner.style.border = '1px solid #10b981';
      banner.style.color = '#6ee7b7';
      banner.innerHTML = `
        <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">✓ PASS VALIDATED — WELCOME!</div>
        <div>Ticket: <strong>${data.entry.ticket_id}</strong> (${data.entry.category})</div>
        <div>Attendee: <strong>${data.entry.first_name} ${data.entry.last_name}</strong></div>
        <div style="font-size: 11px; margin-top: 4px; color: #a7f3d0;">Gate entry recorded at ${new Date().toLocaleTimeString()}</div>
      `;
    } else if (data.already_scanned) {
      banner.style.background = 'rgba(239, 68, 68, 0.25)';
      banner.style.border = '1px solid #ef4444';
      banner.style.color = '#fca5a5';
      banner.innerHTML = `
        <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">⚠️ ALREADY USED TICKET</div>
        <div>Ticket: <strong>${data.entry?.ticket_id || ticketString}</strong></div>
        <div>Attendee: <strong>${data.entry?.name || 'N/A'}</strong></div>
        <div>First Check-in: ${new Date(data.entry?.scanned_at).toLocaleString()}</div>
      `;
    } else {
      banner.style.background = 'rgba(239, 68, 68, 0.2)';
      banner.style.border = '1px solid #ef4444';
      banner.style.color = '#fca5a5';
      banner.innerHTML = `
        <div style="font-weight: 700; font-size: 15px;">✗ ENTRY DENIED</div>
        <div>${data.message || 'Invalid ticket.'}</div>
      `;
    }
  } catch (err) {
    banner.style.background = 'rgba(239, 68, 68, 0.2)';
    banner.style.border = '1px solid #ef4444';
    banner.style.color = '#fca5a5';
    banner.innerHTML = `Network error: ${err.message}`;
  }
}

// -----------------------------------------------------------------------------
// CSV Export
// -----------------------------------------------------------------------------
function exportRegistrationsCsv() {
  window.location.href = '/api/admin/export_csv';
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
