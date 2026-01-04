/**
 * StudyRecorder - Main Logic
 */

const STATE_KEY = 'study_recorder_state';
const USER_KEY = 'study_recorder_user';
const STATE_STUDY_KEY = 'study_recorder_active_session';

// 日付境界ヘルパー (午前4時基準)
function getLogicalDate(dateOrStr = new Date(), timeStr = null) {
    let d;
    if (typeof dateOrStr === 'string' && dateOrStr.length > 0) {
        // "YYYY/MM/DD" または "YYYY-MM-DD" を正規化
        const normalized = dateOrStr.replace(/-/g, '/');
        // 日付文字列のみの場合、昼の12:00として扱うことで
        // ブラウザによるUTC変換や0時判定のズレを防ぐ
        d = new Date(normalized + ' 12:00:00');
    } else if (dateOrStr instanceof Date) {
        d = new Date(dateOrStr);
    } else {
        d = new Date();
    }

    let h;
    if (timeStr && typeof timeStr === 'string') {
        h = parseInt(timeStr.split(':')[0]);
    } else {
        h = d.getHours();
    }

    // 4時より前なら前日の所属とする
    if (h < 4) {
        d.setDate(d.getDate() - 1);
    }

    const y = d.getFullYear();
    const m = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    return `${y}/${m}/${day}`;
}

// 所属日付を取得（表示日付は変えず、どの日に載せるかの判定用）
// 0:00〜3:59の記録のみ前日所属、それ以外は当日所属
function getBelongingDate(dateStr, timeStr) {
    if (!dateStr) return '';
    const normalized = String(dateStr).replace(/-/g, '/').split(/[ T]/)[0];
    const d = new Date(normalized + ' 12:00:00');
    if (isNaN(d.getTime())) return normalized;

    let h = 12; // デフォルト（時刻不明時は当日扱い）
    if (timeStr && typeof timeStr === 'string') {
        const parsed = parseInt(timeStr.split(':')[0]);
        if (!isNaN(parsed)) h = parsed;
    }

    // 0:00〜3:59の場合のみ前日所属
    if (h >= 0 && h < 4) {
        d.setDate(d.getDate() - 1);
    }

    const y = d.getFullYear();
    const m = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    return `${y}/${m}/${day}`;
}

// 4時跨ぎセッションを分割するヘルパー
// 0:00〜3:59開始で終了が4:00以降の場合、2つのレコードに分割して返す
function splitRecordAt4AMBoundary(record) {
    if (!record.startTime || !record.endTime) return [record];

    const [startH, startM] = record.startTime.split(':').map(Number);
    const [endH, endM] = record.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const boundary = 4 * 60; // 4:00 = 240分

    // 開始が0:00〜3:59かつ終了が4:00以降の場合のみ分割
    if (startMinutes < boundary && endMinutes >= boundary) {
        const beforeDuration = boundary - startMinutes;
        const afterDuration = endMinutes - boundary;

        // 前半（0:00〜4:00）- 前日所属
        const beforeRecord = {
            ...record,
            endTime: '04:00',
            duration: beforeDuration,
            _isSplit: true,
            _splitPart: 'before'
        };

        // 後半（4:00〜終了）- 当日所属
        const afterRecord = {
            ...record,
            startTime: '04:00',
            duration: afterDuration,
            _isSplit: true,
            _splitPart: 'after'
        };

        return [beforeRecord, afterRecord];
    }

    return [record];
}

// レコード配列を分割処理して返す
function getExpandedRecords(records) {
    return records.flatMap(r => splitRecordAt4AMBoundary(r));
}

let state = {
    isStudying: false,
    startTime: null,
    elapsedSeconds: 0,
    timerInterval: null,
    currentTab: 'record-tab',
    records: [],
    isPaused: false,
    pausedSeconds: 0,
    masterData: {
        "プログラミング": ["JavaScript", "Python", "React", "Node.js"],
        "言語学習": ["英語 - 単語", "英語 - リスニング", "中国語"],
        "資格・試験": ["基本情報", "TOEIC", "簿記"]
    },
    goals: {
        minHours: 2,
        targetHours: 5,
        displayUnit: 'h',
        theme: 'orange' // デフォルトをオレンジに設定
    },
    viewDate: null, // 初期化時にセット
    gasMasterData: {
        categories: [],
        contents: [],
        enthusiasms: [],
        comments: [],
        locations: []
    },
    accumulatedPausedMs: 0,
    lastPauseTime: null,
    messageInterval: 20000,
    supportMessageInterval: null,
    isInitializing: false // 起動中フラグ
};

// 初期化時に論理的な「今日」を設定
state.viewDate = getLogicalDate();

let charts = {
    category: null,
    timeline: null
};

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyZxaCwGCAIsWHutoWG3w0asMU6lOfPykktn36YzlnkC0x13EYUxA2l29JOflqapzRUEg/exec';

// DOM Elements
const elements = {
    overlay: document.getElementById('overlay'),
    userSetup: document.getElementById('user-setup'),
    userNameInput: document.getElementById('user-name-input'),
    saveUserBtn: document.getElementById('save-user-btn'),
    welcomeMessage: document.getElementById('welcome-message'),
    userDisplay: document.getElementById('user-display'),
    tabItems: document.querySelectorAll('.tab-item'),
    tabContents: document.querySelectorAll('.tab-content'),
    startTimeInput: document.getElementById('start-time'),
    endTimeInput: document.getElementById('end-time'),
    recordDateInput: document.getElementById('record-date'),
    minHoursInput: document.getElementById('min-hours-input'),
    targetHoursInput: document.getElementById('target-hours-input'),
    startStudyBtn: document.getElementById('start-study-btn'),
    studyMode: document.getElementById('study-mode'),
    timerElapsed: document.getElementById('timer-elapsed'),
    currentTimeDisplay: document.getElementById('current-time-display'),
    finishStudyBtn: document.getElementById('finish-study-btn'),
    confirmModal: document.getElementById('confirm-modal'),
    keepWorkingBtn: document.getElementById('keep-working-btn'),
    takeRestBtn: document.getElementById('take-rest-btn'),
    categoryInput: document.getElementById('category-input'),
    contentInput: document.getElementById('content-input'),
    categoryList: document.getElementById('category-list'),
    contentList: document.getElementById('content-list'),
    enthusiasmInput: document.getElementById('enthusiasm-input'),
    enthusiasmList: document.getElementById('enthusiasm-list'),
    manualRecordBtn: document.getElementById('manual-record-btn'),
    locationInput: document.getElementById('location-input'),
    locationList: document.getElementById('location-list'),
    conditionInput: document.getElementById('condition-input'),
    commentInput: document.getElementById('comment-input'),
    commentList: document.getElementById('comment-list'),
    periodBtns: document.querySelectorAll('.period-btn'),
    supportMessage: document.getElementById('support-message'),
    // New Header & Settings Elements
    settingsBtn: document.getElementById('header-settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    displayMinHours: document.getElementById('display-min-hours'),
    displayTargetHours: document.getElementById('display-target-hours'),
    // New Date Nav Elements
    prevDateBtn: document.getElementById('prev-date-btn'),
    nextDateBtn: document.getElementById('next-date-btn'),
    todayBtn: document.getElementById('today-btn'),
    currentViewDateDisplay: document.getElementById('current-view-date'),
    // Summary Location Elements
    summaryLocation: document.getElementById('summary-location'),
    summaryLocationHistoryBtn: document.getElementById('show-summary-location-history-btn'),
    summaryLocationHistoryPopup: document.getElementById('summary-location-history-popup'),
    // Manual Record Location Elements
    locationCandidatesBtn: document.getElementById('show-location-candidates-btn'),
    locationCandidatesPopup: document.getElementById('location-candidates-popup')
};

// 期間切り替えイベントの初期化
function setupPeriodSwitchers() {
    const switcherIds = ['balance-period-tabs', 'volume-period-tabs', 'detail-period-tabs'];
    switcherIds.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        const btns = container.querySelectorAll('.period-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // 同じグループのactiveを解除
                btns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                // チャート更新
                updateCharts();

                // 学習量推移グラフを右端（最新）までスクロールさせる
                if (id === 'volume-period-tabs') {
                    setTimeout(() => {
                        const scrollingElement = document.querySelector('.chart-scroll-wrapper');
                        if (scrollingElement) {
                            scrollingElement.scrollLeft = scrollingElement.scrollWidth;
                        }
                    }, 200);
                }
            });
        });
    });
}

// 応援メッセージ
const supportMessages = [
    "素晴らしい集中力です！",
    "一歩ずつ、着実に進んでいますね。",
    "休憩も大切ですよ。無理せず頑張りましょう。",
    "その調子です！未来の自分が感謝します。",
    "今はきつくても、必ず力になります。"
];

// 初期化
async function init() {
    state.isInitializing = true; // 重複読み込み防止フラグ
    state.viewDate = getLogicalDate(); // まずは論理日付をセット
    loadUser();
    setupEventListeners();
    setupPeriodSwitchers();
    setCurrentTimeInputs();
    updateViewDateUI();

    // デフォルト値の設定
    elements.enthusiasmInput.value = '集中して取り組む！';
    elements.commentInput.value = '次も頑張ろう！';

    setupMasterData();
    updateGoalDisplay();

    // GASからデータを読み込む (完了を待つ)
    await loadRecordsFromGAS();

    state.isInitializing = false;

    // 以前のセッションがあれば復元
    resumeStudySession();

    // 応援メッセージの初期インターバル設定
    const savedInterval = localStorage.getItem('study_recorder_message_interval');
    if (savedInterval) {
        state.messageInterval = Number(savedInterval) * 1000;
        const input = document.getElementById('message-interval-input');
        if (input) input.value = savedInterval;
    } else {
        // 設定がない場合はデフォルト20秒を適用
        state.messageInterval = 20000;
        const input = document.getElementById('message-interval-input');
        if (input) input.value = "20";
    }
}

