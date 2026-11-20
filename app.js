"use strict";

const LS_SWIPES = "repofeed.swipes.v1";

// ---------- Состояние ----------
let mode = "feed";                 // feed | reco | list | liked | history
const DEFAULT_TOPIC = "machine-learning";
let currentTag = DEFAULT_TOPIC;
let queue = [];                    // очередь карточек для свайпа
let lastRemoved = null;            // для undo

let listPage = 1, listPerPage = 100, listHasMore = true;
let historyFilter = "all";

// ---------- DOM ----------
const $ = sel => document.querySelector(sel);
const stackEl = $("#stack");
const deckWrap = $("#deckWrap");
const tagInput = $("#tagInput");
const panels = { list: $("#listPanel"), liked: $("#likedPanel"), history: $("#historyPanel") };

// ================= Хранилище свайпов (localStorage) =================
function loadSwipes() {
  try { return JSON.parse(localStorage.getItem(LS_SWIPES)) || {}; }
  catch { return {}; }
}
function saveSwipes(obj) {
  try { localStorage.setItem(LS_SWIPES, JSON.stringify(obj)); } catch {}
}
function recordSwipe(repo, action) {
  const all = loadSwipes();
  all[repo.id] = {
    action, ts: Date.now(),
    repo: {
      id: repo.id, name: repo.name, full_name: repo.full_name, description: repo.description,
      language: repo.language, topics: repo.topics || [],
      stargazers_count: repo.stargazers_count, html_url: repo.html_url,
      owner_login: repo.owner_login, owner_avatar_url: repo.owner_avatar_url,
    },
  };
  saveSwipes(all);
}
function removeSwipe(repoId) {
  const all = loadSwipes();
  delete all[repoId];
  saveSwipes(all);
}
function swipedIds() { return new Set(Object.keys(loadSwipes()).map(Number)); }


const API = "https://api.github.com";
const FULL_NAME = /^[a-z\d_.-]+\/[a-z\d_.-]+$/i;
const TOPIC = /^[a-z\d][a-z\d-]{0,49}$/i;
const tokenKey = "repofeed.github.session";
const extensionStorage = globalThis.chrome?.storage?.session;
let token = sessionStorage.getItem(tokenKey) || "";
let account = null;
let deckRequest;
let listRequest;
let feedPage = 1;
let recommendationTopics = [];
let hasMore = false;
let loadingMore = false;
let requestedSummary = 0;
const searchCache = new Map();
const summaries = new Map();

function githubUrl(fullName) {
  return FULL_NAME.test(fullName) ? "https://github.com/" + fullName : "#";
}

function avatarUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://avatars.githubusercontent.com" ? url.origin + url.pathname : "";
  } catch {
    return "";
  }
}

async function github(path, { signal, auth = token, media = "application/vnd.github+json" } = {}) {
  const headers = { Accept: media, "X-GitHub-Api-Version": "2022-11-28" };
  if (auth) headers.Authorization = "Bearer " + auth;
  const response = await fetch(API + path, { signal, headers, credentials: "omit", redirect: "error" });
  if (response.status === 401) throw new Error("Сессия GitHub недействительна. Подключи аккаунт заново.");
  if (response.status === 429 || (response.status === 403 &&
      (response.headers.get("X-RateLimit-Remaining") === "0" || response.headers.has("Retry-After")))) {
    throw new Error("Достигнут лимит GitHub API. Подожди минуту и повтори запрос.");
  }
  if (!response.ok) {
    const error = new Error(response.status === 404 ? "GitHub не нашёл эти данные." : "GitHub вернул ошибку " + response.status + ".");
    error.status = response.status;
    throw error;
  }
  return response;
}

