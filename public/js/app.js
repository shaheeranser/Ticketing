/**
 * Sur o Suroor - Mystical Qawwali Ticketing System - Public Application Controller
 * Handles Pass Reservation, 25% Referral Codes, Al Baraka Bank details, Verification & Ambient Soundscape
 */

const STATE = {
  currentTab: 'register',
  selectedTier: 'Sur o Suroor Pass',
  basePrice: 4000,
  discountPercent: 0,
  finalPrice: 4000,
  isGuest: false,
  selectedFile: null,
  recentTicketId: null,
  musicAudioContext: null,
  isMusicPlaying: false,
  musicNodes: []
};

// -----------------------------------------------------------------------------
// DOM Ready Initialization
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Format CNIC as user types: 35202-1234567-1
  const cnicInput = document.getElementById('reg-cnic');
  if (cnicInput) {
    cnicInput.addEventListener('input', (e) => formatCnicInput(e.target));
  }

  // Setup drag & drop upload zone
  setupDropzone();

  // Initialize price display
  recalculatePrice();
});

// -----------------------------------------------------------------------------
// Tab Switching
// -----------------------------------------------------------------------------
function switchTab(tabName) {
  STATE.currentTab = tabName;

  const views = ['register', 'status'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    const btn = document.getElementById(`tab-btn-${v}`);
    if (el) el.classList.remove('active');
    if (btn) btn.classList.remove('active');
  });

  const targetView = document.getElementById(`view-${tabName}`);
  const targetBtn = document.getElementById(`tab-btn-${tabName}`);
  if (targetView) targetView.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');

  // Scroll smoothly to top of view card on mobile
  if (window.innerWidth < 768) {
    targetView?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// -----------------------------------------------------------------------------
// Price Calculation (Base 4,000 PKR, 25% Promo Discount = 3,000 PKR)
// -----------------------------------------------------------------------------
function recalculatePrice() {
  let payable = STATE.basePrice;

  const dueEl = document.getElementById('display-due-amount');
  const ticketCardPrice = document.getElementById('ticket-card-price');
  const ticketBadge = document.getElementById('ticket-price-badge');
  const hiddenFinal = document.getElementById('selected-final-price');
  const submitBtnText = document.getElementById('submit-btn-text');
  const qrImg = document.getElementById('payment-qr-img');
  const qrSubtext = document.getElementById('payment-qr-subtext');
  const qrArea = document.getElementById('payment-qr-area');
  const bankArea = document.getElementById('bank-details-area');

  if (STATE.isGuest) {
    payable = 0;
    STATE.finalPrice = 0;
    const formatted = 'PKR 0 (Free Entry)';
    if (dueEl) dueEl.textContent = 'PKR 0 (Free Entry Applied)';
    if (ticketCardPrice) {
      ticketCardPrice.innerHTML = `<span class="original-price-strike">PKR 4,000</span> <span style="color: var(--emerald-bright);">PKR 0</span>`;
    }
    if (ticketBadge) {
      ticketBadge.textContent = 'Special Guest Pass (100% Free Entry)';
      ticketBadge.style.color = 'var(--emerald-bright)';
    }
    if (hiddenFinal) hiddenFinal.value = formatted;
    if (submitBtnText) submitBtnText.textContent = 'Confirm Free Guest Admission';
    if (qrArea) qrArea.style.display = 'none';
    if (bankArea) bankArea.style.display = 'none';
  } else if (STATE.discountPercent > 0) {
    payable = Math.round(STATE.basePrice * (1 - STATE.discountPercent / 100));
    STATE.finalPrice = payable;
    const formatted = `PKR ${payable.toLocaleString()}`;
    if (dueEl) dueEl.textContent = formatted;
    if (ticketCardPrice) {
      ticketCardPrice.innerHTML = `<span class="original-price-strike">PKR 4,000</span> ${formatted}`;
    }
    if (ticketBadge) {
      ticketBadge.textContent = '25% Referral Discount (-PKR 1,000)';
      ticketBadge.style.color = '#10b981';
    }
    if (hiddenFinal) hiddenFinal.value = formatted;
    if (submitBtnText) submitBtnText.textContent = `Reserve Pass • ${formatted}`;
    if (qrArea) qrArea.style.display = 'block';
    if (bankArea) bankArea.style.display = 'block';
    if (qrImg) qrImg.src = '/images/qr-payment-3000.png';
    if (qrSubtext) qrSubtext.textContent = 'Scan to pay PKR 3,000 via Raast / Banking App';
  } else {
    payable = STATE.basePrice;
    STATE.finalPrice = payable;
    const formatted = `PKR ${payable.toLocaleString()}`;
    if (dueEl) dueEl.textContent = formatted;
    if (ticketCardPrice) ticketCardPrice.textContent = formatted;
    if (ticketBadge) {
      ticketBadge.textContent = 'Standard Rate';
      ticketBadge.style.color = 'var(--text-muted)';
    }
    if (hiddenFinal) hiddenFinal.value = formatted;
    if (submitBtnText) submitBtnText.textContent = `Reserve Pass • ${formatted}`;
    if (qrArea) qrArea.style.display = 'block';
    if (bankArea) bankArea.style.display = 'block';
    if (qrImg) qrImg.src = '/images/qr-payment-4000.png';
    if (qrSubtext) qrSubtext.textContent = 'Scan to pay PKR 4,000 via Raast / Banking App';
  }
}

// -----------------------------------------------------------------------------
// Privilege / Referral Code Validation
// -----------------------------------------------------------------------------
async function applyReferralCode() {
  const codeInput = document.getElementById('reg-referral');
  const feedback = document.getElementById('referral-feedback');
  const code = (codeInput?.value || '').trim();

  if (!code) {
    STATE.discountPercent = 0;
    STATE.isGuest = false;
    feedback.textContent = '';
    recalculatePrice();
    return;
  }

  feedback.textContent = 'Verifying referral code...';
  feedback.style.color = 'var(--text-muted)';

  try {
    const res = await fetch('/api/validate_code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (data.valid) {
      STATE.discountPercent = data.discount || 0;
      STATE.isGuest = !!data.isGuest;
      feedback.textContent = `✓ ${data.message}`;
      feedback.style.color = '#10b981';
    } else {
      STATE.discountPercent = 0;
      STATE.isGuest = false;
      feedback.textContent = `✗ ${data.message}`;
      feedback.style.color = '#f43f5e';
    }
  } catch (err) {
    feedback.textContent = 'Network error checking code.';
    feedback.style.color = '#f43f5e';
  }

  recalculatePrice();
}

// -----------------------------------------------------------------------------
// CNIC Hyphen Formatting: 35202-1234567-1
// -----------------------------------------------------------------------------
function formatCnicInput(input) {
  let val = input.value.replace(/\D/g, '');
  if (val.length > 13) val = val.substring(0, 13);

  let formatted = '';
  if (val.length > 5) {
    formatted = val.substring(0, 5) + '-';
    if (val.length > 12) {
      formatted += val.substring(5, 12) + '-' + val.substring(12);
    } else {
      formatted += val.substring(5);
    }
  } else {
    formatted = val;
  }
  input.value = formatted;
}

// -----------------------------------------------------------------------------
// Payment Screenshot Upload & Dropzone
// -----------------------------------------------------------------------------
function setupDropzone() {
  const dropzone = document.getElementById('receipt-dropzone');
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      processSelectedFile(dt.files[0]);
    }
  });
}

function handleFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (file) {
    processSelectedFile(file);
  }
}

function processSelectedFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please select a valid image file (PNG, JPG, JPEG).');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    alert('File size exceeds 15MB limit.');
    return;
  }

  STATE.selectedFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('preview-image');
    const container = document.getElementById('preview-container');
    const dropzone = document.getElementById('receipt-dropzone');
    if (preview && container && dropzone) {
      preview.src = e.target.result;
      container.style.display = 'block';
      dropzone.style.display = 'none';
    }
  };
  reader.readAsDataURL(file);
}

function removeSelectedFile() {
  STATE.selectedFile = null;
  const input = document.getElementById('receipt-file');
  if (input) input.value = '';
  const container = document.getElementById('preview-container');
  const dropzone = document.getElementById('receipt-dropzone');
  if (container) container.style.display = 'none';
  if (dropzone) dropzone.style.display = 'block';
}

// -----------------------------------------------------------------------------
// Clipboard Copy with Visual Tooltip Feedback
// -----------------------------------------------------------------------------
function copyToClipboard(text, btn) {
  const origHtml = btn.innerHTML;
  
  const onSuccess = () => {
    btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Copied!</span>';
    btn.style.borderColor = 'var(--emerald-bright)';
    btn.style.color = '#6ee7b7';
    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.style.borderColor = '';
      btn.style.color = '';
    }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      fallbackCopy(text, onSuccess);
    });
  } else {
    fallbackCopy(text, onSuccess);
  }
}

function fallbackCopy(text, cb) {
  const tempInput = document.createElement('input');
  tempInput.value = text;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand('copy');
  document.body.removeChild(tempInput);
  cb();
}

