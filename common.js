      const firebaseConfig = {
        apiKey: "AIzaSyB7WyB8qLVOtpYWDrTUyVi6q1f1MPmIEqI",
        authDomain: "tokuyou-portal.firebaseapp.com",
        projectId: "tokuyou-portal",
        storageBucket: "tokuyou-portal.firebasestorage.app",
        messagingSenderId: "628140097543",
        appId: "1:628140097543:web:03f3cf9ef15a767dbdaaa2",
      };

      const VAPID_PUBLIC_KEY = "YOUR_PUBLIC_VAPID_KEY";
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const db = firebase.firestore();
      let storage = null;
      try { if(typeof firebase.storage === "function") storage = firebase.storage(); } catch(e) { console.warn("添付機能を初期化できません",e); }
      let messaging = null;
      try { if (typeof firebase.messaging === 'function') messaging = firebase.messaging(); }
      catch (e) { console.warn('通知は無効ですがポータルは利用できます', e); }

      const ROOMS = {
        care2: "2階介護",
        care3: "3階介護",
        nurse: "看護",
        rehab: "リハビリ",
        nutrition: "栄養",
        office: "事務",
        consult: "相談課",
        director: "施設長",
        chief: "所長",
        leaders: "役職者",
      };
      const DEPT_ROOM = {
        "2階介護": "care2",
        "3階介護": "care3",
        "介護": "care2",
        "看護": "nurse",
        "リハビリ": "rehab",
        "栄養": "nutrition",
        "事務": "office",
        "相談課": "consult",
        "施設長": "director",
        "所長": "chief",
      };
      const SURVEY_TYPES = {
        text: "記述式",
        yesno: "はい・いいえ",
        rating5: "5段階評価",
        rating10: "10段階評価",
        single: "単一選択",
        multi: "複数選択",
        dropdown: "プルダウン",
        date: "日付",
        number: "数値入力",
      };

      let staffCache = [];
      let activeRoom = "";
      let activeSurveyId = "";
      let activeSurveyData = null;
      let svQuestions = [];
      let watchers = [];
      let charts = {};
      let editingSurveyId = "";
      let surveyResultCurrent = null;
      let surveyDraftTimer = null;
      let boardDraftTimer = null;
      let swReg = null;
      let deferredPrompt = null;
      let facilityCalendarDocId = "";
      let facilityCalendarItems = [];
      const DATA_RETENTION_DAYS = 10;
      const ROOM_VISIBLE_LIMIT = 100;

      const $ = (id) => document.getElementById(id);
      const esc = (s) =>
        String(s ?? "").replace(
          /[&<>"']/g,
          (m) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[m],
        );
      let portalUser = null;
      const me = () => {
        if (portalUser) return portalUser;
        try { return JSON.parse(localStorage.getItem('ku_user') || 'null'); }
        catch (_) { return null; }
      };
      const saveMe = (u) => { portalUser = u; localStorage.setItem('ku_user', JSON.stringify(u)); };
      const admin = () => me()?.role === "admin";
      const sharedEditor = () => me()?.role === "sharedEditor";
      const canAccessAdminTab = () => admin() || sharedEditor();
      const canPostBoard = () => admin() || sharedEditor();
      const canEditFacilityCalendar = () => admin() || sharedEditor();
      const roleLabel = (role) =>
        role === "admin" ? "管理者" : role === "sharedEditor" ? "共有権限者" : "スタッフ";
      function targetDeptLabel(t) {
        if (Array.isArray(t)) return t.map(targetDeptLabel).join("・");
        if (!t || t === "all") return "全部署";
        if (t === "__admin__") return "管理者";
        if (t === "__sharedEditor__") return "共有権限者";
        return t;
      }
      function isBoardVisibleNow(a, now = Date.now()) {
        if (!a) return false;
        const s = a.publishFrom ? new Date(a.publishFrom + "T00:00:00").getTime() : 0;
        const e = a.publishUntil ? localDateEnd(a.publishUntil) : 0;
        if (s && now < s) return false;
        if (e && now > e) return false;
        return true;
      }
      const uid = (p = "id") =>
        `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const parseJSON = (v, d = []) => {
        try {
          const x = typeof v === "string" ? JSON.parse(v || "[]") : v;
          return x ?? d;
        } catch (e) {
          return d;
        }
      };
      function ms(v) {
        if (typeof v === "number") return v;
        if (v?.toDate) return v.toDate().getTime();
        if (v) return new Date(v).getTime();
        return 0;
      }
      function fmt(v) {
        const d = v?.toDate ? v.toDate() : new Date(v);
        if (!d || isNaN(d)) return "";
        const diff = Date.now() - d.getTime();
        if (diff < 6e4) return "たった今";
        if (diff < 36e5) return Math.floor(diff / 6e4) + "分前";
        if (diff < 864e5) return Math.floor(diff / 36e5) + "時間前";
        return d.toLocaleString("ja-JP", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      function todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      function toast(msg, type = "info") {
        const el = document.createElement("div");
        el.className = "toast";
        el.style.borderLeftColor =
          type === "error"
            ? "var(--dan)"
            : type === "ok"
              ? "var(--sec)"
              : "var(--pri)";
        el.innerHTML = `<i class="fas fa-${type === "error" ? "circle-exclamation" : type === "ok" ? "circle-check" : "circle-info"}"></i><div>${esc(msg)}</div>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3200);
      }
      function calcMedian(arr) {
        if (!arr.length) return 0;
        const a = [...arr].sort((x, y) => x - y);
        const m = Math.floor(a.length / 2);
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
      }
      const avg = (arr) =>
        arr.length
          ? arr.reduce((s, v) => s + Number(v || 0), 0) / arr.length
          : 0;
      const fmtNum = (n) => (Number.isFinite(n) ? Number(n).toFixed(1) : "-");
      const draftKey = (surveyId, userId) =>
        `surveyDraft_${surveyId}_${userId}`;
      const boardDraftKey = (userId = me()?.id || "guest") =>
        `ku_board_draft_${userId}`;
      const boardReadKey = (boardId, userId = me()?.id || "guest") =>
        `ku_board_read_${userId}_${boardId}`;
      const surveySeenKey = (surveyId, userId = me()?.id || "guest") =>
        `ku_survey_seen_${userId}_${surveyId}`;
      const roomReadKey = (roomId, userId = me()?.id || "guest") =>
        `ku_room_read_${userId}_${roomId}`;
      const myLinksKey = (userId = me()?.id || "guest") =>
        `ku_my_links_${userId}`;
      function isBoardRead(board, user = me()) {
        if (!user || !board) return true;
        if (board.creatorId === user.id) return true;
        return localStorage.getItem(boardReadKey(board.docId, user.id)) === "1";
      }
      function markBoardRead(boardId, silent = false) {
        localStorage.setItem(boardReadKey(boardId), "1");
        if (!silent) toast("掲示板を確認済みにしました", "ok");
        refreshBoardFromHome();
      }
      function isSurveySeen(survey, user = me(), responses = []) {
        if (!user || !survey) return true;
        if (survey.creatorId === user.id) return true;
        if (hasUserAnsweredSurvey(survey, user, responses)) return true;
        return localStorage.getItem(surveySeenKey(survey.docId, user.id)) === "1";
      }
      function markSurveySeen(surveyId, silent = true) {
        localStorage.setItem(surveySeenKey(surveyId), "1");
        if (!silent) toast("アンケートを確認済みにしました", "ok");
        const card=$('survey-'+surveyId);
        card?.querySelectorAll('[data-survey-new],[data-survey-confirm]').forEach(el=>el.remove());
        if(card)setTabAlert('survey',!!$('surveyList').querySelector('[data-survey-new]'));
      }
      function getRoomReadMs(roomId, userId = me()?.id || "guest") {
        return Number(localStorage.getItem(roomReadKey(roomId, userId)) || 0);
      }
      function setRoomReadMs(roomId, value = Date.now(), userId = me()?.id || "guest") {
        localStorage.setItem(roomReadKey(roomId, userId), String(value || Date.now()));
      }
      function canDeleteRoomMessage(msg, user = me()) {
        return !!user && !!msg && (admin() || msg.userId === user.id);
      }
      function syncPermissionUI() {
        const u = me();
        if ($("meRole") && u) {
          $("meRole").textContent = `${roleLabel(u.role)} / ${u.department || "未設定"}`;
        }
        if ($("editorTab")) {
          $("editorTab").classList.toggle("hide", !canAccessAdminTab());
        }
        if ($("adminTab")) {
          $("adminTab").classList.toggle("hide", !admin());
          $("adminTab").innerHTML = `<i class="fas fa-user-shield"></i> 管理者`;
        }
        if ($("addBoardBtn")) $("addBoardBtn").classList.toggle("hide", !canPostBoard());
        if ($("editorBoardBtn")) $("editorBoardBtn").classList.toggle("hide", !canPostBoard());
        if ($("editorCalendarBtn")) $("editorCalendarBtn").classList.toggle("hide", !canEditFacilityCalendar());
        if ($("editorRoleInfo")) {
          $("editorRoleInfo").textContent = admin()
            ? "管理者として掲示板投稿・月間予定編集・管理機能を利用できます"
            : "共有権限者として掲示板投稿と月間施設予定の更新ができます";
        }
        const staffBtn = document.querySelector('.adminSubtab[data-pane="staff"]');
        const otherBtn = document.querySelector('.adminSubtab[data-pane="other"]');
        if (staffBtn) staffBtn.classList.toggle("hide", !admin());
        if (otherBtn) otherBtn.classList.toggle("hide", !admin());
        if ($("addStaffBtn")) $("addStaffBtn").classList.toggle("hide", !admin());
        if ($("facilityEditorHint")) {
          $("facilityEditorHint").textContent = admin()
            ? "管理者と共有権限者が編集できます"
            : "共有権限者として月間予定の追加・保存ができます";
        }
        if ($("boardModalHint")) {
          $("boardModalHint").textContent = canPostBoard()
            ? "タイトル・本文・優先度・URLは自動で下書き保存されます"
            : "このアカウントでは掲示板投稿はできません";
        }
      }
      function getMyLinks() {
        return parseJSON(localStorage.getItem(myLinksKey()), []);
      }
      function saveMyLinks(links) {
        localStorage.setItem(myLinksKey(), JSON.stringify((links || []).slice(0, 8)));
      }
      function addMyLink() {
        const label = prompt("リンク名");
        if (!label) return;
        const url = prompt("URL", "https://");
        if (!url) return;
        const links = getMyLinks();
        links.push({ label: label.trim(), url: url.trim() });
        saveMyLinks(links);
        renderQuickLinks();
        toast("マイリンクを追加しました", "ok");
      }
      function editMyLink(index) {
        const links = getMyLinks();
        const item = links[index];
        if (!item) return;
        const label = prompt("リンク名", item.label || "");
        if (!label) return;
        const url = prompt("URL", item.url || "https://");
        if (!url) return;
        links[index] = { label: label.trim(), url: url.trim() };
        saveMyLinks(links);
        renderQuickLinks();
        toast("マイリンクを更新しました", "ok");
      }
      function removeMyLink(index) {
        const links = getMyLinks();
        if (!links[index]) return;
        if (!confirm("このマイリンクを削除しますか？")) return;
        links.splice(index, 1);
        saveMyLinks(links);
        renderQuickLinks();
        toast("マイリンクを削除しました", "ok");
      }
      function seedSampleLinks() {
        saveMyLinks([
          { label: "シフト表", url: "https://example.com/shift" },
          { label: "勤怠", url: "https://example.com/time" },
          { label: "介護記録", url: "https://example.com/record" },
        ]);
        renderQuickLinks();
        toast("サンプルのマイリンクを入れました。必要に応じて編集してください", "ok");
      }
      function openInternalTarget(target, payload = "") {
        const tabMap = {
          dashboard: '.tab[data-id="dashboard"]',
          survey: '.tab[data-id="survey"]',
          rooms: '.tab[data-id="rooms"]',
          profile: '.tab[data-id="profile"]',
        };
        const btn = document.querySelector(tabMap[target] || tabMap.dashboard);
        if (target === "directory") {
          showTab("profile", btn || document.querySelector(tabMap.profile));
          setTimeout(() => {
            if ($("directoryKeyword")) $("directoryKeyword").value = payload || "";
            renderMiniDirectory();
          }, 160);
          return;
        }
        showTab(target, btn);
      }
      function renderMiniDirectory(users = staffCache) {
        const listData = Array.isArray(users) && users.length ? users : staffCache;
        const q = String($("directoryKeyword")?.value || "").trim().toLowerCase();
        const dept = $("directoryDeptFilter")?.value || "all";
        const filtered = (listData || []).filter((u) => {
          if (dept !== "all" && (u.department || "") !== dept) return false;
          if (!q) return true;
          return [u.name, u.department, u.extension, u.note, u.role]
            .join(" ")
            .toLowerCase()
            .includes(q);
        });
        if ($("directoryCount")) $("directoryCount").textContent = `${filtered.length}件`;
        if (!$("miniDirectoryList")) return;
        $("miniDirectoryList").innerHTML = filtered.length
          ? filtered
              .sort((a, b) => String(a.department || "").localeCompare(String(b.department || "")) || String(a.name || "").localeCompare(String(b.name || ""), "ja"))
              .map((u) => `<div class="personCard"><div class="itemTop"><div><div class="title">${esc(u.name || "")}</div><div class="meta"><span>${esc(u.department || "")}</span><span>${roleLabel(u.role)}</span>${u.extension ? `<span>内線 ${esc(u.extension)}</span>` : ""}</div></div></div>${u.note ? `<div style="margin-top:8px" class="tiny">${esc(u.note)}</div>` : ""}</div>`)
              .join("")
          : '<div class="empty">該当する職員がいません</div>';
      }
      function monthStr(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      }
      function parseMonthInfo(month) {
        const [y, m] = String(month || monthStr()).split("-").map(Number);
        return { y, m, first: new Date(y, m - 1, 1), lastDate: new Date(y, m, 0).getDate() };
      }
      function normalizeFacilityItems(items = [], month = monthStr()) {
        return (items || [])
          .filter((x) => x && x.date && x.text)
          .filter((x) => String(x.date).startsWith(month))
          .sort((a, b) => String(a.date).localeCompare(String(b.date), "ja"));
      }
      const facilityCalendarData = {};
      function renderFacilityCalendarGrid(targetId, month, items = []) {
        const el = $(targetId);
        if (!el) return;
        facilityCalendarData[targetId] = { month, items };
        const { y, m, first, lastDate } = parseMonthInfo(month);
        const weekLabels = ["日", "月", "火", "水", "木", "金", "土"];
        const byDate = new Map();
        normalizeFacilityItems(items, month).forEach((x) => {
          const key = String(x.date);
          if (!byDate.has(key)) byDate.set(key, []);
          byDate.get(key).push(x.text);
        });
        const blanks = first.getDay();
        const cells = [];
        for (let i = 0; i < blanks; i++) cells.push('<div class="calendarCell muted"></div>');
        for (let d = 1; d <= lastDate; d++) {
          const date = `${month}-${String(d).padStart(2, "0")}`;
          const entries = byDate.get(date) || [];
          cells.push(`<div class="calendarCell clickable" onclick="openCalendarDay('${targetId}','${date}')"><div class="calendarDay">${m}/${d}</div>${entries.length ? entries.map((t) => `<div class="calendarEvent">${esc(t)}</div>`).join("") : '<div class="tiny">予定なし</div>'}</div>`);
        }
        el.innerHTML = `<div class="calendarGrid">${weekLabels.map((w) => `<div class="calendarWeek">${w}</div>`).join("")}${cells.join("")}</div>`;
      }
      function renderFacilityEventEditor() {
        const el = $("facilityEventList");
        if (!el) return;
        const month = $("facilityMonthAdmin")?.value || monthStr();
        const items = normalizeFacilityItems(facilityCalendarItems, month);
        el.innerHTML = items.length
          ? items.map((x, i) => `<div class="calendarEditorItem"><div><div class="title">${esc(x.date)}</div><div class="tiny">${esc(x.text)}</div></div><button class="btn dan sm" onclick="removeFacilityEvent(${i})"><i class="fas fa-trash"></i> 削除</button></div>`).join("")
          : '<div class="empty">この月の予定はまだありません</div>';
        renderFacilityCalendarGrid("facilityCalendarAdminPreview", month, items);
      }
      async function loadFacilityCalendar(settings = null) {
        const month = $("facilityMonthView")?.value || monthStr();
        const all = settings || await loadSettingsCached();
        if(month !== ($("facilityMonthView")?.value || monthStr()))return;
        const row = all.find((x) => x.type === "facilityCalendar" && x.month === month);
        renderFacilityCalendarGrid("facilityCalendar", month, parseJSON(row?.items, []));
      }
      async function loadFacilityCalendarAdmin(settings = null) {
        if (!canEditFacilityCalendar()) return;
        const month = $("facilityMonthAdmin")?.value || monthStr();
        const all = settings || await list("settings");
        const row = all.find((x) => x.type === "facilityCalendar" && x.month === month);
        facilityCalendarDocId = row?.docId || "";
        facilityCalendarItems = normalizeFacilityItems(parseJSON(row?.items, []), month);
        if ($("facilityDate")) $("facilityDate").value = `${month}-01`;
        if ($("facilityText")) $("facilityText").value = "";
        renderFacilityEventEditor();
      }
      function addFacilityEvent() {
        if (!canEditFacilityCalendar()) return;
        const month = $("facilityMonthAdmin")?.value || monthStr();
        const date = $("facilityDate")?.value;
        const text = $("facilityText")?.value.trim();
        if (!date || !text) return toast("日付と予定内容を入力してください", "error");
        if (!String(date).startsWith(month)) return toast("選択中の月と同じ日付を指定してください", "error");
        facilityCalendarItems.push({ date, text });
        facilityCalendarItems = normalizeFacilityItems(facilityCalendarItems, month);
        $("facilityText").value = "";
        renderFacilityEventEditor();
      }
      function removeFacilityEvent(index) {
        if (!canEditFacilityCalendar()) return;
        facilityCalendarItems.splice(index, 1);
        renderFacilityEventEditor();
      }
      async function saveFacilityCalendar() {
        if (!canEditFacilityCalendar()) return;
        const month = $("facilityMonthAdmin")?.value || monthStr();
        const payload = { type: "facilityCalendar", month, items: facilityCalendarItems };
        if (facilityCalendarDocId) await upd("settings", facilityCalendarDocId, payload);
        else facilityCalendarDocId = await add("settings", payload);
        toast("月間施設予定を保存しました", "ok");
        const settings=await loadSettingsCached(true);
        await Promise.all([loadFacilityCalendarAdmin(settings),loadFacilityCalendar(settings)]);
      }
      async function runGlobalSearch(forceWord = "") {
        const input = $("globalSearch");
        const word = String(forceWord || input?.value || "").trim().toLowerCase();
        if (input && forceWord) input.value = forceWord;
        if (!$("searchResult")) return;
        if (!word) {
          $("searchResult").innerHTML = "";
          return;
        }
        $("searchResult").innerHTML = '<div class="tiny">検索中...</div>';
        const u = me();
        const [anns, surveys, users] = await Promise.all([
          loadPublishedBoards(),
          list("surveys"),
          list("users"),
        ]);
        const boardHits = anns
          .filter((a) => [a.title, a.content, a.creatorName].join(" ").toLowerCase().includes(word))
          .slice(0, 5);
        const surveyHits = surveys
          .filter((s) => canUserSeeSurvey(s, u) && [s.title, s.desc, s.creatorName].join(" ").toLowerCase().includes(word))
          .slice(0, 5);
        const peopleHits = users
          .filter((x) => [x.name, x.department, x.extension, x.note].join(" ").toLowerCase().includes(word))
          .slice(0, 5);
        const roomHits = Object.entries(ROOMS).filter(([key])=>canUseRoom(key))
          .filter(([, label]) => label.toLowerCase().includes(word))
          .slice(0, 5);
        const blocks = [];
        boardHits.forEach((a) => blocks.push(`<div class="searchHit"><div class="itemTop"><div><div class="title">掲示板: ${esc(a.title || "")}</div><div class="tiny">${esc(a.creatorName || "")} / ${fmt(a.createdAt)}</div></div><button class="btn out sm" onclick="showTab('dashboard',document.querySelector('.tab[data-id=\"dashboard\"]'));setTimeout(()=>highlightBoard('${a.docId}'),180)"><i class="fas fa-arrow-right"></i> 開く</button></div></div>`));
        surveyHits.forEach((s) => blocks.push(`<div class="searchHit"><div class="itemTop"><div><div class="title">アンケート: ${esc(s.title || "")}</div><div class="tiny">${esc(targetDeptLabel(s.targetDept))} / ${esc(s.creatorName || "")}</div></div><button class="btn out sm" onclick="showTab('survey',document.querySelector('.tab[data-id=\"survey\"]'));setTimeout(()=>highlightSurvey('${s.docId}'),180)"><i class="fas fa-arrow-right"></i> 開く</button></div></div>`));
        peopleHits.forEach((x) => blocks.push(`<div class="searchHit"><div class="itemTop"><div><div class="title">職員: ${esc(x.name || "")}</div><div class="tiny">${esc(x.department || "")} ${x.extension ? '/ 内線 ' + esc(x.extension) : ''}</div></div><button class="btn out sm" onclick="openInternalTarget('directory','${esc(x.name || "")}')"><i class="fas fa-address-book"></i> 名簿で見る</button></div></div>`));
        roomHits.forEach(([key, label]) => blocks.push(`<div class="searchHit"><div class="itemTop"><div><div class="title">ルーム: ${esc(label)}</div><div class="tiny">チャットルーム</div></div><button class="btn out sm" onclick="showTab('rooms',document.querySelector('.tab[data-id=\"rooms\"]'));setTimeout(()=>openRoom('${key}'),180)"><i class="fas fa-comments"></i> 開く</button></div></div>`));
        $("searchResult").innerHTML = blocks.length ? blocks.join("") : '<div class="empty">一致する結果がありません</div>';
      }
      function buildTodayHome(tasks, surveys, responses, anns, roomInfo, users = staffCache) {
        const u = me();
        const unreadBoards = anns.filter((a) => !isBoardRead(a, u)).slice(0, 4);
        const todoSurveys = surveys.filter((s) => canUserSeeSurvey(s, u) && isSurveyOpen(s) && !hasUserAnsweredSurvey(s, u, responses)).slice(0, 4);
        const unreadRooms = roomInfo.filter((r) => r.unread > 0).slice(0, 4);
        const myTasks = tasks.filter((t) => t.userId === u.id && !t.completed).slice(0, 4);
        $("todayHome").innerHTML = `
          <div class="homeCard"><h4><i class="fas fa-bullhorn"></i> 未読掲示板</h4><div class="actionList">${unreadBoards.length ? unreadBoards.map((a) => `<div class="actionItem"><div><div class="title">${esc(a.title || '')}</div><div class="tiny">${fmt(a.createdAt)}</div></div><div class="right"><button class="btn out sm" onclick="highlightBoard('${a.docId}');markBoardRead('${a.docId}',true)">確認</button></div></div>`).join('') : '<div class="tiny">未読はありません</div>'}</div></div>
          <div class="homeCard"><h4><i class="fas fa-poll"></i> 未回答アンケート</h4><div class="actionList">${todoSurveys.length ? todoSurveys.map((s) => `<div class="actionItem"><div><div class="title">${esc(s.title || '')}</div><div class="tiny">${esc(s.targetDept || '全部署')}</div></div><div class="right"><button class="btn pri sm" onclick="markSurveySeen('${s.docId}',true);openSurveyAnswer('${s.docId}')">回答</button></div></div>`).join('') : '<div class="tiny">未回答はありません</div>'}</div></div>
          <div class="homeCard"><h4><i class="fas fa-comments"></i> 未読ルーム</h4><div class="actionList">${unreadRooms.length ? unreadRooms.map((r) => `<div class="actionItem"><div><div class="title">${esc(r.label)}</div><div class="tiny">未読 ${r.unread} 件${r.last ? ' / ' + esc(r.last.userName || '') : ''}</div></div><div class="right"><button class="btn out sm" onclick="openRoom('${r.key}')">開く</button></div></div>`).join('') : '<div class="tiny">未読ルームはありません</div>'}</div></div>
          <div class="homeCard"><h4><i class="fas fa-list-check"></i> 自分のタスク</h4><div class="actionList">${myTasks.length ? myTasks.map((t) => `<div class="actionItem"><div><div class="title">${esc(t.title || '')}</div><div class="tiny">優先度 ${t.priority === 'high' ? '高' : t.priority === 'medium' ? '中' : '低'}</div></div><div class="right"><button class="btn sec sm" onclick="toggleTask('${t.docId}',true)">完了</button></div></div>`).join('') : '<div class="tiny">未完了タスクはありません</div>'}</div></div>`;
      }

      async function list(col) {
        try {
          const s = await db.collection(col).orderBy("createdAt", "desc").get();
          return s.docs.map((d) => ({ docId: d.id, ...d.data() }));
        } catch (e) {
          const s = await db.collection(col).get();
          return s.docs.map((d) => ({ docId: d.id, ...d.data() }));
        }
      }
      async function listLatest(col, limit = ROOM_VISIBLE_LIMIT) {
        try {
          const s = await db.collection(col).orderBy("createdAt", "desc").limit(limit).get();
          return s.docs.map((d) => ({ docId: d.id, ...d.data() }));
        } catch (e) {
          const s = await db.collection(col).get();
          return s.docs.map((d) => ({ docId: d.id, ...d.data() })).sort((a, b) => ms(b.createdAtMs || b.createdAt) - ms(a.createdAtMs || a.createdAt)).slice(0, limit);
        }
      }
      async function add(col, data) {
        return (
          await db
            .collection(col)
            .add({
              ...data,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              createdAtMs: Date.now(),
            })
        ).id;
      }
      async function upd(col, id, data) {
        await db
          .collection(col)
          .doc(id)
          .update({
            ...data,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAtMs: Date.now(),
          });
      }
      async function del(col, id) {
        await db.collection(col).doc(id).delete();
      }
      async function uploadMany(fileList, folder) {
        if (fileList?.length && !storage) throw new Error("添付機能を読み込めませんでした");
        const files = [...(fileList || [])],
          out = [];
        for (const f of files) {
          if (f.size > 20 * 1024 * 1024)
            throw new Error("20MBを超えるファイルがあります");
          const ref = storage.ref(`${folder}/${Date.now()}_${f.name}`);
          const snap = await ref.put(f);
          out.push({
            name: f.name,
            url: await snap.ref.getDownloadURL(),
            size: f.size,
            type: f.type || "",
          });
        }
        return out;
      }

      function openModal(id) {
        $(id).classList.add("show");
      }
      function closeModal(id) {
        $(id).classList.remove("show");
        if (id === "roomModal") {
          if (typeof closeRoomRealtime === "function") closeRoomRealtime();
          if (activeRoom){setRoomReadMs(activeRoom, Date.now());updateRoomReadLocally(activeRoom);}
          activeRoom="";
        }
      }
      function closeSurveyModal() {
        editingSurveyId = "";
        $("svId").value = "";
        closeModal("surveyModal");
      }
      function closeAnswerModal() {
        activeSurveyId = "";
        activeSurveyData = null;
        closeModal("surveyAnswerModal");
      }
      function closeModal_hook_room() {}
      function setNotifyBtn(mode = "default") {
        $("notifyBtn").innerHTML =
          `<i class="fas fa-bell"></i> ${mode === "on" ? "通知ON" : mode === "denied" ? "通知拒否" : "通知OFF"}`;
      }
      async function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) return null;
        swReg = await navigator.serviceWorker.register("./service-worker.js");
        return swReg;
      }
      async function saveFcmToken(token) {
        const u = me();
        if (!u || !token) return;
        await db
          .collection("fcmTokens")
          .doc(encodeURIComponent(token))
          .set(
            {
              token,
              userId: u.id,
              userName: u.name || "",
              department: u.department || "",
              role: u.role || "staff",
              updatedAtMs: Date.now(),
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
      }
      async function requestNotify() {
        if (!messaging) return toast("この環境では通知を利用できません", "error");
        try {
          if (!("Notification" in window))
            return toast("このブラウザは通知に未対応です", "error");
          if (!swReg) await registerServiceWorker();
          const p = await Notification.requestPermission();
          if (p !== "granted") {
            setNotifyBtn(p === "denied" ? "denied" : "default");
            return toast("通知が許可されませんでした", "error");
          }
          if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY === "YOUR_PUBLIC_VAPID_KEY")
            return toast("VAPIDキーを設定してください", "error");
          const token = await messaging.getToken({
            vapidKey: VAPID_PUBLIC_KEY,
            serviceWorkerRegistration: swReg,
          });
          if (!token)
            return toast("通知トークンを取得できませんでした", "error");
          await saveFcmToken(token);
          localStorage.setItem("ku_notify_enabled", "1");
          setNotifyBtn("on");
          toast("PWA通知を有効化しました", "ok");
        } catch (e) {
          console.error(e);
          toast("通知設定でエラーが発生しました", "error");
        }
      }
      function browserNotify(title, body) {
        toast(`${title}：${body}`);
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(title, { body, tag: title });
          } catch (e) {}
        }
        if (navigator.vibrate) {
          try {
            navigator.vibrate([120, 40, 120]);
          } catch (e) {}
        }
      }
      async function setupForegroundMessaging() {
        if (!messaging) return;
        messaging.onMessage(async (payload) => {
          const data = payload?.data || {};
          const title =
            data.title || payload?.notification?.title || "新しいお知らせ";
          const body =
            data.body || payload?.notification?.body || "新しい更新があります";
          browserNotify(title, body);
          if (data.type === "announcement") {
            await refreshBoardOnly();
            if (data.boardId)
              setTimeout(() => highlightBoard(data.boardId), 500);
          }
        });
      }
      function setupInstallPrompt() {
        window.addEventListener("beforeinstallprompt", (e) => {
          e.preventDefault();
          deferredPrompt = e;
          $("installBtn")?.classList.remove("hide");
        });
        $("installBtn")?.addEventListener("click", async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
          $("installBtn").classList.add("hide");
        });
        window.addEventListener("appinstalled", () =>
          $("installBtn")?.classList.add("hide"),
        );
      }
      function setTabAlert(tabId, on = true) {
        const btn = document.querySelector(`.tab[data-id="${tabId}"]`);
        if (btn) btn.classList.toggle("alertDot", !!on);
      }
      function handleDeepLink() {
        const params = new URLSearchParams(location.search);
        const tab = params.get("tab");
        const boardId = params.get("board");
        const surveyId = params.get("survey");
        if (tab) {
          const btn = document.querySelector(`.tab[data-id="${tab}"]`);
          if (btn) showTab(tab, btn);
        }
        if (boardId) setTimeout(() => highlightBoard(boardId), 700);
        if (surveyId) setTimeout(() => highlightSurvey(surveyId), 700);
      }
      function highlightBoard(boardId) {
        const el = document.getElementById(`board-${boardId}`);
        if (!el) return;
        const btn = document.querySelector('.tab[data-id="dashboard"]');
        if (btn) showTab("dashboard", btn);
        markBoardRead(boardId, true);
        const target=$("board-"+boardId)||el;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("flashTarget");
        setTimeout(() => target.classList.remove("flashTarget"), 2500);
      }
      function highlightSurvey(surveyId) {
        const el = document.getElementById(`survey-${surveyId}`);
        if (!el) return;
        const btn = document.querySelector('.tab[data-id="survey"]');
        if (btn) showTab("survey", btn);
        markSurveySeen(surveyId, true);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flashTarget");
        setTimeout(() => el.classList.remove("flashTarget"), 2500);
      }
      async function autoRestorePushToken() {
        if (localStorage.getItem("ku_notify_enabled") !== "1") return;
        if (Notification.permission !== "granted") return;
        if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY === "YOUR_PUBLIC_VAPID_KEY")
          return;
        try {
          const token = await messaging.getToken({
            vapidKey: VAPID_PUBLIC_KEY,
            serviceWorkerRegistration: swReg,
          });
          if (token) {
            await saveFcmToken(token);
            setNotifyBtn("on");
          }
        } catch (e) {}
      }
      async function copyElementImage(id) {
        const el = document.getElementById(id);
        if (!el) return toast("コピー対象が見つかりません", "error");
        try {
          const canvas = await html2canvas(el, {
            backgroundColor: "#ffffff",
            scale: 2,
            useCORS: true,
          });
          if (!navigator.clipboard || !window.ClipboardItem)
            throw new Error("clipboard unsupported");
          const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          toast("画像をクリップボードにコピーしました", "ok");
        } catch (e) {
          console.error(e);
          toast("画像コピーに失敗しました。PNG保存をご利用ください", "error");
        }
      }
      async function copyCanvasImage(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return toast("グラフが見つかりません", "error");
        try {
          const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          toast("グラフ画像をコピーしました", "ok");
        } catch (e) {
          console.error(e);
          toast("グラフコピーに失敗しました", "error");
        }
      }
      function downloadCanvasImage(canvasId, fileName = "chart.png") {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = fileName;
        a.click();
      }
      function fileIcon(n = "") {
        const e = (n.split(".").pop() || "").toLowerCase();
        if (["pdf"].includes(e)) return "fa-file-pdf";
        if (["xls", "xlsx", "csv"].includes(e)) return "fa-file-excel";
        if (["doc", "docx"].includes(e)) return "fa-file-word";
        if (["ppt", "pptx"].includes(e)) return "fa-file-powerpoint";
        if (["jpg", "jpeg", "png", "gif", "webp"].includes(e))
          return "fa-file-image";
        return "fa-file-lines";
      }
      function getAnnFiles(a) {
        let files = [];
        if (Array.isArray(a.attachments)) files = [...a.attachments];
        else if (typeof a.attachments === "string") {
          try {
            files = JSON.parse(a.attachments) || [];
          } catch (e) {}
        }
        if (a.fileUrl && !files.length)
          files = [{ name: a.fileName || "添付ファイル", url: a.fileUrl }];
        if (a.externalUrl)
          files.push({
            name: "外部リンク",
            url: a.externalUrl,
            external: true,
          });
        return files;
      }
      async function deleteAnnFiles(a) {
        for (const f of getAnnFiles(a).filter((x) => x.url && !x.external)) {
          try {
            await storage.refFromURL(f.url).delete();
          } catch (e) {}
        }
      }
      async function createInitialAdmin() {
        return toast("初期管理者は管理用ツールで作成してください", "error");
        const name = $("setupName")?.value.trim();
        const email = $("setupEmail")?.value.trim().toLowerCase();
        const department = $("setupDept").value;
        const extension = $("setupExt").value.trim();
        if (!name || !email)
          return toast("管理者名とメールアドレスを入力してください", "error");
        const now = await list("users");
        if (now.length)
          return toast("すでにスタッフが登録されています", "error");
        await add("users", {
          id: "u_admin_" + Date.now(),
          name,
          email,
          department,
          extension,
          role: "admin",
          note: "初期管理者",
        });
        await loadStaffHints();
        $("loginName").value = name;
        $("loginEmail").value = email;
        toast("初期管理者を作成しました。そのままログインできます", "ok");
      }
      function showAdminPane(pane, btn = null) {
        if (!canAccessAdminTab()) return;
        if (!admin() && pane !== 'calendar') pane = 'calendar';
        document.querySelectorAll('.adminPane').forEach((p) => p.classList.remove('active'));
        document.querySelectorAll('.adminSubtab').forEach((b) => b.classList.remove('active'));
        const paneMap = {
          staff: 'adminPaneStaff',
          calendar: 'adminPaneCalendar',
          other: 'adminPaneOther',
        };
        const el = $(paneMap[pane] || paneMap.calendar);
        if (el) el.classList.add('active');
        const activeBtn = btn || document.querySelector(`.adminSubtab[data-pane="${pane}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        if (pane === "staff" && admin()) loadAdminStaffPane();
        else if (pane === "calendar") loadSettingsCached().then((s) => loadFacilityCalendarAdmin(s));
        else if (pane === "other" && admin()) loadAdminOtherPane();
      }
      const _tabVisited = {};
      function showTab(id, btn) {
        document
          .querySelectorAll(".tab")
          .forEach((t) => t.classList.remove("active"));
        if (btn) btn.classList.add("active");
        document
          .querySelectorAll(".screen")
          .forEach((s) => s.classList.remove("active"));
        $(id).classList.add("active");
        const loaders = {
          dashboard: loadDashboard,
          profile: loadProfile,
          tasks: loadTasks,
          rooms: renderRoomCards,
          survey: loadSurveys,
          editor: syncPermissionUI,
          admin: loadAdmin,
        };
        const fn = loaders[id];
        if (fn) {
          // ダッシュボードは毎回、他は初回のみ (更新ボタンで手動再取得)
          if (id === "dashboard" || !_tabVisited[id]) {
            fn();
            _tabVisited[id] = true;
          }
        }
        if (id === 'admin') showAdminPane(admin() ? 'staff' : 'calendar');
      }

      let homePartData=null;
      let boardRefreshRevision=0;
      function getHomePartData(){
        const id=me()?.id;if(!id)return null;
        if(!homePartData||homePartData.id!==id)homePartData={id,tasks:[],surveys:[],boards:[],rooms:[]};
        return homePartData;
      }
      function renderHomeParts(home=getHomePartData()){
        if(home)buildTodayHomeLite(home.tasks,home.surveys,home.boards,home.rooms);
      }
      function refreshBoardFromHome(home=getHomePartData()){
        if(!home)return;
        home.boards=home.boards.filter(a=>isBoardVisibleNow(a));
        setTabAlert('dashboard',home.boards.some(a=>!isBoardRead(a,me())));
        renderBoard(home.boards);renderHomeParts(home);
      }
      async function refreshBoardOnly(){
        const home=getHomePartData();if(!home)return;
        const revision=++boardRefreshRevision;
        const pending=publishedBoardTask;
        if(pending)await pending.catch(()=>{});
        if(revision!==boardRefreshRevision||home!==getHomePartData())return;
        publishedBoardCache=null;
        const rows=await loadPublishedBoards();
        if(revision!==boardRefreshRevision||home!==getHomePartData())return;
        home.boards=rows;refreshBoardFromHome(home);
      }
      async function loadDashboard() {
        const u = me();
        if (!u) return;
        const home=getHomePartData(), boardRevision=boardRefreshRevision;
        // 最小サマリだけ取得: 掲示板は最新20件、アンケートは自分の未回答判定のためタイトル+targetDept+status+dueDateだけ、ルームは meta のみ
        const [myTasks, anns, surveys, roomMeta, settings] = await Promise.all([
          listMyOpenTasks(u.id).catch(() => []),
          loadPublishedBoards().catch(() => []),
          listLatest("surveys", 40).catch(() => []),
          loadRoomMetaSummary(u).catch(() => []),
          loadSettingsCached().catch(() => []),
        ]);
        $("stTask").textContent = myTasks.length;
        $("stTrain").textContent = 0;
        const visibleAnns = anns.filter((a) => isBoardVisibleNow(a));
        const visibleSurveys = surveys.filter((s) => canUserSeeSurvey(s, u));
        // 自分の回答をサーバーと同期してから未回答判定（localStorage + 埋め込み回答の両方で判定）
        await syncMyAnsweredSurveys(u).catch(() => {});
        const openTodo = visibleSurveys.filter((s) => canAnswerSurvey(s,u) && isSurveyOpen(s) && !hasUserAnsweredSurvey(s, u, []));
        $("stSurvey").textContent = openTodo.length;
        $("stRoom").textContent = roomMeta.filter((r) => r.unread > 0).length;
        if(home!==getHomePartData())return;
        home.tasks=myTasks;home.surveys=openTodo;
        home.rooms=roomMeta.map(r=>({...r,unread:r.unread&&r.lastMs>getRoomReadMs(r.key,u.id)?1:0}));
        updateRoomReadIndicators(home);
        const b = settings.find((x) => x.type === "banner");
        if (b?.imageUrl) {
          $("bannerArea").innerHTML = `<img src="${esc(b.imageUrl)}" alt="banner">`;
          $("bannerArea").classList.remove("hide");
        } else $("bannerArea").classList.add("hide");
        if(boardRevision===boardRefreshRevision)home.boards=visibleAnns;
        refreshBoardFromHome(home);
        renderQuickLinks();
        // 職員名簿はホームでは読まない (プロフィールタブで表示)
        await loadFacilityCalendar(settings);
      }
      async function listMyOpenTasks(userId) {
        try {
          const s = await db.collection("tasks").where("userId", "==", userId).get();
          return s.docs.map((d) => ({ docId: d.id, ...d.data() })).filter((t) => !t.completed);
        } catch (e) {
          const all = await list("tasks").catch(() => []);
          return all.filter((t) => t.userId === userId && !t.completed);
        }
      }
      let settingsCache = null;
      let settingsCacheAt = 0, settingsReadTask=null;
      async function loadSettingsCached(force = false) {
        if (!force && settingsCache && Date.now() - settingsCacheAt < 60000) return settingsCache;
        if(settingsReadTask&&!force)return settingsReadTask;
        const task=list('settings').then(rows=>{if(settingsReadTask===task){settingsCache=rows;settingsCacheAt=Date.now();}return rows;}).finally(()=>{if(settingsReadTask===task)settingsReadTask=null;});
        settingsReadTask=task;return task;
      }
      function getAnsweredSurveyIds(userId) {
        return parseJSON(localStorage.getItem(`ku_answered_${userId}`), []);
      }
      function addAnsweredSurveyId(userId, surveyId) {
        const arr = getAnsweredSurveyIds(userId);
        if (!arr.includes(surveyId)) {
          arr.push(surveyId);
          localStorage.setItem(`ku_answered_${userId}`, JSON.stringify(arr));
        }
      }
      async function syncMyAnsweredSurveys(u) {
        // 別端末/別ブラウザで回答した分も拾うため、自分の回答だけ1クエリで取得してローカルに反映
        try {
          const s = await db.collection("surveyResponses").where("userId", "==", u.id).get();
          s.docs.forEach((d) => addAnsweredSurveyId(u.id, d.data().surveyId || ""));
        } catch (e) { /* 取得失敗時はローカルのみで判定 */ }
      }
      async function loadRoomMetaSummary(u) {
        // 各ルームの meta doc を settings コレクションで管理する (roomMeta_<key>)
        // meta が無いルームは skip して、開いたときにだけ実データを読む
        const settings = await loadSettingsCached();
        return Object.entries(ROOMS).filter(([k]) => canUseRoom(k)).map(([k, v]) => {
          const row = settings.find((x) => x.type === "roomMeta" && x.roomKey === k) || null;
          const lastMs = ms(row?.lastMs || row?.updatedAtMs || row?.createdAtMs || 0);
          const lastUser = row?.lastUser || "";
          const readMs = getRoomReadMs(k, u.id);
          const unread = lastMs && lastMs > readMs && row?.lastUserId !== u.id ? 1 : 0;
          return { key: k, label: v, last: row ? { userName: lastUser, createdAt: lastMs } : null, unread, lastMs };
        });
      }
      function buildTodayHomeLite(myTasks, openTodo, anns, roomMeta) {
        const u = me();
        const unreadAnns = (anns || []).filter((a) => !isBoardRead(a, u)).slice(0, 4);
        const unreadRooms = (roomMeta || []).filter((r) => r.unread > 0).slice(0, 4);
        const todoSurveys = (openTodo || []).slice(0, 4);
        const tasksList = (myTasks || []).slice(0, 4);
        $("todayHome").innerHTML = `
          <div class="homeCard"><h4><i class="fas fa-bullhorn"></i> 未読掲示板</h4><div class="actionList">${unreadAnns.length ? unreadAnns.map((a) => `<div class="actionItem"><div><div class="title">${esc(a.title || "")}</div><div class="tiny">${esc(a.creatorName || "")} / ${fmt(a.createdAt)}</div></div><div class="right"><button class="btn out sm" onclick="markBoardRead('${a.docId}')">確認</button></div></div>`).join("") : '<div class="tiny">未読の掲示板はありません</div>'}</div></div>
          <div class="homeCard"><h4><i class="fas fa-poll"></i> 未回答アンケート</h4><div class="actionList">${todoSurveys.length ? todoSurveys.map((s) => `<div class="actionItem"><div><div class="title">${esc(s.title || "")}</div><div class="tiny">${targetDeptLabel(s.targetDept)}</div></div><div class="right"><button class="btn pri sm" onclick="markSurveySeen('${s.docId}',true);openSurveyAnswer('${s.docId}')">回答</button></div></div>`).join("") : '<div class="tiny">未回答はありません</div>'}</div></div>
          <div class="homeCard"><h4><i class="fas fa-comments"></i> 未読ルーム</h4><div class="actionList">${unreadRooms.length ? unreadRooms.map((r) => `<div class="actionItem"><div><div class="title">${esc(r.label)}</div><div class="tiny">最終: ${esc(r.last?.userName || "")}</div></div><div class="right"><button class="btn out sm" onclick="openRoom('${r.key}')">開く</button></div></div>`).join("") : '<div class="tiny">未読ルームはありません</div>'}</div></div>
          <div class="homeCard"><h4><i class="fas fa-list-check"></i> 自分のタスク</h4><div class="actionList">${tasksList.length ? tasksList.map((t) => `<div class="actionItem"><div><div class="title">${esc(t.title || "")}</div><div class="tiny">優先度 ${t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低"}</div></div><div class="right"><button class="btn sec sm" onclick="toggleTask('${t.docId}',true)">完了</button></div></div>`).join("") : '<div class="tiny">未完了タスクはありません</div>'}</div></div>`;
      }
      function renderBoard(anns) {
        const u = me();
        const el = $("boardList");
        const visible = (anns || []).filter((a) => isBoardVisibleNow(a));
        if (!visible.length) {
          el.innerHTML = '<div class="empty">掲示板はまだありません</div>';
          return;
        }
        el.innerHTML = visible
          .sort((a, b) => ms(b.createdAtMs || b.createdAt) - ms(a.createdAtMs || a.createdAt))
          .map((a) => {
            const files = getAnnFiles(a);
            const badge = a.priority === "urgent" ? "b4" : a.priority === "important" ? "b3" : "b1";
            const label = a.priority === "urgent" ? "緊急" : a.priority === "important" ? "重要" : "通常";
            const read = isBoardRead(a, u);
            const periodStr = (a.publishFrom || a.publishUntil)
              ? `<span class="tiny">掲載 ${esc(a.publishFrom || "")} 〜 ${esc(a.publishUntil || "")}</span>` : "";
            return `<div class="item" id="board-${a.docId}"><div class="itemTop"><div><div class="title">${esc(a.title)}</div><div class="meta"><span>${esc(a.creatorName || "")}</span><span>${fmt(a.createdAt)}</span><span>${files.length ? files.length + "件添付" : "添付なし"}</span>${periodStr}<span class="readBadge ${read ? "read" : "unread"}">${read ? "既読" : "未読"}</span></div></div><div class="right"><span class="badge ${badge}">${label}</span>${!read ? `<button class="btn out sm" onclick="markBoardRead('${a.docId}')"><i class="fas fa-check"></i> 確認</button>` : ""}</div></div><div style="margin-top:10px;white-space:pre-wrap;line-height:1.6">${esc(a.content || "")}</div>${files.length ? `<div class="files">${files.map((f) => `<div class="file"><div><i class="fas ${fileIcon(f.name || "")}"></i> ${esc(f.name || "添付ファイル")}</div><div class="right"><a class="btn out sm" href="${esc(f.url)}" target="_blank" onclick="markBoardRead('${a.docId}',true)"><i class="fas fa-arrow-up-right-from-square"></i> 開く</a></div></div>`).join("")}</div>` : ""}${(admin() || a.creatorId === u.id) ? `<div style="margin-top:10px" class="right"><button class="btn dan sm" onclick="deleteBoard('${a.docId}')"><i class="fas fa-trash"></i> 削除</button></div>` : ""}</div>`;
          })
          .join("");
      }
      function readBoardDraft() {
        return parseJSON(localStorage.getItem(boardDraftKey()), {});
      }
      function saveBoardDraft(silent = true) {
        if (!$("bTitle") || !$("bBody") || !$("bPri") || !$("bUrl")) return;
        const payload = {
          title: $("bTitle").value || "",
          content: $("bBody").value || "",
          priority: $("bPri").value || "normal",
          externalUrl: $("bUrl").value || "",
          publishFrom: $("bStart")?.value || "",
          publishUntil: $("bEnd")?.value || "",
          updatedAt: Date.now(),
        };
        const hasDraft = [payload.title, payload.content, payload.externalUrl, payload.publishFrom, payload.publishUntil]
          .some((v) => String(v || "").trim()) || payload.priority !== "normal";
        if (hasDraft) {
          localStorage.setItem(boardDraftKey(), JSON.stringify(payload));
          if ($("boardDraftInfo")) $("boardDraftInfo").textContent = "下書きを自動保存しました";
          if (!silent) toast("掲示板の下書きを保存しました", "ok");
        } else {
          localStorage.removeItem(boardDraftKey());
          if ($("boardDraftInfo")) $("boardDraftInfo").textContent = "";
        }
      }
      function loadBoardDraft() {
        const draft = readBoardDraft();
        const hasDraft = !!Object.keys(draft || {}).length;
        $("bTitle").value = draft.title || "";
        $("bBody").value = draft.content || "";
        $("bPri").value = draft.priority || "normal";
        $("bFiles").value = "";
        $("bUrl").value = draft.externalUrl || "";
        if ($("bStart")) $("bStart").value = draft.publishFrom || "";
        if ($("bEnd")) $("bEnd").value = draft.publishUntil || "";
        if ($("boardDraftInfo")) {
          $("boardDraftInfo").textContent = hasDraft
            ? "保存済みの下書きを読み込みました"
            : "タイトル・本文・優先度・URL・掲載期間は自動保存されます";
        }
      }
      function clearBoardDraft(withToast = true) {
        localStorage.removeItem(boardDraftKey());
        if ($("bTitle")) $("bTitle").value = "";
        if ($("bBody")) $("bBody").value = "";
        if ($("bPri")) $("bPri").value = "normal";
        if ($("bFiles")) $("bFiles").value = "";
        if ($("bUrl")) $("bUrl").value = "";
        if ($("bStart")) $("bStart").value = "";
        if ($("bEnd")) $("bEnd").value = "";
        if ($("boardDraftInfo")) $("boardDraftInfo").textContent = "下書きを削除しました";
        if (withToast) toast("掲示板の下書きを削除しました", "ok");
      }
      function wireBoardDraftAutosave() {
        ["bTitle", "bBody", "bPri", "bUrl", "bStart", "bEnd"].forEach((id) => {
          const el = $(id);
          if (!el || el.dataset.boardDraftBound === "1") return;
          const handler = () => {
            clearTimeout(boardDraftTimer);
            boardDraftTimer = setTimeout(() => saveBoardDraft(true), 400);
          };
          el.addEventListener("input", handler);
          el.addEventListener("change", handler);
          el.dataset.boardDraftBound = "1";
        });
      }
      function openPrivilegeBoard() {
        if (!canPostBoard()) return toast("掲示板投稿の権限がありません", "error");
        openBoardModal();
      }
      function openPrivilegeCalendar() {
        if (!canEditFacilityCalendar()) return toast("月間予定編集の権限がありません", "error");
        const btn = $("editorTab") || $("adminTab");
        showTab("admin", btn);
        showAdminPane("calendar");
      }
      function openBoardModal() {
        if (!canPostBoard()) return toast("掲示板投稿の権限がありません", "error");
        loadBoardDraft();
        openModal("boardModal");
      }
      async function createBoard() {
        if (!canPostBoard()) return toast("掲示板投稿の権限がありません", "error");
        const u = me(),
          title = $("bTitle").value.trim(),
          content = $("bBody").value.trim();
        if (!title || !content)
          return toast("タイトルと本文は必須です", "error");
        const publishFrom = $("bStart")?.value || "";
        const publishUntil = $("bEnd")?.value || "";
        if ((publishUntil && publishUntil < todayStr()) || (publishFrom && publishUntil && publishFrom > publishUntil)) {
          return toast("掲載開始日は掲載終了日より前にしてください", "error");
        }
        try {
          const attachments = await uploadMany(
            $("bFiles").files,
            "announcements",
          );
          await add("announcements", {
            title,
            content,
            priority: $("bPri").value,
            creatorId: u.id,
            creatorName: u.name,
            attachments,
            externalUrl: $("bUrl").value.trim(),
            publishFrom,
            publishUntil,
          });
          clearBoardDraft(false);
          closeModal("boardModal");
          await refreshBoardOnly().catch(console.error);
          toast("掲示板に投稿しました", "ok");
        } catch (e) {
          toast("投稿エラー: " + e.message, "error");
        }
      }
      async function deleteBoard(id) {
        const u = me();
        if (!confirm("掲示板を削除しますか？")) return;
        const snap = await db.collection("announcements").doc(id).get();
        const ann = snap.exists ? snap.data() : null;
        if (!ann) return toast("対象掲示板が見つかりませんでした", "error");
        if (!admin() && ann.creatorId !== u.id) return toast("削除権限がありません", "error");
        await deleteAnnFiles(ann);
        await del ("announcements", id);
        publishedBoardCache=null;
        await refreshBoardOnly().catch(console.error);
        toast("削除しました", "ok");
      }

      async function saveProfile() {
        const u = me();
        const patch = {
          department: $("pDept").value,
          extension: $("pExt").value.trim(),
          bio: $("pBio").value.trim(),
        };
        if (u.docId) await upd("users", u.docId, patch);
        const nu = { ...u, ...patch };
        saveMe(nu);
        syncPermissionUI();
        await loadProfile();
        await renderRoomCards();
        toast("プロフィールを保存しました", "ok");
      }

      async function loadTasks() {
        const u = me();
        const rows = (await list("tasks"))
          .filter((t) => t.userId === u.id)
          .sort((a, b) => Number(!!a.completed) - Number(!!b.completed));
        const el = $("taskList");
        if (!rows.length) {
          el.innerHTML = '<div class="empty">タスクはありません</div>';
          return;
        }
        el.innerHTML = rows
          .map(
            (t) =>
              `<div class="item" id="task-${t.docId}"><div class="itemTop"><div><div class="title" style="${t.completed ? "text-decoration:line-through;color:#889" : ""}">${esc(t.title)}</div><div class="meta"><span class="badge ${t.priority === "high" ? "b4" : t.priority === "medium" ? "b3" : "b1"}">${t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低"}</span></div></div><div class="right"><button class="btn ${t.completed ? "sec" : "pri"} sm" onclick="toggleTask('${t.docId}',${!t.completed})"><i class="fas fa-${t.completed ? "rotate-left" : "check"}"></i></button><button class="btn dan sm" onclick="removeTask('${t.docId}')"><i class="fas fa-trash"></i></button></div></div></div>`,
          )
          .join("");
      }
      async function addTask() {
        const u = me();
        const title = $("taskTitle").value.trim();
        if (!title) return toast("タスク名を入力してください", "error");
        await add("tasks", {
          userId: u.id,
          title,
          priority: $("taskPri").value,
          completed: false,
        });
        $("taskTitle").value = "";
        $("taskPri").value = "low";
        await loadTasks();
        await loadDashboard();
        toast("タスクを追加しました", "ok");
      }
      async function toggleTask(id, completed) {
        await upd("tasks", id, { completed });
        await loadTasks();
        await loadDashboard();
      }
      async function removeTask(id) {
        if (!confirm("削除しますか？")) return;
        await del("tasks", id);
        await loadTasks();
        await loadDashboard();
        toast("削除しました", "ok");
      }

      async function renderRoomCards() {
        const u = me();
        const el = $("roomCards");
        if (!u || !el) return;
        const rows = await loadRoomMetaSummary(u);
        const home=getHomePartData();if(!home||home.id!==u.id)return;
        home.rooms=rows.map(r=>({...r,unread:r.unread&&r.lastMs>getRoomReadMs(r.key,u.id)?1:0}));
        updateRoomReadIndicators(home);renderHomeParts(home);
        el.innerHTML = home.rooms
          .map((r) => `<div class="card roomBtn" data-home-room="${esc(r.key)}" onclick="openRoom('${r.key}')"><div class="itemTop"><div><h3>${esc(r.label)}</h3><p class="muted" style="margin-top:8px">${r.key === "leaders" ? "役職者向け共有ルーム" : "部署・役割ごとの情報共有ルーム"}</p></div>${r.unread ? `<span class="badge b4">未読</span>` : `<span class="badge b2">既読</span>`}</div><div class="roomMeta">${r.last && r.lastMs ? `<span class="tiny">最終: ${esc(r.last.userName || "")} / ${fmt(new Date(r.lastMs))}</span>` : '<span class="tiny">まだ投稿がありません</span>'}</div></div>`)
          .join("");
      }
      function updateRoomReadIndicators(home=getHomePartData()){
        if(!home)return;
        $('stRoom').textContent=home.rooms.filter(r=>r.unread).length;
        setTabAlert('rooms',home.rooms.some(r=>r.unread));
      }
      function updateRoomReadLocally(key){
        const home=getHomePartData();if(!home)return;
        const row=home.rooms.find(r=>r.key===key);if(row)row.unread=0;
        const badge=$('roomCards')?.querySelector(`[data-home-room="${key}"] .badge`);
        if(badge){badge.classList.remove('b4');badge.classList.add('b2');badge.textContent='既読';}
        updateRoomReadIndicators(home);renderHomeParts(home);
      }
      let openRoomUnsub = null;
      async function openRoom(key) {
        if (!canUseRoom(key)) return toast("このルームの利用権限がありません", "error");
        if (typeof setRoomReadMs === "function") setRoomReadMs(key, Date.now());
        activeRoom = key;
        $("roomTitle").textContent = ROOMS[key];
        openModal("roomModal");
        updateRoomReadLocally(key);
        try{await loadRoomMsgs();}catch(e){console.error(e);toast('チャットを読み込めませんでした','error');}
        if(activeRoom!==key||!$('roomModal').classList.contains('show'))return;
        $('roomInput').focus();startRoomRealtime(key);
      }
      function closeRoomRealtime() {
        if (typeof openRoomUnsub === "function") {
          try { openRoomUnsub(); } catch (e) {}
        }
        openRoomUnsub = null;
      }
      function startRoomRealtime(key) {
        if (!canUseRoom(key)) return toast("このルームの利用権限がありません", "error");
        closeRoomRealtime();
        try {
          openRoomUnsub = db.collection("rooms_" + key).orderBy("createdAt", "desc").limit(1)
            .onSnapshot((s) => {
              if (s.empty) return;
              const d = s.docs[0];
              const data = d.data();
              if (!activeRoom || activeRoom !== key) return;
              if (data.userId === me()?.id) return; // 自分の投稿は appendRoomMsgToDom 済み
              if (document.querySelector(`#roomMsgs [data-msg-id="${d.id}"]`)) return;
              appendRoomMsgToDom({ docId: d.id, ...data });
              setRoomReadMs(key, Math.max(ms(data.createdAtMs || data.createdAt), Date.now()));
            });
        } catch (e) { console.warn("room realtime failed", e); }
      }
      async function loadRoomMsgs() {
        if (!canUseRoom(activeRoom)) return toast("このルームの利用権限がありません", "error");
        if (!activeRoom) return;
        const u = me();
        const roomKey=activeRoom;
        const msgs = (await listLatest("rooms_" + roomKey, ROOM_VISIBLE_LIMIT)).sort(
          (a, b) => ms(a.createdAtMs || a.createdAt) - ms(b.createdAtMs || b.createdAt),
        );
        if(activeRoom!==roomKey)return;
        const el = $("roomMsgs");
        const lastMs = msgs.length ? ms(msgs[msgs.length - 1].createdAtMs || msgs[msgs.length - 1].createdAt) : Date.now();
        setRoomReadMs(activeRoom, Math.max(lastMs, Date.now()));
        if (!msgs.length) {
          el.innerHTML = '<div class="empty">まだメッセージがありません</div>';
          return;
        }
        el.innerHTML = msgs
          .map(
            (m) =>
              `<div class="msg" data-msg-id="${esc(m.docId)}" data-user-id="${esc(m.userId || "")}" data-user-name="${esc(m.userName || "")}"><div class="avatar" style="width:36px;height:36px;font-size:13px">${esc((m.userName || "?").slice(0, 1))}</div><div class="bubble"><div class="itemTop"><div class="meta"><b>${esc(m.userName || "")}</b> <span>${fmt(m.createdAt)}</span></div>${canDeleteRoomMessage(m, u) ? `<button class="btn dan sm" onclick="deleteRoomMsg('${m.docId}')"><i class="fas fa-trash"></i> 削除</button>` : ""}</div><div style="white-space:pre-wrap">${esc(m.text || "")}</div></div></div>`,
          )
          .join("");
        el.scrollTop = el.scrollHeight;
      }
      async function sendRoomMsg() {
        if (!canUseRoom(activeRoom)) return toast("このルームの利用権限がありません", "error");
        const text = $("roomInput").value.trim();
        const u = me();
        if (!text || !activeRoom) return;
        const now = Date.now();
        try {
          await add("rooms_" + activeRoom, {
            userId: u.id,
            userName: u.name,
            text,
            room: activeRoom,
          });
          await upsertRoomMeta(activeRoom, {
            lastMs: now,
            lastUser: u.name || "",
            lastUserId: u.id,
            lastText: text.slice(0, 60),
          });
        } catch (e) {
          toast("送信に失敗しました", "error");
          return;
        }
        $("roomInput").value = "";
        // 画面に1件だけ追記して再取得を避ける
        appendRoomMsgToDom({ userId: u.id, userName: u.name, text, createdAt: new Date(), docId: "local_" + now });
        setRoomReadMs(activeRoom, now);
      }
      async function deleteRoomMsg(id) {
        if (!canUseRoom(activeRoom)) return toast("このルームの利用権限がありません", "error");
        if (!activeRoom || !id) return;
        const el = document.querySelector(`#roomMsgs [data-msg-id="${id}"]`);
        const cached = el?.dataset?.userId ? { docId: id, userId: el.dataset.userId, userName: el.dataset.userName } : null;
        let target = cached;
        if (!target) {
          const rows = await listLatest("rooms_" + activeRoom, ROOM_VISIBLE_LIMIT).catch(() => []);
          target = rows.find((x) => x.docId === id) || null;
        }
        if (!target) return toast("対象メッセージを見つけられませんでした", "error");
        if (!canDeleteRoomMessage(target)) return toast("削除権限がありません", "error");
        if (!confirm(`「${target.userName || "投稿"}」の発言を削除しますか？`)) return;
        try {
          await del("rooms_" + activeRoom, id);
          if (el) el.remove();
          toast("発言を削除しました", "ok");
        } catch (e) {
          toast("削除に失敗しました", "error");
        }
      }
      function appendRoomMsgToDom(m) {
        const u = me();
        const el = $("roomMsgs");
        if (!el) return;
        if (el.querySelector(".empty")) el.innerHTML = "";
        const html = `<div class="msg" data-msg-id="${esc(m.docId)}" data-user-id="${esc(m.userId || "")}" data-user-name="${esc(m.userName || "")}"><div class="avatar" style="width:36px;height:36px;font-size:13px">${esc((m.userName || "?").slice(0, 1))}</div><div class="bubble"><div class="itemTop"><div class="meta"><b>${esc(m.userName || "")}</b> <span>${fmt(m.createdAt)}</span></div>${canDeleteRoomMessage(m, u) ? `<button class="btn dan sm" onclick="deleteRoomMsg('${m.docId}')"><i class="fas fa-trash"></i> 削除</button>` : ""}</div><div style="white-space:pre-wrap">${esc(m.text || "")}</div></div></div>`;
        el.insertAdjacentHTML("beforeend", html);
        el.scrollTop = el.scrollHeight;
      }
      async function upsertRoomMeta(roomKey, patch) {
        try {
          const settings = await loadSettingsCached(true);
          const row = settings.find((x) => x.type === "roomMeta" && x.roomKey === roomKey);
          const data = { type: "roomMeta", roomKey, ...patch };
          if (row) await upd("settings", row.docId, data);
          else await add("settings", data);
          settingsCache = null;
        } catch (e) {
          console.warn("roomMeta upsert failed", e);
        }
      }

      function clearWatchers() {
        watchers.forEach((u) => u && u());
        watchers = [];
      }
      function watchLatest(col, key, handler) {
        const viewer = me();
        const storageKey = `watch_${viewer?.id || "guest"}_${key}`;
        const unsub = db
          .collection(col)
          .orderBy("createdAt", "desc")
          .limit(1)
          .onSnapshot((s) => {
            if (s.empty) return;
            const d = s.docs[0];
            const prev = localStorage.getItem(storageKey);
            if (!prev) {
              localStorage.setItem(storageKey, d.id);
              return;
            }
            if (prev !== d.id) {
              localStorage.setItem(storageKey, d.id);
              handler({ docId: d.id, ...d.data() });
            }
          });
        watchers.push(unsub);
      }
      async function loadAdmin() {
        if (!canAccessAdminTab()) return;
        syncPermissionUI();
        if ($("facilityMonthAdmin") && !$("facilityMonthAdmin").value) $("facilityMonthAdmin").value = monthStr();
        // どのサブタブが active か判定して、そこだけ読む
        const activePane = document.querySelector(".adminPane.active")?.id || "adminPaneStaff";
        if (!admin() && activePane !== "adminPaneCalendar") {
          $("staffList").innerHTML = '<div class="noteBox">スタッフ管理は管理者のみ利用できます。</div>';
        }
        if (activePane === "adminPaneStaff" && admin()) {
          await loadAdminStaffPane();
        } else if (activePane === "adminPaneCalendar") {
          const settings = await loadSettingsCached().catch(() => []);
          try { await loadFacilityCalendarAdmin(settings); } catch (e) { console.error(e); }
        } else if (activePane === "adminPaneOther" && admin()) {
          await loadAdminOtherPane();
        }
      }
      async function loadAdminStaffPane() {
        let users = [];
        try {
          users = await list("users");
        } catch (e) {
          console.error(e);
          $("staffList").innerHTML = '<div class="noteBox">スタッフ一覧の読込に失敗しました。</div>';
          return;
        }
        staffCache = users;
        $("staffList").innerHTML = !users.length
          ? '<div class="empty">スタッフがいません</div>'
          : `<table class="table"><thead><tr><th>氏名</th><th>メール</th><th>部署</th><th>権限</th><th></th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.name || "")}</td><td>${esc(u.email || "")}</td><td>${esc(u.department || "")}</td><td>${roleLabel(u.role)}</td><td><div class="right"><button class="btn out sm" onclick="editStaff('${u.docId}')">編集</button><button class="btn dan sm" onclick="deleteStaff('${u.docId}','${esc(u.name || "")}')">削除</button></div></td></tr>`).join("")}</tbody></table>`;
      }
      async function loadAdminOtherPane() {
        const settings = await loadSettingsCached(true).catch(() => []);
        const b = settings.find((x) => x.type === "banner");
        $("bannerStatus").innerHTML = b?.imageUrl
          ? `<span class="badge b2">設定済み</span> ${esc(b.fileName || "")}`
          : "未設定";
        // 統計値はキャッシュ済みユーザー数 + 掲示板/アンケートの件数取得(軽い)
        try {
          const [anns, surveys] = await Promise.all([
            listLatest("announcements", 100).catch(() => []),
            listLatest("surveys", 100).catch(() => []),
          ]);
          $("adminStats").innerHTML =
            `登録スタッフ: <b>${(staffCache || []).length || "取得前"}</b> 名<br>アンケート: <b>${surveys.length}</b> 件<br>掲示板: <b>${anns.length}</b> 件`;
        } catch (e) {
          $("adminStats").innerHTML = "統計の読込に失敗しました";
        }
      }
      async function editStaff(id) {
        if (!admin()) return toast("スタッフ管理は管理者のみ利用できます", "error");
        try {
          const users = staffCache.length ? staffCache : await list("users");
          const u = users.find((x) => x.docId === id);
          if (!u) return toast("スタッフ情報を読み込めませんでした", "error");
          $("staffModalTitle").textContent = "スタッフ編集";
          $("sfId").value = id;
          $("sfName").value = u.name || "";
          $("sfEmail").value = u.email || "";
          $("sfDept").value = u.department || "介護";
          $("sfRole").value = u.role || "staff";
          $("sfExt").value = u.extension || "";
          $("sfNote").value = u.note || "";
          openModal("staffModal");
        } catch (e) {
          console.error(e);
          toast("スタッフ編集画面を開けませんでした", "error");
        }
      }
      let staffSaving=false;
      async function saveStaff() {
        if (!admin()) return toast('スタッフ管理は管理者のみ利用できます','error');
        if(staffSaving)return;
        const docId=$('sfId').value.trim(),name=$('sfName').value.trim(),email=$('sfEmail').value.trim().toLowerCase();
        if(!name||!email)return toast('氏名と登録メールは必須です','error');
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return toast('登録メールの形式を確認してください','error');
        const role=$('sfRole').value;
        if(!['admin','sharedEditor','staff'].includes(role))return toast('権限を確認してください','error');
        staffSaving=true;const button=document.querySelector('#staffModal button[onclick="saveStaff()"]');if(button)button.disabled=true;
        let saved=false;
        try{
          const users=await list('users');
          const existing=docId?users.find(u=>u.docId===docId):null;
          if(docId&&!existing)throw new Error('スタッフ情報が見つかりません。一覧を更新してください');
          if(users.some(u=>u.docId!==docId&&(u.name||'').trim()===name&&String(u.email||'').trim().toLowerCase()===email))throw new Error('同じ氏名と登録メールのスタッフが登録されています');
          if(existing?.role==='admin'&&role!=='admin'&&!users.some(u=>u.docId!==docId&&u.role==='admin'&&u.active!==false))throw new Error('最後の管理者の権限は変更できません');
          const data={name,email,department:$('sfDept').value,role,extension:$('sfExt').value.trim(),note:$('sfNote').value.trim()};
          if(docId)await upd('users',docId,data);
          else await add('users',{...data,id:uid('u'),active:true});
          saved=true;staffCache=[];
          const current=me();
          if(existing&&(current?.docId===docId||(existing.id&&current?.id===existing.id))){saveMe({...current,...data});syncPermissionUI();$('meName').textContent=name;$('av').textContent=name.slice(0,1);}
          closeModal('staffModal');toast(docId?'スタッフ情報を更新しました':'スタッフを追加しました','ok');
          if(admin())await loadAdminStaffPane();
          await loadProfile();
        }catch(e){console.error(e);toast(saved?'保存済みですが一覧の更新に失敗しました。一覧を開き直してください':'保存できませんでした：'+e.message,'error');}
        finally{staffSaving=false;if(button)button.disabled=false;}
      }
      async function deleteStaff(id, name) {
        if (!admin()) return toast("スタッフ管理は管理者のみ利用できます", "error");
        if (!confirm(`「${name}」を削除しますか？`)) return;
        await del("users", id);
        await Promise.all([loadAdmin(), loadStaffHints(), loadProfile()]);
        toast("削除しました", "ok");
      }
      function openBannerModal() {
        $("bannerFile").value = "";
        $("bannerPreview").innerHTML = "";
        $("bannerPreview").classList.add("hide");
        openModal("bannerModal");
      }
      $("bannerFile").addEventListener("change", (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = (x) => {
          $("bannerPreview").innerHTML =
            `<img src="${x.target.result}" style="width:100%;max-height:240px;object-fit:cover;border-radius:14px">`;
          $("bannerPreview").classList.remove("hide");
        };
        r.readAsDataURL(f);
      });
      async function uploadBanner() {
        const f = $("bannerFile").files[0];
        if (!f) return toast("画像を選択してください", "error");
        const ref = storage.ref(`banners/${Date.now()}_${f.name}`);
        const snap = await ref.put(f);
        const imageUrl = await snap.ref.getDownloadURL();
        const settings = await list("settings");
        const cur = settings.find((x) => x.type === "banner");
        if (cur)
          await upd("settings", cur.docId, {
            type: "banner",
            imageUrl,
            fileName: f.name,
          });
        else
          await add("settings", { type: "banner", imageUrl, fileName: f.name });
        closeModal("bannerModal");
        await Promise.all([loadDashboard(), loadAdmin()]);
        toast("バナーを更新しました", "ok");
      }
      async function cleanupExpiredData(silent = true) {
        if (!admin()) return;
        try {
          const cutoff = Date.now() - DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
          let removed = 0;
          const anns = await list("announcements");
          for (const a of anns.filter(
            (x) =>
              shouldRemoveBoard(x, Date.now()),
          )) {
            await deleteAnnFiles(a);
            await del("announcements", a.docId);
            removed++;
          }
          for (const r of Object.keys(ROOMS)) {
            const rows = await list("rooms_" + r);
            for (const m of rows.filter(
              (x) =>
                ms(x.createdAtMs || x.createdAt) &&
                ms(x.createdAtMs || x.createdAt) < cutoff,
            )) {
              await del("rooms_" + r, m.docId);
              removed++;
            }
          }
          publishedBoardCache=null;
          if (!silent && removed)
            toast(
              `掲載終了の掲示板・${DATA_RETENTION_DAYS}日超のチャットを ${removed} 件整理しました`,
              "ok",
            );
          if (admin()) loadAdmin();
          loadDashboard();
        } catch (e) {
          if (!silent) toast("自動整理で一部エラーがありました", "error");
        }
      }
      function normalizeQuestion(q, idx) {
        const type = q?.type || "text";
        const base = {
          id: q?.id || `q${idx}`,
          type,
          text: q?.text || "",
          required: !!q?.required,
          options: Array.isArray(q?.options) ? q.options : [],
          leftLabel: q?.leftLabel || "",
          rightLabel: q?.rightLabel || "",
          placeholder: q?.placeholder || "",
        };
        if (type === "yesno") base.options = ["はい", "いいえ"];
        if (type === "rating5") base.options = ["1", "2", "3", "4", "5"];
        if (type === "rating10")
          base.options = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
        if (
          ["single", "multi", "dropdown"].includes(type) &&
          !base.options.length
        )
          base.options = ["選択肢1", "選択肢2"];
        return base;
      }
      function normalizeQuestions(arr) {
        return (parseJSON(arr, arr || []) || []).map((q, i) =>
          normalizeQuestion(q, i),
        );
      }
      function surveyOwner(s, u) {
        return !!u && (u.role === "admin" || s.creatorId === u.id);
      }
      function canUserSeeSurvey(s, u) {
        if (!s || !u) return false;
        if (surveyOwner(s, u)) return true;
        const t = s.targetDept;
        if (!t || t === "all") return true;
        if (t === "__admin__") return u.role === "admin";
        if (t === "__sharedEditor__") return u.role === "admin" || u.role === "sharedEditor";
        return t === u.department;
      }
      function isSurveyOpen(s) {
        return s.status !== "closed" && (!s.dueDate || s.dueDate >= todayStr());
      }
      function hasUserAnsweredSurvey(s, u, responses) {
        if (getSurveyResponses(s, responses).some((r) => r.userId === u.id)) return true;
        // 軽量判定: 送信時に localStorage に記録した ID を参照
        return getAnsweredSurveyIds(u?.id).includes(s.docId);
      }
      function getSurveyResponses(s, allResponses = []) {
        const current = (allResponses || [])
          .filter((r) => r.surveyId === s.docId)
          .map((r) => ({ ...r, answers: parseJSON(r.answers, {}) }));
        const legacy = parseJSON(s.responses, []).map((r, i) => ({
          docId: `legacy_${i}`,
          surveyId: s.docId,
          userId: r.userId,
          userName: r.userName,
          department: r.department || "",
          anonymous: !!s.anonymous,
          answers: r.ans || {},
          submittedAt: r.at,
          createdAtMs: ms(r.at),
        }));
        const map = new Map();
        [...legacy, ...current].forEach((r) =>
          map.set(`${r.userId || ""}_${r.submittedAt || r.docId}`, r),
        );
        return [...map.values()];
      }
      function getTargetUsers(users, survey) {
        const t = survey?.targetDept;
        return (users || []).filter((u) => {
          if (!t || t === "all") return true;
          if (t === "__admin__") return u.role === "admin";
          if (t === "__sharedEditor__") return u.role === "admin" || u.role === "sharedEditor";
          return u.department === t;
        });
      }
      function defaultQuestion(type = "text") {
        return normalizeQuestion(
          {
            id: uid("q"),
            type,
            text: "",
            required: true,
            options: ["single", "multi", "dropdown"].includes(type)
              ? ["選択肢1", "選択肢2"]
              : [],
            leftLabel: "",
            rightLabel: "",
            placeholder: "",
          },
          svQuestions.length,
        );
      }
      function typeLabel(type) {
        return SURVEY_TYPES[type] || type;
      }
      function moveQ(i, dir) {
        const j = i + dir;
        if (j < 0 || j >= svQuestions.length) return;
        [svQuestions[i], svQuestions[j]] = [svQuestions[j], svQuestions[i]];
        renderQuestions();
      }
      function duplicateQ(i) {
        svQuestions.splice(i + 1, 0, {
          ...svQuestions[i],
          id: uid("q"),
          options: [...(svQuestions[i].options || [])],
        });
        renderQuestions();
      }
      function removeQ(i) {
        svQuestions.splice(i, 1);
        renderQuestions();
      }
      function addQ(type = "text") {
        svQuestions.push(defaultQuestion(type));
        renderQuestions();
      }
      function addOpt(i) {
        svQuestions[i].options.push("新しい選択肢");
        renderQuestions();
      }
      function removeOpt(i, j) {
        svQuestions[i].options.splice(j, 1);
        renderQuestions();
      }
      function changeQType(i, val) {
        svQuestions[i] = normalizeQuestion({ ...svQuestions[i], type: val }, i);
        renderQuestions();
      }
      function renderQuestions() {
        const el = $("svQuestions");
        if (!svQuestions.length) {
          el.innerHTML = '<div class="empty">質問を追加してください</div>';
          return;
        }
        el.innerHTML = svQuestions
          .map((q, i) => {
            q = normalizeQuestion(q, i);
            return `<div class="qCard"><div class="qHead"><div><span class="chip">Q${i + 1}</span> <span class="tiny">${typeLabel(q.type)}</span></div><div class="right"><button class="btn out sm" onclick="moveQ(${i},-1)"><i class="fas fa-arrow-up"></i></button><button class="btn out sm" onclick="moveQ(${i},1)"><i class="fas fa-arrow-down"></i></button><button class="btn out sm" onclick="duplicateQ(${i})"><i class="fas fa-copy"></i></button><button class="btn dan sm" onclick="removeQ(${i})"><i class="fas fa-trash"></i></button></div></div><div class="row"><div class="grow"><label class="tiny">質問文</label><input class="inp" value="${esc(q.text)}" oninput="svQuestions[${i}].text=this.value" placeholder="質問文"></div><div class="grow"><label class="tiny">質問形式</label><select onchange="changeQType(${i},this.value)">${Object.entries(
              SURVEY_TYPES,
            )
              .map(
                ([k, v]) =>
                  `<option value="${k}" ${q.type === k ? "selected" : ""}>${v}</option>`,
              )
              .join(
                "",
              )}</select></div><div style="min-width:120px"><label class="tiny">必須</label><select onchange="svQuestions[${i}].required=this.value==='1'"><option value="1" ${q.required ? "selected" : ""}>必須</option><option value="0" ${!q.required ? "selected" : ""}>任意</option></select></div></div>${["single", "multi", "dropdown"].includes(q.type) ? `<div style="margin-top:10px"><div class="tiny">選択肢</div>${q.options.map((o, oi) => `<div class="optRow"><input class="inp grow" value="${esc(o)}" oninput="svQuestions[${i}].options[${oi}]=this.value"><button class="btn dan sm" onclick="removeOpt(${i},${oi})">-</button></div>`).join("")}<div style="margin-top:8px"><button class="btn out sm" onclick="addOpt(${i})">選択肢追加</button></div></div>` : ""}${["rating5", "rating10"].includes(q.type) ? `<div class="row" style="margin-top:10px"><div class="grow"><label class="tiny">左ラベル</label><input class="inp" value="${esc(q.leftLabel || "")}" oninput="svQuestions[${i}].leftLabel=this.value" placeholder="例：不満"></div><div class="grow"><label class="tiny">右ラベル</label><input class="inp" value="${esc(q.rightLabel || "")}" oninput="svQuestions[${i}].rightLabel=this.value" placeholder="例：満足"></div></div>` : ""}${["text", "number", "date"].includes(q.type) ? `<div style="margin-top:10px"><label class="tiny">補助テキスト（任意）</label><input class="inp" value="${esc(q.placeholder || "")}" oninput="svQuestions[${i}].placeholder=this.value" placeholder="例：自由に入力してください"></div>` : ""}</div>`;
          })
          .join("");
      }
      function resetSurveyForm() {
        editingSurveyId = "";
        $("svId").value = "";
        $("surveyModalTitle").textContent = "アンケート作成";
        $("svTitle").value = "";
        $("svDesc").value = "";
        $("svPass").value = "";
        setAudience("svTargetDept");
        $("svAudience").value = "staff";
        $("svAnonymous").value = "0";
        $("svStatus").value = "open";
        $("svDue").value = "";
        $("svAiPrompt").value = "";
        $("svAiStatus").textContent = "";
        svQuestions = [];
        renderQuestions();
      }
      function openSurveyModal() {
        resetSurveyForm();
        openModal("surveyModal");
      }
      async function editSurvey(id) {
        const survey = (await list("surveys")).find((s) => s.docId === id);
        if (!survey) return;
        editingSurveyId = id;
        $("svId").value = id;
        $("surveyModalTitle").textContent = "アンケート編集";
        $("svTitle").value = survey.title || "";
        $("svDesc").value = survey.desc || "";
        $("svPass").value = survey.password || "";
        setAudience("svTargetDept",survey.targetDept,!!linkedTrainingFor(survey));
        $("svAudience").value = survey.audience || "staff";
        $("svAnonymous").value = survey.anonymous ? "1" : "0";
        $("svStatus").value = survey.status || "open";
        $("svDue").value = survey.dueDate || "";
        $("svAiPrompt").value = "";
        $("svAiStatus").textContent = "";
        svQuestions = normalizeQuestions(parseJSON(survey.questions, []));
        renderQuestions();
        openModal("surveyModal");
      }
      async function duplicateSurvey(id) {
        const survey = (await list("surveys")).find((s) => s.docId === id);
        if (!survey) return;
        resetSurveyForm();
        $("svTitle").value = `${survey.title || "アンケート"}（コピー）`;
        $("svDesc").value = survey.desc || "";
        setAudience("svTargetDept",survey.targetDept);
        $("svAudience").value = survey.audience || "staff";
        $("svAnonymous").value = survey.anonymous ? "1" : "0";
        $("svStatus").value = "open";
        $("svDue").value = "";
        svQuestions = normalizeQuestions(parseJSON(survey.questions, [])).map(
          (q) => ({ ...q, id: uid("q") }),
        );
        renderQuestions();
        openModal("surveyModal");
      }
      function buildLocalSurveyDraft(prompt) {
        const p = String(prompt || "");
        if (/職員|スタッフ|満足/.test(p))
          return {
            title: "職員満足度アンケート",
            desc: "職員向けの簡易アンケートです。率直なご意見をお願いします。",
            questions: [
              {
                id: uid("q"),
                type: "rating5",
                text: "現在の勤務環境に満足していますか？",
                required: true,
                leftLabel: "低い",
                rightLabel: "高い",
              },
              {
                id: uid("q"),
                type: "rating5",
                text: "上司・同僚との連携は取りやすいですか？",
                required: true,
                leftLabel: "取りにくい",
                rightLabel: "取りやすい",
              },
              {
                id: uid("q"),
                type: "single",
                text: "特に改善が必要だと感じる項目はどれですか？",
                required: true,
                options: [
                  "人員体制",
                  "情報共有",
                  "教育体制",
                  "業務負担",
                  "設備",
                ],
              },
              {
                id: uid("q"),
                type: "multi",
                text: "良いと感じている点を選んでください",
                required: false,
                options: [
                  "人間関係",
                  "シフト配慮",
                  "相談しやすさ",
                  "教育",
                  "利用者対応",
                ],
              },
              {
                id: uid("q"),
                type: "text",
                text: "自由記述",
                required: false,
                placeholder: "ご意見・ご要望があればご記入ください",
              },
            ],
          };
        if (/研修/.test(p))
          return {
            title: "研修後アンケート",
            desc: "研修内容の振り返りにご協力ください。",
            questions: [
              {
                id: uid("q"),
                type: "rating5",
                text: "研修内容は理解しやすかったですか？",
                required: true,
                leftLabel: "低い",
                rightLabel: "高い",
              },
              {
                id: uid("q"),
                type: "rating5",
                text: "現場で活かせそうですか？",
                required: true,
                leftLabel: "活かしにくい",
                rightLabel: "活かせる",
              },
              {
                id: uid("q"),
                type: "yesno",
                text: "追加の研修を希望しますか？",
                required: true,
              },
              {
                id: uid("q"),
                type: "single",
                text: "今後受けたいテーマは何ですか？",
                required: false,
                options: ["認知症ケア", "感染対策", "事故防止", "接遇", "記録"],
              },
              {
                id: uid("q"),
                type: "text",
                text: "研修へのご意見",
                required: false,
              },
            ],
          };
        if (/感染/.test(p))
          return {
            title: "感染対策確認アンケート",
            desc: "現場の感染対策状況を確認します。",
            questions: [
              {
                id: uid("q"),
                type: "yesno",
                text: "手指消毒は適切に実施できていますか？",
                required: true,
              },
              {
                id: uid("q"),
                type: "yesno",
                text: "防護具の使用方法を理解していますか？",
                required: true,
              },
              {
                id: uid("q"),
                type: "rating5",
                text: "感染対策マニュアルは分かりやすいですか？",
                required: true,
                leftLabel: "低い",
                rightLabel: "高い",
              },
              {
                id: uid("q"),
                type: "single",
                text: "困っている点はどれですか？",
                required: false,
                options: ["物品不足", "周知不足", "動線", "清掃", "特になし"],
              },
              {
                id: uid("q"),
                type: "text",
                text: "改善したい点",
                required: false,
              },
            ],
          };
        return {
          title: "アンケート",
          desc: "ご意見をお聞かせください。",
          questions: [
            {
              id: uid("q"),
              type: "rating5",
              text: "全体として満足していますか？",
              required: true,
              leftLabel: "低い",
              rightLabel: "高い",
            },
            {
              id: uid("q"),
              type: "single",
              text: "特に重要な項目を選んでください",
              required: true,
              options: ["対応", "食事", "清潔", "連携", "その他"],
            },
            { id: uid("q"), type: "text", text: "自由記述", required: false },
          ],
        };
      }
      async function generateSurveyByAI() {
        const prompt = $("svAiPrompt").value.trim();
        if (!prompt) return toast("作成したい内容を入力してください", "error");
        $("svAiStatus").textContent = "下書きを生成しています…";
        let draft = null;
        try {
          const res = await fetch("/api/survey_ai_draft.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
          });
          if (res.ok) draft = await res.json();
        } catch (e) {}
        if (!draft) draft = buildLocalSurveyDraft(prompt);
        $("svTitle").value = draft.title || $("svTitle").value;
        $("svDesc").value = draft.desc || $("svDesc").value;
        svQuestions = normalizeQuestions(draft.questions || []);
        renderQuestions();
        $("svAiStatus").textContent =
          "下書きを反映しました。必要に応じて編集してください。";
        toast("下書きを反映しました", "ok");
      }
      async function createSurvey() {
        const u = me();
        const title = $("svTitle").value.trim();
        const isEdit = !!editingSurveyId;
        if (!u) return;
        const target = readAudience('svTargetDept');
        if (!target.length) return toast('対象部署・役割を選んでください','error');
        const editing = isEdit ? await db.collection('surveys').doc(editingSurveyId).get() : null;
        if (isEdit && (!editing.exists || !surveyOwner(editing.data(),u))) return toast('編集権限がありません','error');
        if (!title) return toast("タイトルを入力してください", "error");
        if (!svQuestions.length)
          return toast("質問を1つ以上追加してください", "error");
        if (svQuestions.some((q) => !String(q.text || "").trim()))
          return toast("未入力の質問があります", "error");
        const payload = {
          title,
          desc: $("svDesc").value.trim(),
          password: $("svPass").value.trim(),
          targetDept: isEdit && $("svTargetDeptChoices").dataset.locked === "1" ? (editing.data().targetDept || "all") : target,
          audience: $("svAudience").value,
          anonymous: $("svAnonymous").value === "1",
          status: $("svStatus").value,
          dueDate: $("svDue").value || "",
          creatorId: isEdit ? (editing.data().creatorId || u.id) : u.id,
          creatorName: isEdit ? (editing.data().creatorName || u.name) : u.name,
          questions: JSON.stringify(
            svQuestions.map((q, i) => normalizeQuestion(q, i)),
          ),
        };
        if (isEdit) await upd("surveys", editingSurveyId, payload);
        else await add("surveys", payload);
        closeSurveyModal();
        await Promise.all([loadSurveys(), loadDashboard()]);
        toast(isEdit ? "アンケートを更新しました" : "アンケートを作成しました", "ok");
      }
      async function toggleSurveyStatus(id, nextStatus) {
        await upd("surveys", id, { status: nextStatus });
        await Promise.all([loadSurveys(), loadDashboard()]);
        toast(
          nextStatus === "closed"
            ? "アンケートを締切にしました"
            : "アンケートを再開しました",
          "ok",
        );
      }
      async function deleteSurvey(id) {
        if (!confirm("アンケートを削除しますか？")) return;
        const rows = await list("surveyResponses").catch(() => []);
        for (const r of rows.filter((x) => x.surveyId === id))
          await del("surveyResponses", r.docId);
        await del("surveys", id);
        await Promise.all([loadSurveys(), loadDashboard()]);
        toast("削除しました", "ok");
      }

      async function loadSurveys() {
        const u = me();
        // 集計件数は結果画面で読み込む方針にし、一覧は surveys だけ取得
        const surveys = await listLatest("surveys", 50).catch(() => []);
        const responses = [];
        const users = staffCache.length ? staffCache : [];
        // 回答済みかどうかを確実に判定するため、自分の回答だけサーバーから同期
        await syncMyAnsweredSurveys(u).catch(() => {});
        const visible = surveys
          .filter((s) => canUserSeeSurvey(s, u))
          .sort((a, b) => ms(b.createdAtMs || b.createdAt) - ms(a.createdAtMs || a.createdAt));
        const openCount = visible.filter(isSurveyOpen).length;
        const doneCount = visible.filter((s) => hasUserAnsweredSurvey(s, u, responses)).length;
        const todoCount = visible.filter((s) => canAnswerSurvey(s,u) && isSurveyOpen(s) && !hasUserAnsweredSurvey(s, u, responses)).length;
        const mineCount = visible.filter((s) => s.creatorId === u.id).length;
        $("svStatOpen").textContent = openCount;
        $("svStatDone").textContent = doneCount;
        $("svStatTodo").textContent = todoCount;
        $("svStatMine").textContent = mineCount;
        setTabAlert("survey", visible.some((s) => isSurveyOpen(s) && !isSurveySeen(s, u, responses)));
        const el = $("surveyList");
        if (!visible.length) {
          el.innerHTML = '<div class="empty">アンケートはありません</div>';
          return;
        }
        el.innerHTML = visible
          .map((s) => {
            const qs = normalizeQuestions(parseJSON(s.questions, []));
            const rs = getSurveyResponses(s, responses);
            const answered = hasUserAnsweredSurvey(s, u, responses);
            const seen = isSurveySeen(s, u, responses);
            const targetUsers = getTargetUsers(users, s).length || 0;
            const rate = targetUsers ? Math.round((rs.length / targetUsers) * 100) : 0;
            const open = isSurveyOpen(s);
            const owner = surveyOwner(s, u);
            return `<div class="item" id="survey-${s.docId}"><div class="itemTop"><div><div class="title">${esc(s.title || "")}</div><div class="meta"><span>${esc(s.creatorName || "")}</span><span>${esc(targetDeptLabel(s.targetDept))}</span><span>${qs.length}問</span><span>回答状況は集計で確認</span>${s.anonymous ? '<span class="badge b2">匿名表示</span>' : '<span class="badge b1">記名</span>'}${open ? '<span class="badge b2">受付中</span>' : '<span class="badge b4">締切</span>'}${answered ? '<span class="badge b2">回答済</span>' : open && canAnswerSurvey(s,u) ? '<span class="badge b3">未回答</span>' : ''}${!seen && open ? '<span class="badge b4" data-survey-new>NEW</span>' : ''}</div></div><div class="right">${!answered && open && canAnswerSurvey(s,u) ? `<button class="btn pri sm" onclick="markSurveySeen('${s.docId}',true);openSurveyAnswer('${s.docId}')">回答</button>` : ""}<button class="btn out sm" onclick="markSurveySeen('${s.docId}',true);openSurveyResult('${s.docId}')">集計</button>${!seen && !answered ? `<button class="btn out sm" data-survey-confirm onclick="markSurveySeen('${s.docId}',false)">確認</button>` : ''}${owner ? `<button class="btn out sm" onclick="editSurvey('${s.docId}')">編集</button><button class="btn out sm" onclick="duplicateSurvey('${s.docId}')">複製</button><button class="btn ${open ? "warn" : "sec"} sm" onclick="toggleSurveyStatus('${s.docId}','${open ? "closed" : "open"}')">${open ? "締切" : "再開"}</button><button class="btn dan sm" onclick="deleteSurvey('${s.docId}')">削除</button>` : ""}</div></div>${s.desc ? `<div style="margin-top:10px;white-space:pre-wrap;line-height:1.6">${esc(s.desc)}</div>` : ""}${s.dueDate ? `<div class="meta"><span>締切: ${esc(s.dueDate)}</span></div>` : ""}</div>`;
          })
          .join("");
      }

      function renderAnswerInput(q, i, draft) {
        const key = q.id || `q${i}`;
        const val = draft?.[key];
        if (q.type === "text")
          return `<textarea class="inp surveyInput" data-key="${key}" placeholder="${esc(q.placeholder || "")}">${esc(val || "")}</textarea>`;
        if (q.type === "yesno" || q.type === "single")
          return `<div class="pick">${q.options.map((o) => `<label><input class="surveyInput" type="radio" name="${key}" value="${esc(o)}" ${val === o ? "checked" : ""}> ${esc(o)}</label>`).join("")}</div>`;
        if (q.type === "multi")
          return `<div class="pick">${q.options.map((o) => `<label><input class="surveyInput" type="checkbox" data-key="${key}" value="${esc(o)}" ${Array.isArray(val) && val.includes(o) ? "checked" : ""}> ${esc(o)}</label>`).join("")}</div>`;
        if (q.type === "dropdown")
          return `<select class="surveyInput" data-key="${key}"><option value="">選択してください</option>${q.options.map((o) => `<option value="${esc(o)}" ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
        if (q.type === "rating5" || q.type === "rating10")
          return `${q.leftLabel || q.rightLabel ? `<div class="meta"><span>${esc(q.leftLabel || "")}</span><span style="margin-left:auto">${esc(q.rightLabel || "")}</span></div>` : ""}<div class="scale">${q.options.map((o) => `<label><input class="surveyInput" type="radio" name="${key}" value="${o}" ${String(val || "") === String(o) ? "checked" : ""}><div>${o}</div></label>`).join("")}</div>`;
        if (q.type === "number")
          return `<input class="inp surveyInput" type="number" data-key="${key}" value="${esc(val || "")}" placeholder="${esc(q.placeholder || "")}">`;
        if (q.type === "date")
          return `<input class="inp surveyInput" type="date" data-key="${key}" value="${esc(val || "")}" placeholder="${esc(q.placeholder || "")}">`;
        return `<input class="inp surveyInput" data-key="${key}" value="${esc(val || "")}">`;
      }
      function wireDraftAutosave() {
        const fn = () => {
          if (!activeSurveyId || !activeSurveyData) return;
          const u = me();
          const answers = collectAnswerValues(false);
          localStorage.setItem(
            draftKey(activeSurveyId, u.id),
            JSON.stringify(answers),
          );
          $("ansDraftInfo").textContent = "下書きを自動保存しました";
        };
        document.querySelectorAll("#ansBody .surveyInput").forEach((el) =>
          el.addEventListener("input", () => {
            clearTimeout(surveyDraftTimer);
            surveyDraftTimer = setTimeout(fn, 500);
          }),
        );
      }
      function clearSurveyDraft() {
        if (!activeSurveyId) return;
        const u = me();
        localStorage.removeItem(draftKey(activeSurveyId, u.id));
        $("ansDraftInfo").textContent = "下書きを削除しました";
        toast("下書きを削除しました", "ok");
      }
      function collectAnswerValues(withValidation = true) {
        const qs = normalizeQuestions(
          parseJSON(activeSurveyData.questions, []),
        );
        const answers = {};
        const errors = [];
        qs.forEach((q, i) => {
          const key = q.id || `q${i}`;
          let value = "";
          if (q.type === "multi")
            value = [
              ...document.querySelectorAll(
                `#ansBody input[data-key="${key}"]:checked`,
              ),
            ].map((x) => x.value);
          else if (
            q.type === "yesno" ||
            q.type === "single" ||
            q.type === "rating5" ||
            q.type === "rating10"
          )
            value =
              document.querySelector(`#ansBody input[name="${key}"]:checked`)
                ?.value || "";
          else
            value =
              document
                .querySelector(`#ansBody [data-key="${key}"]`)
                ?.value?.trim?.() ?? "";
          answers[key] = value;
          if (withValidation && q.required) {
            const ok = Array.isArray(value)
              ? value.length > 0
              : String(value || "").trim() !== "";
            if (!ok) errors.push(`Q${i + 1}`);
          }
        });
        return withValidation ? { answers, errors } : answers;
      }
      async function openSurveyAnswer(id) {
        const u = me();
        if(!u)return;
        const [doc] = await Promise.all([db.collection('surveys').doc(id).get(),getTrainingLinks()]);
        await syncMyAnsweredSurveys(u).catch(console.error);
        const responses=[];
        const survey=doc.exists?decorateTrainingSurveys([{...doc.data(),docId:doc.id}])[0]:null;
        if (!survey) return;
        if (!canAnswerSurvey(survey, u)) return toast("このアンケートは対象外です", "error");
        if (!isSurveyOpen(survey)) return toast("このアンケートは締め切られています", "error");
        if (hasUserAnsweredSurvey(survey, u, responses)) return toast("すでに回答済みです", "error");
        markSurveySeen(id, true);
        activeSurveyId = id;
        activeSurveyData = survey;
        const qs = normalizeQuestions(parseJSON(survey.questions, []));
        const draft = parseJSON(localStorage.getItem(draftKey(id, u.id)), {});
        $("ansTitle").textContent = survey.title || "アンケート回答";
        $("ansSub").textContent = `${targetDeptLabel(survey.targetDept)} / ${survey.anonymous ? "匿名表示" : "記名"}`;
        $("ansBody").innerHTML = `${survey.desc ? `<div class="noteBox">${esc(survey.desc)}</div>` : ""}${qs.map((q, i) => `<div class="q"><div style="font-weight:800;margin-bottom:8px">Q${i + 1}. ${esc(q.text)} ${q.required ? '<span class="badge b4">必須</span>' : '<span class="badge b1">任意</span>'}</div>${renderAnswerInput(q, i, draft)}</div>`).join("")}`;
        $("ansDraftInfo").textContent = Object.keys(draft || {}).length ? "保存済みの下書きを読み込みました" : "";
        openModal("surveyAnswerModal");
        wireDraftAutosave();
      }
      async function submitSurvey() {
        if (!activeSurveyId || !activeSurveyData || !me()) return;
        const u = me();
        if (submissionSurvey && hasUserAnsweredSurvey(submissionSurvey,u,[])) return toast('すでに回答済みです','error');
        if (!submissionSurvey || !canAnswerSurvey(submissionSurvey,u) || !isSurveyOpen(submissionSurvey)) return toast('現在このアンケートには回答できません','error');
        const { answers, errors } = collectAnswerValues(true);
        if (errors.length)
          return toast(`${errors.join(" / ")} を入力してください`, "error");
        await add("surveyResponses", {
          surveyId: activeSurveyId,
          surveyTitle: activeSurveyData.title || "",
          userId: u.id,
          userName: u.name,
          department: u.department || "",
          anonymous: !!activeSurveyData.anonymous,
          answers: JSON.stringify(answers),
          submittedAt: new Date().toISOString(),
        });
        addAnsweredSurveyId(u.id,activeSurveyId);
        localStorage.removeItem(draftKey(activeSurveyId, u.id));
        closeAnswerModal();
        await Promise.all([loadSurveys(), loadDashboard()]);
        toast("回答を送信しました", "ok");
      }
      function makeChart(id, type, labels, data) {
        const ctx = $(id).getContext("2d");
        charts[id] = new Chart(ctx, {
          type,
          data: {
            labels,
            datasets: [
              {
                data,
                backgroundColor: [
                  "#2f80ed",
                  "#27ae60",
                  "#f39c12",
                  "#e74c3c",
                  "#9b51e0",
                  "#56ccf2",
                  "#6fcf97",
                  "#f2c94c",
                  "#eb5757",
                  "#828282",
                ],
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: type === "pie" } },
            scales:
              type === "pie"
                ? {}
                : { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
          },
        });
      }
      function extractKeywords(texts) {
        const tokens = [];
        const stop = [
          "です",
          "ます",
          "した",
          "して",
          "ある",
          "いる",
          "こと",
          "ため",
          "よう",
          "ない",
          "いつも",
          "とても",
          "など",
          "また",
          "特に",
        ];
        texts.forEach((t) => {
          String(t || "")
            .match(/[一-龠ぁ-んァ-ヶA-Za-z0-9]{2,}/g)
            ?.forEach((w) => {
              if (!stop.includes(w)) tokens.push(w);
            });
        });
        const count = {};
        tokens.forEach((w) => (count[w] = (count[w] || 0) + 1));
        return Object.entries(count)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
      }
      function summarizeComments(texts) {
        const cats = { 感謝: 0, 要望: 0, 課題: 0, 改善案: 0, その他: 0 };
        texts.forEach((t) => {
          const s = String(t || "");
          if (/ありがとう|感謝|助か/.test(s)) cats["感謝"]++;
          else if (/してほしい|欲しい|希望|要望|必要/.test(s)) cats["要望"]++;
          else if (/困る|大変|不足|問題|不便|負担/.test(s)) cats["課題"]++;
          else if (/改善|見直|増や|減ら|工夫|整備/.test(s)) cats["改善案"]++;
          else cats["その他"]++;
        });
        return cats;
      }
      async function openSurveyResult(id) {
        const u = me();
        if(!u||!id)return;
        let survey;
        try{
          const [doc]=await Promise.all([db.collection('surveys').doc(id).get(),getTrainingLinks().catch(console.error)]);
          if(!doc.exists)return toast('アンケートが見つかりませんでした','error');
          survey={...doc.data(),docId:id};
        }catch(e){console.error(e);return toast('アンケートを取得できませんでした','error');}
        if (!canUserSeeSurvey(survey, u)) return toast("このアンケートは対象外です", "error");
        if (survey.password && !surveyOwner(survey, u)) {
          const pw = prompt("集計パスワード");
          if (pw === null) return;
          if (pw !== survey.password) return toast("パスワードが違います", "error");
        }
        let responses,users;
        try{
          [responses,users]=await Promise.all([
            db.collection('surveyResponses').where('surveyId','==',id).get().then(result=>result.docs.map(d=>({...d.data(),docId:d.id}))),
            list('users'),
          ]);
        }catch(e){console.error(e);return toast('集計データを取得できませんでした','error');}
        markSurveySeen(id, true);
        Object.values(charts).forEach((c) => c.destroy());
        charts = {};
        const qs = normalizeQuestions(parseJSON(survey.questions, []));
        const targetUsers = getTargetUsers(users, survey);
        const targetIds = new Set(targetUsers.map(u=>u.id));
        const allRows = getSurveyResponses(survey, responses);
        const rs = linkedTrainingFor(survey) ? [...new Map(allRows.filter(r=>targetIds.has(r.userId)).map(r=>[r.userId,r])).values()] : allRows;
        const rate = targetUsers.length ? Math.round((rs.length / targetUsers.length) * 100) : 0;
        surveyResultCurrent = { survey, qs, rs, users };
        $("svResultTitle").textContent = `${survey.title || ""} 集計結果`;
        $("svResultSub").textContent = `${targetDeptLabel(survey.targetDept)} / 回答率 ${rate}% / ${survey.anonymous ? "匿名表示" : "記名"}`;
        const numericValues = [];
        qs.forEach((q, i) => {
          if (["rating5", "rating10", "number"].includes(q.type)) {
            rs.forEach((r) => {
              const v = Number(parseJSON(r.answers, {})[q.id || `q${i}`]);
              if (Number.isFinite(v)) numericValues.push(v);
            });
          }
        });
        const respondentNames = !survey.anonymous
          ? rs.map((r) => `<span class="kw">${esc(r.userName || "")}${r.department ? ` / ${esc(r.department)}` : ""}</span>`).join("")
          : '<span class="tiny">匿名表示のため回答者名は表示しません</span>';
        const unanswered = targetUsers.filter((u2) => !rs.some((r) => r.userId === u2.id));
        $("svSummary").innerHTML = `<div class="resultStat"><b>${rs.length}</b><div class="tiny">回答人数</div></div><div class="resultStat"><b>${targetUsers.length}</b><div class="tiny">対象人数</div></div><div class="resultStat"><b>${rate}%</b><div class="tiny">回答率</div></div><div class="resultStat"><b>${numericValues.length ? fmtNum(avg(numericValues)) : "-"}</b><div class="tiny">平均点</div></div><div class="resultStat"><b>${survey.anonymous ? "匿名" : rs.length}</b><div class="tiny">記名回答の確認</div></div>`;
        $("svResult").innerHTML = `<div class="q"><div style="font-weight:800;margin-bottom:10px">回答状況</div><div class="meta"><span>${survey.anonymous ? "匿名表示" : "記名"}</span><span>回答率 ${rate}%</span></div><div style="margin-top:10px"><div class="tiny" style="margin-bottom:6px">回答者一覧</div>${respondentNames}</div><div style="margin-top:14px"><div class="tiny" style="margin-bottom:6px">未回答者一覧</div>${unanswered.length ? unanswered.map((u2) => `<span class="kw">${esc(u2.name || "")}${u2.department ? ` / ${esc(u2.department)}` : ""}</span>`).join("") : '<span class="tiny">全員回答済みです</span>'}</div></div>` + qs
          .map((q, i) => {
            const key = q.id || `q${i}`;
            const vals = rs.map((r) => parseJSON(r.answers, {})[key]).filter((v) => !(Array.isArray(v) ? !v.length : String(v ?? "").trim() === ""));
            const cid = `chart_${Date.now()}_${i}`;
            let body = "";
            if (["yesno", "single", "dropdown"].includes(q.type)) {
              const count = {};
              q.options.forEach((o) => (count[o] = 0));
              vals.forEach((v) => (count[v] = (count[v] || 0) + 1));
              body = `<div class="right"><button class="btn out sm" onclick="copyCanvasImage('${cid}')"><i class="fas fa-copy"></i> グラフコピー</button><button class="btn out sm" onclick="downloadCanvasImage('${cid}','${cid}.png')"><i class="fas fa-image"></i> PNG保存</button></div><div class="meta"><span>回答数 ${vals.length}</span></div><div class="chartWrap"><canvas id="${cid}"></canvas></div><div class="meta">${Object.entries(count).map(([k, v]) => `<span>${esc(k)}: ${v}</span>`).join("")}</div>`;
              setTimeout(() => makeChart(cid, "pie", Object.keys(count), Object.values(count)), 0);
            } else if (q.type === "multi") {
              const count = {};
              q.options.forEach((o) => (count[o] = 0));
              vals.forEach((arr) => (arr || []).forEach((v) => (count[v] = (count[v] || 0) + 1)));
              body = `<div class="right"><button class="btn out sm" onclick="copyCanvasImage('${cid}')"><i class="fas fa-copy"></i> グラフコピー</button><button class="btn out sm" onclick="downloadCanvasImage('${cid}','${cid}.png')"><i class="fas fa-image"></i> PNG保存</button></div><div class="meta"><span>回答数 ${vals.length}</span></div><div class="chartWrap"><canvas id="${cid}"></canvas></div>`;
              setTimeout(() => makeChart(cid, "bar", Object.keys(count), Object.values(count)), 0);
            } else if (["rating5", "rating10", "number"].includes(q.type)) {
              const nums = vals.map((v) => Number(v)).filter((v) => Number.isFinite(v));
              const labels = [...new Set(nums)].sort((a, b) => a - b).map(String);
              const count = labels.map((lb) => nums.filter((v) => String(v) === lb).length);
              body = `<div class="right"><button class="btn out sm" onclick="copyCanvasImage('${cid}')"><i class="fas fa-copy"></i> グラフコピー</button><button class="btn out sm" onclick="downloadCanvasImage('${cid}','${cid}.png')"><i class="fas fa-image"></i> PNG保存</button></div><div class="row"><div class="resultStat"><b>${nums.length ? fmtNum(avg(nums)) : "-"}</b><div class="tiny">平均</div></div><div class="resultStat"><b>${nums.length ? fmtNum(calcMedian(nums)) : "-"}</b><div class="tiny">中央値</div></div><div class="resultStat"><b>${nums.length ? Math.max(...nums) : "-"}</b><div class="tiny">最高</div></div><div class="resultStat"><b>${nums.length ? Math.min(...nums) : "-"}</b><div class="tiny">最低</div></div></div><div class="chartWrap"><canvas id="${cid}"></canvas></div>`;
              setTimeout(() => makeChart(cid, "bar", labels, count), 0);
            } else if (q.type === "text") {
              const texts = vals.map((v) => String(v || "").trim()).filter(Boolean);
              const kws = extractKeywords(texts);
              const sum = summarizeComments(texts);
              body = `<div class="meta"><span>記述件数 ${texts.length}</span></div><div>${Object.entries(sum).map(([k, v]) => `<span class="kw">${esc(k)} ${v}</span>`).join("")}</div><div style="margin-top:8px">${kws.length ? kws.map(([k, v]) => `<span class="kw">${esc(k)} ${v}</span>`).join("") : '<span class="tiny">頻出語なし</span>'}</div><div class="files">${texts.length ? texts.slice(0, 12).map((t) => `<div class="file">${esc(t)}</div>`).join("") : '<div class="empty">回答なし</div>'}</div>`;
            } else {
              body = `<div class="files">${vals.length ? vals.map((v) => `<div class="file">${esc(Array.isArray(v) ? v.join(" / ") : v)}</div>`).join("") : '<div class="empty">回答なし</div>'}</div>`;
            }
            return `<div class="q" id="result_block_${i}"><div class="right" style="justify-content:space-between"><div style="font-weight:800">Q${i + 1}. ${esc(q.text)}</div><button class="btn out sm" onclick="copyElementImage('result_block_${i}')"><i class="fas fa-copy"></i> 設問を画像コピー</button></div>${body}</div>`;
          }).join("");
        openModal("surveyResultModal");
        setTimeout(ensureSurveyPdfButton, 50);
      }
      function downloadSurveyCsv() {
        if (!surveyResultCurrent)
          return toast("集計結果を先に開いてください", "error");
        const { survey, qs, rs } = surveyResultCurrent;
        const header = [
          "回答日時",
          "回答者",
          "部署",
          ...qs.map((q) => q.text || q.id),
        ];
        const rows = rs.map((r) => {
          const ans = parseJSON(r.answers, {});
          return [
            r.submittedAt || r.createdAtMs || "",
            survey.anonymous ? "匿名" : r.userName || "",
            r.department || "",
            ...qs.map((q, i) => {
              const v = ans[q.id || `q${i}`];
              return Array.isArray(v) ? v.join(" / ") : (v ?? "");
            }),
          ];
        });
        const csv = [header, ...rows]
          .map((row) =>
            row
              .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
              .join(","),
          )
          .join("\n");
        const blob = new Blob(["\ufeff" + csv], {
          type: "text/csv;charset=utf-8;",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${survey.title || "survey"}_responses.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      }

      document.querySelectorAll(".modal").forEach((m) =>
        m.addEventListener("click", (e) => {
          if (e.target === m) closeModal(m.id);
        }),
      );
      $("loginName").addEventListener(
        "keypress",
        (e) => e.key === "Enter" && login(),
      );
      $("loginEmail").addEventListener(
        "keypress",
        (e) => e.key === "Enter" && login(),
      );
      $("setupName")?.addEventListener(
        "keypress",
        (e) => e.key === "Enter" && createInitialAdmin(),
      );
      $("setupEmail")?.addEventListener(
        "keypress",
        (e) => e.key === "Enter" && createInitialAdmin(),
      );
      $("roomInput").addEventListener(
        "keypress",
        (e) => e.key === "Enter" && sendRoomMsg(),
      );
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot().catch(console.error), {once:true});
      else setTimeout(() => boot().catch(console.error), 0);

      async function exportSurveyResultPDF() {
        const box = document.querySelector("#surveyResultModal .box");
        if (!box) return toast("集計画面が見つかりません", "error");
        if (!window.jspdf) return toast("PDFライブラリの読み込みに失敗しました", "error");
        toast("PDFを作成しています...", "ok");
        // モーダル内スクロールの影響を避けるため、一時的に全展開してから全体をキャプチャ
        const prev = {
          maxHeight: box.style.maxHeight,
          overflow: box.style.overflow,
          width: box.style.width,
        };
        box.style.maxHeight = "none";
        box.style.overflow = "visible";
        box.style.width = "960px";
        try {
          const canvas = await html2canvas(box, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            windowWidth: 1024,
            scrollX: 0,
            scrollY: 0,
          });
          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF("p", "mm", "a4");
          const pageW = 210, pageH = 297, margin = 10;
          const imgW = pageW - margin * 2;
          const pageImgH = pageH - margin * 2;
          // ページごとに画像を切り出して配置（切り詰めず欠落させない）
          const pxPerMm = canvas.width / imgW;
          const pagePxH = Math.floor(pageImgH * pxPerMm);
          const totalPages = Math.ceil(canvas.height / pagePxH);
          for (let p = 0; p < totalPages; p++) {
            const srcY = p * pagePxH;
            const srcH = Math.min(pagePxH, canvas.height - srcY);
            const pageCanvas = document.createElement("canvas");
            pageCanvas.width = canvas.width;
            pageCanvas.height = srcH;
            const ctx = pageCanvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
            ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
            const img = pageCanvas.toDataURL("image/png");
            if (p > 0) pdf.addPage();
            pdf.addImage(img, "PNG", margin, margin, imgW, srcH / pxPerMm);
          }
          const name = (document.getElementById("svResultTitle")?.textContent || "survey_result").trim() || "survey_result";
          pdf.save(name + ".pdf");
          toast("PDFを保存しました", "ok");
        } catch (e) {
          console.error(e);
          toast("PDF作成に失敗しました", "error");
        } finally {
          box.style.maxHeight = prev.maxHeight;
          box.style.overflow = prev.overflow;
          box.style.width = prev.width;
        }
      }
      function ensureSurveyPdfButton() {
        const box = document.querySelector("#surveyResultModal .box");
        if (!box || document.getElementById("svPdfBtn")) return;
        const b = document.createElement("button");
        b.id = "svPdfBtn";
        b.className = "btn sec";
        b.style.marginTop = "10px";
        b.innerHTML = '<i class="fas fa-file-pdf"></i> 結果全体をPDFで保存';
        b.onclick = exportSurveyResultPDF;
        box.appendChild(b);
      }

      function openCalendarDay(targetId, date) {
        const store = facilityCalendarData[targetId];
        if (!store) return;
        const items = normalizeFacilityItems(store.items, store.month)
          .filter((x) => String(x.date) === date);
        const d = new Date(date + "T00:00:00");
        $("dayModalTitle").textContent = `${d.getMonth() + 1}月${d.getDate()}日 の予定`;
        $("dayModalBody").innerHTML = items.length
          ? items.map((x) => `<div class="dayEventBig">${esc(x.text)}</div>`).join("")
          : '<div class="empty">この日の予定はありません</div>';
        openModal("dayModal");
      }
      function toggleCalendarZoom() {
        const g = document.querySelector("#facilityCalendar .calendarGrid");
        if (!g) return;
        g.classList.toggle("zoomed");
        const btn = $("calZoomBtn");
        if (btn) btn.innerHTML = g.classList.contains("zoomed")
          ? '<i class="fas fa-magnifying-glass-minus"></i> 縮小'
          : '<i class="fas fa-magnifying-glass-plus"></i> 拡大';
      }



// Compatibility: keep the existing staff-name and registered-email login.
let trainingCache = null, trainingCacheAt = 0, trainingCacheTask = null;
let trainingGroup = 'todo';

let trainingSaving = false;
function localDateEnd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return NaN;
  const day=new Date(s+'T00:00:00');
  if(!Number.isFinite(day.getTime())||day.getDate()!==Number(s.slice(-2)))return NaN;
  day.setHours(23,59,59,999);return day.getTime();
}
function shouldRemoveBoard(a, now = Date.now()) {
  if (a.publishUntil) { const start = a.publishFrom ? new Date(a.publishFrom+'T00:00:00').getTime() : 0; if(start>now)return false; const end = localDateEnd(a.publishUntil); return Number.isFinite(end) && now > end; }
  // Scheduled posts get their full default 10 days starting from publication, not creation.
  const from = a.publishFrom ? new Date(a.publishFrom + 'T00:00:00').getTime() : 0;
  const created = ms(a.createdAtMs || a.createdAt);
  const base = Math.max(Number.isFinite(from) ? from : 0, created || 0);
  return !!base && now > base + DATA_RETENTION_DAYS * 86400000;
}
function canUseRoom(key) { return !!me() && !!ROOMS[key] && (key !== 'leaders' || canAccessAdminTab()); }
function safePortalUrl(value) {
  try { const u = new URL(String(value || '').trim()); return u.protocol === 'https:' ? u.href : ''; }
  catch (_) { return ''; }
}
function safeUserId() { return me()?.id || ''; }

