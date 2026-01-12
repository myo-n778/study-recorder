/**
 * 学習記録アプリ StudyRecorder 用 GAS (CRUD & マルチユーザー & マスタデータ同期対応)
 */

const STUDY_REC_SS_ID = '1Zr2IDZiu4ixCh6NPExyVYLxXrSrabXm4L841MjbkAuM';
const STUDY_REC_SHEET_NAME_BASE = 'base'; // 応援メッセージ・マスタデータの格納先

/**
 * ユーザー別シートの取得・初期化
 * シート名: "rec" + userName (例: "rec山田")
 */
function getSheetForUser(ss, userName) {
  let name = userName ? userName.trim() : 'デフォルト';
  let sheetName = "rec" + name;
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  // 常に最新のヘッダー構成を維持（全カラムチェック）
  const headers = ['日付', 'ユーザー名', '開始時刻', '終了時刻', '学習時間', 'カテゴリ', '内容', '意気込み', 'コメント', '意欲', '場所', 'ID', 'visibility', 'timeline_visibility', 'status'];
  const currentHeadersCount = sheet.getLastColumn();

  if (currentHeadersCount < headers.length) {
    // 既存のカラムが少ない場合は不足分を補完
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(7, 150);
    sheet.setColumnWidth(11, 150);
    sheet.setColumnWidth(12, 250);
  } else {
    // 既存のカラムが多い場合も、ヘッダーが正しいか簡易チェックして必要なら上書き
    const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < headers.length; i++) {
      if (existingHeaders[i] !== headers[i]) {
        needsUpdate = true;
        break;
      }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  return sheet;
}

/**
 * ユーザーの公開設定を取得 (baseシートから)
 */
function getUserVisibility(ss, userName) {
  const baseSheet = ss.getSheetByName(STUDY_REC_SHEET_NAME_BASE);
  if (!baseSheet) return 'private';

  const lastRow = baseSheet.getLastRow();
  if (lastRow < 2) return 'private';

  const headers = baseSheet.getRange(1, 1, 1, baseSheet.getLastColumn()).getValues()[0];
  const userColIdx = headers.indexOf('ユーザー名(設定)');
  const visibilityColIdx = headers.indexOf('ユーザー公開設定');

  if (userColIdx === -1 || visibilityColIdx === -1) return 'private';

  const data = baseSheet.getRange(2, 1, lastRow - 1, baseSheet.getLastColumn()).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][userColIdx] === userName) {
      return data[i][visibilityColIdx] || 'private';
    }
  }
  return 'private';
}

/**
 * ユーザーの公開設定を更新 (baseシートへ)
 */
