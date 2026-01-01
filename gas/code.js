/**
 * 学習記録アプリ StudyRecorder 用 GAS (完全修正版)
 * スプレッドシートID: 1Zr2IDZiu4ixCh6NPExyVYLxXrSrabXm4L841MjbkAuM
 */

const SPREADSHEET_ID = '1Zr2IDZiu4ixCh6NPExyVYLxXrSrabXm4L841MjbkAuM';
const SHEET_NAME_RECORDS = '学習記録';
const SHEET_NAME_MASTER = '学習内容マスター';

/**
 * 初回セットアップまたはヘッダー修正用
 * GASエディタでこの関数を実行すると、1行目が最新の正しいラベルに更新されます
 */
function setup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME_RECORDS) || ss.getSheetByName('record');

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_RECORDS);
  }

  // A:日付, B:ユーザー名, C:開始時刻, D:終了時刻, E:学習時間, F:カテゴリ, G:内容, H:意気込み, I:コメント, J:FB
  const headers = ['日付', 'ユーザー名', '開始時刻', '終了時刻', '学習時間', 'カテゴリ', '内容', '意気込み', 'コメント', 'FB'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function doPost(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME_RECORDS) || ss.getSheetByName('record');

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_RECORDS);
    setup();
  }

  let data = {};

  // 1. JSONボディ解析
  try {
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }
  } catch (err) { }

  // 2. URLパラメータ解析 (no-cors 対策)
  const fields = ['date', 'userName', 'startTime', 'endTime', 'duration', 'content', 'enthusiasm', 'condition', 'comment', 'category'];
  fields.forEach(field => {
    if (!data[field] && e.parameter[field]) {
      data[field] = e.parameter[field];
    }
  });

  // バリデーション
  if (!data.userName && !data.content) {
    return ContentService.createTextOutput("Error: No data").setMimeType(ContentService.MimeType.TEXT);
  }

  // 3. データの書き込み (ご要望の順序に 100% 合わせます)
  // 順番を絶対に間違えないように一つずつ定義します
  const colA_date = data.date || '';
  const colB_userName = data.userName || '';
  const colC_startTime = data.startTime || '';
  const colD_endTime = data.endTime || '';
  const colE_duration = data.duration || '';
  const colF_category = data.category || '';
  const colG_content = data.content || '';
  const colH_enthusiasm = data.enthusiasm || ''; // ★意気込み
  const colI_comment = data.comment || '';       // ★コメント
  const colJ_fb = data.condition || '';         // ★FB (調子)

  sheet.appendRow([
    colA_date,      // A列
    colB_userName,  // B列
    colC_startTime, // C列
    colD_endTime,   // D列
    colE_duration,  // E列
    colF_category,  // F列
    colG_content,   // G列
    colH_enthusiasm,// H列
    colI_comment,   // I列
    colJ_fb         // J列
  ]);

  return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME_RECORDS) || ss.getSheetByName('record');

  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }

  const headers = values[0];
  const records = values.slice(1).map(row => {
    // ヘッダーに基づいたオブジェクト作成
    // A:日付, B:ユーザー名, C:開始時刻, D:終了時刻, E:学習時間, F:カテゴリ, G:内容, H:意気込み, I:コメント, J:FB
    return {
      date: row[0],
      userName: row[1],
      startTime: row[2],
      endTime: row[3],
      duration: row[4],
      category: row[5],
      content: row[6],
      enthusiasm: row[7],
      comment: row[8],
      condition: row[9] // FB/Condition
    };
  });

  return ContentService.createTextOutput(JSON.stringify(records))
    .setMimeType(ContentService.MimeType.JSON);
}