async function login() {
 const name=$('loginName').value.trim();
 const email=$('loginEmail').value.trim().toLowerCase();
 if(!name||!email)return toast('IDとパスワードを入力してください','error');
 $('authNotice').textContent='確認中…';
 try{
  const users=await list('users');
  const found=users.find(u=>(u.name||'')===name&&String(u.email||'').toLowerCase()===email);
  if(!found){$('authNotice').textContent='IDまたはパスワードが一致しません。';return;}
  if(found.active===false){$('authNotice').textContent='この職員情報は利用停止中です。';return;}
  staffCache=users;saveMe(found);$('authNotice').textContent='';await boot();
 }catch(e){console.error(e);$('authNotice').textContent='確認できませんでした。通信状態を確認してください。';}
}
async function logout() {
 if(!confirm('ログアウトしますか？'))return;
 clearWatchers();closeRoomRealtime();portalUser=null;
 localStorage.removeItem('ku_user');localStorage.removeItem('ku_auto_login');location.reload();
}
async function boot() {
 const u=me();
 if(!u){$('loginScreen').classList.remove('hide');$('app').classList.add('hide');return;}
 $('loginScreen').classList.add('hide');$('app').classList.remove('hide');
 $('av').textContent=(u.name||'?').slice(0,1);$('meName').textContent=u.name||'';syncPermissionUI();
 $('facilityMonthView').value ||= monthStr();$('facilityMonthAdmin').value ||= monthStr();
 $('facilityMonthView').onchange=()=>loadFacilityCalendar().catch(console.error);$('facilityMonthAdmin').onchange=()=>loadFacilityCalendarAdmin();
 $('globalSearch').onkeypress=e=>{if(e.key==='Enter')runGlobalSearch();};
 $('directoryKeyword').oninput=()=>renderMiniDirectory();$('directoryDeptFilter').onchange=()=>renderMiniDirectory();
 wireBoardDraftAutosave();setNotifyBtn('default');
 try{await loadDashboard();setupRealtimeWatch();}catch(e){console.error(e);toast('画面の一部を取得できませんでした','error');}
}
async function loadStaffHints() {
  if (!me()) return;
  staffCache = staffCache.length ? staffCache : await list('users');
}
function renderQuickLinks() {
  const el=$('quickLinks');if(!el)return;
  el.innerHTML=getMyLinks().map((x,i)=>{
    if (x.type==='internal'||/^(internal:|#)/i.test(String(x.url||'').trim()))return '';
    const url=safePortalUrl(x.url);
    return `<div class="linkCard"><div><b>${esc(x.label || '')}</b><div class="tiny">${esc(x.url || '')}</div></div><div class="right">${url ? `<a class="btn out sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">開く</a>`:'<span class="tiny">httpsのURLに変更してください</span>'}<button class="btn out sm" onclick="editMyLink(${i})">編集</button><button class="btn dan sm" onclick="removeMyLink(${i})">削除</button></div></div>`;
  }).join('') || '<div class="empty">個人用のリンクを追加できます</div>';
}
async function loadProfile() {
  const u=me();if(!u)return;
  $('pName').value=u.name || '';$('pEmail').value='';$('pDept').value=u.department || '2階介護';$('pExt').value=u.extension || '';$('pBio').value=u.bio || '';
  await loadStaffHints();renderMiniDirectory(staffCache);
}
async function loadTraining(force=false) {
  if (!me())return;
  if(force){trainingCache=null;trainingCacheAt=0;}
  if(!trainingCache || Date.now()-trainingCacheAt>60000){
    if(!trainingCacheTask)trainingCacheTask=(async()=>{
      const [trainings,responses,completions]=await Promise.all([
        getTrainingLinks(force),
        db.collection('surveyResponses').where('userId','==',me().id).get(),
        db.collection('trainingCompletions').where('userId','==',me().id).get()
      ]);
      responses.docs.forEach(d=>{if(d.data().surveyId)addAnsweredSurveyId(me().id,d.data().surveyId);});
      trainingCache={trainings:trainings.filter(t=>!t.deleted && (matchesTrainingAudience(t,me()) || canManageTraining(t))),done:new Set(completions.docs.map(d=>d.data().trainingId)),hidden:new Set(completions.docs.filter(d=>d.data().hidden===true).map(d=>d.data().trainingId))};
      trainingCacheAt=Date.now();
    })().finally(()=>trainingCacheTask=null);
    await trainingCacheTask;
  }
  $('addTrainingBtn').classList.toggle('hide',!canAccessAdminTab());
  renderTrainingViews();
}
function showTrainingGroup(group) {trainingGroup=group;renderTrainingViews();}
function renderTrainingViews() {
  if(!trainingCache)return;
  const {trainings,done}=trainingCache;
  const todo=trainings.filter(t=>t.active!==false && !done.has(t.docId) && matchesTrainingAudience(t,me()));
  const managed=trainings.filter(t=>canManageTraining(t)&&!todo.includes(t)&&!done.has(t.docId));
  const finished=trainings.filter(t=>done.has(t.docId) && !trainingCache.hidden?.has(t.docId));
  $('stTrain').textContent=todo.length;
  $('trainingTodoCount').textContent=todo.length;$('trainingDoneCount').textContent=finished.length;
  document.querySelectorAll('.trainingTabs button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===(trainingGroup==='done'?1:0))));
  const rows=trainingGroup==='done'?finished:[...todo,...managed];
  $('trainingList').innerHTML=rows.map(t=>{
    const url=safePortalUrl(t.videoUrl);const complete=done.has(t.docId);
    const surveyed=!t.surveyId || getAnsweredSurveyIds(me().id).includes(t.surveyId);
    return `<div class="item" id="training-${esc(t.docId)}" tabindex="-1"><h3>${esc(t.title)}</h3><p style="white-space:pre-wrap">${esc(t.description || '')}</p><div class="meta"><span>対象：${esc(targetDeptLabel(t.targetDept))}</span><span>期限：${esc(t.dueDate || '指定なし')}</span><span>${complete?'受講完了':t.active===false?'受付終了':matchesTrainingAudience(t,me())?'未実施':'管理対象'}</span></div><div class="right">${url?`<a class="btn out" href="${esc(url)}" target="_blank" rel="noopener noreferrer">動画研修を開く</a>`:''}${t.surveyId?`<button class="btn out" onclick="openTrainingSurvey('${esc(t.surveyId)}')">${surveyed?'回答済み':'受講後アンケート'}</button>`:''}${!complete && t.active!==false && matchesTrainingAudience(t,me())?`<button class="btn sec" onclick="completeTraining('${esc(t.docId)}')">受講完了を記録</button>`:''}${complete?`<button class="btn out sm" onclick="hideCompletedTraining('${esc(t.docId)}')">履歴から削除</button>`:''}${canManageTraining(t)?`<button class="btn out sm" onclick="archiveTraining('${esc(t.docId)}')">受付終了</button><button class="btn dan sm" onclick="deleteTraining('${esc(t.docId)}')">研修を削除</button>`:''}</div></div>`;
  }).join('')||'<div class="empty">該当する研修はありません</div>';
  $('trainingHome').innerHTML=`<div class="cardHd"><h3>未実施の研修 ${todo.length}件</h3><button class="btn out sm" onclick="showTab('training',document.querySelector('[data-id=training]'))">研修へ</button></div>${todo.slice(0,3).map(t=>`<div class="summaryRow"><b>${esc(t.title)}</b><span>期限 ${esc(t.dueDate || 'なし')}</span><button class="btn out sm" data-training-id="${esc(t.docId)}" onclick="goToTraining(this.dataset.trainingId)">開く</button></div>`).join('')||'<p class="tiny">未実施の研修はありません</p>'}`;
}
async function openTrainingSurvey(id) {
  if(getAnsweredSurveyIds(me().id).includes(id))return toast('回答済みです。受講完了を記録できます');
  await openSurveyAnswer(id);
}
async function completeTraining(id) {
  const t=trainingCache?.trainings.find(t=>t.docId===id && t.active!==false);if(!t)return;
  if(!matchesTrainingAudience(t,me()))return toast('この研修は受講対象外です','error');
  // Verify linked survey on the server; local storage is not sufficient for completion checks.
  try {
  if(t.surveyId){
    const answers=await db.collection('surveyResponses').where('userId','==',me().id).get();
    const survey=await db.collection('surveys').doc(t.surveyId).get();
    if(!answers.docs.some(d=>d.data().surveyId===t.surveyId) && !(survey.exists&&getSurveyResponses({...survey.data(),docId:survey.id}).some(r=>r.userId===me().id)))return toast('関連アンケートへ回答してください','error');
  }
  if(!confirm('研修を受講しましたか？受講完了を記録します。'))return;
  const key=encodeURIComponent(me().id+'__'+id);
    const ref=db.collection('trainingCompletions').doc(key);
    await db.runTransaction(async tx=>{const d=await tx.get(ref);if(!d.exists)tx.set(ref,{userId:me().id,trainingId:id,completedAt:firebase.firestore.FieldValue.serverTimestamp(),createdAt:firebase.firestore.FieldValue.serverTimestamp()});});
    trainingCache.done.add(id);renderTrainingViews();toast('受講完了を記録しました','ok');
  }catch(e){toast('保存できませんでした。再度お試しください','error');}
}
async function openTrainingEditor(){
  if(!canAccessAdminTab())return;
  const surveys=await list('surveys');
  $('trSurvey').innerHTML='<option value="">なし：本人の完了操作で記録</option>'+surveys.filter(s=>isSurveyOpen(s)&&!linkedTrainingFor(s)&&surveyOwner(s,me())).map(s=>`<option value="${esc(s.docId)}">${esc(s.title)}（${esc(targetDeptLabel(s.targetDept))}）</option>`).join('');
  ['trTitle','trDescription','trUrl','trDue','trBoardUntil'].forEach(id=>$(id).value='');
  setAudience('trTarget');$('trBoard').checked=true;$('trainingSaveStatus').textContent='';openModal('trainingEditor');
}
async function saveTraining(){
  if(!canAccessAdminTab()||trainingSaving)return;
  const title=$('trTitle').value.trim(),videoUrl=safePortalUrl($('trUrl').value),dueDate=$('trDue').value;
  const boardUntil=$('trBoardUntil').value;
  if(!title||!videoUrl)return toast('研修名とhttpsの動画URLを入力してください','error');
  if(boardUntil&&boardUntil<todayStr())return toast('掲示板終了日は本日以降にしてください','error');
  const targetDept=readAudience('trTarget'),surveyId=$('trSurvey').value;
  if(!targetDept.length)return toast('視聴対象の部署・役割を選んでください','error');
  if(dueDate&&dueDate<todayStr())return toast('受講期限は本日以降にしてください','error');
  trainingSaving=true;$('trainingSaveBtn').disabled=true;
  try {
  const trainingRef=db.collection('trainings').doc();const batch=db.batch();
  const stamp=firebase.firestore.FieldValue.serverTimestamp();const now=Date.now();
  const training={title,description:$('trDescription').value.trim(),videoUrl,targetDept,dueDate,surveyId,active:true,creatorId:me().id,creatorName:me().name,createdAt:stamp,createdAtMs:now};
  const boardRef=$('trBoard').checked?db.collection('announcements').doc():null;
  if(surveyId){
    const survey=await db.collection('surveys').doc(surveyId).get();
    if(!survey.exists||!isSurveyOpen(survey.data()))return toast('関連アンケートがありません、または締切済みです','error');
    const links=await getTrainingLinks(true);
    if(survey.data().linkedTrainingId||links.some(t=>t.surveyId===surveyId&&!t.deleted))return toast('このアンケートは他の研修と連携済みです。別のアンケートを選んでください','error');
    if(!admin() && survey.data().creatorId!==me().id)return toast('自分で作成したアンケートを選択してください','error');
    batch.update(db.collection('surveys').doc(surveyId),{linkedTrainingId:trainingRef.id,trainingTargetDept:targetDept,trainingDeleted:false});
  }
  batch.set(trainingRef,{...training,announcementId:boardRef?.id||''});
  if(boardRef)batch.set(boardRef,{title:'【研修】'+title,content:training.description+'\n研修画面から動画を開き、受講後に完了を記録してください。',priority:'normal',creatorId:me().id,creatorName:me().name,attachments:[],externalUrl:videoUrl,publishFrom:todayStr(),publishUntil:boardUntil||dueDate||'',trainingId:trainingRef.id,targetDept,createdAt:stamp,createdAtMs:now});
  await batch.commit();trainingLinksCache=null;trainingCache=null;publishedBoardCache=null;closeModal('trainingEditor');toast('研修を登録しました','ok');await loadDashboard().catch(console.error);}
  catch(e){$('trainingSaveStatus').textContent='登録できませんでした。通信・設定を確認してください。';}
  finally{trainingSaving=false;$('trainingSaveBtn').disabled=false;}
}
async function archiveTraining(id){
  await updateTrainingAvailability(id,false);
}
// Dashboard wrapper runs after original dashboard renderer without resetting the real training count.
const baseDashboard = loadDashboard;
loadDashboard = async function(){await baseDashboard();try{await loadTraining();}catch(e){$('stTrain').textContent='—';$('trainingHome').textContent='研修情報を取得できません。更新して確認してください。';console.error(e);}};
const baseSubmitSurvey=submitSurvey;
let surveySubmitting=false, submissionSurvey=null;
submitSurvey=async function(){
 if(surveySubmitting||!activeSurveyId||!me())return;
 const id=activeSurveyId;surveySubmitting=true;
 try{
  const [doc]=await Promise.all([db.collection('surveys').doc(id).get(),getTrainingLinks(true)]);
  submissionSurvey=doc.exists?decorateTrainingSurveys([{...doc.data(),docId:doc.id}])[0]:null;
  if(activeSurveyId!==id)return;
  await baseSubmitSurvey();if(!$('surveyAnswerModal').classList.contains('show'))await loadTraining(true);
 }catch(e){toast('回答を保存できませんでした。通信状態を確認してください','error');console.error(e);}
 finally{surveySubmitting=false;submissionSurvey=null;}
};
const baseShowTab=showTab;
showTab=function(id,btn){if((id==='admin'||id==='editor')&&!canAccessAdminTab())return;if(id==='training'){baseShowTab(id,btn);loadTraining().catch(e=>toast('研修を取得できません','error'));}else baseShowTab(id,btn);};
// Default view filters include board publication dates and linked training audience.
const baseIsBoardVisible=isBoardVisibleNow;
isBoardVisibleNow=function(a,now=Date.now()){return baseIsBoardVisible(a,now)&&!shouldRemoveBoard(a,now)&&matchesTrainingAudience(a,me());};
// Replace unlimited background watchers: only active board/survey view gets a listener; room has its own.
function setupRealtimeWatch(){
 clearWatchers();if(!me())return;
 const current=document.querySelector('.screen.active')?.id;
 if(current==='dashboard')watchLatest('announcements','ann',()=>refreshBoardOnly().catch(console.error));
 if(current==='survey')watchLatest('surveys','survey',()=>loadSurveys().catch(console.error));
}
const previousShowTab=showTab;
showTab=function(id,btn){previousShowTab(id,btn);setupRealtimeWatch();};
async function goToTraining(id){
 showTab('training',document.querySelector('[data-id=training]'));
 try{await loadTraining();showTrainingGroup(trainingCache?.done.has(id)?'done':'todo');
 const item=$('training-'+id);if(item){item.scrollIntoView({block:'center'});item.focus({preventScroll:true});}
 else toast('この研修は現在の一覧には表示されていません');}catch(e){toast('研修を取得できませんでした','error');}
}
function renderTrainingBoardButton(a){return a.trainingId?`<button class="btn sec sm" data-training-id="${esc(a.trainingId)}" onclick="goToTraining(this.dataset.trainingId)">研修へ進む</button>`:'';}
const baseRenderBoard=renderBoard;
renderBoard=function(anns){baseRenderBoard(anns);for(const a of anns){const card=$('board-'+a.docId);if(card&&a.trainingId)card.insertAdjacentHTML('beforeend',renderTrainingBoardButton(a));}};
// Restrict client access paths only. Public Firestore rules still permit direct external access.
const baseList=list;
list=async function(col){if(col==='rooms_leaders'&&!canUseRoom('leaders'))throw new Error('利用権限なし');return baseList(col);};
const baseLatest=listLatest;
listLatest=async function(col,limit){if(col==='rooms_leaders'&&!canUseRoom('leaders'))throw new Error('利用権限なし');return baseLatest(col,limit);};
// Retention never runs automatically per visitor. Only explicit admin cleanup remains.
function openStaffModal(){
 if(!admin())return;
 $('staffModalTitle').textContent='スタッフ追加';
 for(const id of ['sfId','sfName','sfEmail','sfExt','sfNote'])$(id).value='';
 $('sfDept').value='2階介護';$('sfRole').value='staff';openModal('staffModal');
}

let publishedBoardCache=null,publishedBoardAt=0,publishedBoardTask=null;
async function loadPublishedBoards(){
 if(publishedBoardCache&&Date.now()-publishedBoardAt<60000)return publishedBoardCache.filter(a=>isBoardVisibleNow(a));
 if(!publishedBoardTask)publishedBoardTask=db.collection('announcements').get().then(s=>{publishedBoardCache=s.docs.map(d=>({docId:d.id,...d.data()}));publishedBoardAt=Date.now();return publishedBoardCache;}).finally(()=>publishedBoardTask=null);
 return (await publishedBoardTask).filter(a=>isBoardVisibleNow(a));
}
const originalCreateBoard=createBoard;
createBoard=async function(){publishedBoardCache=null;try{await originalCreateBoard();}finally{publishedBoardCache=null;}};
const originalDeleteBoard=deleteBoard;
deleteBoard=async function(id){publishedBoardCache=null;try{await originalDeleteBoard(id);}finally{publishedBoardCache=null;}};

let trainingLinksCache=null,trainingLinksAt=0,trainingLinksTask=null;
async function getTrainingLinks(force=false){
 if(!force&&trainingLinksCache&&Date.now()-trainingLinksAt<60000)return trainingLinksCache;
 if(!trainingLinksTask)trainingLinksTask=db.collection('trainings').get().then(q=>{
  trainingLinksCache=q.docs.map(d=>({docId:d.id,...d.data()}));trainingLinksAt=Date.now();return trainingLinksCache;
 }).finally(()=>trainingLinksTask=null);
 return trainingLinksTask;
}
function canManageTraining(t,u=me()){return !!u && (u.role==='admin'||t.creatorId===u.id);}
function audienceValues(value){
 const values=(Array.isArray(value)?value:[value||'all']).filter(v=>typeof v==='string'&&v.trim());
 return values.includes('all')?['all']:[...new Set(values)];
}
function matchesTrainingAudience(t,u){
 if(!t||!u||u.active===false)return false;
 return audienceValues(t.targetDept).some(target=>target==='all'||
  (target==='__admin__'?u.role==='admin':target==='__sharedEditor__'?['sharedEditor','admin'].includes(u.role):target===u.department));
}
function linkedTrainingFor(s){
 if(s.linkedTrainingId)return trainingLinksCache?.find(t=>t.docId===s.linkedTrainingId)||{targetDept:s.trainingTargetDept||s.targetDept,deleted:s.trainingDeleted};
 return trainingLinksCache?.find(t=>t.surveyId===s.docId&&!t.deleted)||trainingLinksCache?.find(t=>t.surveyId===s.docId)||null;
}
function canAnswerSurvey(s,u){const t=linkedTrainingFor(s);return !s.trainingDeleted&&!t?.deleted&&matchesTrainingAudience(t||s,u);}
canUserSeeSurvey=function(s,u){return !!s&&!!u&&(surveyOwner(s,u)||canAnswerSurvey(s,u));};
getTargetUsers=function(users,s){return (users||[]).filter(u=>matchesTrainingAudience(linkedTrainingFor(s)||s,u));};
function setAudience(id,value='all',locked=false){
 const root=$(id+'Choices'), select=$(id), values=audienceValues(value);
 for(const option of select.options) option.selected=values.includes(option.value);
 for(const box of root.querySelectorAll('input')){box.checked=values.includes(box.value);box.disabled=locked;}
 root.dataset.locked=locked?'1':'0';$(id+'Locked').classList.toggle('hide',!locked);
 if(!root.dataset.bound){root.dataset.bound='1';root.addEventListener('change',e=>{
  const boxes=[...root.querySelectorAll('input')];
  if(e.target.checked){if(e.target.value==='all')boxes.filter(b=>b!==e.target).forEach(b=>b.checked=false);else boxes.find(b=>b.value==='all').checked=false;}
  for(const opt of select.options)opt.selected=boxes.some(b=>b.checked&&b.value===opt.value);
 });}
}
function readAudience(id){const values=[...$(id).selectedOptions].map(o=>o.value);return values.includes('all')?'all':values;}
// Decorate query results so home, survey list, answer screen and result use one audience.
function decorateTrainingSurveys(rows){return rows.map(s=>{
 const t=linkedTrainingFor(s);
 return t?{...s,targetDept:t.targetDept,linkedTrainingId:t.docId||s.linkedTrainingId,trainingTargetDept:t.targetDept,trainingDeleted:!!t.deleted}:s;
});}
const listBeforeAudience=list;
list=async function(col){if(col==='surveys'){await getTrainingLinks().catch(console.error);return decorateTrainingSurveys(await listBeforeAudience(col));}return listBeforeAudience(col);};
const latestBeforeAudience=listLatest;
listLatest=async function(col,n){if(col==='surveys'){await getTrainingLinks().catch(console.error);return decorateTrainingSurveys(await latestBeforeAudience(col,n));}return latestBeforeAudience(col,n);};
const originalSurveyOpen=isSurveyOpen;
isSurveyOpen=function(s){return !s.trainingDeleted && originalSurveyOpen(s);};
async function hideCompletedTraining(id){
 if(!me()||!trainingCache?.done.has(id)||trainingCache.hidden?.has(id))return;
 if(!confirm('自分の受講後一覧から削除しますか？受講完了記録と他の職員の表示は残ります。'))return;
 const key=encodeURIComponent(me().id+'__'+id);
 try{
  await db.collection('trainingCompletions').doc(key).set({userId:me().id,trainingId:id,hidden:true,hiddenAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
  trainingCache.hidden ||= new Set();trainingCache.hidden.add(id);renderTrainingViews();toast('自分の一覧から削除しました','ok');
 }catch(e){toast('削除できませんでした。再度お試しください','error');}
}
async function updateTrainingAvailability(id,remove){
 const ref=db.collection('trainings').doc(id);
 try{
  const snap=await ref.get();if(!snap.exists)return toast('研修が見つかりません','error');
  const t=snap.data();if(!canManageTraining(t))return toast('作成者または管理者のみ操作できます','error');
  if(!confirm(remove?'研修を全員の一覧から削除しますか？関連する掲示板は非表示にし、受講記録とアンケート回答は保存します。':'この研修の受付を終了しますか？'))return;
  const [board,survey]=await Promise.all([
   t.announcementId?db.collection('announcements').doc(t.announcementId).get():null,
   t.surveyId?db.collection('surveys').doc(t.surveyId).get():null
  ]);
  const batch=db.batch();batch.update(ref,{active:false,...(remove?{deleted:true,deletedAt:firebase.firestore.FieldValue.serverTimestamp()}:{} )});
  if(board?.exists)batch.update(board.ref,{publishUntil:'2000-01-01'});
  // Only shut down a survey uniquely linked to this training, never unrelated survey data.
  if(remove&&survey?.exists){
   const links=await getTrainingLinks(true);
   const shared=links.some(x=>x.docId!==id&&!x.deleted&&x.surveyId===t.surveyId);
   if(!shared)batch.update(survey.ref,{trainingDeleted:true});
  }
  await batch.commit();trainingLinksCache=null;trainingCache=null;publishedBoardCache=null;
  await loadDashboard();if($('training').classList.contains('active'))await loadTraining();
  if($('survey').classList.contains('active'))await loadSurveys();toast(remove?'研修を削除しました':'受付を終了しました','ok');
 }catch(e){console.error(e);toast('更新できませんでした。通信状態を確認してください','error');}
}
async function deleteTraining(id){await updateTrainingAvailability(id,true);}
