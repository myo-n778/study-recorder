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

// 本日の論理的な合計学習時間を取得
function getTodayTotalMinutes() {
    const logicalTodayStr = getLogicalDate(new Date());
    return getExpandedRecords(state.records)
        .filter(r => getBelongingDate(r.date, r.startTime) === logicalTodayStr)
        .reduce((sum, r) => sum + (parseInt(r.duration) || 0), 0);
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
        locations: [],
        supportMessages: []
    },
    sessionSupportMessages: [], // 今のタイマーセッション中だけ使い回すメッセージ
    accumulatedPausedMs: 0,
    lastPauseTime: null,
    messageInterval: 20000,
    supportMessageInterval: null,
    userName: '', // 永続化用のユーザー名
    lastSettings: {
        targetTime: '60',
        condition: '◯',
        comment: '',
        location: ''
    }
};

// 最後に使用した設定のキー
const LAST_SETTINGS_KEY = 'study_recorder_last_settings';

// 初期化時に論理的な「今日」を設定
state.viewDate = getLogicalDate();

let charts = {
    category: null,
    timeline: null
};

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyWZFMOnmx73_d_TyoG5dtUin2UFKgsUM8YWuwDEYtaaojKEaa7tP5r095Az_FIoTLjzA/exec';

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
    locationCandidatesPopup: document.getElementById('location-candidates-popup'),
    // Timer Layout Correction
    timerStage: document.getElementById('timer-stage'),
    timerRings: document.querySelector('.timer-rings')
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
    state.isInitializing = true;
    state.viewDate = getLogicalDate();

    // 1. 同期的な復元 (User, LocalSettings)
    loadUser();         // ユーザー名復元
    loadLocalRecords(); // 目標・テーマ復元 & updateUserDisplay実行

    // 2. UI基本設定
    setupEventListeners();
    setupPeriodSwitchers();
    setCurrentTimeInputs();
    updateViewDateUI();

    // 復元したユーザーに基づいた設定の読み込み
    const savedSettings = localStorage.getItem(LAST_SETTINGS_KEY);
    if (savedSettings) {
        state.lastSettings = JSON.parse(savedSettings);
        const targetTimeEl = document.getElementById('target-time');
        if (targetTimeEl) targetTimeEl.value = state.lastSettings.targetTime || '60';
        if (elements.conditionInput) elements.conditionInput.value = state.lastSettings.condition || '◯';
        if (elements.commentInput) elements.commentInput.value = state.lastSettings.comment || '';
        if (elements.locationInput) elements.locationInput.value = state.lastSettings.location || '';
    }

    // タイマー補正用イベント
    window.addEventListener('resize', adjustTimerPosition);
    window.addEventListener('orientationchange', () => setTimeout(adjustTimerPosition, 300));
    window.visualViewport?.addEventListener('resize', adjustTimerPosition);
    window.visualViewport?.addEventListener('scroll', adjustTimerPosition);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') adjustTimerPosition();
    });

    // 3. 非同期データ取得の前にセッション復元 (モバイルでの再開を最優先)
    resumeStudySession();

    setupMasterData();
    updateGoalDisplay();
    await loadRecordsFromGAS();

    state.isInitializing = false;

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

            // 修正: 学習中なら画面を自動表示し、オーバーレイを確実に消す
            if (elements.studyMode) {
                elements.studyMode.classList.remove('hidden');
                // オーバーレイと名前入力画面を強制的に非表示
                if (elements.overlay) elements.overlay.classList.add('hidden');
                if (elements.userSetup) elements.userSetup.classList.add('hidden');
            }
            // リロード復帰時も位置補正を実行
            setTimeout(adjustTimerPosition, 100);
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

    // リングアニメーションも開始
    startRingAnimation();
}

// 重複防止のためこの位置の updateSupportMessage は削除。末尾の定義を使用。

// ユーザー情報のロード
function loadUser() {
    const userName = localStorage.getItem(USER_KEY);
    if (!userName) {
        elements.userSetup.classList.remove('hidden');
        elements.overlay.classList.remove('hidden'); // 確実に見せる
        elements.overlay.style.opacity = '1';
    } else {
        state.userName = userName;
        updateUserDisplay();
        hideOverlay();
    }
}

// ユーザー名表示の更新（不具合防止のため関数化）
function updateUserDisplay() {
    const userName = state.userName || localStorage.getItem(USER_KEY);
    if (userName && elements.userDisplay) {
        elements.userDisplay.textContent = `User: ${userName}`;
        state.userName = userName;
    }
}

function hideOverlay() {
    elements.overlay.style.opacity = '0';
    setTimeout(() => elements.overlay.classList.add('hidden'), 500);
}

// 時刻・日付の初期値設定
function setCurrentTimeInputs() {
    const now = new Date();
    const endTimeStr = now.toTimeString().slice(0, 5);
    elements.endTimeInput.value = endTimeStr;

    // 開始時刻は1時間前をデフォルトに
    const earlier = new Date(now.getTime() - 60 * 60 * 1000);
    elements.startTimeInput.value = earlier.toTimeString().slice(0, 5);

    // 日付の初期値を今日に (YYYY-MM-DD形式)
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    elements.recordDateInput.value = `${yyyy}-${mm}-${dd}`;
}