function resumeStudySession() {
    const saved = localStorage.getItem(STATE_STUDY_KEY);
    if (saved) {
        const session = JSON.parse(saved);
        if (session.isStudying && session.startTime) {
            state.isStudying = true;
            state.isPaused = session.isPaused || false;
            state.startTime = new Date(session.startTime);
            state.accumulatedPausedMs = session.accumulatedPausedMs || 0;
            state.lastPauseTime = session.lastPauseTime ? new Date(session.lastPauseTime) : null;

            // ⑤ 記録モードの「カテゴリ」「学習内容」の復元（入力欄へのセット）
            elements.categoryInput.value = session.category || '';
            elements.contentInput.value = session.content || '';
            if (elements.locationInput) elements.locationInput.value = session.location || '';

            document.getElementById('study-current-category').textContent = session.category || '-';
            document.getElementById('study-current-content').textContent = session.content || '-';

            updateTimerDisplay();
            updateCurrentTimeDisplay();
            updateSupportMessage();

            if (!state.isPaused) {
                startTimerInterval();
                startSupportMessageInterval();
            } else {
                const pauseBtn = document.getElementById('pause-study-btn');
                if (pauseBtn) {
                    pauseBtn.textContent = '再開する';
                    pauseBtn.classList.add('pulse');
                }
            }

            // 修正: 学習中なら画面を自動表示する
            if (elements.studyMode) {
                elements.studyMode.classList.remove('hidden');
            }
        }
    }
}

function startTimerInterval() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
        const now = Date.now();
        let totalElapsedMs = now - state.startTime.getTime() - state.accumulatedPausedMs;
        state.elapsedSeconds = Math.max(0, Math.floor(totalElapsedMs / 1000));

        updateTimerDisplay();
        updateCurrentTimeDisplay();
        if (state.elapsedSeconds % 60 === 0) saveStudyState();
    }, 1000);
}

function updateSupportMessage() {
    const messages = (state.gasMasterData && state.gasMasterData.supportMessages && state.gasMasterData.supportMessages.length > 0)
        ? state.gasMasterData.supportMessages
        : supportMessages;

    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    const msgEl = document.getElementById('support-message');
    if (msgEl) {
        msgEl.style.opacity = '0';
        setTimeout(() => {
            msgEl.textContent = randomMsg;
            msgEl.style.opacity = '1';
        }, 500);
    }
}

// ユーザー情報のロード
function loadUser() {
    const userName = localStorage.getItem(USER_KEY);
    if (!userName) {
        elements.userSetup.classList.remove('hidden');
    } else {
        elements.userDisplay.textContent = `User: ${userName}`;
        hideOverlay();
    }
}

function hideOverlay() {
    elements.overlay.style.opacity = '0';
    setTimeout(() => elements.overlay.classList.add('hidden'), 500);
}

// 時刻・日付の初期値設定
function setCurrentTimeInputs() {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    elements.startTimeInput.value = timeStr;

    // 終了時刻は1時間後をデフォルトに
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    elements.endTimeInput.value = later.toTimeString().slice(0, 5);

    // 日付の初期値を今日に (YYYY-MM-DD形式)
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    elements.recordDateInput.value = `${yyyy}-${mm}-${dd}`;
}

// マスターデータのセットアップ (履歴 + GASのbaseシートから候補抽出)
function setupMasterData() {
    // 1. カテゴリー候補
    const catFreq = {};
    // GASからのデータを優先的に追加
    if (state.gasMasterData && state.gasMasterData.categories) {
        state.gasMasterData.categories.forEach(c => catFreq[c] = (catFreq[c] || 0) + 10); // 重み付け
    }
    Object.keys(state.masterData).forEach(c => catFreq[c] = (catFreq[c] || 0) + 1);
    state.records.forEach(r => catFreq[r.category] = (catFreq[r.category] || 0) + 1);
    const sortedCats = Object.keys(catFreq).sort((a, b) => catFreq[b] - catFreq[a]);
    elements.categoryList.innerHTML = '';
    sortedCats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        elements.categoryList.appendChild(opt);
    });

    // 全体の履歴 + GASデータから収集しておく
    const allContents = new Set(state.gasMasterData?.contents || []);
    const allIntents = new Set(state.gasMasterData?.enthusiasms || []);
    state.records.forEach(r => {
        if (r.content) allContents.add(r.content);
        if (r.intent) allIntents.add(r.intent);
    });
    Object.values(state.masterData).forEach(arr => arr.forEach(c => allContents.add(c)));

    // 2. 学習内容の候補更新
    const updateContentList = () => {
        const catVal = elements.categoryInput.value;
        const contFreq = {};
        if (catVal) {
            (state.masterData[catVal] || []).forEach(c => contFreq[c] = (contFreq[c] || 0) + 1);
            // GASからのデータ（そのカテゴリに合致するか不明だが、全体候補として出すか検討）
            state.records.filter(r => r.category === catVal).forEach(r => contFreq[r.content] = (contFreq[r.content] || 0) + 1);
            const sortedConts = Object.keys(contFreq).sort((a, b) => contFreq[b] - contFreq[a]);
            elements.contentList.innerHTML = '';
            sortedConts.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item;
                elements.contentList.appendChild(opt);
            });
            if (sortedConts.length === 0) fillList(elements.contentList, allContents);
        } else {
            fillList(elements.contentList, allContents);
        }
    };

    // 3. 意気込みの候補更新
    const updateEnthusiasmList = () => {
        const intFreq = {};
        // GASデータ
        if (state.gasMasterData?.enthusiasms) {
            state.gasMasterData.enthusiasms.forEach(i => intFreq[i] = (intFreq[i] || 0) + 5);
        }
        ['集中して取り組む！', 'まずは15分頑張る', '復習をメインに'].forEach(i => intFreq[i] = (intFreq[i] || 0) + 1);
        state.records.forEach(r => { if (r.enthusiasm) intFreq[r.enthusiasm] = (intFreq[r.enthusiasm] || 0) + 1; });
        const sortedIntents = Object.keys(intFreq).sort((a, b) => intFreq[b] - intFreq[a]);
        elements.enthusiasmList.innerHTML = '';
        sortedIntents.forEach(i => {
            const opt = document.createElement('option');
            opt.value = i;
            elements.enthusiasmList.appendChild(opt);
        });
    };

    const fillList = (listEl, set) => {
        listEl.innerHTML = '';
        Array.from(set).forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            listEl.appendChild(opt);
        });
    };

    // リスナー設定
    if (!elements.categoryInput.dataset.listeners) {
        const handleFocus = (el, updateFn) => {
            el.addEventListener('mousedown', () => {
                if (el.value) {
                    el.dataset.oldValue = el.value;
                    el.value = '';
                }
                updateFn();
            });
            el.addEventListener('blur', () => {
                if (!el.value && el.dataset.oldValue) {
                    el.value = el.dataset.oldValue;
                }
            });
        };

        elements.categoryInput.addEventListener('input', updateContentList);
        handleFocus(elements.categoryInput, () => { });
        handleFocus(elements.contentInput, updateContentList);
        handleFocus(elements.enthusiasmInput, updateEnthusiasmList);

        elements.commentInput.addEventListener('mousedown', () => {
            if (elements.commentInput.value) {
                elements.commentInput.dataset.oldValue = elements.commentInput.value;
                elements.commentInput.value = '';
            }
            updateConditionSuggestions();
            updateLocationSuggestions();
            // 初期状態の表示を更新
        });
        elements.commentInput.addEventListener('blur', () => {
            if (!elements.commentInput.value && elements.commentInput.dataset.oldValue) {
                elements.commentInput.value = elements.commentInput.dataset.oldValue;
            }
        });

        elements.categoryInput.dataset.listeners = "true";

        // 意気込み・コメントの便利機能（クリックで全選択）
        const selectAll = (e) => e.target.select();
        elements.enthusiasmInput.addEventListener('focus', selectAll);
        elements.commentInput.addEventListener('focus', selectAll);
        elements.enthusiasmInput.addEventListener('click', selectAll);
        elements.commentInput.addEventListener('click', selectAll);
        elements.commentInput.dataset.listeners = "true";

        // サマリーモーダルの履歴ボタン
        const historyBtn = document.getElementById('show-comment-history-btn');
        const historyPopup = document.getElementById('comment-history-popup');
        if (historyBtn && historyPopup) {
            historyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!historyPopup.classList.contains('hidden')) {
                    historyPopup.classList.add('hidden');
                    return;
                }

                const commentInput = document.getElementById('summary-comment');
                const commFreq = {};
                if (state.gasMasterData?.comments) {
                    state.gasMasterData.comments.forEach(c => commFreq[c] = (commFreq[c] || 0) + 5);
                }
                state.records.forEach(r => {
                    if (r.comment) commFreq[r.comment] = (commFreq[r.comment] || 0) + 1;
                });
                ['集中できた！', '復習が必要', '目標達成', '少し疲れた'].forEach(c => commFreq[c] = (commFreq[c] || 0) + 1);

                const sortedComms = Object.keys(commFreq).sort((a, b) => commFreq[b] - commFreq[a]);
                if (sortedComms.length === 0) return;

                historyPopup.innerHTML = '';
                sortedComms.forEach(text => {
                    const item = document.createElement('div');
                    item.className = 'history-item';
                    item.textContent = text;
                    item.addEventListener('click', () => {
                        commentInput.value = text;
                        historyPopup.classList.add('hidden');
                        commentInput.focus();
                    });
                    historyPopup.appendChild(item);
                });
                historyPopup.classList.remove('hidden');
            });

            document.addEventListener('click', (e) => {
                if (!historyBtn.contains(e.target) && !historyPopup.contains(e.target)) {
                    historyPopup.classList.add('hidden');
                }
            });
        }

        // 場所の履歴/候補ボタン (サマリーモーダル)
        const summaryLocBtn = document.getElementById('show-summary-location-history-btn');
        const summaryLocPopup = document.getElementById('summary-location-history-popup');
        if (summaryLocBtn && summaryLocPopup) {
            summaryLocBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!summaryLocPopup.classList.contains('hidden')) {
                    summaryLocPopup.classList.add('hidden');
                    return;
                }
                showLocationTypePopup(summaryLocPopup, document.getElementById('summary-location'));
            });
            document.addEventListener('click', (e) => {
                if (!summaryLocBtn.contains(e.target) && !summaryLocPopup.contains(e.target)) {
                    summaryLocPopup.classList.add('hidden');
                }
            });
        }

        // 場所の履歴/候補ボタン (手動記録フォーム)
        const manualLocBtn = document.getElementById('show-location-candidates-btn');
        const manualLocPopup = document.getElementById('location-candidates-popup');
        if (manualLocBtn && manualLocPopup) {
            manualLocBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!manualLocPopup.classList.contains('hidden')) {
                    manualLocPopup.classList.add('hidden');
                    return;
                }
                showLocationTypePopup(manualLocPopup, document.getElementById('location-input'));
            });
            document.addEventListener('click', (e) => {
                if (!manualLocBtn.contains(e.target) && !manualLocPopup.contains(e.target)) {
                    manualLocPopup.classList.add('hidden');
                }
            });
        }
    }

    // 初期実行
    updateContentList();
    updateEnthusiasmList();
    updateCommentSuggestions();
}