async function ghSearch(topic, page, size, signal) {
  if (!TOPIC.test(topic)) return { items: [], total_count: 0 };
  const params = new URLSearchParams({q: "topic:" + topic + " archived:false is:public", sort: "stars", page, per_page: size});
  const key = params.toString();
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.time < 120000) return cached.value;
  const auth = token;
  const response = await github("/search/repositories?" + key, {signal, auth});
  const data = await response.json();
  const items = data.items.filter(repo => FULL_NAME.test(repo.full_name)).map(repo => ({
    id: repo.id, name: repo.name, full_name: repo.full_name,
    owner_login: repo.owner.login, owner_avatar_url: avatarUrl(repo.owner.avatar_url),
    description: repo.description, language: repo.language, topics: repo.topics || [],
    stargazers_count: repo.stargazers_count, forks_count: repo.forks_count,
    open_issues_count: repo.open_issues_count, html_url: githubUrl(repo.full_name),
  }));
  const value = {items, total_count: data.total_count};
  if (auth === token) {
    if (searchCache.size >= 50) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(key, {time: Date.now(), value});
  }
  return value;
}

function showAccount() {
  $("#accountBtn").textContent = account ? "@" + account.login : "GitHub";
  $("#accountStatus").textContent = account ? "Подключён @" + account.login : "Без входа доступна публичная выдача.";
  $("#signOutBtn").hidden = !token;
  $("#tokenForm").hidden = Boolean(account);
}

async function connectAccount(candidate) {
  const response = await github("/user", {auth: candidate});
  account = await response.json();
  token = candidate;
  sessionStorage.setItem(tokenKey, candidate);
  if (extensionStorage) await extensionStorage.set({[tokenKey]: candidate});
  searchCache.clear();
  showAccount();
  switchMode(mode);
}

async function deviceCall(path, fields) {
  if (globalThis.RepoFeedAndroid?.oauth) {
    const result = JSON.parse(RepoFeedAndroid.oauth(path, new URLSearchParams(fields).toString()));
    if (result.transportError) throw new Error("GitHub не ответил на запрос входа.");
    return result;
  }
  const response = await fetch("https://github.com/login/" + path, {
    method: "POST", headers: {Accept: "application/json"},
    body: new URLSearchParams(fields), credentials: "omit",
  });
  if (!response.ok) throw new Error("GitHub не ответил на запрос входа.");
  return response.json();
}