function updateUserVisibility(ss, userName, visibility) {
  let baseSheet = ss.getSheetByName(STUDY_REC_SHEET_NAME_BASE);
  if (!baseSheet) {
    baseSheet = ss.insertSheet(STUDY_REC_SHEET_NAME_BASE);
  }

  const lastCol = baseSheet.getLastColumn();
  let headers = [];
  if (lastCol > 0) {
    headers = baseSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  let userColIdx = headers.indexOf('ユーザー名(設定)');
  let visibilityColIdx = headers.indexOf('ユーザー公開設定');

  // 列がない場合は追加
  if (userColIdx === -1) {
    userColIdx = lastCol;
    baseSheet.getRange(1, userColIdx + 1).setValue('ユーザー名(設定)');
    headers[userColIdx] = 'ユーザー名(設定)';
  }
  if (visibilityColIdx === -1) {
    visibilityColIdx = baseSheet.getLastColumn();
    baseSheet.getRange(1, visibilityColIdx + 1).setValue('ユーザー公開設定');
    headers[visibilityColIdx] = 'ユーザー公開設定';
  }

  const lastRow = baseSheet.getLastRow();
  let targetRow = -1;
  if (lastRow > 1) {
    const userData = baseSheet.getRange(2, userColIdx + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < userData.length; i++) {
      if (userData[i][0] === userName) {
        targetRow = i + 2;
        break;
      }
    }
  }

  if (targetRow === -1) {
    targetRow = lastRow + 1;
    baseSheet.getRange(targetRow, userColIdx + 1).setValue(userName);
  }

  baseSheet.getRange(targetRow, visibilityColIdx + 1).setValue(visibility === 'public' ? 'public' : 'private');
  return true;
}

function doPost(e) {
  const ss = SpreadsheetApp.openById(STUDY_REC_SS_ID);
  let data = {};

  // 1. JSONパースの試行
  try {
    if (e.postData && e.postData.contents && e.postData.type === "application/json") {
      data = JSON.parse(e.postData.contents);
    }
  } catch (err) { }

  // 2. URLSearchParams (application/x-www-form-urlencoded) の試行
  // e.parameter が期待通りでない場合の保険として自力でパース
  if (e.postData && e.postData.contents && e.postData.contents.indexOf('=') !== -1) {
    const contents = e.postData.contents;
    contents.split('&').forEach(pair => {
      const [key, val] = pair.split('=');
      if (key) data[decodeURIComponent(key)] = decodeURIComponent(val || '');
    });
  }

  // 3. e.parameter による最終補完
  const fields = ['id', 'action', 'userName', 'date', 'startTime', 'endTime', 'duration', 'content', 'enthusiasm', 'condition', 'comment', 'category', 'location', 'visibility', 'timeline_visibility', 'status'];
  fields.forEach(field => {
    if (e.parameter[field] !== undefined) {
      data[field] = e.parameter[field];
    }
  });

  const userName = data.userName;
  const action = data.action || 'create';

  try {
    const sheet = getSheetForUser(ss, userName);
    if (!sheet) throw new Error("Target sheet could not be initialized.");

    if (action === 'delete') {
      const rowIdx = findRowIndexById(sheet, data.id);
      if (rowIdx !== -1) {
        sheet.deleteRow(rowIdx);
        return successResponse({ status: 'deleted', id: data.id });
      }
      return errorResponse(`Record with ID ${data.id} not found for deletion.`);
    }

    if (action === 'update' || action === 'create') {
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
          if (data.location !== undefined) sheet.getRange(rowIdx, 11).setValue(data.location);
          if (data.visibility !== undefined) sheet.getRange(rowIdx, 13).setValue(data.visibility);
          if (data.timeline_visibility !== undefined) sheet.getRange(rowIdx, 14).setValue(data.timeline_visibility);
          return successResponse({ status: 'updated', id: data.id });
        }
        return errorResponse(`Record with ID ${data.id} not found for update.`);
      } else {
        const newId = Utilities.getUuid();
        const visibility = data.visibility || 'private';
        const timelineVisibility = data.timeline_visibility || 'private';
        const rowData = [
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
          data.location || '',
          newId,
          visibility,
          timelineVisibility,
          data.status || '' // 15列目 (O列) にステータスを保存
        ];
        sheet.appendRow(rowData);

        // マスタデータへの同期 (新規作成時のみ実行)
        syncToBaseSheet(ss, data);

        return successResponse({ status: 'created', id: newId });
      }
    }
    if (action === 'updateStatus') {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        // 最終記録行のO列 (15列目) にステータスを保存
        sheet.getRange(lastRow, 15).setValue(data.status || '');
        return successResponse({ status: 'status_updated', userName: userName });
      }
      // データがない場合は、2行目（データ開始行）の15列目に暫定保存
      sheet.getRange(2, 15).setValue(data.status || '');
      return successResponse({ status: 'status_updated_init', userName: userName });
    }

    if (action === 'updateUserVisibility') {
      updateUserVisibility(ss, userName, data.visibility);
      return successResponse({ status: 'visibility_updated', userName: userName, visibility: data.visibility });
    }

    if (action === 'getPublicUsers') {
      return successResponse({ users: getPublicUsers(ss) });
    }
  } catch (e) {
    return errorResponse(`Server Error: ${e.message}`);
  }
  return errorResponse('Invalid action');
}

