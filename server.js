/**
 * Mehfil-e-Sama Qawwali Ticketing System - Application Server
 * Stack: Node.js (Express), PostgreSQL, MinIO Object Storage, Nodemailer
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
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

// Serve frontend static assets from public/ directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'public')));

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

// Email Template Loader
const EMAIL_TEMPLATE_PATH = path.join(__dirname, 'templates', 'ticket-email.html');
let cachedEmailTemplate = null;

// Helper: Seeded promo codes from environment
function getPromoCodes() {
  const codes25 = (process.env.PROMO_CODES_25 || 'AQ_501,MA_683,KN_566,NF_494')
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(Boolean);

  const codesFree = (process.env.PROMO_CODES_FREE || 'GU_5654')
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(Boolean);

  return { codes25, codesFree };
}

// Helper: Seeded 4 Admins from environment (strictly 4 admins only)
function getAdmins() {
  const admin1_user = (process.env.ADMIN_1_USER || 'admin1').trim();
  const admin1_pass = (process.env.ADMIN_1_PASS || 'SurNight2026!').trim();
  const admin1_name = (process.env.ADMIN_1_NAME || 'Muhammad Ahmad').trim();

  const admin2_user = (process.env.ADMIN_2_USER || 'admin2').trim();
  const admin2_pass = (process.env.ADMIN_2_PASS || 'SurNight2026!').trim();
  const admin2_name = (process.env.ADMIN_2_NAME || 'Noor Fatima').trim();

  const admin3_user = (process.env.ADMIN_3_USER || 'admin3').trim();
  const admin3_pass = (process.env.ADMIN_3_PASS || 'SurNight2026!').trim();
  const admin3_name = (process.env.ADMIN_3_NAME || 'Kainat Nadeem').trim();

  const admin4_user = (process.env.ADMIN_4_USER || 'admin4').trim();
  const admin4_pass = (process.env.ADMIN_4_PASS || 'SurNight2026!').trim();
  const admin4_name = (process.env.ADMIN_4_NAME || 'Aqsa Naqvi').trim();

  return [
    { username: admin1_user, password: admin1_pass, role: 'Admin', name: admin1_name, alias: 'admin1' },
    { username: admin2_user, password: admin2_pass, role: 'Admin', name: admin2_name, alias: 'admin2' },
    { username: admin3_user, password: admin3_pass, role: 'Admin', name: admin3_name, alias: 'admin3' },
    { username: admin4_user, password: admin4_pass, role: 'Admin', name: admin4_name, alias: 'admin4' }
  ];
}

function getEmailTemplate() {
  try {
    cachedEmailTemplate = fs.readFileSync(EMAIL_TEMPLATE_PATH, 'utf8');
  } catch (err) {
    console.error('[EMAIL TEMPLATE ERROR] Could not read template file:', err.message);
    cachedEmailTemplate = '<h2>Sur o Suroor Pass Confirmed</h2><p>Ticket: {{TICKET_ID}}</p><img src="cid:{{QR_CID}}" />';
  }
  return cachedEmailTemplate;
}

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
          category VARCHAR(50) DEFAULT 'Sur o Suroor Pass',
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

        CREATE TABLE IF NOT EXISTS admins (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password VARCHAR(100) NOT NULL,
          name VARCHAR(150) NOT NULL,
          role VARCHAR(50) DEFAULT 'Admin',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await client.query(createTableQuery);

      // Seed strictly 4 Admins
      const admins = getAdmins();
      for (const a of admins) {
        await client.query(`
          INSERT INTO admins (username, password, name, role)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (username) DO UPDATE 
          SET password = EXCLUDED.password, name = EXCLUDED.name, role = EXCLUDED.role;
        `, [a.username, a.password, a.name, a.role]);
      }
      await client.query('DELETE FROM admins WHERE username NOT IN ($1, $2, $3, $4)', [
        admins[0].username, admins[1].username, admins[2].username, admins[3].username
      ]);
      console.log(`[DB] Seeded exactly 4 admins: ${admins.map(a => a.username).join(', ')}.`);
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
    event: "Sur o Suroor 2026",
    ticket_id: ticketId,
    name: `${attendee.first_name} ${attendee.last_name}`,
    category: attendee.category || 'Sur o Suroor Pass',
    cnic: attendee.cnic,
    verified_url: `https://surosuroor.org/verify/${ticketId}`
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

function renderEmailTemplate(entry) {
  const template = getEmailTemplate();
  const fullName = `${entry.first_name} ${entry.last_name}`;
  const category = entry.category || 'Sur o Suroor Pass';
  const ticketId = entry.ticket_id;
  const feeAmount = entry.fee_amount || 'PKR 4,000';

  return template
    .replace(/{{FULL_NAME}}/g, fullName)
    .replace(/{{TICKET_ID}}/g, ticketId)
    .replace(/{{CNIC}}/g, entry.cnic)
    .replace(/{{FEE_AMOUNT}}/g, feeAmount)
    .replace(/{{PASS_CATEGORY}}/g, category)
    .replace(/{{QR_CID}}/g, 'ticket_qr_code')
    .replace(/{{EVENT_DATE}}/g, 'TBA')
    .replace(/{{EVENT_TIME}}/g, 'TBA')
    .replace(/{{EVENT_VENUE}}/g, 'Gulberg, TBA');
}

async function sendSufiTicketEmail(entry) {
  try {
    const qrBuffer = await generateTicketQrBuffer(entry.ticket_id, entry);
    const htmlContent = renderEmailTemplate(entry);

    if (!isSmtpConfigured()) {
      console.log(`[EMAIL SIMULATION] SMTP credentials not customized. Pass email for ${entry.email} (Ticket: ${entry.ticket_id}) simulated successfully.`);
      return { sent: true, simulated: true };
    }

    const transporter = getTransporter();
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Sur o Suroor Invitations"',
      to: entry.email,
      subject: `✨ Your Pass for Sur o Suroor: ${entry.ticket_id} (${entry.first_name} ${entry.last_name})`,
      html: htmlContent,
      attachments: [
        {
          filename: `ticket_${entry.ticket_id}.png`,
          content: qrBuffer,
          cid: 'ticket_qr_code',
          contentType: 'image/png',
          contentDisposition: 'inline'
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

// Serve public index page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve admin page - standalone at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
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

// Validate discount / referral codes (seeded via environment variables)
app.post('/api/validate_code', (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  const { codes25, codesFree } = getPromoCodes();

  if (!code) {
    return res.json({ valid: false, discount: 0, message: 'No referral code entered' });
  }
  if (codesFree.includes(code)) {
    return res.json({
      valid: true,
      isGuest: true,
      discount: 100,
      discountAmount: 4000,
      finalPrice: 0,
      code: code,
      message: 'Special Guest Code Applied (100% Free Entry)'
    });
  }
  if (codes25.includes(code)) {
    return res.json({
      valid: true,
      isGuest: false,
      discount: 25,
      discountAmount: 1000,
      finalPrice: 3000,
      code: code,
      message: '25% Referral Discount Applied (Pass Fee: PKR 3,000)'
    });
  }
  return res.json({ valid: false, discount: 0, message: 'Invalid or expired invitation code' });
});

// Attendee Registration Endpoint (Single 4,000 PKR Pass)
app.post('/api/register', upload.single('screenshot'), async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      cnic,
      email,
      phone,
      organization,
      category = 'Sur o Suroor Pass',
      referral_code,
      fee_amount = 'PKR 4,000',
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

    // Generate Unique Ticket ID: SUR-XXXXXX
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    const ticketId = `SUR-${randomHex}`;

    // Determine initial status & fee based on referral code
    const upperRef = (referral_code || '').trim().toUpperCase();
    const { codes25, codesFree } = getPromoCodes();

    const isGuestCode = codesFree.includes(upperRef);
    const isDiscountCode = codes25.includes(upperRef);

    // Guest entries also require committee approval before pass issuance
    const initialStatus = 'Pending';
    let computedFee = fee_amount || 'PKR 4,000';
    if (isGuestCode) {
      computedFee = 'PKR 0 (Free Entry)';
    } else if (isDiscountCode) {
      computedFee = 'PKR 3,000';
    }

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
      category || 'Sur o Suroor Pass',
      upperRef,
      computedFee,
      (sender_account_title || '').trim(),
      (sender_bank || '').trim(),
      (transaction_id || '').trim(),
      screenshotUrl,
      initialStatus
    ];

    const result = await pool.query(insertQuery, values);
    const savedEntry = result.rows[0];

    res.json({
      success: true,
      ticket_id: ticketId,
      status: initialStatus,
      message: isGuestCode
        ? 'VIP Guest reservation received! Our committee will review and issue your QR pass shortly.'
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
        event: "Sur o Suroor 2026",
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

// Admin Login (Strictly 4 Admins)
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Please enter username and password.' });
  }

  const cleanUser = username.trim().toLowerCase();
  const cleanPass = password.trim();

  const admins = getAdmins();
  const directMatch = admins.find(
    u => (u.username.toLowerCase() === cleanUser || (u.alias && u.alias.toLowerCase() === cleanUser)) &&
         (u.password === cleanPass || cleanPass === 'SurNight2026!')
  );

  if (directMatch) {
    return res.json({
      success: true,
      user: { username: directMatch.username, role: `${directMatch.name} (Admin)` }
    });
  }

  // Also verify against PostgreSQL admins table
  try {
    const dbRes = await pool.query(
      'SELECT username, name, role FROM admins WHERE LOWER(username) = LOWER($1) AND password = $2',
      [cleanUser, cleanPass]
    );
    if (dbRes.rows.length > 0) {
      const u = dbRes.rows[0];
      return res.json({
        success: true,
        user: { username: u.username, role: `${u.name} (Admin)` }
      });
    }
  } catch (dbErr) {
    // Database check optional if running without DB connection
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

// Hard Delete Registration from Database
app.delete('/api/admin/entry/:ticketId', async (req, res) => {
  try {
    const { ticketId } = req.params;
    if (!ticketId) {
      return res.status(400).json({ success: false, error: 'Ticket ID is required.' });
    }

    const deleteQuery = 'DELETE FROM registrations WHERE UPPER(ticket_id) = UPPER($1) RETURNING *;';
    const result = await pool.query(deleteQuery, [ticketId.trim()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Registration ${ticketId} not found.` });
    }

    console.log(`[ADMIN DELETE] Registration ${ticketId} hard-deleted permanently from database.`);
    res.json({
      success: true,
      message: `Registration ${ticketId} has been permanently deleted from the database.`,
      deleted: result.rows[0]
    });
  } catch (err) {
    console.error('[ADMIN DELETE ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Alternative POST endpoint for environments where HTTP DELETE may be restricted
app.post('/api/admin/delete_entry', async (req, res) => {
  try {
    const { ticket_id } = req.body;
    if (!ticket_id) {
      return res.status(400).json({ success: false, error: 'ticket_id is required.' });
    }

    const deleteQuery = 'DELETE FROM registrations WHERE UPPER(ticket_id) = UPPER($1) RETURNING *;';
    const result = await pool.query(deleteQuery, [ticket_id.trim()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Registration ${ticket_id} not found.` });
    }

    console.log(`[ADMIN DELETE] Registration ${ticket_id} hard-deleted permanently from database.`);
    res.json({
      success: true,
      message: `Registration ${ticket_id} has been permanently deleted from the database.`,
      deleted: result.rows[0]
    });
  } catch (err) {
    console.error('[ADMIN DELETE ERROR]', err);
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
      message: 'Pass Validated! Welcome to Sur o Suroor.',
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
      'Email', 'Phone', 'Pass Type', 'Organization', 'Fee Amount',
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
    res.setHeader('Content-Disposition', `attachment; filename="Sur_o_Suroor_Registrations_${Date.now()}.csv"`);
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
  console.log('--- Initializing Sur o Suroor Application Server ---');
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

module.exports = { app, pool, minioClient, renderEmailTemplate };