async function startDeviceLogin(clientId) {
  const button = $("#deviceLoginBtn");
  const status = $("#accountStatus");
  const verify = $("#verifyDevice");
  button.disabled = true;
  try {
    const challenge = await deviceCall("device/code", {client_id: clientId});
    if (!challenge.device_code || !challenge.user_code) throw new Error("GitHub не выдал код входа.");
    verify.href = "https://github.com/login/device";
    verify.hidden = false;
    status.textContent = "Код GitHub: " + challenge.user_code + ". Открой страницу подтверждения и введи этот код.";
    let interval = Math.max(challenge.interval || 5, 5);
    const deadline = Date.now() + challenge.expires_in * 1000;
    while (Date.now() < deadline && $("#accountDialog").open) {
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      if (!$("#accountDialog").open) return;
      const data = await deviceCall("oauth/access_token", {
        client_id: clientId, device_code: challenge.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      if (data.access_token) { await connectAccount(data.access_token); return; }
      if (data.error === "slow_down") interval += 5;
      else if (data.error !== "authorization_pending") throw new Error("Вход отменён или код истёк.");
    }
    showAccount();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    verify.hidden = true;
  }
}

function excerpt(readme) {
  const lines = readme.replace(/<!--[^]*?-->/g, "").replace(/^(?:```|~~~).*?$[^]*?^(?:```|~~~).*?$/gm, "").split(/\r?\n/);
  return lines.map(line => line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^[#>*\s-]+/, "").trim())
    .filter(line => line.length >= 45 && !/^\[|^\{|^https?:/i.test(line))
    .slice(0, 3).join("\n\n").slice(0, 950);
}

function renderSummary(request, result) {
  if (request !== requestedSummary || !$("#summaryDialog").open) return;
  $("#summaryText").textContent = result.text;
  $("#summarySource").textContent = result.source;
}

async function improveSummary(repo, text, request) {
  if (!globalThis.Summarizer || await Summarizer.availability() !== "available") return;
  if (request !== requestedSummary || !$("#summaryDialog").open) return;
  const ai = await Summarizer.create({type:"key-points", length:"short", format:"plain-text"});
  try {
    const generated = await ai.summarize(text.slice(0, 12000));
    if (!generated.trim()) return;
    const result = {text: generated, source: "Сводка локальной модели браузера · источник: README"};
    summaries.set(repo.id, result);
    renderSummary(request, result);
  } finally {
    ai.destroy();
  }
}

async function openSummary(repo) {
  const request = ++requestedSummary;
  $("#summaryTitle").textContent = repo.name + " · кратко";
  $("#summaryText").textContent = "Читаю README…";
  $("#summarySource").textContent = "";
  $("#summaryDialog").showModal();
  const cached = summaries.get(repo.id);
  if (cached) { renderSummary(request, cached); return; }
  try {
    const response = await github("/repos/" + repo.full_name + "/readme", {media: "application/vnd.github.raw+json"});
    const text = await response.text();
    const preview = excerpt(text) || repo.description || "В README нет текстового описания.";
    const result = {text: preview, source: "Выдержка из README на GitHub"};
    summaries.set(repo.id, result);
    renderSummary(request, result);
    improveSummary(repo, text, request).catch(() => {});
  } catch (error) {
    const source = error.status === 404 ? "У проекта нет README" : "README временно недоступен";
    renderSummary(request, {text: repo.description || "Описание отсутствует.", source});
  }
}

const LANG_COLORS = {
  JavaScript:"#f1e05a", TypeScript:"#3178c6", Python:"#3572A5", Rust:"#dea584",
  Go:"#00ADD8", Java:"#b07219", "C++":"#f34b7d", C:"#555555", "C#":"#178600",
  Ruby:"#701516", PHP:"#4F5D95", Swift:"#F05138", Kotlin:"#A97BFF", Shell:"#89e051",
  HTML:"#e34c26", CSS:"#563d7c", Vue:"#41b883", Dart:"#00B4AB", Elixir:"#6e4a7e",
  Lua:"#000080", Zig:"#ec915c", Julia:"#a270ba", Scala:"#c22d40", Haskell:"#5e5086",
  Nix:"#7e7eff", Svelte:"#ff3e00", Jupyter:"#DA5B0B", "Jupyter Notebook":"#DA5B0B",
};

// ================= Рекомендации (клиентские) =================
function likedProfile() {
  const all = loadSwipes();
  const topics = {}, langs = {};
  for (const id in all) {
    const e = all[id];
    if (e.action !== "like") continue;
    (e.repo.topics || []).forEach(t => topics[t] = (topics[t] || 0) + 1);
    if (e.repo.language) langs[e.repo.language] = (langs[e.repo.language] || 0) + 1;
  }
  return { topics, langs };
}
function topKeys(obj, n) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}
function scoreRepo(repo, prof) {
  let s = Math.min(repo.stargazers_count, 50000) / 50000;
  (repo.topics || []).forEach(t => { if (prof.topics[t]) s += prof.topics[t] * 3; });
  if (repo.language && prof.langs[repo.language]) s += prof.langs[repo.language] * 2;
  return s;
}

// ================= Утилиты =================
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : String(n); }
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ================= Переключение режимов =================
function switchMode(m) {
  deckRequest?.abort();
  listRequest?.abort();
  mode = m;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
  const swipe = (m === "feed" || m === "reco");
  deckWrap.style.display = swipe ? "flex" : "none";
  panels.list.classList.toggle("active", m === "list");
  panels.liked.classList.toggle("active", m === "liked");
  panels.history.classList.toggle("active", m === "history");
  $(".search").style.display = (m === "feed" || m === "list") ? "flex" : "none";

  if (m === "list") { listPage = 1; loadList(); }
  else if (m === "liked") loadLiked();
  else if (m === "history") loadHistory();
  else resetDeck();
}

// ================= Свайп-колода =================

function showEmpty(message, retry) {
  stackEl.innerHTML = '<div class="state"></div>';
  const state = stackEl.firstElementChild;
  state.textContent = message;
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Повторить";
    button.onclick = retry;
    state.append(button);
  }
  updateSwipeActions();
}

function resetDeck() {
  deckRequest?.abort();
  deckRequest = new AbortController();
  queue = [];
  lastRemoved = null;
  feedPage = 1;
  loadingMore = false;
  recommendationTopics = mode === "reco" ? topKeys(likedProfile().topics, 3) : [currentTag];
  hasMore = recommendationTopics.length !== 0;
  if (!hasMore) {
    showEmpty("Сохрани несколько проектов, чтобы получить рекомендации.");
    return;
  }
  loadMoreCards();
}

async function loadMoreCards() {
  if (loadingMore || !hasMore) return;
  const {signal} = deckRequest;
  loadingMore = true;
  if (!queue.length) showEmpty("Загружаю репозитории…");
  try {
    const swiped = swipedIds();
    const seen = new Set(queue.map(repo => repo.id));
    while (queue.length < 4 && hasMore) {
      const size = 25;
      const fetched = await Promise.all(recommendationTopics.map(topic => ghSearch(topic, feedPage, size, signal)));
      if (signal.aborted) return;
      recommendationTopics = recommendationTopics.filter((_, i) => feedPage * size < Math.min(fetched[i].total_count, 1000));
      hasMore = recommendationTopics.length > 0;
      feedPage++;
      for (const {items} of fetched) for (const repo of items) {
        if (!seen.has(repo.id) && !swiped.has(repo.id)) {
          seen.add(repo.id);
          queue.push(repo);
        }
      }
    }
    const profile = likedProfile();
    queue.sort((a, b) => scoreRepo(b, profile) - scoreRepo(a, profile));
    renderStack();
  } catch (error) {
    if (!signal.aborted) {
      if (queue.length) renderStack();
      else showEmpty(error instanceof TypeError ? "Не удалось подключиться к GitHub." : error.message, loadMoreCards);
    }
  } finally {
    if (!signal.aborted) loadingMore = false;
  }
}

function updateSwipeActions() {
  $("#skipBtn").disabled = !queue.length;
  $("#likeBtn").disabled = !queue.length;
  $("#undoBtn").disabled = !lastRemoved;
}

function renderStack() {
  if (queue.length === 0) {
    showEmpty(mode === "reco" ? "Рекомендации закончились" : "Нет новых карточек по этой теме. Попробуй machine-learning, rust или web.");
    return;
  }
  stackEl.innerHTML = "";
  stackEl.appendChild(buildCard(queue[0]));
  updateSwipeActions();
}

function buildCard(repo) {
  const card = document.createElement("article");
  card.className = "card";

  const langColor = LANG_COLORS[repo.language] || "#8b949e";

  card.innerHTML = `
    <div class="cover">
      <div class="cover-fallback" aria-hidden="true"><span>{ }</span>${escapeHtml(repo.owner_login)}</div>
    </div>
    <div class="stamp skip" aria-hidden="true">× Пропустить</div>
    <div class="stamp like" aria-hidden="true">♡ Сохранить</div>
    <div class="body">
      <p class="owner">${escapeHtml(repo.owner_login)}</p>
      <h2><a href="${repo.html_url}" target="_blank" rel="noopener noreferrer">${escapeHtml(repo.name)} <span aria-hidden="true">↗</span></a></h2>
      <p class="desc">${escapeHtml(repo.description || "Автор не добавил описание.")}</p>
      <div class="topics">${(repo.topics || []).slice(0, 6).map(t => `<span>${escapeHtml(t)}</span>`).join("")}</div>
      <div class="card-footer">
        <div class="stats">
          <span>★ ${fmt(repo.stargazers_count)}</span>
          <span>⑂ ${fmt(repo.forks_count)}</span>
          <span>⚑ ${fmt(repo.open_issues_count)}</span>
          ${repo.language ? `<span><span class="lang-dot" style="background:${langColor}"></span>${escapeHtml(repo.language)}</span>` : ""}
        </div>
        <button type="button" class="summary-btn">✦ Краткая сводка</button>
      </div>
    </div>`;
  const cover = card.querySelector(".cover");
  const image = new Image();
  image.alt = "";
  image.draggable = false;
  image.referrerPolicy = "no-referrer";
  image.addEventListener("load", () => image.classList.add("ready"), { once: true });
  image.addEventListener("error", () => image.remove(), { once: true });
  image.src = "https://opengraph.githubassets.com/1/" + repo.full_name;
  cover.appendChild(image);

  card.querySelector(".summary-btn").addEventListener("click", () => openSummary(repo));
  attachDrag(card);
  return card;
}


function attachDrag(card) {
  let drag = null;
  const like = card.querySelector(".stamp.like");
  const skip = card.querySelector(".stamp.skip");
  card.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest("a, button") || card.dataset.swiping) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0 };
    card.setPointerCapture(drag.id);
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", event => {
    if (event.pointerId !== drag?.id) return;
    const x = event.clientX - drag.x;
    const y = event.clientY - drag.y;
    drag.dx = x;
    card.style.transform = "translate(" + x + "px," + y * 0.25 + "px) rotate(" + x / 20 + "deg)";
    like.style.opacity = Math.min(1, Math.max(0, x / 95));
    skip.style.opacity = Math.min(1, Math.max(0, -x / 95));
  });
  function finish(event) {
    if (event.pointerId !== drag?.id) return;
    const { dx } = drag;
    drag = null;
    card.style.transition = "";
    if (event.type === "pointerup" && Math.abs(dx) >= 95) {
      doSwipe(dx > 0 ? "like" : "skip");
    } else {
      card.style.transform = "";
      like.style.opacity = 0;
      skip.style.opacity = 0;
    }
  }
  card.addEventListener("pointerup", finish);
  card.addEventListener("pointercancel", finish);
  card.addEventListener("lostpointercapture", finish);
}

