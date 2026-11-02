/**
 * Mehfil-e-Sama Qawwali Ticketing System - Frontend Controller
 * Public Page: Registration, Tier Selection, Pass Status, & Oriental Soundscape
 */

// Application State
const STATE = {
  currentTab: 'register',
  selectedTier: 'General Mehfil',
  basePrice: 2000,
  discountPercent: 0,
  finalPrice: 2000,
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

  // Drag and drop setup for receipt screenshot
  setupDropzone();

  // Recalculate price
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
}

// -----------------------------------------------------------------------------
// Seating Tier Selection & Price Calculation
// -----------------------------------------------------------------------------
function selectTier(tierName, price, cardElement) {
  STATE.selectedTier = tierName;
  STATE.basePrice = price;

  // Toggle selected card styling
  document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('selected'));
  if (cardElement) {
    cardElement.classList.add('selected');
  }

  document.getElementById('selected-category').value = tierName;
  document.getElementById('selected-base-price').value = price;

  recalculatePrice();
}

function recalculatePrice() {
  let payable = STATE.basePrice;

  if (STATE.isGuest) {
    payable = 0;
  } else if (STATE.discountPercent > 0) {
    payable = Math.round(STATE.basePrice * (1 - STATE.discountPercent / 100));
  }

  STATE.finalPrice = payable;
  const formatted = payable === 0 ? 'Complimentary VIP Honor' : `PKR ${payable.toLocaleString()}`;

  const dueEl = document.getElementById('display-due-amount');
  if (dueEl) dueEl.textContent = formatted;

  const hiddenFinal = document.getElementById('selected-final-price');
  if (hiddenFinal) hiddenFinal.value = formatted;
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

  feedback.textContent = 'Verifying invitation code...';
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
// CNIC Hyphen Formatting
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

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });
}

function handleFileSelect(e) {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file (PNG, JPG, or JPEG).');
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

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = 'fa-solid fa-check';
      setTimeout(() => { icon.className = 'fa-regular fa-copy'; }, 2000);
    }
  });
}