// マスターデータのセットアップ (履歴 + GASのbaseシートから候補抽出)
function setupMasterData() {
    // ▼ボタン（datalist）: baseシートの共通マスタから取得
    // 履歴ボタン（ポップアップ）: 自分の記録から取得（showHistoryTypePopup内で処理）

    // 1. カテゴリー候補 (baseシートから取得)
    elements.categoryList.innerHTML = '';
    if (state.gasMasterData?.categories) {
        state.gasMasterData.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            elements.categoryList.appendChild(opt);
        });
    }

    // 2. 学習内容の候補更新 (baseシートから取得)
    const updateContentList = () => {
        elements.contentList.innerHTML = '';
        if (state.gasMasterData?.contents) {
            state.gasMasterData.contents.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item;
                elements.contentList.appendChild(opt);
            });
        }
    };

    // 3. 意気込みの候補更新 (baseシートから取得)
    const updateEnthusiasmList = () => {
        elements.enthusiasmList.innerHTML = '';
        if (state.gasMasterData?.enthusiasms && state.gasMasterData.enthusiasms.length > 0) {
            state.gasMasterData.enthusiasms.forEach(i => {
                const opt = document.createElement('option');
                opt.value = i;
                elements.enthusiasmList.appendChild(opt);
            });
        } else {
            // フォールバック
            ['集中して取り組む！', 'まずは15分頑張る', '復習をメインに'].forEach(i => {
                const opt = document.createElement('option');
                opt.value = i;
                elements.enthusiasmList.appendChild(opt);
            });
        }
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
            updateCommentSuggestions();
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

        // カテゴリー履歴ボタン
        const catBtn = document.getElementById('show-category-history-btn');
        const catPopup = document.getElementById('category-history-popup');
        if (catBtn && catPopup) {
            catBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!catPopup.classList.contains('hidden')) {
                    catPopup.classList.add('hidden');
                    return;
                }
                showHistoryTypePopup(catPopup, elements.categoryInput, 'category');
            });
            document.addEventListener('click', (e) => {
                if (!catBtn.contains(e.target) && !catPopup.contains(e.target)) {
                    catPopup.classList.add('hidden');
                }
            });
        }

        // 内容履歴ボタン
        const contentBtn = document.getElementById('show-content-history-btn');
        const contentPopup = document.getElementById('content-history-popup');
        if (contentBtn && contentPopup) {
            contentBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!contentPopup.classList.contains('hidden')) {
                    contentPopup.classList.add('hidden');
                    return;
                }
                showHistoryTypePopup(contentPopup, elements.contentInput, 'content');
            });
            document.addEventListener('click', (e) => {
                if (!contentBtn.contains(e.target) && !contentPopup.contains(e.target)) {
                    contentPopup.classList.add('hidden');
                }
            });
        }

        // メインコメント履歴ボタン
        const mainCommentBtn = document.getElementById('show-main-comment-history-btn');
        const mainCommentPopup = document.getElementById('main-comment-history-popup');
        if (mainCommentBtn && mainCommentPopup) {
            mainCommentBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!mainCommentPopup.classList.contains('hidden')) {
                    mainCommentPopup.classList.add('hidden');
                    return;
                }
                showHistoryTypePopup(mainCommentPopup, elements.commentInput, 'comment');
            });
            document.addEventListener('click', (e) => {
                if (!mainCommentBtn.contains(e.target) && !mainCommentPopup.contains(e.target)) {
                    mainCommentPopup.classList.add('hidden');
                }
            });
        }

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
                showHistoryTypePopup(historyPopup, document.getElementById('summary-comment'), 'comment');
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
                showHistoryTypePopup(summaryLocPopup, document.getElementById('summary-location'), 'location');
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
                showHistoryTypePopup(manualLocPopup, document.getElementById('location-input'), 'location');
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
    // ▼ボタン（datalist）: baseシートの共通マスタから取得
    elements.commentList.innerHTML = '';
    if (state.gasMasterData?.comments) {
        state.gasMasterData.comments.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            elements.commentList.appendChild(opt);
        });
    }
}

/**
 * 汎用的な履歴ポップアップ表示関数
 * プライバシーに配慮し、自分の記録(state.records)を最優先する
 */