function doSwipe(action) {
  const top = stackEl.firstElementChild;
  if (!queue.length || !top || top.dataset.swiping) return;
  const repo = queue.shift();
  lastRemoved = { repo, action };
  recordSwipe(repo, action);

  top.dataset.swiping = "true";
  top.inert = true;
  top.querySelector(".stamp." + action).style.opacity = 1;
  const dir = action === "like" ? 1 : -1;
  top.style.transform = "translate(" + dir * 120 + "px, -10px) rotate(" + dir * 9 + "deg)";
  top.style.opacity = "0";
  updateSwipeActions();
  setTimeout(() => {
    if (stackEl.firstElementChild !== top) return;
    if (!queue.length && hasMore) loadMoreCards();
    else renderStack();
  }, 200);
}

function undoLast() {
  if (!lastRemoved) { toast("Нечего отменять"); return; }
  removeSwipe(lastRemoved.repo.id);
  queue.unshift(lastRemoved.repo);
  lastRemoved = null;
  renderStack();
  toast("Отменено");
}

// ================= Список =================
async function loadList() {
  listRequest?.abort();
  listRequest = new AbortController();
  const {signal} = listRequest;
  const rows = $("#listRows");
  if (!currentTag) { rows.innerHTML = `<div class="note">Введите тег и нажмите Enter</div>`; return; }
  rows.innerHTML = skeletonRows(10);
  $("#pageLabel").textContent = `Стр. ${listPage}`;
  listHasMore = false;
  $("#prevPageBtn").disabled = true;
  $("#nextPageBtn").disabled = true;
  try {
    const data = await ghSearch(currentTag, listPage, listPerPage, signal);
    if (signal.aborted) return;
    $("#prevPageBtn").disabled = listPage <= 1;
    listHasMore = listPage * listPerPage < Math.min(data.total_count, 1000);
    $("#nextPageBtn").disabled = !listHasMore;
    if (data.items.length === 0) { rows.innerHTML = `<div class="note">Ничего не найдено</div>`; return; }
    const total = Math.min(data.total_count, 1000);
    $("#pageLabel").textContent = `Стр. ${listPage} · ~${fmt(total)}${data.total_count > 1000 ? "+" : ""}`;
    rows.innerHTML = data.items.map(repoRow).join("");
  } catch (e) {
    if (signal.aborted) return;
    $("#prevPageBtn").disabled = listPage <= 1;
    rows.innerHTML = `<div class="note">⚠ ${escapeHtml(e.message)}</div>`;
    $("#nextPageBtn").disabled = true;
  }
}
function repoRow(r) {
  return `<a class="row" href="${githubUrl(r.full_name)}" target="_blank" rel="noopener">
    ${r.owner_avatar_url ? `<img class="avatar" src="${escapeHtml(avatarUrl(r.owner_avatar_url))}" alt="" loading="lazy">` : `<span class="avatar"></span>`}
    <span class="name"><span class="ownr">${escapeHtml(r.owner_login || r.full_name.split("/")[0])}/</span>${escapeHtml(r.name)}</span>
    <span class="row-stars">★ ${fmt(r.stargazers_count)}</span>
    <span class="row-tags">${(r.topics || []).slice(0, 3).map(t => `<span>${escapeHtml(t)}</span>`).join("")}</span>
  </a>`;
}
function skeletonRows(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += `<div class="skel-row"><div class="skel c"></div><div class="skel l" style="max-width:${40 + (i*7)%45}%"></div></div>`;
  return s;
}

