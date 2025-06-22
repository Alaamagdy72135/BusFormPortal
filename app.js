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
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'life-makers-secret',
  resave: false,
  saveUninitialized: true
}));

app.use(express.static('public'));

function protectAdmin(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login.html');
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

// === Login Routes ===
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.authenticated = true;
    return res.redirect('/admin.html');
  } else {
    return res.send('اسم المستخدم أو كلمة المرور غير صحيحة');
  }
});

// === Protect Admin Pages ===
app.use('/admin.html', protectAdmin);
app.use('/api/update-limits', protectAdmin);
app.use('/api/reset-usage', protectAdmin);

// === GET: Usage Info ===
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

// === GET: Job Codes ===
app.get('/api/jobcodes', async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'JobCodes!A2:B'
    });

    const rows = result.data.values || [];
    const codes = {};
    rows.forEach(([code, name]) => {
      if (code && name) codes[code.trim()] = name.trim();
    });

    res.json(codes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch job codes' });
  }
});

// === POST: Update Line Limit ===
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
    res.status(500).json({ error: 'Failed to update limits' });
  }
});

// === POST: Reset Line Usage ===
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
    res.status(500).json({ error: 'Failed to reset usage' });
  }
});

// === POST: Submit Form ===
app.post('/submit', async (req, res) => {
  const { jobCode, name, phone, department, line, point, time } = req.body;

  if (!jobCode || !name || !phone || !department || !line || !point || !time) {
    return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  }

  const phoneRegex = /^(\+201|01|00201)[0-2,5]{1}[0-9]{8}$/g;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({ success: false, message: 'رقم الهاتف غير صالح. تأكد من إدخاله بشكل صحيح.' });
  }

  try {
    const sheets = await getSheetsClient();

    // Validate Job Code
    const codeResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'JobCodes!A2:B'
    });

    const jobCodeRows = codeResult.data.values || [];
    const matched = jobCodeRows.find(([code, userName]) =>
      code.trim() === jobCode.trim() && userName.trim() === name.trim()
    );

    if (!matched) {
      return res.status(400).json({ success: false, message: 'الكود الوظيفي غير صحيح أو لا يطابق الاسم.' });
    }

    // Check usage
    const usageResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Usage!A2:C'
    });

    const rows = usageResult.data.values || [];
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

    // Append to Responses
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Responses!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[jobCode, name, phone, department, line, point, time, new Date().toISOString()]]
      }
    });

    // Increment usage
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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
