/**
 * 学習記録アプリ StudyRecorder 用 GAS (CRUD & マルチユーザー対応最終版)
 */

const SPREADSHEET_ID = '1Zr2IDZiu4ixCh6NPExyVYLxXrSrabXm4L841MjbkAuM';

// ユーザー名に基づいてシートを取得（なければ作成）
function getSheetForUser(ss, userName) {
  let name = userName ? userName.trim() : 'デフォルト';
  // シート名の制限に対応
  let sheetName = "記録_" + name;
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // A:日付, B:ユーザー名, C:開始時刻, D:終了時刻, E:学習時間, F:カテゴリ, G:内容, H:意気込み, I:コメント, J:FB, K:ID
    const headers = ['日付', 'ユーザー名', '開始時刻', '終了時刻', '学習時間', 'カテゴリ', '内容', '意気込み', 'コメント', 'FB', 'ID'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(7, 150);
    sheet.setColumnWidth(11, 250);
  }

  // Migration: ID列(K列)がない場合の補完
  if (sheet.getLastColumn() < 11) {
    sheet.getRange(1, 11).setValue('ID');
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const ids = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
      const newIds = ids.map(row => [row[0] ? row[0] : Utilities.getUuid()]);
      sheet.getRange(2, 11, lastRow - 1, 1).setValues(newIds);
    }
  }

  return sheet;
}

function doPost(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let data = {};
  try {
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }
  } catch (err) { }

  const fields = ['id', 'action', 'userName', 'date', 'startTime', 'endTime', 'duration', 'content', 'enthusiasm', 'condition', 'comment', 'category'];
  fields.forEach(field => {
    if (e.parameter[field]) data[field] = e.parameter[field];
  });

  const userName = data.userName;
  const sheet = getSheetForUser(ss, userName);
  const action = data.action || 'create';

  if (action === 'delete') {
    const rowIdx = findRowIndexById(sheet, data.id);
    if (rowIdx !== -1) {
      sheet.deleteRow(rowIdx);
      return successResponse({ status: 'deleted' });
    }
    return errorResponse("Record not found");
  }

  if (action === 'update') {
    const rowIdx = findRowIndexById(sheet, data.id);
    if (rowIdx !== -1) {
      if (data.date) sheet.getRange(rowIdx, 1).setValue(data.date);
      if (data.duration) sheet.getRange(rowIdx, 5).setValue(data.duration);
      if (data.category) sheet.getRange(rowIdx, 6).setValue(data.category);
      if (data.content) sheet.getRange(rowIdx, 7).setValue(data.content);
      if (data.comment) sheet.getRange(rowIdx, 9).setValue(data.comment);
      if (data.condition) sheet.getRange(rowIdx, 10).setValue(data.condition);
      return successResponse({ status: 'updated' });
    }
    return errorResponse("Record not found");
  }

  const newId = Utilities.getUuid();
  sheet.appendRow([
    data.date || '',
    data.userName || '',
    data.startTime || '',
    data.endTime || '',
    data.duration || '',
    data.category || '',
    data.content || '',
    data.enthusiasm || '',
    data.comment || '',
    data.condition || '',
    newId
  ]);
  return successResponse({ status: 'created', id: newId });
}

function doGet(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const userName = e.parameter.userName;
  const sheet = getSheetForUser(ss, userName);

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return successResponse([]);

  const records = values.slice(1).map(row => {
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
      condition: row[9],
      id: row[10]
    };
  });
  return successResponse(records);
}

function findRowIndexById(sheet, id) {
  if (!id) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  const ids = sheet.getRange(2, 11, lastRow - 1, 1).getValues().flat();
  const idx = ids.indexOf(id);
  return idx !== -1 ? idx + 2 : -1;
}

function successResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(msg) {
  return ContentService.createTextOutput(JSON.stringify({ error: msg })).setMimeType(ContentService.MimeType.JSON);
}