// ================= Избранное =================
function loadLiked() {
  const rows = $("#likedRows");
  const all = loadSwipes();
  const liked = Object.values(all).filter(e => e.action === "like").sort((a, b) => b.ts - a.ts).map(e => e.repo);
  if (liked.length === 0) { rows.innerHTML = `<div class="note">Здесь появятся проекты, которые ты сохранишь</div>`; return; }
  rows.innerHTML = liked.map(repoRow).join("");
}

// ================= История =================
function loadHistory() {
  const rows = $("#historyRows");
  const all = loadSwipes();
  let entries = Object.values(all).sort((a, b) => b.ts - a.ts);
  if (historyFilter !== "all") entries = entries.filter(e => e.action === historyFilter);
  if (entries.length === 0) { rows.innerHTML = `<div class="note">Пусто — здесь появятся все просмотренные репозитории</div>`; return; }
  rows.innerHTML = entries.map(e => {
    const r = e.repo;
    return `<div class="row">
      <span class="action-icon ${e.action}">${e.action === "like" ? "★" : "✕"}</span>
      ${r.owner_avatar_url ? `<img class="avatar" src="${escapeHtml(avatarUrl(r.owner_avatar_url))}" alt="" loading="lazy">` : `<span class="avatar"></span>`}
      <a class="name" href="${githubUrl(r.full_name)}" target="_blank" rel="noopener"><span class="ownr">${escapeHtml(r.owner_login || r.full_name.split("/")[0])}/</span>${escapeHtml(r.full_name.split("/")[1] || "")}</a>
      <span class="row-tags">${(r.topics || []).slice(0, 3).map(t => `<span>${escapeHtml(t)}</span>`).join("")}</span>
      <button class="remove-btn" title="Убрать" data-id="${r.id}">✕</button>
    </div>`;
  }).join("");
}