function updateCommentSuggestions() {
    elements.commentList.innerHTML = '';
    const commFreq = {};
    // GASデータ
    if (state.gasMasterData?.comments) {
        state.gasMasterData.comments.forEach(c => commFreq[c] = (commFreq[c] || 0) + 5);
    }
    ['集中できた！', '復習が必要', '目標達成', '少し疲れた'].forEach(c => commFreq[c] = (commFreq[c] || 0) + 1);
    state.records.forEach(r => {
        if (r.comment) commFreq[r.comment] = (commFreq[r.comment] || 0) + 1;
    });

    const sortedComms = Object.keys(commFreq).sort((a, b) => commFreq[b] - commFreq[a]);

    sortedComms.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        elements.commentList.appendChild(opt);
    });
}

// イベントリスナー
function showLocationTypePopup(popup, input) {
    const locFreq = {};
    // マスタデータ(スプレッドシートE列)を優先
    if (state.gasMasterData?.locations) {
        state.gasMasterData.locations.forEach(l => locFreq[l] = (locFreq[l] || 0) + 10);
    }
    // 過去の記録から集計
    state.records.forEach(r => {
        if (r.location) locFreq[r.location] = (locFreq[r.location] || 0) + 1;
    });
    // デフォルト候補
    ['自宅', 'カフェ', '図書館', '学校', '塾'].forEach(l => locFreq[l] = (locFreq[l] || 0) + 1);

    const sortedLocs = Object.keys(locFreq).sort((a, b) => locFreq[b] - locFreq[a]);
    if (sortedLocs.length === 0) return;

    popup.innerHTML = '';
    sortedLocs.forEach(text => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.textContent = text;
        item.addEventListener('click', () => {
            input.value = text;
            popup.classList.add('hidden');
            input.focus();
        });
        popup.appendChild(item);
    });
    popup.classList.remove('hidden');
}

function setupEventListeners() {
    // ユーザー保存
    elements.saveUserBtn.addEventListener('click', () => {
        const name = elements.userNameInput.value.trim();
        if (name) {
            localStorage.setItem(USER_KEY, name);
            elements.userDisplay.textContent = `User: ${name}`;
            hideOverlay();
            loadRecordsFromGAS(); // 名前が変わったらデータを再読込
        }
    });

    // タブ切り替え
    elements.tabItems.forEach(item => {
        item.addEventListener('click', () => {
            elements.tabItems.forEach(btn => btn.classList.remove('active'));
            elements.tabContents.forEach(content => content.classList.remove('active'));
            item.classList.add('active');
            document.getElementById(item.dataset.tab).classList.add('active');
        });
    });

    // 目標時間の変更を監視して即時保存・反映
    elements.minHoursInput.addEventListener('input', (e) => {
        state.goals.minHours = Number(e.target.value);
        saveLocalRecords();
        updateCharts();
    });
    elements.targetHoursInput.addEventListener('input', (e) => {
        state.goals.targetHours = Number(e.target.value);
        saveLocalRecords();
        updateCharts();
    });

    // 学習開始
    elements.startStudyBtn.addEventListener('click', startStudy);

    // 一時中断・再開
    const pauseBtn = document.getElementById('pause-study-btn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', togglePauseStudy);
    }

    // 学習終了
    elements.finishStudyBtn.addEventListener('click', finishStudy);

    // まとめ保存
    const saveSummaryBtn = document.getElementById('save-summary-btn');
    if (saveSummaryBtn) {
        saveSummaryBtn.addEventListener('click', saveSummaryRecord);
    }

    // 手動記録
    elements.manualRecordBtn.addEventListener('click', manualRecord);

    // 離脱防止
    window.addEventListener('beforeunload', (e) => {
        if (state.isStudying) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // 視認性変更時の警告
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && state.isStudying) {
            elements.confirmModal.classList.remove('hidden');
        }
    });

    elements.keepWorkingBtn.addEventListener('click', () => {
        elements.confirmModal.classList.add('hidden');
    });

    elements.takeRestBtn.addEventListener('click', () => {
        elements.confirmModal.classList.add('hidden');
        // 休憩処理（タイマー一時停止など検討可能）
    });

    // ヘッダー設定・単位切り替え
    elements.settingsBtn.addEventListener('click', () => elements.settingsModal.classList.remove('hidden'));
    elements.closeSettingsBtn.addEventListener('click', () => {
        elements.settingsModal.classList.add('hidden');
        updateGoalDisplay();
    });

    const msgIntervalInput = document.getElementById('message-interval-input');
    if (msgIntervalInput) {
        msgIntervalInput.addEventListener('change', (e) => {
            state.messageInterval = Number(e.target.value) * 1000;
            localStorage.setItem('study_recorder_message_interval', e.target.value);
            if (state.isStudying) startSupportMessageInterval();
        });
    }

    // テーマカラーピッカー（カラードット）
    const themePicker = document.getElementById('theme-picker');
    if (themePicker) {
        const dots = themePicker.querySelectorAll('.color-dot');
        dots.forEach(dot => {
            // ホバーでプレビュー
            dot.addEventListener('mouseenter', () => {
                document.documentElement.setAttribute('data-theme', dot.dataset.theme);
            });
            // クリックで確定
            dot.addEventListener('click', () => {
                state.goals.theme = dot.dataset.theme;
                dots.forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                saveLocalRecords();
            });
        });
        // モーダルを閉じたら保存済みテーマに戻す
        elements.closeSettingsBtn.addEventListener('click', () => {
            document.documentElement.setAttribute('data-theme', state.goals.theme || 'default');
        });
    }

    // 日付ナビゲーション
    elements.prevDateBtn.addEventListener('click', () => changeViewDate(-1));
    elements.nextDateBtn.addEventListener('click', () => changeViewDate(1));
    elements.todayBtn.addEventListener('click', () => {
        state.viewDate = getLogicalDate();
        updateViewDateUI();
        updateViewDateRecords(); // 表示を即座にリロード
    });
}

// Assuming 'state' object is defined globally or in an outer scope.
// This is an example of how the state object might be structured,
// based on the provided instruction snippet.
// The actual definition of 'state' is not in the provided 'content'.
// This section is added to reflect the instruction's intent for 'state' object modification.
/*
const state = {
    // ... other state properties
    viewDate: getLogicalDate(),
    categoryFreq: {},
    masterData: {}, // カテゴリ -> 内容のリスト
    gasMasterData: null,
    accumulatedPausedMs: 0, // 合計中断ミリ秒数 (ミリ秒精度で保持)
    lastPauseTime: null,    // 最後の中断開始時刻
    messageInterval: 30000,  // デフォルト30秒
    supportMessageInterval: null
    // ... other state properties
};
*/

function updateGoalDisplay() {
    if (!elements.displayMinHours || !elements.displayTargetHours) return;

    const minH = state.goals.minHours;
    const targetH = state.goals.targetHours;

    const format = (h) => `${h}h (${h * 60}min)`;
    elements.displayMinHours.textContent = format(minH);
    elements.displayTargetHours.textContent = format(targetH);
}

