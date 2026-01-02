/**
 * 学習記録アプリ StudyRecorder 用 GAS (CRUD & マルチユーザー & マスタデータ同期対応)
 */

const SPREADSHEET_ID = '1Zr2IDZiu4ixCh6NPExyVYLxXrSrabXm4L841MjbkAuM';
const SHEET_NAME_BASE = 'base'; // マスタデータのシート名

// ユーザー名に基づいてシートを取得（なければ作成）
function getSheetForUser(ss, userName) {
  let name = userName ? userName.trim() : 'デフォルト';
  let sheetName = "rec" + name;
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = ['日付', 'ユーザー名', '開始時刻', '終了時刻', '学習時間', 'カテゴリ', '内容', '意気込み', 'コメント', '意欲', 'ID'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(7, 150);
    sheet.setColumnWidth(11, 250);
  }

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

  if (action === 'update' || action === 'create') {
    // baseシートへの同期（マスタデータの自動蓄積）
    syncToBaseSheet(ss, data);

    if (action === 'update') {
      const rowIdx = findRowIndexById(sheet, data.id);
      if (rowIdx !== -1) {
        if (data.date !== undefined) sheet.getRange(rowIdx, 1).setValue(data.date);
        if (data.startTime !== undefined) sheet.getRange(rowIdx, 3).setValue(data.startTime);
        if (data.endTime !== undefined) sheet.getRange(rowIdx, 4).setValue(data.endTime);
        if (data.duration !== undefined) sheet.getRange(rowIdx, 5).setValue(Number(data.duration));
        if (data.category !== undefined) sheet.getRange(rowIdx, 6).setValue(data.category);
        if (data.content !== undefined) sheet.getRange(rowIdx, 7).setValue(data.content);
        if (data.enthusiasm !== undefined) sheet.getRange(rowIdx, 8).setValue(data.enthusiasm);
        if (data.comment !== undefined) sheet.getRange(rowIdx, 9).setValue(data.comment);
        if (data.condition !== undefined) sheet.getRange(rowIdx, 10).setValue(data.condition);
        return successResponse({ status: 'updated' });
      }
      return errorResponse("Record not found");
    } else {
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
  }

  return errorResponse('Invalid action');
}

/**
 * baseシートに新しいマスタデータを同期する
 */
function syncToBaseSheet(ss, data) {
  let baseSheet = ss.getSheetByName(SHEET_NAME_BASE);
  if (!baseSheet) {
    baseSheet = ss.insertSheet(SHEET_NAME_BASE);
    baseSheet.appendRow(['カテゴリ', '内容', '意気込み', 'コメント', '応援メッセージ', '終了メッセージ']);
    // 初期の応援メッセージを登録
    const defaultSupport = [
      "素晴らしい集中力です！",
      "一歩ずつ、着実に進んでいますね。",
      "休憩も大切ですよ。無理せず頑張りましょう。",
      "その調子です！未来の自分が感謝します。",
      "今はきつくても、必ず力になります。"
    ];
    const defaultFinish = [
      "お疲れ様でした！",
      "今日も一歩前進ですね。",
      "しっかり頑張りましたね！(長時間)",
      "素晴らしい継続力です！(長時間)"
    ];
    defaultSupport.forEach((m, i) => baseSheet.getRange(i + 2, 5).setValue(m));
    defaultFinish.forEach((m, i) => baseSheet.getRange(i + 2, 6).setValue(m));
  }

  // 同期対象のフィールドと列番号のマッピング
  const syncFields = [
    { value: data.category, col: 1 },
    { value: data.content, col: 2 },
    { value: data.enthusiasm, col: 3 },
    { value: data.comment, col: 4 }
  ];

  syncFields.forEach(field => {
    if (field.value && field.value.trim() !== '') {
      const val = field.value.trim();
      const columnData = baseSheet.getRange(1, field.col, baseSheet.getLastRow(), 1).getValues().flat();

      // まだ登録されていなければ追記
      if (columnData.indexOf(val) === -1) {
        const lastRowInCol = getFirstEmptyRowInColumn(baseSheet, field.col);
        baseSheet.getRange(lastRowInCol, field.col).setValue(val);
      }
    }
  });
}

/**
 * 指定した列の最初の空行を取得
 */
function getFirstEmptyRowInColumn(sheet, column) {
  const values = sheet.getRange(1, column, sheet.getLastRow(), 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === "") return i + 1;
  }
  return values.length + 1;
}

function doGet(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const userName = e.parameter.userName;
  const sheet = getSheetForUser(ss, userName);

  const values = sheet.getDataRange().getValues();
  const records = values.length <= 1 ? [] : values.slice(1).map(row => {
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

  const baseData = getBaseData(ss);

  return successResponse({
    records: records,
    masterData: baseData
  });
}

function getBaseData(ss) {
  const sheet = ss.getSheetByName(SHEET_NAME_BASE);
  if (!sheet) return { categories: [], contents: [], enthusiasms: [], comments: [], supportMessages: [], finishMessages: [] };

  const data = sheet.getDataRange().getValues();
  const categories = [];
  const contents = [];
  const enthusiasms = [];
  const comments = [];
  const supportMessages = [];
  const finishMessages = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) categories.push(data[i][0]);
    if (data[i][1]) contents.push(data[i][1]);
    if (data[i][2]) enthusiasms.push(data[i][2]);
    if (data[i][3]) comments.push(data[i][3]);
    if (data[i][4]) supportMessages.push(data[i][4]);
    if (data[i][5]) finishMessages.push(data[i][5]);
  }

  return {
    categories: [...new Set(categories)],
    contents: [...new Set(contents)],
    enthusiasms: [...new Set(enthusiasms)],
    comments: [...new Set(comments)],
    supportMessages: [...new Set(supportMessages)],
    finishMessages: [...new Set(finishMessages)]
  };
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
