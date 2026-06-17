/* ============================================================
   人生履歴書作成フォーム – app.js
   ============================================================ */

/* TODO: LINE Developersでこのフォーム専用のLIFFアプリを発行し、
   発行されたLIFF IDに書き換えてください。
   （前回の婚活QAアプリのIDはそのアプリ専用のため、ここでは使えません） */
const LIFF_ID = "YOUR_LIFF_ID_HERE";

const STORAGE_KEY = "life_story_draft_v1";

const CATEGORY_LIST = [
  "小学校入学前","小学校","中学校","高校","専門学校","短期大学","大学","大学院",
  "留学","会社","転職期間","無職期間","その他",
];

/* 共有URL用：カード1件を配列にする際のフィールド順（キー名を持たせず短縮） */
const CARD_FIELD_ORDER = [
  "category","categoryName","startYear","startAge","endYear","endAge",
  "orgName","livedPlace","hobby","lessons","bestMemory","onePhrase","freeText",
];

let createdAt = null; // 完成画面の「作成日」。プレビュー／共有を初めて開いた時点で確定する

/* ------------------------------------------------------------
   URLセーフ Base64 エンコード／デコード（前回アプリと同じ方式）
   ------------------------------------------------------------ */
function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad    = padded.length % 4;
  const fixed  = pad ? padded + "=".repeat(4 - pad) : padded;
  return decodeURIComponent(escape(atob(fixed)));
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------
   カードデータの初期値
   ------------------------------------------------------------ */
function createCardData(overrides = {}) {
  return Object.assign({
    category: "", categoryName: "",
    startYear: "", startAge: "", endYear: "", endAge: "",
    orgName: "", livedPlace: "", hobby: "", lessons: "",
    bestMemory: "", onePhrase: "", freeText: "",
  }, overrides);
}

/* ------------------------------------------------------------
   カードDOM生成
   ------------------------------------------------------------ */
function renderCard(cardData) {
  const tpl = document.getElementById("cardTemplate");
  const node = tpl.content.firstElementChild.cloneNode(true);

  const select = node.querySelector(".card-category");
  select.innerHTML =
    `<option value="" disabled ${cardData.category ? "" : "selected"}>カテゴリを選択</option>` +
    CATEGORY_LIST.map(c => `<option value="${escapeHTML(c)}" ${c === cardData.category ? "selected" : ""}>${escapeHTML(c)}</option>`).join("");

  const otherField = node.querySelector(".other-category-field");
  otherField.classList.toggle("hidden", cardData.category !== "その他");

  const fieldMap = {
    ".card-categoryName": "categoryName",
    ".card-startYear":    "startYear",
    ".card-startAge":     "startAge",
    ".card-endYear":      "endYear",
    ".card-endAge":       "endAge",
    ".card-orgName":      "orgName",
    ".card-livedPlace":   "livedPlace",
    ".card-hobby":        "hobby",
    ".card-lessons":      "lessons",
    ".card-bestMemory":   "bestMemory",
    ".card-onePhrase":    "onePhrase",
    ".card-freeText":     "freeText",
  };
  Object.keys(fieldMap).forEach(sel => {
    const el = node.querySelector(sel);
    if (el) el.value = cardData[fieldMap[sel]] || "";
  });

  select.addEventListener("change", () => {
    otherField.classList.toggle("hidden", select.value !== "その他");
    if (select.value !== "その他") node.querySelector(".card-categoryName").value = "";
    saveDraft();
  });

  node.querySelector(".delete-card").addEventListener("click", () => {
    if (!confirm("このカードを削除しますか？この操作は取り消せません。")) return;
    node.remove();
    saveDraft();
  });

  document.getElementById("cardList").appendChild(node);
  return node;
}

function addCard(data) {
  renderCard(data || createCardData());
  saveDraft();
}

/* ------------------------------------------------------------
   ドラッグ＆ドロップ並び替え（ポインターイベント／スマホ・PC共通）
   ------------------------------------------------------------ */