function changeViewDate(days) {
    if (days === 0) {
        state.viewDate = getLogicalDate();
    } else {
        const d = new Date(state.viewDate.replace(/\//g, '-'));
        d.setDate(d.getDate() + days);
        const y = d.getFullYear();
        const m = ('0' + (d.getMonth() + 1)).slice(-2);
        const day = ('0' + d.getDate()).slice(-2);
        state.viewDate = `${y}/${m}/${day}`;
    }

    // 未来の日付制限
    const today = getLogicalDate();
    if (state.viewDate > today) {
        state.viewDate = today;
    }

    updateViewDateUI();
    updateViewDateRecords(); // 表示の反映を確実に行う
}

function updateViewDateUI() {
    const d = new Date(state.viewDate);
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    elements.currentViewDateDisplay.textContent = `${state.viewDate}(${dayNames[d.getDay()]})`;
    updateCharts();
}

// 学習開始処理
function startStudy() {
    const category = elements.categoryInput.value.trim();
    const content = elements.contentInput.value.trim();
    if (!category || !content) {
        alert('カテゴリーと内容を入力してください');
        return;
    }

    state.isStudying = true;
    state.startTime = new Date(); // ① 基準修正: 必ず現在（開始タップ時）をstartTimeとする

    state.elapsedSeconds = 0;
    state.isPaused = false;
    state.accumulatedPausedMs = 0;
    state.lastPauseTime = null;

    document.getElementById('study-current-category').textContent = category;
    document.getElementById('study-current-content').textContent = content;

    elements.studyMode.classList.remove('hidden');
    updateSupportMessage();
    saveStudyState(); // 状態を即時保存

    startTimerInterval();
    startSupportMessageInterval();
}

function startSupportMessageInterval() {
    if (state.supportMessageInterval) clearInterval(state.supportMessageInterval);
    state.supportMessageInterval = setInterval(updateSupportMessage, state.messageInterval);
}

function togglePauseStudy() {
    const pauseBtn = document.getElementById('pause-study-btn');
    const now = Date.now();
    if (state.isPaused) {
        // 再開
        if (state.lastPauseTime) {
            state.accumulatedPausedMs += (now - state.lastPauseTime.getTime());
        }
        state.isPaused = false;
        state.lastPauseTime = null;
        pauseBtn.textContent = '一時中断';
        pauseBtn.classList.remove('pulse');
        startTimerInterval();
    } else {
        // 中断
        state.isPaused = true;
        state.lastPauseTime = new Date(now);
        clearInterval(state.timerInterval);
        pauseBtn.textContent = '再開する';
        pauseBtn.classList.add('pulse');
    }
    saveStudyState();
}

function saveStudyState() {
    if (state.isStudying) {
        localStorage.setItem(STATE_STUDY_KEY, JSON.stringify({
            isStudying: true,
            isPaused: state.isPaused,
            startTime: state.startTime.toISOString(),
            accumulatedPausedMs: state.accumulatedPausedMs,
            lastPauseTime: state.lastPauseTime ? state.lastPauseTime.toISOString() : null,
            category: elements.categoryInput.value.trim(),
            content: elements.contentInput.value.trim(),
            location: elements.locationInput.value.trim()
        }));
    } else {
        localStorage.removeItem(STATE_STUDY_KEY);
    }
}

async function finishStudy() {
    clearInterval(state.timerInterval);

    // ⑦ 正確な分数の算出
    const endTime = new Date();
    let currentAccumulatedPausedMs = state.accumulatedPausedMs;
    if (state.isPaused && state.lastPauseTime) {
        currentAccumulatedPausedMs += (endTime - state.lastPauseTime);
    }
    const diffMs = endTime - state.startTime - currentAccumulatedPausedMs;
    const duration = Math.max(0, Math.round(diffMs / 60000));

    // ③ 開始・終了時刻の取得と表示
    const formatTime = (d) => d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const startTimeStr = formatTime(state.startTime);
    const endTimeStr = formatTime(endTime);

    document.getElementById('summary-duration-display').textContent =
        `学習時間: ${duration} 分 (${startTimeStr} 〜 ${endTimeStr})`;

    // ④ コメント欄の操作性改善（全文選択リスナーの追加）
    const summaryComment = document.getElementById('summary-comment');
    if (summaryComment && !summaryComment.dataset.selectListener) {
        summaryComment.addEventListener('focus', (e) => e.target.select());
        summaryComment.addEventListener('click', (e) => e.target.select());
        summaryComment.dataset.selectListener = "true";
    }

    // 現在のコメント・場所をプリセット
    document.getElementById('summary-comment').value = elements.commentInput.value.trim() || '次も頑張ろう！';

    // 前回選択した場所を自動入力 (最新の記録から取得)
    const lastLocation = state.records.length > 0 ? (state.records[0].location || '') : '';
    document.getElementById('summary-location').value = lastLocation;

    // ① 2軸評価用データの準備 (A: 今回, B: 本日合計)
    const durationA = duration;
    // 修正: 所属判定で本日合計を計算（0:00〜3:59は前日所属）
    const logicalTodayStr = getLogicalDate(endTime);
    const todayTotalMinutes = state.records
        .filter(r => getBelongingDate(r.date, r.startTime) === logicalTodayStr)
        .reduce((sum, r) => sum + (parseInt(r.duration) || 0), 0);
    const durationB = todayTotalMinutes + durationA;

    // ② メッセージの取得とフィルタリング
    const rawMsgs = (state.gasMasterData && state.gasMasterData.finishMessages && state.gasMasterData.finishMessages.length > 0)
        ? state.gasMasterData.finishMessages.filter(m => m && m.trim())
        : ["お疲れ様でした！", "今日も一歩前進ですね。"];

    const candidates = rawMsgs.map(m => {
        let thresholdA = 0;
        let thresholdB = 0;
        let content = m;

        // [Axx], [Bxx], [xx] タグの抽出
        const matchA = m.match(/\[A(\d+)\]/);
        const matchB = m.match(/\[B(\d+)\]/);
        const matchOld = m.match(/^\[(\d+)\]/); // 旧仕様 [60] 等

        if (matchA) thresholdA = parseInt(matchA[1]);
        if (matchB) thresholdB = parseInt(matchB[1]);
        if (matchOld && !matchA && !matchB) thresholdA = parseInt(matchOld[1]);

        // 旧仕様かつタグなし互換性 (タグなしは A=60 とみなしていたが、新仕様では「条件なし」として扱うのが安全)
        // ただしユーザー指示に「タグなし既存は stage=60（A=60）として扱う」とあるため維持
        const hasAnyTag = matchA || matchB || matchOld;
        if (!hasAnyTag) {
            thresholdA = 60;
        }

        return { content, thresholdA, thresholdB, hasAnyTag };
    });

    // 条件合致チェック
    let filtered = candidates.filter(item => {
        return durationA >= item.thresholdA && durationB >= item.thresholdB;
    });

    // 合致がなければ、タグなし等のデフォルトから選ぶ
    if (filtered.length === 0) {
        filtered = candidates.filter(item => !item.hasAnyTag);
    }

    // 優先順位: 閾値の合計 (A + B) が高いものを優先
    filtered.sort((a, b) => (b.thresholdA + b.thresholdB) - (a.thresholdA + a.thresholdB));

    // 同一スコア内でのランダム性
    const topScore = filtered.length > 0 ? (filtered[0].thresholdA + filtered[0].thresholdB) : -1;
    const bestCandidates = filtered.filter(item => (item.thresholdA + item.thresholdB) === topScore);

    const selectedItem = bestCandidates[Math.floor(Math.random() * bestCandidates.length)] || { content: "お疲れ様でした！" };
    const finalMsg = selectedItem.content.replace(/\[[AB]?\d+\]/g, '').trim();

    document.querySelector('#summary-modal h3').textContent = finalMsg;

    elements.studyMode.classList.add('hidden');
    if (state.supportMessageInterval) clearInterval(state.supportMessageInterval);
    document.getElementById('summary-modal').classList.remove('hidden');
}

async function saveSummaryRecord() {
    const endTime = new Date();
    let currentAccumulatedPausedMs = state.accumulatedPausedMs;
    if (state.isPaused && state.lastPauseTime) {
        currentAccumulatedPausedMs += (endTime - state.lastPauseTime);
    }
    const diffMs = endTime - state.startTime - currentAccumulatedPausedMs;
    const duration = Math.max(0, Math.round(diffMs / 60000));

    const condition = document.getElementById('summary-condition').value;
    const comment = document.getElementById('summary-comment').value.trim();
    const location = document.getElementById('summary-location').value.trim();

    const record = {
        // 修正: 実日付をそのまま保存（所属判定は表示時にgetBelongingDateで行う）
        date: endTime.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/-/g, '/'),
        userName: localStorage.getItem(USER_KEY),
        startTime: state.startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        endTime: endTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        duration: duration,
        category: elements.categoryInput.value.trim(),
        content: elements.contentInput.value.trim(),
        enthusiasm: elements.enthusiasmInput.value,
        condition: condition,
        comment: comment,
        location: location
    };

    state.isStudying = false;
    saveStudyState(); // 状態をクリア

    state.records.push(record);
    saveLocalRecords();
    updateHistoryUI();
    updateCharts();
    updateCommentSuggestions();

    document.getElementById('summary-modal').classList.add('hidden');

    const btn = document.getElementById('save-summary-btn');
    await sendRecord(record, btn);

    alert(`記録しました！今回の学習時間は ${duration} 分でした。`);
}

function updateLocationSuggestions() {
    elements.locationList.innerHTML = '';
    const locFreq = {};
    if (state.gasMasterData?.locations) {
        state.gasMasterData.locations.forEach(l => locFreq[l] = (locFreq[l] || 0) + 5);
    }
    state.records.forEach(r => {
        if (r.location) locFreq[r.location] = (locFreq[r.location] || 0) + 1;
    });

    const sortedLocs = Object.keys(locFreq).sort((a, b) => locFreq[b] - locFreq[a]);
    sortedLocs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        elements.locationList.appendChild(opt);
    });
}