// -----------------------------------------------------------------------------
// Registration Submission
// -----------------------------------------------------------------------------
async function handleRegistrationSubmit(e) {
  e.preventDefault();

  const btn = document.getElementById('btn-submit-registration');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing Reservation...';

  try {
    const formData = new FormData();
    formData.append('first_name', document.getElementById('reg-first-name').value.trim());
    formData.append('last_name', document.getElementById('reg-last-name').value.trim());
    formData.append('cnic', document.getElementById('reg-cnic').value.trim());
    formData.append('email', document.getElementById('reg-email').value.trim());
    formData.append('phone', document.getElementById('reg-phone').value.trim());
    formData.append('organization', document.getElementById('reg-org').value.trim());
    formData.append('category', 'Sur o Suroor Pass');
    formData.append('referral_code', document.getElementById('reg-referral').value.trim());
    formData.append('fee_amount', document.getElementById('selected-final-price').value);
    formData.append('transaction_id', document.getElementById('pay-trans-id').value.trim());
    formData.append('sender_account_title', document.getElementById('pay-sender-name').value.trim());

    if (STATE.selectedFile) {
      formData.append('screenshot', STATE.selectedFile);
    }

    const res = await fetch('/api/register', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Registration failed.');
    }

    // Success! Show modal
    STATE.recentTicketId = data.ticket_id;
    document.getElementById('modal-ticket-id').textContent = data.ticket_id;
    document.getElementById('success-modal').classList.add('active');

    // Reset form
    document.getElementById('registration-form').reset();
    removeSelectedFile();
    STATE.discountPercent = 0;
    STATE.isGuest = false;
    document.getElementById('referral-feedback').textContent = '';
    recalculatePrice();
  } catch (err) {
    alert(`Registration Notice: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function closeSuccessModal() {
  document.getElementById('success-modal').classList.remove('active');
}

function goToStatusWithTicket() {
  closeSuccessModal();
  switchTab('status');
  if (STATE.recentTicketId) {
    document.getElementById('status-query').value = STATE.recentTicketId;
    handleStatusLookup(new Event('submit'));
  }
}

// -----------------------------------------------------------------------------
// Check E-Pass Status
// -----------------------------------------------------------------------------
async function handleStatusLookup(e) {
  if (e) e.preventDefault();

  const query = document.getElementById('status-query').value.trim();
  const container = document.getElementById('status-result-container');
  const btn = document.getElementById('btn-search-status');

  if (!query) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
  container.style.display = 'block';
  container.innerHTML = '<div style="text-align: center; padding: 25px; color: var(--gold-light);">Searching for admission record...</div>';

  try {
    const res = await fetch('/api/check_status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      container.innerHTML = `
        <div class="pass-result-card" style="border-color: rgba(244, 63, 94, 0.4);">
          <div style="font-size: 32px; color: #f43f5e; margin-bottom: 8px;">✦</div>
          <h3 class="font-serif" style="color: #fda4af; margin-bottom: 8px; font-size: 18px;">No Record Found</h3>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 440px; margin: 0 auto;">
            ${data.message || 'We could not locate any active pass with those details. Please check for typos in your CNIC or Ticket ID.'}
          </p>
        </div>
      `;
      return;
    }

    const entry = data.entry;
    renderPassCard(entry, container);
  } catch (err) {
    container.innerHTML = `
      <div class="pass-result-card" style="border-color: #f43f5e;">
        <h3 style="color: #fda4af;">Lookup Error</h3>
        <p style="color: var(--text-muted);">${err.message}</p>
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Check Pass';
  }
}

function renderPassCard(entry, container) {
  let statusBadgeClass = 'status-pending';
  let statusText = 'Payment Verification Pending';
  let bodyContent = '';

  if (entry.status === 'Approved') {
    statusBadgeClass = 'status-approved';
    statusText = 'Verified Admission Pass';
    bodyContent = `
      <div class="pass-qr-frame">
        <img src="${entry.qrDataUrl || '/images/sur-o-suroor-icon.png'}" alt="Encrypted Gate Pass QR Code">
      </div>
      <div style="font-size: 12px; color: #a1a1aa; margin-top: 4px;">
        Present this encrypted QR code at the entrance for barcode gate scanning.
      </div>
    `;
  } else if (entry.status === 'Declined') {
    statusBadgeClass = 'status-declined';
    statusText = 'Reservation Declined';
    bodyContent = `
      <div style="padding: 20px 10px; color: #fda4af;">
        <p style="font-size: 13px; line-height: 1.6;">
          Your registration could not be verified by the secretariat. Reason: ${entry.notes || 'Payment proof could not be verified against the official bank ledger.'}
        </p>
      </div>
    `;
  } else {
    bodyContent = `
      <div style="padding: 20px 10px;">
        <i class="fa-solid fa-clock-rotate-left" style="font-size: 32px; color: #f59e0b; margin-bottom: 10px;"></i>
        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; max-width: 460px; margin: 0 auto;">
          Your payment screenshot has been logged. Our admissions committee is verifying the bank transfer. Once approved, your encrypted QR code will appear here automatically.
        </p>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="pass-result-card">
      <div class="pass-status-pill ${statusBadgeClass}">
        ${statusText}
      </div>

      <div style="font-family: var(--font-urdu); font-size: 24px; color: var(--gold-light);">سُر و سُرور</div>
      <div style="font-family: var(--font-mono); font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: 2px; margin: 2px 0 12px 0;">
        ${entry.ticket_id}
      </div>

      ${bodyContent}

      <div class="pass-meta-grid">
        <div class="pass-meta-item">
          <div class="label">Attendee</div>
          <div class="val">${entry.first_name} ${entry.last_name}</div>
        </div>
        <div class="pass-meta-item">
          <div class="label">CNIC</div>
          <div class="val">${entry.cnic}</div>
        </div>
        <div class="pass-meta-item">
          <div class="label">Pass Type</div>
          <div class="val">${entry.category || 'Sur o Suroor Pass'}</div>
        </div>
        <div class="pass-meta-item">
          <div class="label">Pass Fee</div>
          <div class="val">${entry.fee_amount || 'PKR 4,000'}</div>
        </div>
        <div class="pass-meta-item">
          <div class="label">Gate Status</div>
          <div class="val" style="color: ${entry.qr_scanned ? '#f43f5e' : '#10b981'};">
            ${entry.qr_scanned ? 'Already Checked In' : 'Valid for Admission'}
          </div>
        </div>
        <div class="pass-meta-item">
          <div class="label">Date & Time</div>
          <div class="val">TBA</div>
        </div>
        <div class="pass-meta-item">
          <div class="label">Venue</div>
          <div class="val">Gulberg, TBA</div>
        </div>
      </div>

      <div style="font-size: 11px; color: var(--text-muted); border-top: 1px dashed var(--border-gold); padding-top: 10px; margin-top: 14px;">
        Venue: Gulberg, TBA • Date & Time: TBA • Physical CNIC required for admission
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Oriental Ambient Music & Tanpura Soundscape (Web Audio API Synthesizer)
// -----------------------------------------------------------------------------
function toggleAmbientMusic() {
  const btn = document.getElementById('btn-ambient-music');
  const btnText = document.getElementById('music-btn-text');
  const waveBars = document.getElementById('music-wave-bars');

  if (STATE.isMusicPlaying) {
    stopAmbientDrone();
    STATE.isMusicPlaying = false;
    btn.classList.remove('playing');
    waveBars.classList.remove('active');
    btnText.textContent = 'Ambience';
  } else {
    startAmbientDrone();
    STATE.isMusicPlaying = true;
    btn.classList.add('playing');
    waveBars.classList.add('active');
    btnText.textContent = 'On';
  }
}

function startAmbientDrone() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!STATE.musicAudioContext) {
      STATE.musicAudioContext = new AudioContext();
    }
    const ctx = STATE.musicAudioContext;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 3);
    masterGain.connect(ctx.destination);
    STATE.musicNodes.push(masterGain);

    // Fundamental Tanpura Frequencies (C# / Kharaj Pancham tuning)
    const frequencies = [
      { f: 138.6, type: 'sawtooth', gain: 0.07, lfoRate: 0.25 },
      { f: 207.65, type: 'triangle', gain: 0.11, lfoRate: 0.35 },
      { f: 277.2, type: 'sine', gain: 0.05, lfoRate: 0.18 },
      { f: 69.3, type: 'sine', gain: 0.12, lfoRate: 0.1 }
    ];

    frequencies.forEach(spec => {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.f, ctx.currentTime);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, ctx.currentTime);
      filter.Q.setValueAtTime(2, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(spec.gain, ctx.currentTime);

      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(spec.lfoRate, ctx.currentTime);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(spec.gain * 0.4, ctx.currentTime);
      lfo.connect(lfoGain.gain);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start();
      lfo.start();

      STATE.musicNodes.push(osc, lfo, gain, filter);
    });
  } catch (err) {
    console.warn('Web Audio Ambient Drone could not start:', err);
  }
}

function stopAmbientDrone() {
  if (STATE.musicAudioContext) {
    try {
      STATE.musicNodes.forEach(node => {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      });
      STATE.musicNodes = [];
    } catch (e) {}
  }
}