// -----------------------------------------------------------------------------
// Registration Submission
// -----------------------------------------------------------------------------
async function handleRegistrationSubmit(e) {
  e.preventDefault();

  const btn = document.getElementById('btn-submit-registration');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reserving Pass...';

  try {
    const formData = new FormData();
    formData.append('first_name', document.getElementById('reg-first-name').value.trim());
    formData.append('last_name', document.getElementById('reg-last-name').value.trim());
    formData.append('cnic', document.getElementById('reg-cnic').value.trim());
    formData.append('email', document.getElementById('reg-email').value.trim());
    formData.append('phone', document.getElementById('reg-phone').value.trim());
    formData.append('organization', document.getElementById('reg-org').value.trim());
    formData.append('category', document.getElementById('selected-category').value);
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
  } catch (err) {
    alert(`Registration Error: ${err.message}`);
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
  container.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--gold-light);">Searching for registration record...</div>';

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
          <div style="font-size: 36px; color: #f43f5e; margin-bottom: 10px;">✦</div>
          <h3 class="font-serif" style="color: #fda4af; margin-bottom: 8px;">No Record Found</h3>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 450px; margin: 0 auto;">
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
  const isApproved = entry.status === 'Approved';
  const isPending = entry.status === 'Pending';
  const isDeclined = entry.status === 'Declined';

  let statusBadgeClass = 'status-pending';
  let statusText = 'Verification Pending';
  if (isApproved) {
    statusBadgeClass = 'status-approved';
    statusText = 'Confirmed & Active Pass';
  } else if (isDeclined) {
    statusBadgeClass = 'status-declined';
    statusText = 'Reservation Declined';
  }

  let bodyContent = '';

  if (isPending) {
    bodyContent = `
      <div style="font-size: 40px; color: #f59e0b; margin: 15px 0;">⏳</div>
      <h3 class="font-serif" style="color: #fcd34d; margin-bottom: 8px;">Under Verification</h3>
      <p style="font-size: 13px; color: var(--text-secondary); max-width: 500px; margin: 0 auto 20px auto; line-height: 1.6;">
        Your payment screenshot and credentials are currently being reviewed by the admissions desk. Once verified, your encrypted QR Gate Pass will appear right here and will be dispatched to <strong>${entry.email}</strong>.
      </p>
    `;
  } else if (isDeclined) {
    bodyContent = `
      <div style="font-size: 40px; color: #f43f5e; margin: 15px 0;">✗</div>
      <h3 class="font-serif" style="color: #fda4af; margin-bottom: 8px;">Reservation Not Confirmed</h3>
      <p style="font-size: 13px; color: var(--text-secondary); max-width: 480px; margin: 0 auto 20px auto; line-height: 1.6;">
        This registration could not be verified with the provided payment receipt. For assistance or re-submission, please contact the organizing committee at <strong>sama@mehfil.org</strong>.
      </p>
    `;
  } else if (isApproved && entry.qr_data_url) {
    bodyContent = `
      <div class="pass-qr-frame">
        <img src="${entry.qr_data_url}" alt="Gate Pass QR Code" id="pass-qr-image">
      </div>
      <div style="font-size: 12px; color: var(--emerald-bright); margin-bottom: 15px;">
        <i class="fa-solid fa-circle-check"></i> Present this official QR code at the entrance
      </div>
      <div style="display: flex; gap: 10px; justify-content: center; margin-bottom: 15px;">
        <button type="button" class="btn-secondary" onclick="window.print()">
          <i class="fa-solid fa-print"></i> Print / Save Pass
        </button>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="pass-result-card">
      <div class="pass-status-pill ${statusBadgeClass}">
        ${statusText}
      </div>

      <div style="font-family: var(--font-urdu); font-size: 24px; color: var(--gold-light);">محفلِ سماع • بزمِ خسرو</div>
      <div style="font-family: var(--font-mono); font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: 2px; margin: 4px 0 15px 0;">
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
          <div class="label">Seating Tier</div>
          <div class="val">${entry.category}</div>
        </div>
        <div class="pass-meta-item">
          <div class="label">Gate Status</div>
          <div class="val" style="color: ${entry.qr_scanned ? '#f43f5e' : '#10b981'};">
            ${entry.qr_scanned ? 'Already Checked In' : 'Valid for Admission'}
          </div>
        </div>
      </div>

      <div style="font-size: 11px; color: var(--text-muted); border-top: 1px dashed var(--border-gold); padding-top: 12px; margin-top: 15px;">
        Gate opens at 7:30 PM • The Royal Heritage Courtyard, Lahore • Please bring your physical CNIC
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
    btnText.textContent = 'Mehfil Ambience';
  } else {
    startAmbientDrone();
    STATE.isMusicPlaying = true;
    btn.classList.add('playing');
    waveBars.classList.add('active');
    btnText.textContent = 'Ambience: On';
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
    masterGain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 3);
    masterGain.connect(ctx.destination);
    STATE.musicNodes.push(masterGain);

    // Fundamental Tanpura Frequencies in Indian Classical Music (C# / Kharaj Pancham tuning)
    // Sa (C#3: 138.6 Hz), Pa (G#3: 207.65 Hz), Tar Sa (C#4: 277.2 Hz)
    const frequencies = [
      { f: 138.6, type: 'sawtooth', gain: 0.08, lfoRate: 0.25 },
      { f: 207.65, type: 'triangle', gain: 0.12, lfoRate: 0.35 },
      { f: 277.2, type: 'sine', gain: 0.06, lfoRate: 0.18 },
      { f: 69.3, type: 'sine', gain: 0.14, lfoRate: 0.1 } // Deep sub drone
    ];

    frequencies.forEach(spec => {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.f, ctx.currentTime);

      // Lowpass filter for warm acoustic resonance
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, ctx.currentTime);
      filter.Q.setValueAtTime(2, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(spec.gain, ctx.currentTime);

      // Amplitude LFO to simulate the breathing rhythm of the Tanpura plucking
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
    } catch (e) {
      // Ignore cleanup error
    }
  }
}