function setupDragReorder() {
  const list = document.getElementById("cardList");
  let dragCard = null;
  let pointerId = null;
  let lastClientY = 0;

  function onPointerMove(e) {
    if (!dragCard) return;
    const dy = e.clientY - lastClientY;
    dragCard.style.transform = `translateY(${dy}px) scale(1.03)`;

    const rect = dragCard.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const siblings = [...list.children].filter(c => c !== dragCard);

    for (const sib of siblings) {
      const sRect = sib.getBoundingClientRect();
      if (centerY > sRect.top && centerY < sRect.bottom) {
        if (centerY < sRect.top + sRect.height / 2) {
          list.insertBefore(dragCard, sib);
        } else {
          list.insertBefore(dragCard, sib.nextElementSibling);
        }
        lastClientY = e.clientY;
        dragCard.style.transform = "translateY(0px) scale(1.03)";
        break;
      }
    }
  }

  function onPointerUp(e) {
    if (!dragCard) return;
    try { dragCard.querySelector(".drag-handle").releasePointerCapture(pointerId); } catch (_) {}
    dragCard.classList.remove("dragging");
    dragCard.style.transform = "";
    dragCard.style.zIndex = "";
    list.removeEventListener("pointermove", onPointerMove);
    list.removeEventListener("pointerup", onPointerUp);
    list.removeEventListener("pointercancel", onPointerUp);
    dragCard = null;
    saveDraft();
  }

  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const card = handle.closest(".life-card");
    if (!card) return;
    e.preventDefault();

    dragCard = card;
    pointerId = e.pointerId;
    lastClientY = e.clientY;

    card.classList.add("dragging");
    card.style.zIndex = "50";
    handle.setPointerCapture(pointerId);

    list.addEventListener("pointermove", onPointerMove);
    list.addEventListener("pointerup", onPointerUp);
    list.addEventListener("pointercancel", onPointerUp);
  });
}

/* ------------------------------------------------------------
   現在の入力内容をDOMから収集
   ------------------------------------------------------------ */
function collectProfile() {
  return {
    name:  document.getElementById("profileName").value.trim(),
    age:   document.getElementById("profileAge").value.trim(),
    intro: document.getElementById("profileIntro").value.trim(),
  };
}

function collectCards() {
  return [...document.querySelectorAll("#cardList .life-card")].map(node => ({
    category:     node.querySelector(".card-category").value,
    categoryName: node.querySelector(".card-categoryName").value.trim(),
    startYear:    node.querySelector(".card-startYear").value.trim(),
    startAge:     node.querySelector(".card-startAge").value.trim(),
    endYear:      node.querySelector(".card-endYear").value.trim(),
    endAge:       node.querySelector(".card-endAge").value.trim(),
    orgName:      node.querySelector(".card-orgName").value.trim(),
    livedPlace:   node.querySelector(".card-livedPlace").value.trim(),
    hobby:        node.querySelector(".card-hobby").value.trim(),
    lessons:      node.querySelector(".card-lessons").value.trim(),
    bestMemory:   node.querySelector(".card-bestMemory").value.trim(),
    onePhrase:    node.querySelector(".card-onePhrase").value.trim(),
    freeText:     node.querySelector(".card-freeText").value.trim(),
  }));
}

/* ------------------------------------------------------------
   下書き保存／復元（LocalStorage）
   ------------------------------------------------------------ */
function saveDraft() {
  try {
    const payload = { profile: collectProfile(), cards: collectCards(), createdAt };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    flashSaved();
  } catch (e) {
    console.warn("draft save failed", e);
  }
}

function flashSaved() {
  const badge = document.getElementById("saveStatus");
  if (!badge) return;
  badge.classList.add("just-saved");
  setTimeout(() => badge.classList.remove("just-saved"), 400);
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);

    document.getElementById("profileName").value  = data.profile?.name  || "";
    document.getElementById("profileAge").value    = data.profile?.age   || "";
    document.getElementById("profileIntro").value  = data.profile?.intro || "";
    createdAt = data.createdAt || null;

    (data.cards || []).forEach(c => renderCard(createCardData(c)));
    return (data.cards && data.cards.length > 0) || !!(data.profile?.name || data.profile?.intro);
  } catch (e) {
    console.warn("draft load failed", e);
    return false;
  }
}

function hasAnyDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return (data.cards && data.cards.length > 0) || !!(data.profile?.name || data.profile?.intro);
  } catch (_) { return false; }
}