function syncToBaseSheet(ss, data) {
  let baseSheet = ss.getSheetByName(STUDY_REC_SHEET_NAME_BASE);
  if (!baseSheet) {
    baseSheet = ss.insertSheet(STUDY_REC_SHEET_NAME_BASE);
    baseSheet.appendRow(['カテゴリ', '内容', '意気込み', 'コメント', '場所', '応援メッセージ', '終了メッセージ', 'ステータス候補']);
    const defaultSupport = ["素晴らしい集中力です！", "一歩ずつ、着実に進んでいますね。", "休憩も大切ですよ。無理せず頑張りましょう。", "その調子です！未来の自分が感謝します。", "今はきつくても、必ず力になります。"];
    const defaultFinish = ["お疲れ様でした！", "今日も一歩前進ですね。"];
    defaultSupport.forEach((m, i) => baseSheet.getRange(i + 2, 6).setValue(m));
    defaultFinish.forEach((m, i) => baseSheet.getRange(i + 2, 7).setValue(m));
  } else if (baseSheet.getLastColumn() < 8) {
    // 列が足りない場合は追加
    baseSheet.getRange(1, 8).setValue('ステータス候補');
  }

  const syncFields = [
    { value: data.category, col: 1 },
    { value: data.content, col: 2 },
    { value: data.enthusiasm, col: 3 },
    { value: data.comment, col: 4 },
    { value: data.location, col: 5 }
  ];

  syncFields.forEach(field => {
    if (field.value && field.value.trim() !== '') {
      const val = field.value.trim();
      const columnData = baseSheet.getRange(1, field.col, baseSheet.getLastRow(), 1).getValues().flat();
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
  const ss = SpreadsheetApp.openById(STUDY_REC_SS_ID);
  const userName = e.parameter.userName;
  const action = e.parameter.action || 'get';

  // Public View データの取得
  if (action === 'getPublicData') {
    const userVisibility = getUserVisibility(ss, userName);
    if (userVisibility !== 'public') {
      // ユーザーが非公開(private)の場合は何も返さない
      return successResponse({
        records: [],
        userStatus: '',
        masterData: {},
        userVisibility: 'private',
        accessDenied: true
      });
    }
  }

  if (action === 'getPublicUsers') {
    return successResponse({ users: getPublicUsers(ss) });
  }

  const sheet = getSheetForUser(ss, userName);

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return successResponse({
      records: [],
      userStatus: '',
      masterData: getBaseData(ss),
      userVisibility: getUserVisibility(ss, userName)
    });
  }

  const userHeaders = values[0];
  const colMap = {};
  const expectedFields = ['日付', 'ユーザー名', '開始時刻', '終了時刻', '学習時間', 'カテゴリ', '内容', '意気込み', 'コメント', '意欲', '場所', 'ID', 'visibility', 'timeline_visibility', 'status'];
  expectedFields.forEach(f => {
    colMap[f] = userHeaders.indexOf(f);
  });

  const records = values.slice(1).map(row => {
    const formatDate = (val) => {
      if (val instanceof Date) {
        return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy/MM/dd');
      }
      return val;
    };

    const formatTime = (val) => {
      if (val instanceof Date) {
        return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
      }
      return val;
    };

    // ID列判定ロジックをより柔軟にする
    // IDが見つからない場合や異常な場合は、旧来の構成も考慮してフォールバック
    const getVal = (fieldName, fallbackCol = -1) => {
      const idx = colMap[fieldName];
      if (idx !== -1 && idx < row.length) return row[idx];
      if (fallbackCol !== -1 && fallbackCol < row.length) return row[fallbackCol];
      return '';
    };

    // location と ID の特殊抽出 (移行期間対応)
    let locationVal = getVal('場所');
    let idVal = getVal('ID');

    // IDが短すぎる場合は場所とIDが逆転しているか、古い構成である可能性を疑う
    if (idVal && idVal.toString().length < 10) {
      // もし ID 列に短い値があり、場所列が UUID のような長い値なら入れ替える
      if (locationVal && locationVal.toString().length > 10) {
        const tmp = idVal;
        idVal = locationVal;
        locationVal = tmp;
      }
    }

    return {
      date: formatDate(getVal('日付', 0)),
      userName: getVal('ユーザー名', 1),
      startTime: formatTime(getVal('開始時刻', 2)),
      endTime: formatTime(getVal('終了時刻', 3)),
      duration: getVal('学習時間', 4),
      category: getVal('カテゴリ', 5),
      content: getVal('内容', 6),
      enthusiasm: getVal('意気込み', 7),
      comment: getVal('コメント', 8),
      condition: getVal('意欲', 9),
      location: locationVal || '',
      id: idVal,
      visibility: getVal('visibility') || 'private',
      timeline_visibility: getVal('timeline_visibility') || 'private',
      status: getVal('status') || ''
    };
  });

  // 最新ステータスの取得
  const lastRow = sheet.getLastRow();
  let userStatus = '';
  if (lastRow > 0) {
    const statusIdx = colMap['status'];
    if (statusIdx !== -1) {
      userStatus = sheet.getRange(lastRow, statusIdx + 1).getValue() || '';
    } else {
      // フォールバック: O列(15)
      userStatus = sheet.getRange(lastRow, 15).getValue() || '';
    }
  }

  const baseData = getBaseData(ss);
  const userVisibility = getUserVisibility(ss, userName);

  return successResponse({
    records: records,
    userStatus: userStatus,
    masterData: baseData,
    userVisibility: userVisibility
  });
}

function getBaseData(ss) {
  const sheet = ss.getSheetByName(STUDY_REC_SHEET_NAME_BASE);
  if (!sheet) return { categories: [], contents: [], enthusiasms: [], comments: [], locations: [], supportMessages: [], finishMessages: [] };

  const data = sheet.getDataRange().getValues();
  const categories = [];
  const contents = [];
  const enthusiasms = [];
  const comments = [];
  const locations = [];
  const supportMessages = [];
  const finishMessages = [];
  const statusPresets = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim()) categories.push(data[i][0].toString().trim());
    if (data[i][1] && data[i][1].toString().trim()) contents.push(data[i][1].toString().trim());
    if (data[i][2] && data[i][2].toString().trim()) enthusiasms.push(data[i][2].toString().trim());
    if (data[i][3] && data[i][3].toString().trim()) comments.push(data[i][3].toString().trim());
    if (data[i][4] && data[i][4].toString().trim()) locations.push(data[i][4].toString().trim());
    if (data[i][5] && data[i][5].toString().trim()) supportMessages.push(data[i][5].toString().trim());
    if (data[i][6] && data[i][6].toString().trim()) finishMessages.push(data[i][6].toString().trim());
    if (data[i][7] && data[i][7].toString().trim()) statusPresets.push(data[i][7].toString().trim());
  }

  return {
    categories: [...new Set(categories)],
    contents: [...new Set(contents)],
    enthusiasms: [...new Set(enthusiasms)],
    comments: [...new Set(comments)],
    locations: [...new Set(locations)],
    supportMessages: [...new Set(supportMessages)],
    finishMessages: [...new Set(finishMessages)],
    statusPresets: [...new Set(statusPresets)]
  };
}