function showHistoryTypePopup(popup, input, field) {
    const freq = {};
    const catVal = field === 'content' ? elements.categoryInput.value : null;

    // 自分の過去記録
    state.records.forEach(r => {
        const val = r[field];
        if (val) {
            // content の場合は現在のカテゴリに一致するもののみ
            if (field === 'content' && catVal && r.category !== catVal) return;
            freq[val] = (freq[val] || 0) + 1;
        }
    });

    const sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
    if (sorted.length === 0) return;

    popup.innerHTML = '';
    sorted.forEach(text => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.textContent = text;
        item.addEventListener('click', () => {
            input.value = text;
            popup.classList.add('hidden');
            input.focus();
            if (field === 'category') setupMasterData(); // カテゴリが変わったので内容候補を更新
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
            state.userName = name; // stateに即時反映
            updateUserDisplay();
            hideOverlay();
            loadRecordsFromGAS();
            alert(`User: ${name} として保存しました`);
        } else {
            alert('名前を入力してください');
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
    const minH = state.goals.minHours;
    const targetH = state.goals.targetHours;
    const format = (h) => `${h}h (${h * 60}min)`;

    if (elements.displayMinHours) elements.displayMinHours.textContent = format(minH);
    if (elements.displayTargetHours) elements.displayTargetHours.textContent = format(targetH);

    // 目標達成状況に応じたバッジの発光演出反映
    const totalTodayMinutes = getTodayTotalMinutes();
    const minGoalMin = minH * 60;
    const targetGoalMin = targetH * 60;

    if (elements.displayMinHours) {
        if (minGoalMin > 0 && totalTodayMinutes >= minGoalMin) {
            elements.displayMinHours.classList.add('achieved');
        } else {
            elements.displayMinHours.classList.remove('achieved');
        }
    }
    if (elements.displayTargetHours) {
        if (targetGoalMin > 0 && totalTodayMinutes >= targetGoalMin) {
            elements.displayTargetHours.classList.add('achieved');
        } else {
            elements.displayTargetHours.classList.remove('achieved');
        }
    }

    updateUserDisplay(); // ユーザー名保護を維持
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
async function startStudy() {
    const category = elements.categoryInput.value.trim();
    const content = elements.contentInput.value.trim();
    if (!category || !content) {
        alert('カテゴリーと内容を入力してください');
        return;
    }

    // 学習開始時に一度だけGASからマスタデータを取得し、応援メッセージを固定（一時キャッシュ）する
    try {
        await loadRecordsFromGAS();
        if (state.gasMasterData && state.gasMasterData.supportMessages && state.gasMasterData.supportMessages.length > 0) {
            // F列（supportMessages）が有効な場合、それをセッション用キャッシュに設定
            state.sessionSupportMessages = state.gasMasterData.supportMessages;
        } else {
            // 1つも無い場合は空にする（updateSupportMessage側でデフォルトへフォールバック）
            state.sessionSupportMessages = [];
        }
    } catch (e) {
        console.error("Failed to load support messages from GAS:", e);
        state.sessionSupportMessages = []; // 失敗時もフォールバック用に空にする
    }

    state.isStudying = true;
    state.startTime = new Date();

    state.elapsedSeconds = 0;
    state.isPaused = false;
    state.accumulatedPausedMs = 0;
    state.lastPauseTime = null;

    // リングの周回状態をリセット（初期塗りバグ防止）
    prevSecondLap = -1;
    prevMinuteLap = -1;
    prevHourLap = -1;
    timerRingsInitialized = false;

    // リングの不透明度をリセット
    ['ring-seconds-prev', 'ring-minutes-prev', 'ring-hours-prev'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.opacity = '0';
    });

    document.getElementById('study-current-category').textContent = category;
    document.getElementById('study-current-content').textContent = content;

    elements.studyMode.classList.remove('hidden');
    updateSupportMessage();
    saveStudyState();

    updateTimerDisplay();
    startTimerInterval();
    startSupportMessageInterval();

    // タイマー位置補正を実行
    setTimeout(adjustTimerPosition, 100);
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
        pauseBtn.textContent = 'Take a Break';
        pauseBtn.classList.remove('pulse');
        startTimerInterval();
    } else {
        // 中断
        state.isPaused = true;
        state.lastPauseTime = new Date(now);
        clearInterval(state.timerInterval);
        pauseBtn.textContent = 'Resume';
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
            location: elements.locationInput.value.trim(),
            theme: state.goals.theme || 'default'
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

    // 前回または現在の場所を自動入力 (現在の入力を優先、なければ最新の履歴から取得)
    const currentLocation = elements.locationInput.value.trim();
    const lastLocation = currentLocation || (state.records.length > 0 ? (state.records[state.records.length - 1].location || '') : '');
    document.getElementById('summary-location').value = lastLocation;

    // ① 2軸評価用データの準備 (A: 今回, B: 本日合計)
    const durationA = duration;
    // 修正: 共通関数を使用して本日合計を計算
    const durationB = getTodayTotalMinutes() + durationA;

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
        // 記録日は「開始時刻の日付」を基準に決定する（深夜跨ぎでも開始日を使用）
        date: state.startTime.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/-/g, '/'),
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

    // 設定を保存
    state.lastSettings = {
        targetTime: document.getElementById('target-time').value,
        condition: condition,
        comment: comment,
        location: location
    };
    localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(state.lastSettings));

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
    // ▼ボタン（datalist）: baseシートの共通マスタから取得
    elements.locationList.innerHTML = '';
    if (state.gasMasterData?.locations) {
        state.gasMasterData.locations.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l;
            elements.locationList.appendChild(opt);
        });
    }
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

    // 設定を保存
    state.lastSettings = {
        targetTime: document.getElementById('target-time').value,
        condition: condition,
        comment: comment,
        location: location
    };
    localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(state.lastSettings));

    saveLocalRecords();
    updateHistoryUI();
    updateCharts();
    updateCommentSuggestions();

    await sendRecord(record, elements.manualRecordBtn);
}