// ================= События =================
function onTagSubmit() {
  const next = tagInput.value.trim().toLowerCase() || DEFAULT_TOPIC;
  if (!TOPIC.test(next)) { toast("Тема может содержать латинские буквы, цифры и дефисы."); return; }
  currentTag = next;
  tagInput.value = currentTag;
  if (mode === "list") { listPage = 1; loadList(); }
  else if (mode === "feed") resetDeck();
  else { switchMode("feed"); }
}

document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => switchMode(b.dataset.mode));
$("#goBtn").onclick = onTagSubmit;
tagInput.addEventListener("keydown", e => { if (e.key === "Enter") onTagSubmit(); });

$("#likeBtn").onclick = () => doSwipe("like");
$("#skipBtn").onclick = () => doSwipe("skip");
$("#undoBtn").onclick = undoLast;

$("#perPageSelect").onchange = e => { listPerPage = +e.target.value; listPage = 1; loadList(); };
$("#prevPageBtn").onclick = () => { if (listPage > 1) { listPage--; loadList(); } };
$("#nextPageBtn").onclick = () => { if (listHasMore) { listPage++; loadList(); } };

document.querySelectorAll(".filter-tabs button").forEach(b => b.onclick = () => {
  historyFilter = b.dataset.filter;
  document.querySelectorAll(".filter-tabs button").forEach(x => x.classList.toggle("active", x === b));
  loadHistory();
});
$("#clearHistoryBtn").onclick = () => {
  if (confirm("Очистить всю историю просмотров? Сохранённые проекты тоже будут удалены.")) {
    saveSwipes({}); loadHistory(); toast("История очищена");
  }
};
$("#historyRows").addEventListener("click", e => {
  const btn = e.target.closest(".remove-btn");
  if (btn) { removeSwipe(+btn.dataset.id); loadHistory(); }
});