/* ------------------------------------------------------------
   共有用エンコード／デコード（URLセーフBase64・キー短縮、前回と同じ方式）
   ------------------------------------------------------------ */
function encodeShareData(profile, cards) {
  const payload = {
    n: profile.name  || "",
    a: profile.age   || "",
    i: profile.intro || "",
    d: createdAt      || "",
    c: cards.map(card => CARD_FIELD_ORDER.map(f => card[f] || "")),
  };
  return base64UrlEncode(JSON.stringify(payload));
}

function decodeShareData(encoded) {
  const payload = JSON.parse(base64UrlDecode(encoded));
  const profile = { name: payload.n || "", age: payload.a || "", intro: payload.i || "" };
  const cards = (payload.c || []).map(arr => {
    const obj = {};
    CARD_FIELD_ORDER.forEach((f, i) => { obj[f] = arr[i] || ""; });
    return obj;
  });
  return { profile, cards, createdAt: payload.d || "" };
}

function getFormBaseURL() {
  return location.href.split("?")[0].split("#")[0];
}

function buildShareURL() {
  const encoded = encodeShareData(collectProfile(), collectCards());
  return `${getFormBaseURL()}?share=${encoded}`;
}

function getSharedDataFromURL() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("share");
  if (!raw) return null;
  try { return decodeShareData(raw); } catch (e) { console.error("share decode error", e); return null; }
}

/* ------------------------------------------------------------
   期間・日付の表示整形
   ------------------------------------------------------------ */
function formatPeriod(card) {
  const y1 = card.startYear, y2 = card.endYear, a1 = card.startAge, a2 = card.endAge;
  let yearPart = "";
  if (y1 && y2) yearPart = `${y1}〜${y2}`;
  else if (y1) yearPart = `${y1}〜`;
  else if (y2) yearPart = `〜${y2}`;

  let agePart = "";
  if (a1 !== "" && a2 !== "") agePart = `（${a1}〜${a2}歳）`;
  else if (a1 !== "") agePart = `（${a1}歳〜）`;
  else if (a2 !== "") agePart = `（〜${a2}歳）`;

  return [yearPart, agePart].filter(Boolean).join("") || "期間未設定";
}

function formatDateLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------
   カテゴリアイコン
   ------------------------------------------------------------ */
const CATEGORY_ICON_SVG = {
  home:   '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10v9h14v-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  school: '<svg viewBox="0 0 24 24"><path d="M12 4 2 9l10 5 10-5-10-5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 11.5V17c0 1 2.7 2 6 2s6-1 6-2v-5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  globe:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 12h16M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  work:   '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  switch: '<svg viewBox="0 0 24 24"><path d="M4.5 9a7.5 7.5 0 0 1 12-4.6l1.7-.9.3 4.8-4.8-.4 1.6-1.3A5.5 5.5 0 0 0 6.4 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/><path d="M19.5 15a7.5 7.5 0 0 1-12 4.6l-1.7.9-.3-4.8 4.8.4-1.6 1.3A5.5 5.5 0 0 0 17.6 15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  rest:   '<svg viewBox="0 0 24 24"><path d="M6.5 17a4 4 0 1 1 .6-7.96A5 5 0 0 1 16.4 10a3.5 3.5 0 0 1 .4 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  spark:  '<svg viewBox="0 0 24 24"><path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.5 5.5l4 4M14.5 14.5l4 4M18.5 5.5l-4 4M9.5 14.5l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  dot:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
};

function categoryIconKind(category) {
  if (!category) return "dot";
  if (category === "小学校入学前") return "home";
  if (["小学校","中学校","高校","専門学校","短期大学","大学","大学院"].includes(category)) return "school";
  if (category === "留学") return "globe";
  if (category === "会社") return "work";
  if (category === "転職期間") return "switch";
  if (category === "無職期間") return "rest";
  return "spark"; // その他・カスタムカテゴリ
}

function categoryIconHTML(category) {
  return `<span class="cat-icon">${CATEGORY_ICON_SVG[categoryIconKind(category)]}</span>`;
}