// レコード送信 (Create / Update / Delete) とリトライ処理
async function sendRecord(record, button = null, action = 'create') {
    let originalText = '';
    if (button) {
        originalText = button.textContent;
        button.textContent = '送信中...';
        button.disabled = true;
    }

    const dataToSend = { action: action, ...record };
    const params = new URLSearchParams();
    Object.keys(dataToSend).forEach(key => {
        if (dataToSend[key] !== null && dataToSend[key] !== undefined) {
            params.append(key, dataToSend[key]);
        }
    });

    const maxRetries = 3;
    let attempt = 0;
    let success = false;

    try {
        // GASの仕様上、リダイレクトが発生するため no-cors を使用し、成否判定はコンソールのみとします
        await fetch(GAS_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: params
        });

        console.log('送信完了(no-cors)');
        setTimeout(() => loadRecordsFromGAS(), 1500);
        success = true;
    } catch (error) {
        console.error('送信エラー:', error);
        alert('記録の送信に失敗しました。ネットワークを確認してください。');
    }

    if (button) {
        button.textContent = originalText;
        button.disabled = false;
    }
    return success;
}

function saveLocalRecords() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state.records));
    localStorage.setItem('study_recorder_goals', JSON.stringify(state.goals));
}

async function loadRecordsFromGAS() {
    if (state.isLoadingRecords) return;
    const userName = localStorage.getItem(USER_KEY);
    if (!userName) {
        console.warn('ユーザー名が設定されていないため、GASからの入力をスキップします。');
        return;
    }

    state.isLoadingRecords = true;
    try {
        const response = await fetch(`${GAS_URL}?userName=${encodeURIComponent(userName)}`, {
            cache: 'no-store'
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const result = await response.json();
        if (!result) throw new Error('Response is empty');

        // マスタデータの更新 (応援メッセージ等に使用)
        if (result.masterData) {
            state.gasMasterData = result.masterData;
        }

        const recordsData = result.records;
        if (Array.isArray(recordsData)) {
            state.records = recordsData.map(record => {
                let datePart = record.date;

                // ISOString（UTC）をローカル日付に変換
                if (datePart && typeof datePart === 'string' && datePart.includes('T')) {
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

                return {
                    ...record,
                    date: datePart || '',
                    startTime: formatTime(record.startTime),
                    endTime: formatTime(record.endTime)
                };
            });
            console.log(`GASから ${state.records.length} 件の記録を正常に読み込みました。`);
        }
    } catch (error) {
        console.error('GASからの記録読み込みに失敗しました:', error);
        // 失敗してもローカルの記録のみで動作を継続
    } finally {
        state.isLoadingRecords = false;
        updateHistoryUI();
        updateGoalDisplay();
        updateCharts();
        setupMasterData();
        updateLocationSuggestions();
        updateUserDisplay();
    }
}

// ② カテゴリ・学習内容の初期値（初期起動時かつ学習中でない場合のみセット）
if (!state.isStudying && state.records.length > 0 && !elements.categoryInput.value && !elements.contentInput.value) {
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
            const dots = document.querySelectorAll('.color-dot');
            dots.forEach(d => d.classList.remove('active'));
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
                            const h = (val / 60).toFixed(1);
                            const pct = totalDuration > 0 ? ((val / totalDuration) * 100).toFixed(1) : 0;
                            return `${context.label}: ${val}分（${h}h） (${pct}%)`;
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
                    intersect: false,
                    callbacks: {
                        label: (context) => {
                            const val = context.raw;
                            const h = (val / 60).toFixed(1);
                            return `${context.dataset.label}: ${val}分（${h}h）`;
                        }
                    }
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
                    intersect: false,
                    callbacks: {
                        label: (context) => {
                            const val = context.raw;
                            const h = (val / 60).toFixed(1);
                            return `${context.dataset.label}: ${val}分（${h}h）`;
                        }
                    }
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
            const mm = (d.getMonth() + 1).toString().padStart(2, '0');
            const dd = d.getDate().toString().padStart(2, '0');
            const label = `${mm}/${dd}`;
            allLabelsSet.add(label);
        }
    } else if (period === 'week') {
        for (let i = 11; i >= 0; i--) { // 直近12週
            const d = new Date(viewDate);
            d.setDate(viewDate.getDate() - i * 7);
            allLabelsSet.add(`W${getWeekNumber(d)}`);
        }
    } else if (period === 'month') {
        // 同一年の月を網羅
        for (let i = 0; i < 12; i++) {
            const label = `${(i + 1).toString().padStart(2, '0')}`;
            allLabelsSet.add(label);
        }
    }

    records.forEach(r => {
        // 所属日付で集計（0:00〜3:59は前日所属）
        const belongingDateStr = getBelongingDate(r.date, r.startTime);
        const date = new Date(belongingDateStr);
        let label = '';
        if (period === 'day') {
            const mm = (date.getMonth() + 1).toString().padStart(2, '0');
            const dd = date.getDate().toString().padStart(2, '0');
            label = `${mm}/${dd}`;
        }
        else if (period === 'week') label = `W${getWeekNumber(date)}`;
        else if (period === 'month') label = `${(date.getMonth() + 1).toString().padStart(2, '0')}`;
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
    console.log('setupCardEvents called, rec.id:', rec.id);

    // IDがなくても編集画面は開けるようにする（削除は不可）
    const recordId = rec.id || null;

    // PC: 右クリック
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        console.log('contextmenu triggered, id:', recordId);
        if (recordId) {
            showContextMenu(e.clientX, e.clientY, recordId);
        } else {
            alert('この記録にはIDがないため編集できません。');
        }
    });

    // Mobile: 長押し
    let touchTimer;
    card.addEventListener('touchstart', (e) => {
        touchTimer = setTimeout(() => {
            console.log('long press triggered, id:', recordId);
            if (recordId) {
                const touch = e.touches[0];
                showContextMenu(touch.clientX, touch.clientY, recordId);
            } else {
                alert('この記録にはIDがないため編集できません。');
            }
        }, 600);
    });

    card.addEventListener('touchend', () => {
        clearTimeout(touchTimer);
    });

    card.addEventListener('touchmove', () => {
        clearTimeout(touchTimer);
    });
}

function showContextMenu(x, y, id) {
    console.log('showContextMenu called, x:', x, 'y:', y, 'id:', id);
    contextMenuTargetId = id;

    // contextMenuがnullの場合は再取得
    let menu = contextMenu;
    if (!menu) {
        menu = document.getElementById('context-menu');
        console.log('context-menu re-fetched:', menu);
    }

    if (!menu) {
        console.error('context-menu element not found!');
        return;
    }

    // 画面内に収める（メニューのサイズを考慮）
    const menuWidth = 160;
    const menuHeight = 100;
    const maxX = window.innerWidth - menuWidth;
    const maxY = window.innerHeight - menuHeight;

    const finalX = Math.min(Math.max(0, x), maxX);
    const finalY = Math.min(Math.max(0, y), maxY);

    console.log('Final position: x:', finalX, 'y:', finalY);

    menu.style.left = `${finalX}px`;
    menu.style.top = `${finalY}px`;
    menu.classList.remove('hidden');
    console.log('context-menu should now be visible at', finalX, finalY);
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
    document.getElementById('edit-start-time').value = rec.startTime || '';
    document.getElementById('edit-end-time').value = rec.endTime || '';
    document.getElementById('edit-date').value = rec.date; // YYYY/MM/DD
    document.getElementById('edit-condition').value = rec.condition || '◯';
    document.getElementById('edit-location').value = rec.location || '';
    document.getElementById('edit-comment').value = rec.comment || '';

    // 学習時間を計算して表示
    updateEditDuration();

    editModal.classList.remove('hidden');
}

// 編集モーダルの学習時間を自動計算
function updateEditDuration() {
    const startTime = document.getElementById('edit-start-time').value;
    const endTime = document.getElementById('edit-end-time').value;

    if (startTime && endTime) {
        const [h1, m1] = startTime.split(':').map(Number);
        const [h2, m2] = endTime.split(':').map(Number);
        let duration = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (duration < 0) duration += 24 * 60; // 日を跨ぐ場合
        document.getElementById('edit-duration').value = `${duration} 分`;
    } else {
        document.getElementById('edit-duration').value = '';
    }
}

// 開始時刻・終了時刻変更時に学習時間を再計算
document.getElementById('edit-start-time').addEventListener('change', updateEditDuration);
document.getElementById('edit-end-time').addEventListener('change', updateEditDuration);

document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    editModal.classList.add('hidden');
});

