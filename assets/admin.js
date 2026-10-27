(function () {
  "use strict";

  // 網站所在的 GitHub repo
  const OWNER = "rascalxp";
  const REPO = "rascalxp.github.io";
  const BRANCH = "main";
  const DATA_PATH = "data/analysis.json";
  const TOKEN_KEY = "gh_token";
  const DRAFT_KEY = "analysis_draft";

  const $ = (id) => document.getElementById(id);
  const api = `https://api.github.com/repos/${OWNER}/${REPO}`;

  // ---------- 小工具 ----------
  const store = {
    get(k) { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch { return null; } },
    set(k, v, persist) {
      try { (persist ? localStorage : sessionStorage).setItem(k, v); } catch { /* 無痕模式等情況 */ }
    },
    del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* 忽略 */ } },
  };

  function todayTW() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  }

  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  const textToB64 = (s) => bytesToB64(new TextEncoder().encode(s));
  const b64ToText = (b64) => {
    const bin = atob(b64.replace(/\n/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };

  function setStatus(msg, kind) {
    const s = $("status");
    s.textContent = msg;
    s.className = "status" + (kind ? " " + kind : "");
  }

  let token = store.get(TOKEN_KEY);

  async function gh(path, opts = {}) {
    const res = await fetch(path.startsWith("http") ? path : api + path, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  function explain(err) {
    if (err.status === 401) return "金鑰無效或已過期，請重新登入。";
    if (err.status === 403) return "金鑰權限不足：請確認金鑰有這個 repo 的 Contents「Read and write」權限。";
    if (err.status === 404) return "找不到 repo，或金鑰沒有被授權存取這個 repo。";
    return "發生錯誤：" + err.message;
  }

  // ---------- 讀寫 analysis.json ----------
  async function readPosts() {
    try {
      const file = await gh(`/contents/${DATA_PATH}?ref=${BRANCH}&t=${Date.now()}`);
      const data = JSON.parse(b64ToText(file.content));
      return { sha: file.sha, posts: Array.isArray(data.posts) ? data.posts : [] };
    } catch (err) {
      if (err.status === 404) return { sha: null, posts: [] };
      throw err;
    }
  }

  // 每次都先抓最新版本再修改，避免蓋掉別處的更新；版本衝突時重試一次
  async function updatePosts(mutate, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { sha, posts } = await readPosts();
      const next = mutate(posts.slice()).sort((a, b) => (a.date < b.date ? 1 : -1));
      const body = {
        message,
        branch: BRANCH,
        content: textToB64(JSON.stringify({ posts: next }, null, 2) + "\n"),
      };
      if (sha) body.sha = sha;
      try {
        await gh(`/contents/${DATA_PATH}`, { method: "PUT", body: JSON.stringify(body) });
        return next;
      } catch (err) {
        if ((err.status === 409 || err.status === 422) && attempt === 0) continue;
        throw err;
      }
    }
  }

  // ---------- 畫面 ----------
  let posts = [];
  let editingDate = null; // 正在編輯的既有文章日期

  function renderPreview() {
    const md = $("post-content").value;
    $("preview-title").textContent = $("post-title").value;
    const html = window.marked ? window.marked.parse(md) : md;
    $("preview").innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(html) : "";
    // 剛上傳的圖片網站還沒更新，預覽時先從 GitHub 原始檔讀
    $("preview").querySelectorAll('img[src^="uploads/"]').forEach((img) => {
      img.src = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${img.getAttribute("src")}`;
    });
  }

  function saveDraft() {
    store.set(DRAFT_KEY, JSON.stringify({
      date: $("post-date").value, title: $("post-title").value,
      content: $("post-content").value, editingDate,
    }), true);
  }

  function fillEditor(p, isExisting) {
    $("post-date").value = p.date || todayTW();
    $("post-title").value = p.title || "";
    $("post-content").value = p.content || "";
    editingDate = isExisting ? p.date : null;
    $("editor-heading").textContent = isExisting ? `編輯 ${p.date} 的分析` : "新增大盤分析";
    $("delete-btn").hidden = !isExisting;
    renderPreview();
  }

  function renderList() {
    const ul = $("post-list");
    ul.replaceChildren();
    if (!posts.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "還沒有任何文章。";
      ul.append(li);
      return;
    }
    for (const p of posts) {
      const li = document.createElement("li");
      const left = document.createElement("div");
      const d = document.createElement("span");
      d.className = "d";
      d.textContent = p.date;
      left.append(d, p.title || "（無標題）");
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.type = "button";
      btn.textContent = "編輯";
      btn.addEventListener("click", () => {
        fillEditor(p, true);
        saveDraft();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      li.append(left, btn);
      ul.append(li);
    }
  }

  async function refreshList() {
    ({ posts } = await readPosts());
    posts.sort((a, b) => (a.date < b.date ? 1 : -1));
    renderList();
  }

  // ---------- 編輯工具列 ----------
  function wrapSelection(before, after, placeholder) {
    const ta = $("post-content");
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || placeholder;
    ta.value = value.slice(0, s) + before + sel + after + value.slice(e);
    ta.focus();
    ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    ta.dispatchEvent(new Event("input"));
  }

  function prefixLines(makePrefix) {
    const ta = $("post-content");
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const block = value.slice(lineStart, e) || "";
    const lines = block.split("\n").map((l, i) => makePrefix(i) + l);
    ta.value = value.slice(0, lineStart) + lines.join("\n") + value.slice(e);
    ta.focus();
    ta.dispatchEvent(new Event("input"));
  }

  const actions = {
    h2: () => prefixLines(() => "## "),
    bold: () => wrapSelection("**", "**", "重點文字"),
    list: () => prefixLines(() => "- "),
    olist: () => prefixLines((i) => `${i + 1}. `),
    quote: () => prefixLines(() => "> "),
    red: () => wrapSelection('<span class="up">', "</span>", "上漲"),
    green: () => wrapSelection('<span class="down">', "</span>", "下跌"),
  };

  // 大圖先縮小再上傳（寬度最多 1600px），避免拖慢網頁
  async function prepareImage(file) {
    if (file.size < 800 * 1024 || file.type === "image/gif") {
      return { bytes: new Uint8Array(await file.arrayBuffer()), ext: (file.name.split(".").pop() || "png").toLowerCase() };
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: "jpg" };
  }

  async function uploadImage(file) {
    setStatus("圖片上傳中…");
    const { bytes, ext } = await prepareImage(file);
    const [y, m] = todayTW().split("-");
    const path = `uploads/${y}/${m}/${Date.now()}.${ext.replace(/[^a-z0-9]/g, "") || "png"}`;
    await gh(`/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({ message: `上傳圖片 ${path}`, branch: BRANCH, content: bytesToB64(bytes) }),
    });
    wrapSelection(`\n![`, `](${path})\n`, "圖片說明");
    setStatus("圖片已上傳（發布後約 1～2 分鐘才看得到）。", "ok");
  }

  // ---------- 事件 ----------
  async function login() {
    const t = $("token").value.trim();
    if (!t) return;
    token = t;
    $("login-btn").disabled = true;
    $("login-status").textContent = "驗證中…";
    $("login-status").className = "status";
    try {
      await gh("");
      await readPosts();
      store.set(TOKEN_KEY, t, $("remember").checked);
      showEditor();
    } catch (err) {
      token = null;
      $("login-status").textContent = explain(err);
      $("login-status").className = "status err";
    } finally {
      $("login-btn").disabled = false;
    }
  }

  function showEditor() {
    $("login-box").hidden = true;
    $("editor-box").hidden = false;
    $("logout").hidden = false;
    let draft = null;
    try { draft = JSON.parse(store.get(DRAFT_KEY) || "null"); } catch { draft = null; }
    if (draft && (draft.content || draft.title)) {
      fillEditor(draft, false);
      editingDate = draft.editingDate || null;
      $("delete-btn").hidden = !editingDate;
      if (editingDate) $("editor-heading").textContent = `編輯 ${editingDate} 的分析`;
      setStatus("已載入上次未發布的草稿。");
    } else {
      fillEditor({ date: todayTW() }, false);
    }
    refreshList().catch((err) => setStatus(explain(err), "err"));
  }

  async function publish() {
    const date = $("post-date").value;
    const title = $("post-title").value.trim();
    const content = $("post-content").value.trim();
    if (!date || !content) {
      setStatus("請填寫日期和內容。", "err");
      return;
    }
    const exists = posts.some((p) => p.date === date && p.date !== editingDate);
    if (exists && !confirm(`${date} 已經有一篇分析，要覆蓋嗎？`)) return;

    $("publish-btn").disabled = true;
    setStatus("發布中…");
    try {
      const post = { date, title, content, updated: new Date().toISOString() };
      const oldDate = editingDate;
      posts = await updatePosts(
        (list) => list.filter((p) => p.date !== date && p.date !== oldDate).concat(post),
        `大盤分析 ${date}${title ? "：" + title : ""}`,
      );
      editingDate = date;
      $("delete-btn").hidden = false;
      $("editor-heading").textContent = `編輯 ${date} 的分析`;
      store.del(DRAFT_KEY);
      renderList();
      setStatus("已發布！約 1～2 分鐘後首頁會更新。", "ok");
    } catch (err) {
      setStatus(explain(err), "err");
    } finally {
      $("publish-btn").disabled = false;
    }
  }

  async function removePost() {
    if (!editingDate || !confirm(`確定要刪除 ${editingDate} 的分析嗎？刪除後無法復原。`)) return;
    $("delete-btn").disabled = true;
    try {
      const target = editingDate;
      posts = await updatePosts((list) => list.filter((p) => p.date !== target), `刪除大盤分析 ${target}`);
      store.del(DRAFT_KEY);
      fillEditor({ date: todayTW() }, false);
      renderList();
      setStatus("已刪除。", "ok");
    } catch (err) {
      setStatus(explain(err), "err");
    } finally {
      $("delete-btn").disabled = false;
    }
  }

  $("login-btn").addEventListener("click", login);
  $("token").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  $("logout").addEventListener("click", (e) => {
    e.preventDefault();
    store.del(TOKEN_KEY);
    location.reload();
  });
  $("publish-btn").addEventListener("click", publish);
  $("delete-btn").addEventListener("click", removePost);
  $("new-btn").addEventListener("click", () => {
    if (($("post-content").value || $("post-title").value) && !confirm("確定要清空目前的內容嗎？")) return;
    store.del(DRAFT_KEY);
    fillEditor({ date: todayTW() }, false);
    setStatus("");
  });
  for (const id of ["post-date", "post-title", "post-content"]) {
    $(id).addEventListener("input", () => { renderPreview(); saveDraft(); });
  }
  document.querySelector(".toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-md]");
    if (b) actions[b.dataset.md]();
  });
  $("img-btn").addEventListener("click", () => $("img-input").click());
  $("img-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { await uploadImage(file); } catch (err) { setStatus(explain(err), "err"); }
  });

  if (token) showEditor();
  else $("login-box").hidden = false;
})();