function decoFlourishSVG() {
  return `<svg viewBox="0 0 160 28" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 14 C32 3,50 25,76 13 S122 1,154 14" fill="none" stroke="#f4b8c5" stroke-width="2" stroke-linecap="round"/>
    <circle cx="24" cy="9" r="2.6" fill="#f48ca0"/>
    <circle cx="58" cy="19" r="2.6" fill="#f48ca0"/>
    <circle cx="96" cy="8" r="2.6" fill="#f48ca0"/>
    <circle cx="132" cy="18" r="2.6" fill="#f48ca0"/>
  </svg>`;
}

/* ------------------------------------------------------------
   タイムライン（プレビュー／公開ビュー 共通レンダラ）
   ------------------------------------------------------------ */
function renderTimeline(container, profile, cardsArr, opts = {}) {
  const { showViewerCTA = false } = opts;
  const dateLabel = formatDateLabel(createdAt || profile.createdAt);

  const itemsHTML = cardsArr.map(card => {
    const period = formatPeriod(card);
    const catLabel = card.category === "その他" ? (card.categoryName || "その他") : card.category;

    const rows = [
      ["学校名・施設名", card.orgName],
      ["住んでいた場所", card.livedPlace],
      ["趣味", card.hobby],
      ["習い事・部活動", card.lessons],
      ["一番の思い出", card.bestMemory],
      ["一言で表すと", card.onePhrase],
      ["自由記述", card.freeText],
    ].filter(([, v]) => v && String(v).trim() !== "");

    return `
      <div class="timeline-item">
        <div class="timeline-rail"><span class="timeline-dot"></span></div>
        <div class="timeline-card">
          <p class="timeline-period">${escapeHTML(period)}</p>
          <p class="timeline-category">${categoryIconHTML(card.category)}<span>${escapeHTML(catLabel || "（カテゴリ未設定）")}</span></p>
          ${rows.map(([label, val]) => `
            <div class="field-row">
              <span class="field-row-label">${escapeHTML(label)}</span>
              <span class="field-row-value">${escapeHTML(val).replace(/\n/g, "<br>")}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="timeline-header">
      <div class="timeline-header-deco">${decoFlourishSVG()}</div>
      <p class="timeline-header-title">人生履歴書</p>
      <p class="timeline-header-sub">MY LIFE STORY</p>
      <div class="timeline-profile">
        <div class="avatar-circle">${escapeHTML((profile.name || "?").trim().slice(0, 1) || "?")}</div>
        <div class="timeline-profile-text">
          <p class="timeline-profile-name">${escapeHTML(profile.name || "名前未設定")}${profile.age ? `（${escapeHTML(String(profile.age))}歳）` : ""}</p>
          ${profile.intro ? `<p class="timeline-profile-intro">${escapeHTML(profile.intro).replace(/\n/g, "<br>")}</p>` : ""}
        </div>
      </div>
      ${dateLabel ? `<p class="timeline-date">作成日：${escapeHTML(dateLabel)}</p>` : ""}
    </div>

    <div class="timeline-list">
      ${itemsHTML || `<div class="timeline-empty">まだ出来事が登録されていません</div>`}
    </div>

    ${showViewerCTA ? `
      <div class="cta-card">
        <p class="cta-title">あなたも人生履歴書を作ってみませんか？</p>
        <p class="cta-text">生い立ちから今までの歩みを、ストーリーとして伝えられます。</p>
        <button type="button" class="btn-primary cta-btn" id="ctaCreateBtn">私も作成する</button>
      </div>
    ` : ""}
  `;

  if (showViewerCTA) {
    const btn = container.querySelector("#ctaCreateBtn");
    if (btn) btn.addEventListener("click", () => { location.href = getFormBaseURL(); });
  }
}

/* ------------------------------------------------------------
   公開ビュー（共有リンクで開かれた場合。LIFFログイン不要）
   ------------------------------------------------------------ */
function renderPublicView(shared) {
  document.getElementById("app").style.display = "none";
  const pv = document.getElementById("publicView");
  pv.style.display = "block";
  createdAt = shared.createdAt || null;
  renderTimeline(pv, shared.profile, shared.cards, { showViewerCTA: true });
}

/* ------------------------------------------------------------
   タブ切り替え
   ------------------------------------------------------------ */
function switchTab(tab) {
  ["input","preview","share","settings"].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  if (tab === "preview") {
    if (!createdAt) { createdAt = new Date().toISOString(); saveDraft(); }
    renderTimeline(document.getElementById("previewTimeline"), collectProfile(), collectCards(), { showViewerCTA: false });
  }
  if (tab === "share") {
    if (!createdAt) { createdAt = new Date().toISOString(); saveDraft(); }
    document.getElementById("shareUrlInput").value = buildShareURL();
  }
}

/* ------------------------------------------------------------
   LINEトーク（本人）への送信。トーク画面から開かれている場合のみ有効
   ------------------------------------------------------------ */
async function sendShareMessageToSelf(text) {
  try {
    if (liff.isInClient() && liff.isApiAvailable("sendMessages")) {
      await liff.sendMessages([{ type: "text", text }]);
    }
  } catch (e) {
    console.warn("sendMessages (self) skipped:", e);
  }
}

/* ------------------------------------------------------------
   イベント登録（メイン画面）
   ------------------------------------------------------------ */
function bindEvents() {
  document.getElementById("addCardBtn").addEventListener("click", () => addCard());

  // 入力内容の自動保存（入力のたび・debounce）
  let saveTimer = null;
  document.getElementById("tab-input").addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 500);
  });

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("backToInputBtn").addEventListener("click", () => switchTab("input"));

  document.getElementById("copyUrlBtn").addEventListener("click", async () => {
    const input = document.getElementById("shareUrlInput");
    const btn = document.getElementById("copyUrlBtn");
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (_) {
      input.removeAttribute("readonly");
      input.select();
      try { document.execCommand("copy"); } catch (_) {}
      input.setAttribute("readonly", "true");
    }
    btn.textContent = "コピーしました";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = "コピー"; btn.classList.remove("copied"); }, 1800);
  });

  document.getElementById("lineShareBtn").addEventListener("click", async () => {
    const url  = document.getElementById("shareUrlInput").value || buildShareURL();
    const name = collectProfile().name;
    const message = name
      ? `${name}さんの人生履歴書が届きました。\n見てみる→${url}`
      : `人生履歴書が届きました。\n見てみる→${url}`;

    await sendShareMessageToSelf(message);

    const lineShareURL = `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
    if (liff.isInClient()) {
      window.location.href = lineShareURL;
    } else {
      window.open(lineShareURL, "_blank");
    }
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("下書きを削除して最初から作成しますか？この操作は取り消せません。")) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    location.href = getFormBaseURL();
  });

  setupDragReorder();
}