// 手動記録処理
async function manualRecord() {
    const category = elements.categoryInput.value.trim();
    const content = elements.contentInput.value.trim();
    if (!category || !content) {
        alert('カテゴリーと内容を入力してください');
        return;
    }

    const startTimeStr = elements.startTimeInput.value;
    const endTimeStr = elements.endTimeInput.value;

    if (!startTimeStr || !endTimeStr) {
        alert('開始時刻と終了時刻を入力してください');
        return;
    }

    // 時間計算
    const [h1, m1] = startTimeStr.split(':').map(Number);
    const [h2, m2] = endTimeStr.split(':').map(Number);
    let duration = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (duration < 0) duration += 24 * 60; // 日を跨ぐ場合

    const condition = elements.conditionInput.value;
    const location = elements.locationInput.value.trim();
    let comment = elements.commentInput.value.trim();
    if (!comment) {
        comment = prompt('コメントがあれば入力してください', '') || '';
    }

    // 修正: 入力された日付をそのまま保存（所属判定は表示時にgetBelongingDateで行う）
    const inputDateStr = elements.recordDateInput.value || new Date().toISOString().slice(0, 10);
    const formattedDate = inputDateStr.replace(/-/g, '/');

    const record = {
        date: formattedDate,
        userName: localStorage.getItem(USER_KEY),
        startTime: startTimeStr,
        endTime: endTimeStr,
        duration: duration,
        category: category,
        content: content,
        enthusiasm: document.getElementById('enthusiasm-input').value,
        condition: condition,
        location: location,
        comment: comment
    };

    state.records.push(record);
    saveLocalRecords();
    updateHistoryUI();
    updateCharts();
    updateCommentSuggestions();

    await sendRecord(record, elements.manualRecordBtn);
}

// レコード送信 (Create / Update / Delete)
async function sendRecord(record, button = null, action = 'create') {
    let originalText = '';
    if (button) {
        originalText = button.textContent;
        button.textContent = '送信中...';
        button.disabled = true;
    }

    // Update/Deleteの場合はIDが必須
    const dataToSend = {
        action: action, // 'create', 'update', 'delete'
        ...record
    };

    // no-cors対策のためURLパラメータにも付与
    const params = new URLSearchParams();
    Object.keys(dataToSend).forEach(key => {
        if (dataToSend[key] !== null && dataToSend[key] !== undefined) {
            params.append(key, dataToSend[key]);
        }
    });

    try {
        const response = await fetch(GAS_URL + '?' + params.toString(), {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });

        // no-corsなのでレスポンス読めないが成功とみなす
        // リロードして反映
        setTimeout(() => loadRecordsFromGAS(), 1000);

    } catch (error) {
        console.error('送信エラー:', error);
        alert('送信に失敗しました。');
    } finally {
        if (button) {
            button.textContent = originalText;
            button.disabled = false;
        }
    }
}

function saveLocalRecords() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state.records));
    localStorage.setItem('study_recorder_goals', JSON.stringify(state.goals));
}

async function loadRecordsFromGAS() {
    const userName = localStorage.getItem(USER_KEY);
    if (!userName) return;

    // NOTE: ここで state.viewDate を getLogicalDate() で上書きしないこと
    // (Navでの日付切り替えや今日ボタンの動作を破壊するため)

    try {
        const response = await fetch(`${GAS_URL}?userName=${encodeURIComponent(userName)}`);
        if (response.ok) {
            const result = await response.json();
            const recordsData = result.records || [];

            // マスタデータの更新
            if (result.masterData) {
                state.gasMasterData = result.masterData;
            }

            if (Array.isArray(recordsData)) {
                state.records = recordsData.map(record => {
                    let datePart = record.date;

                    // 修正: ISOString（UTC）をローカル日付に正しく変換
                    // GASはDate型をISOString（UTC）として返すため、ローカル時間に変換が必要
                    if (datePart && typeof datePart === 'string' && datePart.includes('T')) {
                        // ISOString形式の場合はDateオブジェクトを経由してローカル日付を取得
                        const d = new Date(datePart);
                        if (!isNaN(d.getTime())) {
                            const y = d.getFullYear();
                            const m = ('0' + (d.getMonth() + 1)).slice(-2);
                            const day = ('0' + d.getDate()).slice(-2);
                            datePart = `${y}/${m}/${day}`;
                        } else {
                            datePart = datePart.split(/[ T]/)[0].replace(/-/g, '/');
                        }
                    } else if (datePart && typeof datePart === 'string') {
                        // 既に日付文字列の場合はそのまま正規化
                        datePart = datePart.split(/[ T]/)[0].replace(/-/g, '/');
                    } else if (datePart) {
                        datePart = datePart.toString().split(/[ T]/)[0].replace(/-/g, '/');
                    }

                    const formatTime = (timeStr) => {
                        if (!timeStr) return '';
                        if (typeof timeStr === 'string' && timeStr.includes('T')) {
                            const d = new Date(timeStr);
                            if (isNaN(d.getTime())) return timeStr;
                            const h = ('0' + d.getHours()).slice(-2);
                            const m = ('0' + d.getMinutes()).slice(-2);
                            return `${h}:${m}`;
                        }
                        return timeStr;
                    };

                    const startTime = formatTime(record.startTime);
                    const endTime = formatTime(record.endTime);

                    // 修正: 表示日付はスプレッドシートの実データをそのまま使用
                    // 所属判定（どの日に載せるか）はgetBelongingDateで別途行う
                    return {
                        ...record,
                        date: datePart || '',
                        startTime: startTime,
                        endTime: endTime
                    };
                });
                console.log('GASから学習記録を正常に読み込みました。');
            }
        }
    } catch (error) {
        console.error('GASからの記録読み込みに失敗しました:', error);
    } finally {
        // UIとチャートを更新 (正常・異常に関わらず最新状態を反映して「消失」を防ぐ)
        updateHistoryUI();
        updateGoalDisplay();
        updateCharts();
        setupMasterData();
        updateLocationSuggestions();
    }

    // ② カテゴリ・学習内容の初期値（直近の記録からセット）
    if (state.records.length > 0) {
        const sorted = [...state.records].sort((a, b) => {
            const parseTime = (r) => {
                if (!r.date || !r.startTime) return 0;
                const [y, m, d] = r.date.split('/').map(Number);
                const [h, min] = r.startTime.split(':').map(Number);
                return new Date(y, m - 1, d, h, min).getTime();
            };
            return parseTime(b) - parseTime(a);
        });
        const lastRec = sorted[0];
        if (lastRec) {
            elements.categoryInput.value = lastRec.category || '';
            elements.contentInput.value = lastRec.content || '';
        }
    }
}

function loadLocalRecords() {
    // 学習記録はGASから読み込むため、ローカルストレージからは読み込まないように変更
    // ただし、目標設定やテーマは引き続きローカルに保持（必要に応じてGAS化も検討可能）
    const savedGoals = localStorage.getItem('study_recorder_goals');
    if (savedGoals) {
        state.goals = JSON.parse(savedGoals);
        elements.minHoursInput.value = state.goals.minHours;
        elements.targetHoursInput.value = state.goals.targetHours;
        if (state.goals.theme) {
            document.documentElement.setAttribute('data-theme', state.goals.theme);
            const activeDot = document.querySelector(`.color-dot[data-theme="${state.goals.theme}"]`);
            if (activeDot) activeDot.classList.add('active');
        }
    }
    // 初期状態の表示を更新: 最新の場所を入力欄へ
    updateLocationSuggestions();
    if (state.records.length > 0 && elements.locationInput && !elements.locationInput.value) {
        elements.locationInput.value = state.records[0].location || '';
    }
    // 初期状態の表示を更新
    updateGoalDisplay();
}

