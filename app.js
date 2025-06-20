require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const basicAuth = require('basic-auth');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Admin credentials
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
const SHEET_ID = process.env.SHEET_ID;

const protectAdmin = (req, res, next) => {
  const user = basicAuth(req);
  if (user && user.name === ADMIN_USER && user.pass === ADMIN_PASS) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(401).send('🔒 Unauthorized');
};

app.use('/admin.html', protectAdmin);
app.use('/api', protectAdmin);

// File paths
const usagePath = path.join(__dirname, 'data', 'usage.json');
const responsesPath = path.join(__dirname, 'data', 'responses.json');
const credentialsPath = path.join(__dirname, 'config', 'credentials.json');

// Read/Write JSON
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

// Append to Google Sheet
async function appendToSheet(response) {
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const values = [[
    response.name,
    response.phone,
    response.department,
    response.line,
    response.point,
    response.time,
    new Date().toISOString()
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Responses!A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values }
  });
}

// ==================== API Routes ====================

// GET usage
app.get('/api/usage', (req, res) => {
  try {
    const usage = readJSON(usagePath);
    res.json(usage);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load usage' });
  }
});

// POST update line limits
app.post('/api/update-limits', (req, res) => {
  try {
    const { line, max } = req.body;
    const usage = readJSON(usagePath);
    if (usage[line]) {
      usage[line].max = parseInt(max);
      writeJSON(usagePath, usage);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Line not found' });
  } catch {
    res.status(500).json({ error: 'Failed to update limit' });
  }
});

// POST reset line usage
app.post('/api/reset-usage', (req, res) => {
  try {
    const { line } = req.body;
    const usage = readJSON(usagePath);
    if (usage[line]) {
      usage[line].used = 0;
      writeJSON(usagePath, usage);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Line not found' });
  } catch {
    res.status(500).json({ error: 'Failed to reset usage' });
  }
});

// POST form submission
app.post('/submit', async (req, res) => {
  try {
    const { name, phone, department, line, point, time } = req.body;
    if (!name || !phone || !department || !line || !point || !time) {
      return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
    }

    // Validate Egyptian phone number
    const phoneRegex = /^01[0-2,5]{1}[0-9]{8}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف غير صالح. تأكد من إدخاله بشكل صحيح.' });
    }

    const usage = readJSON(usagePath);
    if (!usage[line]) {
      return res.status(400).json({ success: false, message: 'خط غير معروف' });
    }

    if (usage[line].used >= usage[line].max) {
      return res.status(400).json({ success: false, message: 'عذراً، لا توجد أماكن متبقية لهذا الخط.' });
    }

    // Save to JSON
    const responses = readJSON(responsesPath);
    const response = { name, phone, department, line, point, time, timestamp: new Date().toISOString() };
    responses.push(response);
    writeJSON(responsesPath, responses);

    // Save to Google Sheet
    await appendToSheet(response);

    // Update usage
    usage[line].used += 1;
    writeJSON(usagePath, usage);

    const remaining = usage[line].max - usage[line].used;
    res.json({ success: true, message: `تم الإرسال بنجاح. متبقي ${remaining} أماكن لهذا الخط.` });

  } catch (err) {
    console.error('❌ Submission error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء الإرسال. حاول مرة أخرى.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});