/**
 * 公開設定が public のユーザー一覧を取得
 * 最新活動（最後のレコードの日付・開始時刻）順にソートするための情報を含める
 */
function getPublicUsers(ss) {
  const baseSheet = ss.getSheetByName(STUDY_REC_SHEET_NAME_BASE);
  if (!baseSheet) return [];

  const baseHeaders = baseSheet.getRange(1, 1, 1, baseSheet.getLastColumn()).getValues()[0];
  const userColIdx = baseHeaders.indexOf('ユーザー名(設定)');
  const visibilityColIdx = baseHeaders.indexOf('ユーザー公開設定');

  if (userColIdx === -1 || visibilityColIdx === -1) return [];

  const baseData = baseSheet.getRange(2, 1, Math.max(1, baseSheet.getLastRow() - 1), baseSheet.getLastColumn()).getValues();
  const publicUserNames = [];

  for (let i = 0; i < baseData.length; i++) {
    const name = baseData[i][userColIdx];
    const visibility = baseData[i][visibilityColIdx];
    if (name && visibility === 'public') {
      publicUserNames.push(name);
    }
  }

  const results = [];
  const allSheets = ss.getSheets();

  publicUserNames.forEach(name => {
    const sheetName = "rec" + name;
    const userSheet = allSheets.find(s => s.getName() === sheetName);
    let lastActivityTime = 0;

    if (userSheet && userSheet.getLastRow() > 1) {
      const lastRow = userSheet.getLastRow();
      // ヘッダーから日付(A)と開始時刻(C)を取得 (1列目, 3列目)
      // より正確には colMap を使うべきだが、パフォーマンス重視で固定列(A, C)を参照
      const dateVal = userSheet.getRange(lastRow, 1).getValue();
      const timeVal = userSheet.getRange(lastRow, 3).getValue();

      try {
        let dateObj;
        if (dateVal instanceof Date) {
          dateObj = new Date(dateVal);
        } else {
          dateObj = new Date(dateVal.toString().replace(/-/g, '/'));
        }

        if (timeVal) {
          const tStr = timeVal instanceof Date ? Utilities.formatDate(timeVal, Session.getScriptTimeZone(), "HH:mm") : timeVal.toString();
          const [h, m] = tStr.split(':').map(Number);
          dateObj.setHours(h || 0, m || 0, 0, 0);
        }
        lastActivityTime = dateObj.getTime();
      } catch (e) {
        lastActivityTime = 0;
      }
    }

    results.push({
      userName: name,
      lastActivity: lastActivityTime
    });
  });

  // 最新活動順にソート
  results.sort((a, b) => b.lastActivity - a.lastActivity);

  return results;
}

function findRowIndexById(sheet, id) {
  if (!id) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  const values = sheet.getRange(2, 11, lastRow - 1, 2).getValues(); // K, L列を取得
  for (let i = 0; i < values.length; i++) {
    if (values[i][1] === id || values[i][0] === id) { // L列(新) または K列(旧) をチェック
      return i + 2;
    }
  }
  return -1;
}

function successResponse(data) {
  const response = { success: true, ...data };
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(msg) {
  return ContentService.createTextOutput(JSON.stringify({ error: msg })).setMimeType(ContentService.MimeType.JSON);
}
