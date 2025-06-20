const express = require("express");
const router = express.Router();
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const MAX_PER_LINE = {
  "خط 1 (اكتوبر - حدائق اكتوبر - حدائق الاهرام - الهرم - المعراج) من الساعة 7 الي الساعة 9": 3,
  "خط 2 ( السلام - قليوب - الدائري - المعراج) من الساعة 7 الي الساعة 9": 2,
  "خط 3 (المنيب - المعراج) من الساعة 8:30 الي الساعة 9": 1,
  "خط 4 (كورنيش المعادي - مترو الزهراء - المعراج) من الساعة 9:30 الي الساعة 10": 2,
  "خط 5 (مترو الزهراء - المعراج) من الساعة 8:30 الي الساعة 9": 2,
  "خط 6 (مترو الزهراء -  المعراج) من الساعة 9:30 الي الساعة 10": 2
};


async function getAuth() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    keyFile: './credentials.json' // your service account key
  });
  return await auth.getClient();
}

router.post("/", async (req, res) => {
  const { name, phone, department, line, point, time } = req.body;

  try {
    const auth = await getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Check submission count
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Responses!E2:E' // line column
    });

    const count = read.data.values?.filter(row => row[0] === line).length || 0;

    if (count >= (MAX_PER_LINE[line] || 1)) {
      return res.json({ success: false, message: "تم إغلاق التسجيل لهذا الخط." });
    }

    // Append submission
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Responses!A2',
      valueInputOption: "RAW",
      resource: {
        values: [[new Date().toISOString(), name, phone, department, line, point, time]]
      }
    });

    const remaining = MAX_PER_LINE[line] - currentCount - 1;
    res.json({
      success: true,
      message: `تم الإرسال بنجاح. متبقي ${remaining} أماكن لهذا الخط.`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في السيرفر" });
  }
});

module.exports = router;
