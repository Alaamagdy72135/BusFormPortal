require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// === Middlewares ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
}));

// === Serve static pages ===
app.use(express.static(path.join(__dirname, 'public'), { index: ['index.html'] }));

// === Serve admin files ===
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});
app.get('/admin.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.html'));
});

// === Login + Logout ===
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.redirect('/admin.html');
  }
  res.send(`<script>alert("بيانات الدخول غير صحيحة"); window.location.href='/login.html';</script>`);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// === Auth middleware ===
function isAuthenticated(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.redirect('/login.html');
}

// === Secure API routes ===
app.use('/api', isAuthenticated);

// === Google Sheets Auth ===
const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

// === /submit ===
app.post('/submit', async (req, res) => {
  const { name, phone, department, line, point, time } = req.body;

  if (!name || !phone || !department || !line || !point || !time) {
    return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  }

  const phoneRegex = /^01[0-2,5]{1}[0-9]{8}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({ success: false, message: 'رقم الهاتف غير صالح. تأكد من إدخاله بشكل صحيح.' });
  }

  try {
    const sheets = await getSheetsClient();

    // Get usage data
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Usage!A2:C'
    });

    const rows = result.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === line);

    if (rowIndex === -1) {
      return res.status(400).json({ success: false, message: 'خط غير معروف' });
    }

    const [_, max, used] = rows[rowIndex];
    const maxInt = parseInt(max);
    const usedInt = parseInt(used);

    if (usedInt >= maxInt) {
      return res.status(400).json({ success: false, message: 'لا توجد أماكن متبقية لهذا الخط.' });
    }

    // Append to Responses sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Responses!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[name, phone, department, line, point, time, new Date().toISOString()]]
      }
    });

    // Update usage
    const rowNumber = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Usage!C${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[usedInt + 1]] }
    });

    const remaining = maxInt - usedInt - 1;
    res.json({ success: true, message: `تم الإرسال بنجاح. متبقي ${remaining} أماكن لهذا الخط.` });

  } catch (err) {
    console.error('❌ Submission error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء الإرسال. حاول مرة أخرى.' });
  }
});

// === /api/usage ===
app.get('/api/usage', async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Usage!A2:C'
    });

    const rows = result.data.values || [];
    const usage = {};
    rows.forEach(([line, max, used]) => {
      usage[line] = {
        max: parseInt(max),
        used: parseInt(used)
      };
    });

    res.json(usage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch usage data' });
  }
});

// === /api/update-limits ===
app.post('/api/update-limits', async (req, res) => {
  const { line, max } = req.body;
  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Usage!A2:C'
    });

    const rows = result.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === line);

    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Line not found' });
    }

    const rowNumber = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Usage!B${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[max]] }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update limits' });
  }
});

// === /api/reset-usage ===
app.post('/api/reset-usage', async (req, res) => {
  const { line } = req.body;
  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Usage!A2:C'
    });

    const rows = result.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === line);

    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Line not found' });
    }

    const rowNumber = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Usage!C${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[0]] }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset usage' });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