document.addEventListener("keydown", e => {
  if ($("#summaryDialog").open || $("#accountDialog").open || e.target.closest("input, select, textarea, button, a") || e.repeat) return;
  if (mode !== "feed" && mode !== "reco") return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    doSwipe(e.key === "ArrowRight" ? "like" : "skip");
  }
  else if (e.key === "Backspace") { e.preventDefault(); undoLast(); }
});

// ================= Старт =================
$("#accountBtn").onclick = () => $("#accountDialog").showModal();
$("#signOutBtn").onclick = async () => {
  token = "";
  account = null;
  searchCache.clear();
  sessionStorage.removeItem(tokenKey);
  if (extensionStorage) await extensionStorage.remove(tokenKey);
  showAccount();
  switchMode(mode);
};
$("#tokenForm").onsubmit = async event => {
  event.preventDefault();
  const input = $("#tokenInput");
  const candidate = input.value.trim();
  input.value = "";
  if (!candidate) return;
  try { await connectAccount(candidate); }
  catch (error) { $("#accountStatus").textContent = error.message; }
};
const clientId = globalThis.REPOFEED_GITHUB_CLIENT_ID;
const deviceEnabled = location.protocol === "chrome-extension:" || Boolean(globalThis.RepoFeedAndroid);
if (location.protocol === "chrome-extension:" && window.parent !== window) {
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.querySelector("dialog[open]")) window.parent.postMessage("repofeed:close", "https://github.com");
  });
}
if (globalThis.RepoFeedAndroid) {
  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link || !link.href.startsWith("https://github.com/")) return;
    event.preventDefault();
    RepoFeedAndroid.openGitHub(link.href);
  });
}
if (deviceEnabled && clientId) {
  const button = $("#deviceLoginBtn");
  button.hidden = false;
  button.onclick = () => startDeviceLogin(clientId);
}
async function initialize() {
  if (extensionStorage) {
    const saved = await extensionStorage.get(tokenKey);
    token = saved[tokenKey] || "";
  }
  showAccount();
  if (token) {
    try { await connectAccount(token); }
    catch (error) { await $("#signOutBtn").onclick(); toast(error.message); }
  } else {
    resetDeck();
  }
}
initialize();
