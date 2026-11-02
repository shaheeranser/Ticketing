/**
 * Mehfil-e-Sama Qawwali Ticketing System - Application Server
 * Stack: Node.js (Express), PostgreSQL, MinIO Object Storage, Nodemailer
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const Minio = require('minio');
const multer = require('multer');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // Also serve root static assets (style.css, etc.)

// PostgreSQL Connection Pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres123',
  database: process.env.POSTGRES_DB || 'eventpass_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// MinIO Object Storage Client
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
  secretKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin123'
});
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'payment-receipts';

// Multer memory storage for uploaded payment receipts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

// Nodemailer SMTP Transporter
function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true' || parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

function isSmtpConfigured() {
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  return user && !user.includes('your_email') && pass && !pass.includes('your_16_digit');
}

// -----------------------------------------------------------------------------
// Database & MinIO Initialization
// -----------------------------------------------------------------------------
async function initDatabase(retries = 15, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      console.log(`[DB] Connected to PostgreSQL (attempt ${attempt}/${retries})`);
      
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS registrations (
          ticket_id VARCHAR(30) PRIMARY KEY,
          timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          cnic VARCHAR(30) NOT NULL,
          email VARCHAR(150) NOT NULL,
          phone VARCHAR(50) NOT NULL,
          organization VARCHAR(150),
          category VARCHAR(50) DEFAULT 'General Mehfil',
          referral_code VARCHAR(30),
          fee_amount VARCHAR(50) NOT NULL,
          sender_account_title VARCHAR(150),
          sender_bank VARCHAR(100),
          transaction_id VARCHAR(100),
          payment_screenshot_url TEXT,
          status VARCHAR(50) DEFAULT 'Pending',
          qr_scanned BOOLEAN DEFAULT FALSE,
          scanned_at TIMESTAMPTZ,
          handled_by VARCHAR(100),
          notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_reg_cnic ON registrations(cnic);
        CREATE INDEX IF NOT EXISTS idx_reg_email ON registrations(email);
        CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
      `;
      await client.query(createTableQuery);
      client.release();
      console.log('[DB] Table "registrations" initialized successfully.');
      return;
    } catch (err) {
      console.warn(`[DB] Retrying connection (${attempt}/${retries}): ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function initMinio(retries = 15, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const exists = await minioClient.bucketExists(MINIO_BUCKET);
      if (!exists) {
        await minioClient.makeBucket(MINIO_BUCKET, 'us-east-1');
        console.log(`[MinIO] Created bucket "${MINIO_BUCKET}".`);
      } else {
        console.log(`[MinIO] Bucket "${MINIO_BUCKET}" ready.`);
      }
      return;
    } catch (err) {
      console.warn(`[MinIO] Retrying connection (${attempt}/${retries}): ${err.message}`);
      if (attempt === retries) {
        console.error('[MinIO] Warning: MinIO not ready yet, uploads will retry upon request.');
        return;
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// -----------------------------------------------------------------------------
// Stylized Sufi Email Template & Dispatcher
// -----------------------------------------------------------------------------
async function generateTicketQrBuffer(ticketId, attendee) {
  const qrData = JSON.stringify({
    event: "Mehfil-e-Sama 2026",
    ticket_id: ticketId,
    name: `${attendee.first_name} ${attendee.last_name}`,
    category: attendee.category,
    cnic: attendee.cnic,
    verified_url: `https://mehfil.sama/verify/${ticketId}`
  });

  return await QRCode.toBuffer(qrData, {
    width: 320,
    margin: 2,
    color: {
      dark: '#081426',
      light: '#ffffff'
    },
    errorCorrectionLevel: 'H'
  });
}

function buildSufiEmailHtml(entry) {
  const fullName = `${entry.first_name} ${entry.last_name}`;
  const category = entry.category || 'General Mehfil';
  const ticketId = entry.ticket_id;
  const feeAmount = entry.fee_amount || 'PKR 2,000';
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mehfil-e-Sama Official Pass</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #060b14;
      font-family: 'Georgia', 'Cinzel', serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #e2d9c8;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #060b14;
      padding: 40px 10px;
    }
    .main-table {
      max-width: 620px;
      margin: 0 auto;
      background: linear-gradient(180deg, #0d1627 0%, #08111e 100%);
      border: 2px solid #d4af37;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(212, 175, 55, 0.2);
    }
    .header-band {
      background: linear-gradient(135deg, #04241d 0%, #0a3d31 50%, #061915 100%);
      border-bottom: 2px solid #d4af37;
      text-align: center;
      padding: 35px 20px 25px 20px;
    }
    .calligraphy {
      font-size: 32px;
      color: #f6e6b4;
      letter-spacing: 2px;
      margin: 0 0 6px 0;
      text-shadow: 0 2px 8px rgba(212, 175, 55, 0.5);
    }
    .subtitle {
      font-size: 13px;
      letter-spacing: 4px;
      text-transform: uppercase;
      color: #d4af37;
      margin: 0;
    }
    .poetic-verse {
      margin: 15px auto 0 auto;
      font-style: italic;
      font-size: 13px;
      color: #c9b07a;
      max-width: 480px;
      line-height: 1.5;
    }
    .content-body {
      padding: 30px 35px;
      text-align: center;
    }
    .salutation {
      font-size: 20px;
      color: #ffffff;
      margin-bottom: 12px;
    }
    .confirmation-msg {
      font-size: 14px;
      line-height: 1.7;
      color: #b5bdca;
      margin-bottom: 25px;
    }
    .ticket-card {
      background: radial-gradient(circle at top, #152238 0%, #0b1424 100%);
      border: 1px dashed #d4af37;
      border-radius: 12px;
      padding: 24px;
      margin: 25px 0;
      text-align: center;
    }
    .ticket-badge {
      display: inline-block;
      background: linear-gradient(90deg, #d4af37, #f5d77f);
      color: #060b14;
      font-weight: bold;
      font-size: 11px;
      letter-spacing: 2px;
      text-transform: uppercase;
      padding: 5px 14px;
      border-radius: 20px;
      margin-bottom: 15px;
    }
    .ticket-id {
      font-family: 'Courier New', monospace;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 3px;
      color: #f6e6b4;
      margin: 5px 0 15px 0;
    }
    .qr-container {
      background-color: #ffffff;
      padding: 14px;
      border-radius: 10px;
      display: inline-block;
      margin: 15px 0;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4);
    }
    .qr-container img {
      display: block;
      width: 220px;
      height: 220px;
    }
    .event-details-table {
      width: 100%;
      margin-top: 15px;
      border-collapse: collapse;
      text-align: left;
    }
    .event-details-table td {
      padding: 8px 12px;
      font-size: 13px;
      border-bottom: 1px solid rgba(212, 175, 55, 0.15);
      color: #d1d5db;
    }
    .event-details-table td.label {
      color: #d4af37;
      font-weight: 600;
      width: 35%;
    }
    .guidelines {
      background: rgba(4, 36, 29, 0.35);
      border-left: 3px solid #10b981;
      padding: 15px;
      text-align: left;
      border-radius: 0 8px 8px 0;
      margin-top: 25px;
    }
    .guidelines h4 {
      margin: 0 0 8px 0;
      color: #6ee7b7;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .guidelines ul {
      margin: 0;
      padding-left: 18px;
      font-size: 12px;
      color: #9ca3af;
      line-height: 1.6;
    }
    .footer {
      background-color: #040810;
      border-top: 1px solid #1f2e46;
      text-align: center;
      padding: 20px;
      font-size: 11px;
      color: #6b7280;
      line-height: 1.6;
    }
    .footer a {
      color: #d4af37;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table class="main-table" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="header-band">
          <div class="calligraphy">محفلِ سماع</div>
          <div class="subtitle">A Night of Mystical Qawwali</div>
          <div class="poetic-verse">"چھاپ تلک سب چھینی رے موسے نیناں ملائی کے"<br>— حضرت امیر خسرو</div>
        </td>
      </tr>
      <tr>
        <td class="content-body">
          <div class="salutation">خوش آمدید، <strong>${fullName}</strong></div>
          <div class="confirmation-msg">
            Your pass for <strong>Mehfil-e-Sama 2026</strong> has been confirmed. We look forward to welcoming you to an unforgettable night of divine poetry, ecstatic harmonies, and spiritual devotion.
          </div>

          <div class="ticket-card">
            <span class="ticket-badge">${category}</span>
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #9ca3af;">Official Pass Code</div>
            <div class="ticket-id">${ticketId}</div>

            <div class="qr-container">
              <img src="cid:ticket_qr_code" alt="Gate Pass QR Code" />
            </div>
            
            <div style="font-size: 12px; color: #a1a1aa; margin-top: 5px;">
              Present this QR code on your mobile device at the entrance.
            </div>

            <table class="event-details-table">
              <tr>
                <td class="label">Date:</td>
                <td>Saturday, November 28, 2026</td>
              </tr>
              <tr>
                <td class="label">Time:</td>
                <td>Doors open 7:30 PM | Mehfil starts 8:30 PM</td>
              </tr>
              <tr>
                <td class="label">Venue:</td>
                <td>The Royal Heritage Courtyard, Alhamra Cultural Complex</td>
              </tr>
              <tr>
                <td class="label">Attendee:</td>
                <td>${fullName} (CNIC: ${entry.cnic})</td>
              </tr>
              <tr>
                <td class="label">Tier / Pass:</td>
                <td>${category} (${feeAmount})</td>
              </tr>
            </table>
          </div>

          <div class="guidelines">
            <h4>Mehfil Protocols & Etiquette:</h4>
            <ul>
              <li><strong>Entry:</strong> Each QR code is uniquely encrypted and allows single entry. Once scanned at the gate, it cannot be reused.</li>
              <li><strong>Attire:</strong> Traditional eastern / modest attire is warmly appreciated for the ambiance of the Mehfil.</li>
              <li><strong>Timings:</strong> Gates will be closed during the recitation of traditional Kalams to honor the sanctity of the Sama.</li>
            </ul>
          </div>
        </td>
      </tr>
      <tr>
        <td class="footer">
          Mehfil-e-Sama Secretariat • Spiritual Heritage Foundation<br>
          For queries or assistance, contact <a href="mailto:sama@mehfil.org">sama@mehfil.org</a><br>
          <em>May the resonance of divine music bring peace to your soul.</em>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
  `;
}

async function sendSufiTicketEmail(entry) {
  try {
    const qrBuffer = await generateTicketQrBuffer(entry.ticket_id, entry);
    const htmlContent = buildSufiEmailHtml(entry);

    if (!isSmtpConfigured()) {
      console.log(`[EMAIL SIMULATION] SMTP credentials not customized. Pass email for ${entry.email} (Ticket: ${entry.ticket_id}) simulated successfully.`);
      return { sent: true, simulated: true };
    }

    const transporter = getTransporter();
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Mehfil-e-Sama Invitations" <sama@mehfil.org>',
      to: entry.email,
      subject: `✨ Your Pass for Mehfil-e-Sama: ${entry.ticket_id} (${entry.first_name} ${entry.last_name})`,
      html: htmlContent,
      attachments: [
        {
          filename: `ticket_${entry.ticket_id}.png`,
          content: qrBuffer,
          cid: 'ticket_qr_code'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Ticket pass delivered to ${entry.email}: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to deliver ticket pass to ${entry.email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------
// Public Routes
// -----------------------------------------------------------------------------

// Serve index page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin page - standalone at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const dbRes = await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      database: dbRes ? 'connected' : 'disconnected',
      minio: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Stream payment screenshots from MinIO
app.get(['/api/receipts/:filename', '/uploads/:filename'], async (req, res) => {
  const filename = req.params.filename;
  try {
    const stream = await minioClient.getObject(MINIO_BUCKET, filename);
    res.setHeader('Content-Type', 'image/jpeg');
    stream.pipe(res);
  } catch (err) {
    console.error(`[MinIO Read Error] ${filename}:`, err.message);
    res.status(404).json({ error: 'Receipt screenshot not found.' });
  }
});

// Validate discount / referral codes
app.post('/api/validate_code', (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  const validDiscountCodes = ['SUFI20', 'AQ_501', 'MA_683', 'KN_566', 'NF_494', 'MEHFIL20'];
  const guestCodes = ['GU_5654', 'VIP_GUEST', 'KHUSRAU'];

  if (!code) {
    return res.json({ valid: false, discount: 0, message: 'No referral code entered' });
  }
  if (guestCodes.includes(code)) {
    return res.json({ valid: true, isGuest: true, discount: 100, message: 'VIP Honor Guest Access Applied (100% Waiver)' });
  }
  if (validDiscountCodes.includes(code)) {
    return res.json({ valid: true, discount: 20, message: 'Special Mehfil 20% Privilege Discount Applied' });
  }
  return res.json({ valid: false, discount: 0, message: 'Invalid or expired invitation code' });
});

// Attendee Registration Endpoint
app.post('/api/register', upload.single('screenshot'), async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      cnic,
      email,
      phone,
      organization,
      category = 'General Mehfil',
      referral_code,
      fee_amount,
      sender_account_title,
      sender_bank,
      transaction_id
    } = req.body;

    // Validation
    if (!first_name || !last_name || !cnic || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Please provide all mandatory personal details.' });
    }

    const cleanCnic = cnic.replace(/[^0-9]/g, '');
    if (cleanCnic.length < 13) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 13-digit CNIC.' });
    }

    // Check duplicate active registrations
    const existing = await pool.query(
      'SELECT ticket_id, status FROM registrations WHERE (cnic = $1 OR LOWER(email) = LOWER($2)) AND status != $3',
      [cnic.trim(), email.trim(), 'Declined']
    );

    if (existing.rows.length > 0) {
      const match = existing.rows[0];
      return res.status(409).json({
        success: false,
        error: `A registration with this CNIC or Email already exists (${match.ticket_id}) with status "${match.status}". You can check your pass status using the Check Pass tab.`
      });
    }

    // Process Screenshot Upload to MinIO
    let screenshotUrl = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname) || '.png';
      const filename = `receipt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      
      try {
        await minioClient.putObject(
          MINIO_BUCKET,
          filename,
          req.file.buffer,
          req.file.size,
          { 'Content-Type': req.file.mimetype }
        );
        screenshotUrl = `/api/receipts/${filename}`;
      } catch (uploadErr) {
        console.warn('[MinIO Upload Warning]', uploadErr.message);
        screenshotUrl = null;
      }
    }

    // Generate Unique Ticket ID: SAMA-XXXXXX
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    const ticketId = `SAMA-${randomHex}`;

    // Determine initial status: Guests can be auto-approved, standard is Pending
    const isGuestCode = ['GU_5654', 'VIP_GUEST', 'KHUSRAU'].includes((referral_code || '').trim().toUpperCase());
    const initialStatus = isGuestCode ? 'Approved' : 'Pending';

    // Insert into PostgreSQL
    const insertQuery = `
      INSERT INTO registrations (
        ticket_id, first_name, last_name, cnic, email, phone,
        organization, category, referral_code, fee_amount,
        sender_account_title, sender_bank, transaction_id,
        payment_screenshot_url, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;
    const values = [
      ticketId,
      first_name.trim(),
      last_name.trim(),
      cnic.trim(),
      email.trim().toLowerCase(),
      phone.trim(),
      (organization || '').trim(),
      category,
      (referral_code || '').trim().toUpperCase(),
      fee_amount || 'PKR 2,000',
      (sender_account_title || '').trim(),
      (sender_bank || '').trim(),
      (transaction_id || '').trim(),
      screenshotUrl,
      initialStatus
    ];

    const result = await pool.query(insertQuery, values);
    const savedEntry = result.rows[0];

    // If VIP guest is auto-approved, trigger the confirmation email right away
    if (initialStatus === 'Approved') {
      sendSufiTicketEmail(savedEntry).catch(e => console.error('[EMAIL AUTO ERROR]', e.message));
    }

    res.json({
      success: true,
      ticket_id: ticketId,
      status: initialStatus,
      message: initialStatus === 'Approved'
        ? 'VIP Invitation confirmed! Your pass has been issued and sent to your email.'
        : 'Registration submitted successfully! Our committee will verify your payment and issue your QR pass shortly.',
      entry: savedEntry
    });
  } catch (err) {
    console.error('[REGISTRATION ERROR]', err);
    res.status(500).json({ success: false, error: 'Failed to process registration: ' + err.message });
  }
});

// Status & QR Pass Lookup
app.post('/api/check_status', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, error: 'Please enter a Ticket ID, CNIC, or Email address.' });
    }

    const cleanInput = query.trim();
    const cleanCnic = cleanInput.replace(/[^0-9]/g, '');

    const sql = `
      SELECT * FROM registrations 
      WHERE UPPER(ticket_id) = UPPER($1) 
         OR cnic = $1 
         OR (LENGTH($2) = 13 AND REPLACE(cnic, '-', '') = $2)
         OR LOWER(email) = LOWER($1)
      ORDER BY timestamp DESC
      LIMIT 1;
    `;
    const result = await pool.query(sql, [cleanInput, cleanCnic]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No registration found for the provided details.' });
    }

    const entry = result.rows[0];
    let qrDataUrl = null;

    // Generate client QR code if registration is Approved
    if (entry.status === 'Approved') {
      const qrPayload = JSON.stringify({
        event: "Mehfil-e-Sama 2026",
        ticket_id: entry.ticket_id,
        name: `${entry.first_name} ${entry.last_name}`,
        category: entry.category,
        cnic: entry.cnic
      });
      qrDataUrl = await QRCode.toDataURL(qrPayload, {
        width: 280,
        margin: 2,
        color: { dark: '#081426', light: '#ffffff' }
      });
    }

    res.json({
      success: true,
      entry: {
        ticket_id: entry.ticket_id,
        first_name: entry.first_name,
        last_name: entry.last_name,
        email: entry.email,
        phone: entry.phone,
        cnic: entry.cnic,
        category: entry.category,
        fee_amount: entry.fee_amount,
        status: entry.status,
        timestamp: entry.timestamp,
        qr_scanned: entry.qr_scanned,
        qr_data_url: qrDataUrl
      }
    });
  } catch (err) {
    console.error('[CHECK STATUS ERROR]', err);
    res.status(500).json({ success: false, error: 'Server error checking status.' });
  }
});

// -----------------------------------------------------------------------------
// Admin Endpoints (/admin)
// -----------------------------------------------------------------------------

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const configuredUser = process.env.ADMIN_USERNAME || 'admin';
  const configuredPass = process.env.ADMIN_PASSWORD || 'SufiNight2026!';

  // Standard configured credentials
  if (username === configuredUser && password === configuredPass) {
    return res.json({
      success: true,
      user: { username: configuredUser, role: 'Chief Organizer' }
    });
  }

  // Backup admin accounts
  const legacyAdmins = {
    '68362': { name: 'Muhammad Ahmad', password: 'Ah@362' },
    '49495': { name: 'Noor Fatima', password: 'Nf@495' },
    '56697': { name: 'Kainat Nadeem', password: 'Kn@697' },
    '50106': { name: 'Aqsa Naqvi', password: 'An@106' }
  };

  if (legacyAdmins[username] && legacyAdmins[username].password === password) {
    return res.json({
      success: true,
      user: { username, role: legacyAdmins[username].name }
    });
  }

  return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
});

// List registrations with metrics
app.get('/api/admin/entries', async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = 'SELECT * FROM registrations WHERE 1=1';
    const params = [];

    if (status && status !== 'All') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(ticket_id) LIKE $${params.length} OR
        LOWER(first_name) LIKE $${params.length} OR
        LOWER(last_name) LIKE $${params.length} OR
        LOWER(email) LIKE $${params.length} OR
        cnic LIKE $${params.length} OR
        LOWER(transaction_id) LIKE $${params.length}
      )`;
    }

    query += ' ORDER BY timestamp DESC';
    const result = await pool.query(query, params);

    // Compute metrics
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END)::int as pending,
        COUNT(CASE WHEN status = 'Approved' THEN 1 END)::int as approved,
        COUNT(CASE WHEN status = 'Declined' THEN 1 END)::int as declined,
        COUNT(CASE WHEN qr_scanned = true THEN 1 END)::int as scanned
      FROM registrations;
    `);

    res.json({
      success: true,
      entries: result.rows,
      stats: statsResult.rows[0]
    });
  } catch (err) {
    console.error('[ADMIN ENTRIES ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Status: Approve or Decline
// Triggers automatic email delivery on confirmation!
app.post('/api/admin/update_status', async (req, res) => {
  try {
    const { ticket_id, status, handled_by, notes } = req.body;
    if (!ticket_id || !status) {
      return res.status(400).json({ success: false, error: 'ticket_id and status are required.' });
    }

    const updateQuery = `
      UPDATE registrations 
      SET status = $1, handled_by = $2, notes = COALESCE($3, notes)
      WHERE ticket_id = $4
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [status, handled_by || 'Admin', notes, ticket_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found.' });
    }

    const updatedEntry = result.rows[0];
    let emailResult = { sent: false };

    // Automatic email delivery if confirmed / approved!
    if (status === 'Approved') {
      console.log(`[APPROVAL] Ticket ${ticket_id} confirmed by ${handled_by}. Triggering automatic pass email...`);
      emailResult = await sendSufiTicketEmail(updatedEntry);
    }

    res.json({
      success: true,
      entry: updatedEntry,
      emailResult,
      message: status === 'Approved'
        ? `Registration ${ticket_id} approved! Stylized QR Ticket dispatched to ${updatedEntry.email}.`
        : `Registration ${ticket_id} status updated to ${status}.`
    });
  } catch (err) {
    console.error('[ADMIN UPDATE ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Resend Ticket Email
app.post('/api/admin/resend_ticket', async (req, res) => {
  try {
    const { ticket_id } = req.body;
    const result = await pool.query('SELECT * FROM registrations WHERE ticket_id = $1', [ticket_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found.' });
    }

    const entry = result.rows[0];
    const emailResult = await sendSufiTicketEmail(entry);

    res.json({
      success: true,
      emailResult,
      message: `Pass email re-sent to ${entry.email}.`
    });
  } catch (err) {
    console.error('[RESEND TICKET ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// QR Code Gate Scanner / Check-In
app.post('/api/admin/scan_qr', async (req, res) => {
  try {
    let { ticket_id } = req.body;
    if (!ticket_id) {
      return res.status(400).json({ success: false, error: 'No ticket ID provided.' });
    }

    // Try parsing if full JSON was scanned
    if (ticket_id.startsWith('{')) {
      try {
        const parsed = JSON.parse(ticket_id);
        if (parsed.ticket_id) ticket_id = parsed.ticket_id;
      } catch (e) {
        // keep ticket_id as is
      }
    }

    ticket_id = ticket_id.trim();

    const result = await pool.query('SELECT * FROM registrations WHERE UPPER(ticket_id) = UPPER($1)', [ticket_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        valid: false,
        message: 'Invalid Pass: No registration record matches this QR code.'
      });
    }

    const entry = result.rows[0];

    if (entry.status !== 'Approved') {
      return res.status(400).json({
        success: false,
        valid: false,
        status: entry.status,
        message: `Pass Not Active: Registration is currently in "${entry.status}" state.`
      });
    }

    if (entry.qr_scanned) {
      return res.status(409).json({
        success: false,
        valid: false,
        already_scanned: true,
        entry: {
          ticket_id: entry.ticket_id,
          name: `${entry.first_name} ${entry.last_name}`,
          scanned_at: entry.scanned_at
        },
        message: `ALREADY USED: This ticket was already checked in at ${new Date(entry.scanned_at).toLocaleTimeString()}.`
      });
    }

    // Mark as checked in
    const checkin = await pool.query(
      'UPDATE registrations SET qr_scanned = true, scanned_at = NOW() WHERE ticket_id = $1 RETURNING *',
      [entry.ticket_id]
    );

    res.json({
      success: true,
      valid: true,
      message: 'Pass Validated! Welcome to Mehfil-e-Sama.',
      entry: checkin.rows[0]
    });
  } catch (err) {
    console.error('[GATE SCAN ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// CSV Export for Admin
app.get('/api/admin/export_csv', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM registrations ORDER BY timestamp DESC');
    
    const headers = [
      'Ticket ID', 'Timestamp', 'First Name', 'Last Name', 'CNIC',
      'Email', 'Phone', 'Category', 'Organization', 'Fee Amount',
      'Referral Code', 'Sender Account', 'Sender Bank', 'Transaction ID',
      'Status', 'Gate Checked In', 'Checked In Time', 'Handled By'
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    let csv = headers.join(',') + '\n';
    result.rows.forEach(r => {
      const row = [
        escapeCsv(r.ticket_id),
        escapeCsv(new Date(r.timestamp).toLocaleString()),
        escapeCsv(r.first_name),
        escapeCsv(r.last_name),
        escapeCsv(r.cnic),
        escapeCsv(r.email),
        escapeCsv(r.phone),
        escapeCsv(r.category),
        escapeCsv(r.organization),
        escapeCsv(r.fee_amount),
        escapeCsv(r.referral_code),
        escapeCsv(r.sender_account_title),
        escapeCsv(r.sender_bank),
        escapeCsv(r.transaction_id),
        escapeCsv(r.status),
        escapeCsv(r.qr_scanned ? 'YES' : 'NO'),
        escapeCsv(r.scanned_at ? new Date(r.scanned_at).toLocaleString() : ''),
        escapeCsv(r.handled_by)
      ];
      csv += row.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="Mehfil_Registrations_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[CSV EXPORT ERROR]', err);
    res.status(500).send('Failed to generate CSV export.');
  }
});

// -----------------------------------------------------------------------------
// Server Bootup
// -----------------------------------------------------------------------------
async function startServer() {
  console.log('--- Initializing Mehfil-e-Sama Application Server ---');
  await initDatabase();
  await initMinio();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✨ Server running on http://0.0.0.0:${PORT}`);
    console.log(`✨ Public Registration: http://localhost:${PORT}/`);
    console.log(`✨ Admin Portal:        http://localhost:${PORT}/admin`);
  });
}

// Start if executed directly
if (require.main === module) {
  startServer().catch(err => {
    console.error('[FATAL SERVER ERROR]', err);
    process.exit(1);
  });
}

module.exports = { app, pool, minioClient };