document.getElementById('save-edit-btn').addEventListener('click', async () => {
    const id = document.getElementById('edit-id').value;
    const startTime = document.getElementById('edit-start-time').value;
    const endTime = document.getElementById('edit-end-time').value;

    // 学習時間を再計算
    let duration = 0;
    if (startTime && endTime) {
        const [h1, m1] = startTime.split(':').map(Number);
        const [h2, m2] = endTime.split(':').map(Number);
        duration = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (duration < 0) duration += 24 * 60;
    }

    const updatedRecord = {
        id: id,
        category: document.getElementById('edit-category').value,
        content: document.getElementById('edit-content').value,
        startTime: startTime,
        endTime: endTime,
        duration: duration,
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

// 編集モーダル用履歴ボタンのセットアップ
function setupEditHistoryButtons() {
    const historyConfig = [
        { btnId: 'edit-category-history-btn', popupId: 'edit-category-history-popup', inputId: 'edit-category', field: 'category' },
        { btnId: 'edit-content-history-btn', popupId: 'edit-content-history-popup', inputId: 'edit-content', field: 'content' },
        { btnId: 'edit-location-history-btn', popupId: 'edit-location-history-popup', inputId: 'edit-location', field: 'location' },
        { btnId: 'edit-comment-history-btn', popupId: 'edit-comment-history-popup', inputId: 'edit-comment', field: 'comment' }
    ];

    historyConfig.forEach(config => {
        const btn = document.getElementById(config.btnId);
        const popup = document.getElementById(config.popupId);
        const input = document.getElementById(config.inputId);

        if (btn && popup && input) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!popup.classList.contains('hidden')) {
                    popup.classList.add('hidden');
                    return;
                }
                showHistoryTypePopup(popup, input, config.field);
            });

            document.addEventListener('click', (e) => {
                if (!btn.contains(e.target) && !popup.contains(e.target)) {
                    popup.classList.add('hidden');
                }
            });
        }
    });
}

// 初期化時に履歴ボタンをセットアップ
setupEditHistoryButtons();