// 履歴UI更新 (最新順 & スクロール対応)
function updateHistoryUI() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = '';

    // 最新順にソート（日付と時刻から判断）
    const sortedRecords = [...state.records].sort((a, b) => {
        const getTime = (r) => {
            try {
                if (!r.date || !r.startTime) return 0;
                // 'YYYY/MM/DD' と 'HH:mm' をパース
                const dParts = r.date.split('/');
                const tParts = r.startTime.split(':');
                if (dParts.length < 3 || tParts.length < 2) return 0;

                // 日本時間として数値をセット (Dateの引数は Y, M-1, D, H, M, S)
                const dObj = new Date(
                    parseInt(dParts[0]),
                    parseInt(dParts[1]) - 1,
                    parseInt(dParts[2]),
                    parseInt(tParts[0]),
                    parseInt(tParts[1])
                );
                return dObj.getTime();
            } catch (e) {
                console.error('Time parse error:', e, r);
                return 0;
            }
        };
        return getTime(b) - getTime(a);
    });

    console.log('Rendering records count:', sortedRecords.length);

    sortedRecords.forEach(rec => {
        const card = document.createElement('div');
        card.className = 'glass-card history-card';
        card.dataset.id = rec.id || ''; // IDを保持

        // UIイベント設定 (右クリック & 長押し)
        setupCardEvents(card, rec);

        card.innerHTML = `
            <div class="history-header">
                <div class="history-date-box">
                    <span class="history-date">${rec.date}</span>
                    ${rec.location ? `<span class="history-location-badge">${rec.location}</span>` : ''}
                </div>
                <span class="history-condition">${rec.condition}</span>
            </div>
            <div class="history-body">
                <h4>${rec.category} - ${rec.content}</h4>
                <p>${rec.startTime} 〜 ${rec.endTime} (${rec.duration}min)</p>
                <div class="history-comment">
                    <div class="intent">${rec.enthusiasm || '-'}</div>
                    <div class="comment">${rec.comment || ''}</div>
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

// チャート更新
function updateCharts() {
    // 各セクションの現在選択されている期間を取得
    const balancePeriod = document.getElementById('balance-period-tabs')?.querySelector('.active')?.dataset.period || 'day';
    const volumePeriod = document.getElementById('volume-period-tabs')?.querySelector('.active')?.dataset.period || 'day';
    const detailPeriod = document.getElementById('detail-period-tabs')?.querySelector('.active')?.dataset.period || 'day';

    updateCategoryChart(balancePeriod);
    updateTimelineAnalysis(); // ガントチャート
    updateStickyTimelineChart(volumePeriod);
    updateMainDetailChart(detailPeriod);
    updateViewDateRecords(); // 選択日の記録リストを表示
}

function updateViewDateRecords() {
    const container = document.getElementById('view-date-records-list');
    if (!container) return;

    // 修正: 4時跨ぎセッションを分割して表示
    const records = getExpandedRecords(state.records)
        .filter(r => getBelongingDate(r.date, r.startTime) === state.viewDate)
        .sort((a, b) => {
            const timeA = a.startTime.split(':').map(Number);
            const timeB = b.startTime.split(':').map(Number);
            // 24時間表記の単純比較（降順）
            return (timeB[0] * 60 + timeB[1]) - (timeA[0] * 60 + timeA[1]);
        });

    container.innerHTML = '';
    if (records.length === 0) {
        container.innerHTML = '<div style="padding: 1rem; color: var(--text-dim); font-size: 0.75rem;">記録なし</div>';
        return;
    }

    records.forEach(r => {
        const card = document.createElement('div');
        card.className = 'mini-record-card';

        // ① 編集機能の紐付け
        setupCardEvents(card, r);

        card.innerHTML = `
            <div class="time">${r.startTime} 〜 ${r.endTime} (${r.duration}min) ${r.location ? `<span style="font-size:0.7rem; color:var(--primary-color); background:rgba(255,255,255,0.05); padding:1px 4px; border-radius:4px; margin-left:4px;">${r.location}</span>` : ''}</div>
            <div class="title">${r.category} - ${r.content}</div>
            <div class="intent-comment">
                ${r.enthusiasm ? '🔥' + r.enthusiasm : ''} ${r.comment ? '💬' + r.comment : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

function updateCategoryChart(period = 'day') {
    const canvas = document.getElementById('categoryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // 期間フィルタリング（4時跨ぎセッションを分割して集計）
    const filteredRecords = filterRecordsByPeriod(getExpandedRecords(state.records), period);
    const dataMap = {};
    filteredRecords.forEach(r => {
        dataMap[r.category] = (dataMap[r.category] || 0) + Number(r.duration);
    });

    const totalDuration = Object.values(dataMap).reduce((a, b) => a + b, 0);

    if (charts.category) charts.category.destroy();

    charts.category = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(dataMap),
            datasets: [{
                data: Object.values(dataMap),
                backgroundColor: ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 } },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const val = context.raw;
                            const pct = totalDuration > 0 ? ((val / totalDuration) * 100).toFixed(1) : 0;
                            return `${context.label}: ${val}分 (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function filterRecordsByPeriod(records, period) {
    const viewDate = new Date(state.viewDate);
    return records.filter(r => {
        // 所属日付で判定（0:00〜3:59は前日所属）
        const belongingDateStr = getBelongingDate(r.date, r.startTime);
        const d = new Date(belongingDateStr);
        if (period === 'day') return belongingDateStr === state.viewDate;
        if (period === 'week') {
            const weekStart = new Date(viewDate);
            weekStart.setDate(viewDate.getDate() - viewDate.getDay()); // 日曜開始
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return d >= weekStart && d <= weekEnd;
        }
        if (period === 'month') return d.getMonth() === viewDate.getMonth() && d.getFullYear() === viewDate.getFullYear();
        return true;
    });
}

// 縦軸固定型積み上げ棒グラフ (最新当日を右に固定・過去をスクロール)
function updateStickyTimelineChart(period = 'day') {
    const yAxisCtx = document.getElementById('timelineYAxis').getContext('2d');
    const mainCtx = document.getElementById('timelineChart').getContext('2d');
    const todayCtx = document.getElementById('timelineTodayGraph').getContext('2d');
    if (!yAxisCtx || !mainCtx || !todayCtx) return;

    // 修正: 4時跨ぎセッションを分割して集計
    const groupedData = aggregateByPeriod(getExpandedRecords(state.records), period);
    const allLabels = groupedData.labels;
    const allDatasets = groupedData.datasets;

    // 分離
    const pastLabels = allLabels.slice(0, -1);
    const todayLabel = allLabels.slice(-1);
    const pastDatasets = allDatasets.map(ds => ({ ...ds, data: ds.data.slice(0, -1) }));
    const todayDatasets = allDatasets.map(ds => ({ ...ds, data: ds.data.slice(-1) }));

    // スケール統一のための最大値計算
    let maxTotal = 300; // デフォルト (5時間)
    allLabels.forEach((label, i) => {
        let dailyTotal = 0;
        allDatasets.forEach(ds => dailyTotal += (ds.data[i] || 0));
        if (dailyTotal > maxTotal) maxTotal = dailyTotal;
    });
    const suggestedMax = Math.ceil(maxTotal / 60) * 60; // 1時間単位に切り上げ

    if (charts.timelineY) charts.timelineY.destroy();
    if (charts.timeline) charts.timeline.destroy();
    if (charts.timelineToday) charts.timelineToday.destroy();

    const baseOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        layout: {
            padding: { top: 10, bottom: 0, left: 0, right: 0 }
        },
        scales: {
            x: {
                stacked: true,
                grid: { display: false },
                ticks: {
                    color: '#94a3b8',
                    font: { size: 10 },
                    maxRotation: 0, // 回転禁止
                    minRotation: 0,
                    autoSkip: false
                },
                afterFit: (axis) => { axis.height = 20; } // X軸の高さを20pxに固定
            },
            y: {
                stacked: true,
                beginAtZero: true,
                min: 0,
                max: suggestedMax,
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { display: false, stepSize: 60 },
                afterFit: (axis) => { axis.width = 0; } // Y軸の表示幅を0に固定
            }
        }
    };

    // 当日チャート用の外部ツールチップ設定 (Canvas外にはみ出させるためHTMLで描画)
    const externalTooltipHandler = (context) => {
        const { chart, tooltip } = context;
        let tooltipEl = document.getElementById('chartjs-tooltip');

        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.id = 'chartjs-tooltip';
            tooltipEl.style.position = 'absolute';
            tooltipEl.style.background = 'rgba(0, 0, 0, 0.8)';
            tooltipEl.style.borderRadius = '6px';
            tooltipEl.style.color = 'white';
            tooltipEl.style.padding = '10px';
            tooltipEl.style.zIndex = '1000';
            tooltipEl.style.pointerEvents = 'none';
            tooltipEl.style.fontSize = '12px';
            tooltipEl.style.transition = 'all 0.1s ease';
            tooltipEl.style.transform = 'translate(-50%, 0)';
            document.body.appendChild(tooltipEl);
        }

        if (tooltip.opacity === 0) {
            tooltipEl.style.opacity = 0;
            return;
        }

        if (tooltip.body) {
            const titleLines = tooltip.title || [];
            const bodyLines = tooltip.body.map(b => b.lines);

            let innerHtml = '<div style="font-weight:600; font-size:12px; margin-bottom:6px;">' + titleLines.join('<br>') + '</div>';

            bodyLines.forEach((body, i) => {
                const colors = tooltip.labelColors[i];
                let style = 'background:' + colors.backgroundColor;
                style += '; border-color:' + colors.borderColor;
                style += '; border-width: 2px';
                const span = '<span style="display:inline-block; width:10px; height:10px; margin-right:6px; border-radius:2px; vertical-align:middle; ' + style + '"></span>';
                innerHtml += '<div style="display:flex; align-items:center; margin-bottom:4px; font-size:12px;">' + span + body + '</div>';
            });

            tooltipEl.innerHTML = innerHtml;
        }

        const position = chart.canvas.getBoundingClientRect();
        tooltipEl.style.opacity = 1;
        tooltipEl.style.left = position.left + window.scrollX + tooltip.caretX + 'px';
        tooltipEl.style.top = position.top + window.scrollY + tooltip.caretY - tooltipEl.offsetHeight - 10 + 'px';
    };

    // 1. 縦軸
    charts.timelineY = new Chart(yAxisCtx, {
        type: 'bar',
        data: { labels: [''], datasets: [] },
        options: {
            ...baseOptions,
            layout: {
                padding: { top: 10, bottom: 20, left: 0, right: 0 } // X軸高さ(20px)分の下部パディングを追加して底辺を揃える
            },
            plugins: { ...baseOptions.plugins, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: {
                    display: true,
                    beginAtZero: true,
                    min: 0,
                    max: suggestedMax,
                    grid: { display: false }, // Y軸の縦グリッドラインは不要
                    ticks: {
                        display: true,
                        color: '#94a3b8',
                        font: { size: 10 },
                        stepSize: 60,
                        callback: function (value) { return (value / 60) + 'h'; }
                    },
                    afterFit: (axis) => { axis.width = 35; }
                }
            }
        }
    });

    // 2. 過去分
    charts.timeline = new Chart(mainCtx, {
        type: 'bar',
        data: { labels: pastLabels, datasets: pastDatasets },
        options: {
            ...baseOptions,
            barThickness: 15,
            plugins: {
                ...baseOptions.plugins,
                tooltip: {
                    enabled: false,
                    external: externalTooltipHandler,
                    mode: 'index',
                    intersect: false
                }
            }
        }
    });

    // 3. 当日分
    charts.timelineToday = new Chart(todayCtx, {
        type: 'bar',
        data: { labels: todayLabel, datasets: todayDatasets },
        options: {
            ...baseOptions,
            barThickness: 15,
            plugins: {
                ...baseOptions.plugins,
                tooltip: {
                    enabled: false,
                    external: externalTooltipHandler,
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: { ...baseOptions.scales.x, ticks: { ...baseOptions.scales.x.ticks, color: '#94a3b8' } },
                y: baseOptions.scales.y
            }
        }
    });

    // スクロール調整
    const wrapper = document.querySelector('.chart-scroll-wrapper');
    const content = document.querySelector('.chart-resizable-content');
    if (wrapper && content) {
        const barWidth = 30;
        content.style.width = Math.max(wrapper.clientWidth, pastLabels.length * barWidth) + 'px';
        setTimeout(() => { wrapper.scrollLeft = wrapper.scrollWidth; }, 150);
    }
}

// 期間別詳細分析チャートの描画（カテゴリ/内容別・縦棒グラフ）
function updateMainDetailChart(period = 'day') {
    const ctx = document.getElementById('mainDetailChart').getContext('2d');
    if (!ctx) return;

    // 選択期間内の記録を取得（4時跨ぎセッションを分割して集計）
    const filteredRecords = filterRecordsByPeriod(getExpandedRecords(state.records), period);

    // カテゴリ別に集計
    const categoryDurations = {};
    filteredRecords.forEach(r => {
        const key = r.category;
        categoryDurations[key] = (categoryDurations[key] || 0) + Number(r.duration);
    });

    // ソート（時間が多い順）して最大7件
    const sortedKeys = Object.keys(categoryDurations)
        .sort((a, b) => categoryDurations[b] - categoryDurations[a])
        .slice(0, 7);

    const labels = sortedKeys.length > 0 ? sortedKeys : ['記録なし'];
    const data = sortedKeys.length > 0 ? sortedKeys.map(k => categoryDurations[k]) : [0];

    const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#06b6d4'];

    if (charts.mainDetail) charts.mainDetail.destroy();
    charts.mainDetail = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderRadius: 4,
                barPercentage: 0.7,
                categoryPercentage: 0.8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 9 }, maxRotation: 45, minRotation: 45 }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 10 },
                        stepSize: 60,
                        callback: (v) => (v / 60).toFixed(1) + 'h'
                    }
                }
            }
        }
    });
}

// 期間別集計ロジック
function aggregateByPeriod(records, period) {
    const categoryTotals = {}; // category -> { periodLabel -> duration }
    const allLabelsSet = new Set();
    const categories = new Set();

    // 期間内の全日付/期間ラベルを網羅するためのパディング
    const viewDate = new Date(state.viewDate);
    if (period === 'day') {
        // 全期間を網羅するため、データ中の最古日付を探す
        // レコードがない場合はとりあえず当日のみ、あれば最古から当日まで埋める
        let minDate = viewDate;
        records.forEach(r => {
            const d = new Date(r.date);
            if (d < minDate) minDate = d;
        });
        // 安全策：あまりに古いと膨大になるので、最大でも3年前まで（1095日前）とする
        const maxPast = new Date(viewDate);
        maxPast.setDate(maxPast.getDate() - 1095);
        if (minDate < maxPast) minDate = maxPast;

        const diffTime = Math.abs(viewDate - minDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        for (let i = diffDays; i >= 0; i--) {
            const d = new Date(viewDate);
            d.setDate(viewDate.getDate() - i);
            const yy = d.getFullYear().toString().slice(-2);
            const mm = (d.getMonth() + 1).toString().padStart(2, '0');
            const dd = d.getDate().toString().padStart(2, '0');
            const label = `${yy}/${mm}/${dd}`;
            allLabelsSet.add(label);
        }
    } else if (period === 'week') {
        for (let i = 11; i >= 0; i--) { // 直近12週
            const d = new Date(viewDate);
            d.setDate(viewDate.getDate() - i * 7);
            allLabelsSet.add(`${d.getFullYear()} W${getWeekNumber(d)}`);
        }
    } else if (period === 'month') {
        // 同一年の月を網羅
        for (let i = 0; i < 12; i++) {
            const label = `${viewDate.getFullYear()}-${(i + 1).toString().padStart(2, '0')}`;
            allLabelsSet.add(label);
        }
    }

    records.forEach(r => {
        // 所属日付で集計（0:00〜3:59は前日所属）
        const belongingDateStr = getBelongingDate(r.date, r.startTime);
        const date = new Date(belongingDateStr);
        let label = '';
        if (period === 'day') {
            const yy = date.getFullYear().toString().slice(-2);
            const mm = (date.getMonth() + 1).toString().padStart(2, '0');
            const dd = date.getDate().toString().padStart(2, '0');
            label = `${yy}/${mm}/${dd}`;
        }
        else if (period === 'week') label = `${date.getFullYear()} W${getWeekNumber(date)}`;
        else if (period === 'month') label = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        else if (period === 'year') label = `${date.getFullYear()}`;

        // allLabelsSet にあるか、または年単位の場合は集計
        // ※ dayの場合は全期間網羅ロジックで allLabelsSet に入れているはずだが、漏れがないようにチェック
        if (allLabelsSet.has(label) || period === 'day' || period === 'year') {
            categories.add(r.category);
            if (!categoryTotals[r.category]) categoryTotals[r.category] = {};
            categoryTotals[r.category][label] = (categoryTotals[r.category][label] || 0) + Number(r.duration);
        }
    });

    // ソートして全量を取得（スライスしない）
    let labels = Array.from(allLabelsSet).sort((a, b) => a.localeCompare(b));
    // ※ ここでスライスしてしまうとスクロールできなくなるため、limitは外す
    // if (period === 'day' || period === 'week') labels = labels.slice(-7);
    const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#06b6d4'];
    let colorIdx = 0;

    // カテゴリがない場合でも7日間のラベルを返すため、空のデータセットを作成
    let datasets = Array.from(categories).map(cat => {
        const data = labels.map(label => categoryTotals[cat]?.[label] || 0);
        return {
            label: cat,
            data: data,
            backgroundColor: colors[colorIdx++ % colors.length],
            borderRadius: 4
        };
    });

    // カテゴリが0の場合は透明なプレースホルダーを追加
    if (datasets.length === 0) {
        datasets = [{
            label: '',
            data: labels.map(() => 0),
            backgroundColor: 'transparent',
            borderRadius: 4
        }];
    }

    return { labels, datasets };
}

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// 帯グラフ式タイムライン (当日固定 + 過去6日間スクロール)
function updateTimelineAnalysis() {
    const todayContainer = document.getElementById('timeline-today-row');
    const pastContainer = document.getElementById('timeline-past-days');
    const legend = document.querySelector('.timeline-legend-full');
    if (!todayContainer || !pastContainer || !legend) return;

    // 1. 時間目盛り生成 (1時間おき)
    legend.innerHTML = '';
    for (let i = 0; i <= 24; i++) {
        const hour = (4 + i) % 24;
        const span = document.createElement('span');
        span.textContent = hour;
        span.style.position = 'absolute';
        span.style.left = `${(i / 24) * 100}%`;
        span.style.transform = 'translateX(-50%)';
        legend.appendChild(span);
    }

    // 2. 直近30日間の日付リストを作成 (論理的な「今日」から遡る)
    const dates = [];
    const logicalToday = getLogicalDate(); // ③ 未来化防止: 厳密に4時境界の「今日」を取得
    const [yT, mT, dT] = logicalToday.split('/').map(Number);
    const baseDate = new Date(yT, mT - 1, dT);

    for (let i = 0; i < 30; i++) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() - i);
        const y = d.getFullYear();
        const m = ('0' + (d.getMonth() + 1)).slice(-2);
        const day = ('0' + d.getDate()).slice(-2);
        dates.push(`${y}/${m}/${day}`);
    }

    // ヘルパー: 日付行を生成
    const createDayRow = (dateStr, isToday) => {
        // 修正: 4時跨ぎセッションを分割して両日に表示
        const recordsOnDate = getExpandedRecords(state.records).filter(r => getBelongingDate(r.date, r.startTime) === dateStr);
        const dayRow = document.createElement('div');
        dayRow.className = 'timeline-day-row' + (isToday ? ' today-row' : '');

        const dateLabel = document.createElement('div');
        dateLabel.className = 'timeline-date-label';
        const d = new Date(dateStr);
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        dateLabel.textContent = `${dateStr.slice(5)}(${dayNames[d.getDay()]})`;
        dayRow.appendChild(dateLabel);

        const track = document.createElement('div');
        track.className = 'timeline-track';

        recordsOnDate.forEach(rec => {
            const block = document.createElement('div');
            block.className = 'time-block';
            const startMin = getMinutesFrom4AM(rec.startTime);
            const duration = rec.duration;
            block.style.left = `${(startMin / (24 * 60)) * 100}%`;
            block.style.width = `${(duration / (24 * 60)) * 100}%`;

            block.addEventListener('mouseenter', (e) => showGanttTooltip(e, rec));
            block.addEventListener('mouseleave', hideGanttTooltip);
            // スマホ対応: タップで表示/非表示を切り替え
            block.addEventListener('click', (e) => {
                e.stopPropagation(); // 他のクリックイベントを阻止
                showGanttTooltip(e, rec);
            });

            const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6'];
            const colorIdx = Math.abs(rec.category.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % colors.length;
            block.style.backgroundColor = colors[colorIdx];
            track.appendChild(block);
        });

        dayRow.appendChild(track);
        return dayRow;
    };

    // 3. 当日（固定表示）
    todayContainer.innerHTML = '';
    todayContainer.appendChild(createDayRow(dates[0], true));

    // 4. 過去6日間（スクロール可能）
    pastContainer.innerHTML = '';
    pastContainer.style.maxHeight = '144px'; // 24px * 6
    pastContainer.style.overflowY = 'auto';
    for (let i = 1; i < dates.length; i++) {
        pastContainer.appendChild(createDayRow(dates[i], false));
    }
}

// ツールチップ非表示
function hideGanttTooltip() {
    const tooltip = document.getElementById('gantt-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

// 時間文字列(HH:mm)を4:00 AMからの経過分に変換
function getMinutesFrom4AM(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    let totalMinutes = h * 60 + m;
    let startMinutes = 4 * 60; // 4:00 AM
    let diff = totalMinutes - startMinutes;
    if (diff < 0) diff += 24 * 60; // 深夜帯(0時〜4時)の対応
    return diff;
}

function showGanttTooltip(e, rec) {
    const tooltip = document.getElementById('gantt-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = `
        <div class="tooltip-title" style="font-weight: bold; margin-bottom: 4px;">${rec.category} - ${rec.content}</div>
        <div class="tooltip-time" style="font-size: 0.8em; opacity: 0.8;">${rec.startTime} 〜 ${rec.endTime} (${rec.duration}分)</div>
        ${rec.comment ? `<div class="tooltip-comment" style="margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 2px;">${rec.comment}</div>` : ''}
    `;

    tooltip.style.left = `${e.pageX + 10}px`;
    tooltip.style.top = `${e.pageY + 10}px`;
    tooltip.classList.remove('hidden');
}

// --- Context Menu & Edit/Delete Logic ---
let contextMenuTargetId = null;
const contextMenu = document.getElementById('context-menu');
const editModal = document.getElementById('edit-modal');


function setupCardEvents(card, rec) {
    if (!rec.id) return; // IDがない古いデータは編集不可(またはGAS側でID付与が必要)

    // PC: 右クリック
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, rec.id);
    });

    // Mobile: 長押し
    let touchTimer;
    card.addEventListener('touchstart', (e) => {
        touchTimer = setTimeout(() => {
            // 長押し検知
            const touch = e.touches[0];
            showContextMenu(touch.pageX, touch.pageY, rec.id);
        }, 600);
    });

    card.addEventListener('touchend', () => {
        clearTimeout(touchTimer);
    });

    card.addEventListener('touchmove', () => {
        clearTimeout(touchTimer); // スクロールしたらキャンセル
    });
}

function showContextMenu(x, y, id) {
    contextMenuTargetId = id;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');
}

// メニュー外クリックで閉じる
document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) {
        contextMenu.classList.add('hidden');
    }
});

// 編集ボタン
document.getElementById('ctx-edit').addEventListener('click', () => {
    if (!contextMenuTargetId) return;
    openEditModal(contextMenuTargetId);
    contextMenu.classList.add('hidden');
});

// 削除ボタン
document.getElementById('ctx-delete').addEventListener('click', async () => {
    if (!contextMenuTargetId) return;
    if (confirm('本当にこの記録を削除しますか？')) {
        contextMenu.classList.add('hidden');
        await sendRecord({ id: contextMenuTargetId }, null, 'delete');
    }
});

// 編集モーダル関連
function openEditModal(id) {
    const rec = state.records.find(r => r.id === id);
    if (!rec) return;

    document.getElementById('edit-id').value = rec.id;
    document.getElementById('edit-category').value = rec.category;
    document.getElementById('edit-content').value = rec.content;
    document.getElementById('edit-duration').value = rec.duration;
    document.getElementById('edit-date').value = rec.date; // YYYY/MM/DD
    document.getElementById('edit-condition').value = rec.condition || '◯';
    document.getElementById('edit-location').value = rec.location || '';
    document.getElementById('edit-comment').value = rec.comment || '';

    editModal.classList.remove('hidden');
}

document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    editModal.classList.add('hidden');
});

document.getElementById('save-edit-btn').addEventListener('click', async () => {
    const id = document.getElementById('edit-id').value;
    const updatedRecord = {
        id: id,
        category: document.getElementById('edit-category').value,
        content: document.getElementById('edit-content').value,
        duration: document.getElementById('edit-duration').value,
        date: document.getElementById('edit-date').value,
        condition: document.getElementById('edit-condition').value,
        location: document.getElementById('edit-location').value,
        comment: document.getElementById('edit-comment').value
    };

    // 保存処理
    const btn = document.getElementById('save-edit-btn');
    await sendRecord(updatedRecord, btn, 'update');
    editModal.classList.add('hidden');
});

// タイマー表示更新
function updateTimerDisplay() {
    const h = Math.floor(state.elapsedSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((state.elapsedSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (state.elapsedSeconds % 60).toString().padStart(2, '0');
    elements.timerElapsed.textContent = `${h}:${m}:${s}`;

    // 円形プログレスリングの更新
    updateTimerRing();
}

// 円形プログレスリングの初期化と更新
let timerRingInitialized = false;

function initTimerRing() {
    const bgGroup = document.getElementById('timer-ring-bg');
    const progressGroup = document.getElementById('timer-ring-progress');
    if (!bgGroup || !progressGroup || timerRingInitialized) return;

    bgGroup.innerHTML = '';
    progressGroup.innerHTML = '';

    // 60個のドットを配置（1秒ごと、1分で一周）
    for (let i = 0; i < 60; i++) {
        const angle = (i / 60) * 360 - 90; // 12時方向（-90度）から開始
        const rad = angle * (Math.PI / 180);
        const cx = 100 + 90 * Math.cos(rad);
        const cy = 100 + 90 * Math.sin(rad);

        // 背景ドット
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', cx);
        bgCircle.setAttribute('cy', cy);
        bgCircle.setAttribute('r', i % 5 === 0 ? 3 : 2); // 5秒ごとに少し大きく
        bgGroup.appendChild(bgCircle);

        // 進捗ドット（初期は非表示）
        const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        progressCircle.setAttribute('cx', cx);
        progressCircle.setAttribute('cy', cy);
        progressCircle.setAttribute('r', i % 5 === 0 ? 3 : 2);
        progressCircle.style.opacity = '0';
        progressCircle.dataset.index = i;
        progressGroup.appendChild(progressCircle);
    }

    timerRingInitialized = true;
}

function updateTimerRing() {
    const progressGroup = document.getElementById('timer-ring-progress');
    const head = document.getElementById('timer-ring-head');
    if (!progressGroup) return;

    // 初期化されていなければ初期化
    if (!timerRingInitialized) initTimerRing();

    // 現在の秒数を60で割った余り（0-59）
    const currentSecond = state.elapsedSeconds % 60;

    // 進捗ドットの更新
    const dots = progressGroup.querySelectorAll('circle');
    dots.forEach((dot, i) => {
        if (i <= currentSecond) {
            dot.style.opacity = '1';
        } else {
            dot.style.opacity = '0';
        }
    });

    // 現在位置の強調ドットを更新
    if (head) {
        const angle = (currentSecond / 60) * 360 - 90;
        const rad = angle * (Math.PI / 180);
        const cx = 100 + 90 * Math.cos(rad);
        const cy = 100 + 90 * Math.sin(rad);
        head.setAttribute('cx', cx);
        head.setAttribute('cy', cy);
        head.classList.add('active');
    }
}

function updateCurrentTimeDisplay() {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    const span = elements.currentTimeDisplay.querySelector('span');
    if (span) {
        span.textContent = timeStr;
    } else {
        elements.currentTimeDisplay.textContent = `現在時刻 ${timeStr}`;
    }
}

function updateSupportMessage() {
    const idx = Math.floor(Math.random() * supportMessages.length);
    elements.supportMessage.textContent = supportMessages[idx];
}

// 実行: 初期化シーケンスを集約
init();
loadRecordsFromGAS(); // GASから記録を非同期で読み込む
// updateHistoryUI や updateCharts は loadRecordsFromGAS 内で呼ばれる