/* ------------------------------------------------------------
   メイン処理
   ------------------------------------------------------------ */
(async () => {

  /* ----- 共有リンクで開かれた場合（LIFFログイン不要） ----- */
  const shared = getSharedDataFromURL();
  if (shared) {
    renderPublicView(shared);
    return;
  }

  /* ----- LIFF 初期化 ----- */
  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (e) {
    console.error("LIFF init failed", e);
    alert("LIFFの初期化に失敗しました。");
    return;
  }

  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }

  /* ----- 下書き復元 ----- */
  const hadDraft = loadDraft();

  bindEvents();

  /* ----- トップ画面の表示切り替え ----- */
  const startBtn  = document.getElementById("startBtn");
  const resumeBtn = document.getElementById("resumeBtn");

  if (hadDraft) {
    resumeBtn.classList.remove("hidden");
    startBtn.textContent = "新しく作成する";
  }

  function goToMain() {
    document.getElementById("screen-top").classList.add("hidden");
    document.getElementById("screen-main").classList.remove("hidden");
    switchTab("input");
  }

  startBtn.addEventListener("click", () => {
    if (hadDraft && !confirm("これまでの下書きを削除して、新しく作成しますか？")) return;
    if (hadDraft) {
      document.getElementById("cardList").innerHTML = "";
      document.getElementById("profileName").value = "";
      document.getElementById("profileAge").value = "";
      document.getElementById("profileIntro").value = "";
      createdAt = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    }
    if (document.querySelectorAll("#cardList .life-card").length === 0) {
      addCard();
    }
    goToMain();
  });

  resumeBtn.addEventListener("click", goToMain);

})();