// タイマー表示更新（各桁を個別要素で更新し、レイアウト揺れを物理的にゼロにする）
function updateTimerDisplay() {
    const h = Math.floor(state.elapsedSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((state.elapsedSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (state.elapsedSeconds % 60).toString().padStart(2, '0');

    const theme = state.goals.theme || 'default';
    const themeColors = {
        'default': '#ff8c42',
        'orange': '#f97316',
        'green': '#22c55e',
        'cyan': '#06b6d4',
        'yellow': '#eab308',
        'blue': '#3b82f6',
        'red': '#ef4444',
        'white': '#f8fafc',
        'purple': '#a855f7',
        'pink': '#ec4899',
        'emerald': '#10b981'
    };
    const color = themeColors[theme] || themeColors['default'];

    // 目標達成度による発光強度の決定
    const totalTodayMinutes = getTodayTotalMinutes();
    const minGoalMinutes = (state.goals.minHours || 0) * 60;
    const targetGoalMinutes = (state.goals.targetHours || 0) * 60;

    let glowStyle = `0 0 15px ${color}cc, 0 0 30px ${color}66`;

    if (totalTodayMinutes >= targetGoalMinutes && targetGoalMinutes > 0) {
        // 最終目標達成：白抜きグローを削除し、テーマカラーの強発光のみに
        glowStyle = `0 0 20px ${color}, 0 0 40px ${color}, 0 0 60px ${color}`;
    } else if (totalTodayMinutes >= minGoalMinutes && minGoalMinutes > 0) {
        // 最小目標達成
        glowStyle = `0 0 10px ${color}, 0 0 25px ${color}`;
    }

    // 各桁の要素を取得して文字をセット（個別に更新することで全体のガタつきを防止）
    const digits = {
        't-h1': h[0], 't-h2': h[1],
        't-m1': m[0], 't-m2': m[1],
        't-s1': s[0], 't-s2': s[1]
    };

    for (const [id, value] of Object.entries(digits)) {
        const el = document.getElementById(id);
        if (el) {
            if (el.textContent !== value) {
                el.textContent = value;
            }
            // テーマカラーとグローをJSから強制
            el.style.color = color;
            el.style.textShadow = glowStyle;
        }
    }

    // コロンの色とグローも更新
    document.querySelectorAll('#timer-elapsed .t-colon').forEach(el => {
        el.style.color = color;
        el.style.textShadow = glowStyle;
    });

    // 達成スタンプを更新
    drawAchievementStamps();

    // 目標バッジ（ヘッダー）の発光状態もリアルタイム更新
    updateGoalDisplay();
}

/**
 * 達成スタンプ（⭐/🌟）の描画ロジック
 * 10分ごとにスタンプ増加。三角形(1,2,3...)配置が基本だが、
 * 60, 180, 360分到達時には🌟を表示して強制改行する。
 * 120, 240, 300分は改行しない。
 */
/**
 * 達成スタンプ（⭐/🌟）の描画ロジック（スマホ最適化版）
 * 10分ごとにスタンプ1つ分として計算するが、
 * 60分単位は常に🌟、それ以外は⭐として表示。
 * 120分（12スタンプ分）ごとに改行する等間隔配置。
 */
function drawAchievementStamps() {
    const area = document.getElementById('achievement-stamps-area');
    if (!area) return;

    const elapsedMinutes = Math.floor(state.elapsedSeconds / 60);
    const totalStampsCount = Math.floor(elapsedMinutes / 10);

    if (totalStampsCount === 0) {
        area.innerHTML = '';
        return;
    }

    const rows = [];
    let currentRow = [];

    for (let i = 1; i <= totalStampsCount; i++) {
        const minutes = i * 10;
        const is60Multiple = minutes % 60 === 0;
        const char = is60Multiple ? '🌟' : '⭐';

        currentRow.push({ char: char, isLarge: is60Multiple });

        // 120分（12個目）に達した時点、または最後の星の場合に行を確定
        // i=12 (120 min) までは同じ行、i=13 (130 min) から次の行
        if (i % 12 === 0 || i === totalStampsCount) {
            rows.push(currentRow);
            currentRow = [];
        }
    }

    // DOMに反映（変化がある場合のみ更新）
    const fragment = document.createDocumentFragment();
    rows.forEach(rowStamps => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'stamp-row';
        rowStamps.forEach(s => {
            const span = document.createElement('span');
            span.className = 'stamp-item' + (s.isLarge ? ' stamp-star-large' : '');
            span.textContent = s.char;
            rowDiv.appendChild(span);
        });
        fragment.appendChild(rowDiv);
    });

    const newHTML = Array.from(fragment.childNodes).map(node => node.outerHTML).join('');
    if (area.innerHTML !== newHTML) {
        area.innerHTML = newHTML;
    }
}

// 3重タイマーリングの初期化フラグ
let timerRingsInitialized = false;
let ringAnimationId = null;

// 周回カウント（塗り重ね用）
let prevSecondLap = -1;
let prevMinuteLap = -1;
let prevHourLap = -1;

// 各リングの色パレット（周回ごとにループ、差が明確に分かる色）
// 秒リング：オレンジ系（赤寄り→黄寄り→濃い→明るい→深い）
const secondColors = ['#ff5722', '#ff9800', '#e64a19', '#ffb74d', '#d84315'];
// 分リング：黄色系（レモン→ゴールド→アンバー→ライム→サフラン）
const minuteColors = ['#ffeb3b', '#ffc107', '#ff8f00', '#c0ca33', '#f57c00'];
// 24hリング：緑系（黄緑→エメラルド→青緑→ライム→ティール）
const hourColors = ['#8bc34a', '#00bfa5', '#26a69a', '#cddc39', '#009688'];

// 新しい半径（HTML対応：中央UIを避けて外側にオフセット）
const RADIUS_SECONDS = 240;
const RADIUS_MINUTES = 265;
const RADIUS_HOURS = 290;

// リングの円周を計算して初期化
function initTimerRings() {
    const ringSeconds = document.getElementById('ring-seconds');
    const ringMinutes = document.getElementById('ring-minutes');
    const ringHours = document.getElementById('ring-hours');
    const ringSecondsPrev = document.getElementById('ring-seconds-prev');
    const ringMinutesPrev = document.getElementById('ring-minutes-prev');
    const ringHoursPrev = document.getElementById('ring-hours-prev');

    if (!ringSeconds || !ringMinutes || !ringHours || timerRingsInitialized) return;

    // 各リングの半径から円周を計算
    const circumferenceSeconds = 2 * Math.PI * RADIUS_SECONDS;
    const circumferenceMinutes = 2 * Math.PI * RADIUS_MINUTES;
    const circumferenceHours = 2 * Math.PI * RADIUS_HOURS;

    // stroke-dasharrayを設定（円周全体）
    ringSeconds.style.strokeDasharray = circumferenceSeconds;
    ringMinutes.style.strokeDasharray = circumferenceMinutes;
    ringHours.style.strokeDasharray = circumferenceHours;

    // 初期状態（進捗なし = 全てオフセット）
    ringSeconds.style.strokeDashoffset = circumferenceSeconds;
    ringMinutes.style.strokeDashoffset = circumferenceMinutes;
    ringHours.style.strokeDashoffset = circumferenceHours;

    // 前周リングも同様に初期化（満タン固定）
    if (ringSecondsPrev && ringMinutesPrev && ringHoursPrev) {
        ringSecondsPrev.style.strokeDasharray = circumferenceSeconds;
        ringMinutesPrev.style.strokeDasharray = circumferenceMinutes;
        ringHoursPrev.style.strokeDasharray = circumferenceHours;
        ringSecondsPrev.style.strokeDashoffset = 0; // 満タン
        ringMinutesPrev.style.strokeDashoffset = 0;
        ringHoursPrev.style.strokeDashoffset = 0;
    }

    timerRingsInitialized = true;
}

// 3重リングの滑らかな更新（requestAnimationFrameベース、塗り重ね方式）
function updateTimerRingsSmoothly() {
    const ringSeconds = document.getElementById('ring-seconds');
    const ringMinutes = document.getElementById('ring-minutes');
    const ringHours = document.getElementById('ring-hours');
    const ringSecondsPrev = document.getElementById('ring-seconds-prev');
    const ringMinutesPrev = document.getElementById('ring-minutes-prev');
    const ringHoursPrev = document.getElementById('ring-hours-prev');

    if (!ringSeconds || !ringMinutes || !ringHours) return;

    // 初期化されていなければ初期化
    if (!timerRingsInitialized) initTimerRings();

    // ミリ秒精度で経過時間を計算（カクつき防止）
    const now = Date.now();
    let elapsedMs = 0;
    if (state.isStudying && state.startTime) {
        elapsedMs = now - state.startTime.getTime() - state.accumulatedPausedMs;
        if (state.isPaused && state.lastPauseTime) {
            elapsedMs -= (now - state.lastPauseTime.getTime());
        }
    }
    elapsedMs = Math.max(0, elapsedMs);

    // ミリ秒から各単位の進捗を連続的に計算
    const msPerMinute = 60 * 1000;
    const msPerHour = 60 * msPerMinute;
    const msPerDay = 24 * msPerHour;

    // 周回数を計算（塗り重ね用）
    const secondLap = Math.floor(elapsedMs / msPerMinute);
    const minuteLap = Math.floor(elapsedMs / msPerHour);
    const hourLap = Math.floor(elapsedMs / msPerDay);

    // 周回が変わったら：前周リングに前の色を設定して表示、現在リングに次の色を設定
    if (secondLap !== prevSecondLap) {
        if (prevSecondLap >= 0 && ringSecondsPrev) {
            // 前周の色を前周リングに設定して表示
            const prevColorIndex = prevSecondLap % secondColors.length;
            ringSecondsPrev.style.stroke = secondColors[prevColorIndex];
            ringSecondsPrev.style.opacity = '1';
        }
        prevSecondLap = secondLap;
        // 現在リングに次の色を設定
        const colorIndex = secondLap % secondColors.length;
        ringSeconds.style.stroke = secondColors[colorIndex];
    }
    if (minuteLap !== prevMinuteLap) {
        if (prevMinuteLap >= 0 && ringMinutesPrev) {
            const prevColorIndex = prevMinuteLap % minuteColors.length;
            ringMinutesPrev.style.stroke = minuteColors[prevColorIndex];
            ringMinutesPrev.style.opacity = '1';
        }
        prevMinuteLap = minuteLap;
        const colorIndex = minuteLap % minuteColors.length;
        ringMinutes.style.stroke = minuteColors[colorIndex];
    }
    if (hourLap !== prevHourLap) {
        if (prevHourLap >= 0 && ringHoursPrev) {
            const prevColorIndex = prevHourLap % hourColors.length;
            ringHoursPrev.style.stroke = hourColors[prevColorIndex];
            ringHoursPrev.style.opacity = '1';
        }
        prevHourLap = hourLap;
        const colorIndex = hourLap % hourColors.length;
        ringHours.style.stroke = hourColors[colorIndex];
    }

    // 進捗を計算（0→100%で塗り増え）
    const secondProgress = (elapsedMs % msPerMinute) / msPerMinute;
    const minuteProgress = (elapsedMs % msPerHour) / msPerHour;
    const hourProgress = (elapsedMs % msPerDay) / msPerDay;

    // 各リングの円周
    const circumferenceSeconds = 2 * Math.PI * RADIUS_SECONDS;
    const circumferenceMinutes = 2 * Math.PI * RADIUS_MINUTES;
    const circumferenceHours = 2 * Math.PI * RADIUS_HOURS;

    // stroke-dashoffsetを更新（進捗に応じてオフセットを減らす = 0から塗り増え）
    ringSeconds.style.strokeDashoffset = circumferenceSeconds * (1 - secondProgress);
    ringMinutes.style.strokeDashoffset = circumferenceMinutes * (1 - minuteProgress);
    ringHours.style.strokeDashoffset = circumferenceHours * (1 - hourProgress);

    // 学習中であれば次フレームも更新
    if (state.isStudying && !state.isPaused) {
        ringAnimationId = requestAnimationFrame(updateTimerRingsSmoothly);
    }
}

// リングアニメーションの開始
function startRingAnimation() {
    if (ringAnimationId) cancelAnimationFrame(ringAnimationId);
    ringAnimationId = requestAnimationFrame(updateTimerRingsSmoothly);
}

// リングアニメーションの停止
function stopRingAnimation() {
    if (ringAnimationId) {
        cancelAnimationFrame(ringAnimationId);
        ringAnimationId = null;
    }
}

function updateCurrentTimeDisplay() {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    const span = elements.currentTimeDisplay.querySelector('span');

    // タイマー画面の現在時刻は常に水色（#00e5ff）グローに固定
    const color = '#00e5ff';

    if (span) {
        span.textContent = timeStr;
        // JSからスタイルを強制適用
        span.style.fontFamily = "'Orbitron', monospace";
        span.style.fontStyle = "italic";
        span.style.fontWeight = "700";
        span.style.color = color;
        span.style.textShadow = `0 0 10px ${color}99, 0 0 20px ${color}4d`;
        span.style.fontVariantNumeric = "tabular-nums";
        span.style.fontFeatureSettings = '"tnum"';
    } else {
        elements.currentTimeDisplay.textContent = `現在時刻 ${timeStr}`;
    }
}

function updateSupportMessage() {
    const messages = (state.gasMasterData && state.gasMasterData.supportMessages && state.gasMasterData.supportMessages.length > 0)
        ? state.gasMasterData.supportMessages
        : supportMessages;

    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    const msgEl = document.getElementById('support-message');
    const container = msgEl?.parentElement;

    if (msgEl && container) {
        msgEl.style.opacity = '0';

        setTimeout(() => {
            msgEl.textContent = randomMsg;
            let fontSize = 1.1;
            msgEl.style.fontSize = fontSize + 'rem';

            // 利用可能な高さを正確に取得（paddingを除く）
            const computedStyle = window.getComputedStyle(container);
            const padding = parseFloat(computedStyle.paddingTop) + parseFloat(computedStyle.paddingBottom);
            const availableHeight = container.clientHeight - padding;

            // 2行に収まるまで（または最小サイズ 0.6rem まで）フォントサイズを縮小
            // scrollHeight と offsetHeight 両方でチェックして確実に収める
            let attempts = 0;
            while ((msgEl.scrollHeight > availableHeight || msgEl.offsetHeight > availableHeight) && fontSize > 0.6 && attempts < 40) {
                fontSize -= 0.02;
                msgEl.style.fontSize = fontSize + 'rem';
                attempts++;
            }

            msgEl.style.opacity = '1';
        }, 400);
    }
}

/**
 * タイマー画面の位置補正
 * リングの上端が安全領域（safe-area-inset-top）に収まるように translateY を調整する
 */
function adjustTimerPosition() {
    if (!state.isStudying || elements.studyMode.classList.contains('hidden')) return;

    const stage = elements.timerStage;
    const rings = elements.timerRings;
    if (!stage || !rings) return;

    // 1. 正確な計測のため、一時的にアニメーションをオフにする
    const originalTransition = stage.style.transition;
    stage.style.transition = 'none';
    stage.style.transform = 'translateY(0)';

    // 強制リフロー（現在の位置をブラウザに確定させる）
    stage.offsetHeight;

    // 2. リングの現在位置を取得
    const ringRect = rings.getBoundingClientRect();

    // 3. 安全領域の取得
    const overlayStyle = window.getComputedStyle(elements.studyMode);
    const safeTopStr = overlayStyle.getPropertyValue('--safe-top') || '0px';
    const safeTop = parseFloat(safeTopStr.replace('px', '')) || 0;

    // 上部の余白（安全領域 + ブラウザバー回避用の 40px）
    const safetyBoundary = safeTop + 40;

    // 4. スライド量の計算（リング天頂を基準）
    const scale = ringRect.width / 600;
    const actualRingTop = ringRect.top + (10 * scale);

    if (actualRingTop < safetyBoundary) {
        const delta = safetyBoundary - actualRingTop;
        stage.style.transform = `translateY(${delta}px)`;
    }

    // 5. アニメーションを元に戻す
    requestAnimationFrame(() => {
        stage.style.transition = originalTransition;
    });
}

// 実行: 初期化シーケンスを集約
init();
