/* 자소서 도우미 프론트엔드 (vanilla JS) */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { config: null, sessions: [], companies: [], docs: [], currentSession: null, currentCompany: null, streaming: false, usage: null };
marked.setOptions({ breaks: true, gfm: true });

// ---------------- 공통 ----------------
async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || body));
  return body;
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

const fmtUsd = (v) => "$" + (v || 0).toFixed(v >= 1 ? 2 : 4);
const fmtKrw = (v) => "₩" + Math.round((v || 0) * (state.config?.usd_krw || state.usage?.usd_krw || 1400)).toLocaleString();
const fmtDate = (s) => (s ? s.replace("T", " ").slice(0, 16) : "");

function openModal(title, html) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").hidden = false;
}
$("#modalClose").onclick = () => ($("#modal").hidden = true);
$("#modal").onclick = (e) => { if (e.target.id === "modal") $("#modal").hidden = true; };

function switchView(name) {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  if (name === "usage") loadUsage();
  if (name === "docs") loadDocs();
  if (name === "company") renderCompanyList();
}
$$(".nav-btn").forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
$("#costPill").onclick = () => switchView("usage");

async function refreshCostPill() {
  try {
    const u = await api("/api/usage");
    state.usage = u;
    const pill = $("#costPill");
    pill.innerHTML = `오늘 ${fmtUsd(u.today_usd)}<br/>이번 달 ${fmtUsd(u.month_usd)}<br/><span style="opacity:.8">${fmtKrw(u.month_usd)}</span>`;
    pill.classList.toggle("over", u.budget_exceeded);
  } catch { /* 무시 */ }
}

// ---------------- 작성 세션 ----------------
async function loadSessions() {
  state.sessions = await api("/api/sessions");
  renderSessionList();
}

function renderSessionList() {
  const list = $("#sessionList");
  if (!state.sessions.length) {
    list.innerHTML = `<div class="empty-inline">문항이 없습니다</div>`;
    return;
  }
  list.innerHTML = state.sessions.map((s) => `
    <div class="list-item ${state.currentSession?.id === s.id ? "active" : ""}" data-id="${s.id}">
      <div class="t">${esc(s.title)}</div>
      <div class="m">${esc(s.company_name || "기업 미지정")}${s.char_limit ? ` · ${s.char_limit}자` : ""}</div>
    </div>`).join("");
  $$(".list-item", list).forEach((el) => (el.onclick = () => openSession(el.dataset.id)));
}

function fillCompanySelect(sel, value) {
  sel.innerHTML = `<option value="">(선택 안 함)</option>` +
    state.companies.map((c) => `<option value="${c.id}">${esc(c.name)}${c.position ? " · " + esc(c.position) : ""}</option>`).join("");
  sel.value = value || "";
}

async function openSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  state.currentSession = s;
  renderSessionList();
  $("#writeEmpty").hidden = true;
  $("#chat").hidden = false;
  $("#sessionPanel").hidden = false;
  $("#sTitle").value = s.title;
  fillCompanySelect($("#sCompany"), s.company_id);
  $("#sQuestion").value = s.question || "";
  $("#sLimit").value = s.char_limit || "";
  $("#sModel").innerHTML = state.config.models.map((m) => `<option>${esc(m)}</option>`).join("");
  if (s.model && !state.config.models.includes(s.model)) $("#sModel").insertAdjacentHTML("beforeend", `<option>${esc(s.model)}</option>`);
  $("#sModel").value = s.model || state.config.writer_model;
  updateCompanyHint();
  const msgs = await api(`/api/sessions/${id}/messages`);
  const box = $("#messages");
  box.innerHTML = "";
  if (!msgs.length) {
    box.innerHTML = `<div class="empty-state" id="chatHint"><p>오른쪽에 문항과 글자수를 입력·저장한 뒤<br/><b>초안 작성</b>을 눌러보세요.</p></div>`;
  }
  msgs.forEach((m) => appendMessage(m.role, m.content, m.meta));
  box.scrollTop = box.scrollHeight;
}

function updateCompanyHint() {
  const c = state.companies.find((x) => x.id === $("#sCompany").value);
  $("#companyHint").innerHTML = c
    ? `✅ <b>${esc(c.name)}</b> 맞춤 지침이 적용됩니다.`
    : `기업을 선택하면 <b>기업 분석</b>에서 만든 맞춤 프롬프트가 적용됩니다.`;
}
$("#sCompany").onchange = updateCompanyHint;

function sessionForm() {
  return {
    title: $("#sTitle").value.trim() || "새 문항",
    company_id: $("#sCompany").value || null,
    question: $("#sQuestion").value.trim(),
    char_limit: parseInt($("#sLimit").value) || null,
    model: $("#sModel").value,
  };
}

async function saveSession(silent = false) {
  const s = state.currentSession;
  if (!s) return;
  const updated = await api(`/api/sessions/${s.id}`, { method: "PUT", json: sessionForm() });
  Object.assign(s, updated, { company_name: state.companies.find((c) => c.id === updated.company_id)?.name });
  renderSessionList();
  if (!silent) toast("저장했습니다");
}
$("#saveSession").onclick = () => saveSession();

$("#newSession").onclick = async () => {
  const s = await api("/api/sessions", { method: "POST", json: { title: `문항 ${state.sessions.length + 1}`, model: state.config.writer_model } });
  await loadSessions();
  openSession(s.id);
  $("#sQuestion").focus();
};

$("#deleteSession").onclick = async () => {
  if (!state.currentSession || !confirm("이 문항과 대화를 삭제할까요?")) return;
  await api(`/api/sessions/${state.currentSession.id}`, { method: "DELETE" });
  state.currentSession = null;
  $("#chat").hidden = true; $("#sessionPanel").hidden = true; $("#writeEmpty").hidden = false;
  loadSessions();
};

$("#clearChat").onclick = async () => {
  if (!state.currentSession || !confirm("대화 내용을 모두 지울까요? (문항 설정은 유지)")) return;
  await api(`/api/sessions/${state.currentSession.id}/messages`, { method: "DELETE" });
  openSession(state.currentSession.id);
};

// ---- 메시지 렌더링 ----
const DRAFT_RE = /###\s*초안\s*\n([\s\S]*?)(?=\n###\s|$)/;

function renderMarkdown(text) {
  const html = DOMPurify.sanitize(marked.parse(text || ""));
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  // "### 초안" 다음 섹션을 원고지 스타일 박스로 감싼다
  const h = [...wrap.querySelectorAll("h3")].find((x) => x.textContent.trim() === "초안");
  if (h) {
    const box = document.createElement("div");
    box.className = "draft";
    let n = h.nextSibling;
    while (n && !(n.nodeType === 1 && /^H[1-3]$/.test(n.tagName))) {
      const next = n.nextSibling;
      box.appendChild(n);
      n = next;
    }
    h.after(box);
  }
  return wrap.innerHTML;
}

function charBadge(count, limit) {
  if (!count) return "";
  const n = count.with_spaces;
  let cls = "ok", note = "";
  if (limit) {
    if (n > limit) { cls = "danger"; note = ` · ${n - limit}자 초과`; }
    else if (n < limit * 0.9) { cls = "warn"; note = ` · ${Math.ceil(limit * 0.9) - n}자 부족`; }
  } else cls = "";
  return `<span class="badge ${cls}" title="공백 제외 ${count.without_spaces}자">본문 ${n}자${limit ? ` / ${limit}자` : ""}${note}</span>`;
}

function countChars(t) { return { with_spaces: [...t].length, without_spaces: [...t.replace(/\s/g, "")].length }; }

function renderFoot(meta) {
  if (!meta) return "";
  const parts = [];
  if (meta.chars) parts.push(charBadge(meta.chars, meta.char_limit));
  if (meta.draft) parts.push(`<button class="btn sm" data-copy>초안 복사</button>`);
  if (meta.cost_usd !== undefined) parts.push(`<span title="${esc(meta.model || "")}">${fmtUsd(meta.cost_usd)} (${fmtKrw(meta.cost_usd)})</span>`);
  const srcs = meta.sources || [];
  if (srcs.length) {
    parts.push(`<details class="sources"><summary>참고한 자료 ${srcs.length}개</summary>${srcs.map((s, i) => `
      <div class="src"><div class="h"><span>[${i + 1}] ${esc(s.name)} <span class="badge">${esc(s.category)}</span></span><span>유사도 ${s.score}</span></div>
      <div class="x">${esc(s.text)}</div></div>`).join("")}</details>`);
  } else if (meta.sources) {
    parts.push(`<span>참고자료 없음</span>`);
  }
  return `<div class="msg-foot">${parts.join("")}</div>`;
}

function appendMessage(role, content, meta = {}) {
  $("#chatHint")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "user") {
    if (meta?.action === "adjust_length") { el.classList.add("system-like"); el.textContent = "↔ 글자수 조정 요청"; }
    else el.textContent = content;
  } else {
    el.innerHTML = `<div class="body">${renderMarkdown(content)}</div>${renderFoot(meta)}`;
    bindFoot(el, meta);
  }
  $("#messages").appendChild(el);
  return el;
}

function bindFoot(el, meta) {
  const btn = el.querySelector("[data-copy]");
  if (btn) btn.onclick = async () => { await navigator.clipboard.writeText(meta.draft); toast("초안을 복사했습니다"); };
}

// ---- 전송 (SSE 스트리밍) ----
async function send(message, action = "chat", autoAdjusted = false) {
  const s = state.currentSession;
  if (!s || state.streaming) return;
  if (action === "chat" && !message.trim()) return;
  await saveSession(true); // 설정 변경사항 반영 후 전송
  state.streaming = true;
  $("#send").disabled = true;
  appendMessage("user", message, { action });
  const box = $("#messages");
  const el = document.createElement("div");
  el.className = "msg assistant";
  el.innerHTML = `<div class="body"><span class="spinner"></span>관련 경험을 찾는 중...</div><div class="live"></div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;

  let text = "", sources = [], donemeta = null;
  const limit = parseInt($("#sLimit").value) || null;
  try {
    const res = await fetch(`/api/sessions/${s.id}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, action }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let raf = 0;
    const paint = () => {
      raf = 0;
      el.querySelector(".body").innerHTML = renderMarkdown(text) + `<span class="typing"></span>`;
      const m = text.match(DRAFT_RE);
      el.querySelector(".live").innerHTML = m ? `<div class="msg-foot">${charBadge(countChars(m[1].trim()), limit)} <span>작성 중…</span></div>` : "";
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      if (nearBottom) box.scrollTop = box.scrollHeight;
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!line.startsWith("data:")) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.type === "sources") {
          sources = ev.sources;
          el.querySelector(".body").innerHTML = `<span class="spinner"></span>참고자료 ${sources.length}개를 바탕으로 작성 중...`;
        } else if (ev.type === "delta") {
          text += ev.text;
          if (!raf) raf = requestAnimationFrame(paint);
        } else if (ev.type === "done") {
          donemeta = ev.meta;
        } else if (ev.type === "error") {
          throw new Error(ev.message);
        }
      }
    }
    if (raf) cancelAnimationFrame(raf);
    el.innerHTML = `<div class="body">${renderMarkdown(text)}</div>${renderFoot(donemeta || { sources })}`;
    bindFoot(el, donemeta || {});
  } catch (e) {
    el.innerHTML = `<div class="body" style="color:var(--danger)">⚠️ ${esc(e.message)}</div>`;
  } finally {
    state.streaming = false;
    $("#send").disabled = false;
    refreshCostPill();
    loadSessions();
  }

  // 글자수 자동 보정 (1회)
  if (donemeta?.chars && donemeta.char_limit && !autoAdjusted && $("#autoAdjust").checked) {
    const n = donemeta.chars.with_spaces, L = donemeta.char_limit;
    if (n > L || n < L * 0.9) {
      toast(`본문 ${n}자 → 목표 ${Math.ceil(L * 0.9)}~${L}자로 자동 보정합니다`);
      await send("", "adjust_length", true);
    }
  }
}

$("#send").onclick = () => { const v = $("#input").value; $("#input").value = ""; send(v); };
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#send").click(); }
});
$$("#chips button").forEach((b) => (b.onclick = () => {
  if (b.dataset.action === "adjust_length") {
    if (!parseInt($("#sLimit").value)) return toast("먼저 글자수 제한을 입력하세요");
    send("", "adjust_length", true);
  } else send(b.dataset.msg);
}));

// ---------------- 기업 분석 ----------------
async function loadCompanies() {
  state.companies = await api("/api/companies");
}

function renderCompanyList() {
  const list = $("#companyList");
  list.innerHTML = state.companies.length ? state.companies.map((c) => `
    <div class="list-item ${state.currentCompany === c.id ? "active" : ""}" data-id="${c.id}">
      <div class="t">${esc(c.name)}</div><div class="m">${esc(c.position || "직무 미입력")} · ${fmtDate(c.updated_at).slice(0, 10)}</div>
    </div>`).join("") : `<div class="empty-inline">분석한 기업이 없습니다</div>`;
  $$(".list-item", list).forEach((el) => (el.onclick = () => showCompany(el.dataset.id)));
  if (!state.currentCompany) showCompanyForm();
}

function showCompanyForm() {
  state.currentCompany = null;
  $$("#companyList .list-item").forEach((x) => x.classList.remove("active"));
  $("#companyContent").innerHTML = `
    <h2>새 기업 분석</h2>
    <p class="sub">회사명과 JD를 넣으면 ① 인재상·핵심역량·키워드를 분석하고 ② 이 회사 전용 작성 지침(프롬프트)을 자동 생성합니다.</p>
    <div class="card">
      <div class="input-row" style="gap:12px">
        <label style="flex:1">회사명 *<input id="cName" placeholder="예) 네이버" /></label>
        <label style="flex:1">지원 직무<input id="cPos" placeholder="예) 백엔드 개발" /></label>
      </div>
      <label>채용공고 / JD (주요 업무·자격 요건·우대 사항)<textarea id="cJd" rows="8" placeholder="채용공고 내용을 붙여넣으세요. 구체적일수록 정확해집니다."></textarea></label>
      <label>인재상·핵심가치·기타 메모 (선택, 최우선 반영)<textarea id="cNotes" rows="4" placeholder="회사 채용 페이지의 인재상, 현직자 정보, 면접 후기 등"></textarea></label>
      <label class="check"><input type="checkbox" id="cWeb" checked /> 웹 검색으로 최신 인재상·사업 동향 조사 (검색 1회당 약 $0.01 추가)</label>
      <button class="btn primary" id="cAnalyze">분석하고 맞춤 프롬프트 만들기</button>
      <span class="status" id="cStatus"></span>
    </div>`;
  $("#cAnalyze").onclick = async () => {
    const body = { name: $("#cName").value, position: $("#cPos").value, jd: $("#cJd").value, notes: $("#cNotes").value, web_search: $("#cWeb").checked };
    if (!body.name.trim()) return toast("회사명을 입력하세요");
    $("#cAnalyze").disabled = true;
    $("#cStatus").innerHTML = `<span class="spinner"></span>분석 중입니다... (웹 검색 포함 시 1~2분)`;
    try {
      const c = await api("/api/companies/analyze", { method: "POST", json: body });
      toast(`분석 완료 · 비용 ${fmtUsd(c.cost_usd)}`);
      await loadCompanies();
      state.currentCompany = c.id;
      renderCompanyList();
      showCompany(c.id);
    } catch (e) {
      $("#cStatus").innerHTML = `<span class="err">⚠️ ${esc(e.message)}</span>`;
    } finally {
      $("#cAnalyze") && ($("#cAnalyze").disabled = false);
      refreshCostPill();
    }
  };
}
$("#newCompany").onclick = showCompanyForm;

const listHtml = (arr) => (arr?.length ? `<ul>${arr.map((x) => `<li>${esc(typeof x === "string" ? x : `${x.name} — ${x.evidence || ""}`)}</li>`).join("")}</ul>` : `<span class="sub">없음</span>`);

function showCompany(id) {
  const c = state.companies.find((x) => x.id === id);
  if (!c) return;
  state.currentCompany = id;
  $$("#companyList .list-item").forEach((x) => x.classList.toggle("active", x.dataset.id === id));
  const p = c.profile || {};
  $("#companyContent").innerHTML = `
    <div class="input-row" style="justify-content:space-between;align-items:center">
      <div><h2>${esc(c.name)} <span class="sub">${esc(c.position || "")}</span></h2></div>
      <div class="row">
        <button class="btn" id="cUse">이 기업으로 새 문항</button>
        <button class="btn danger ghost" id="cDel">삭제</button>
      </div>
    </div>
    <p class="sub">${esc(p.summary || "")}</p>
    <div class="kv">
      <div class="card"><h3>인재상 · 핵심가치</h3>${listHtml(p.talent_values)}</div>
      <div class="card"><h3>직무 핵심 역량</h3>${listHtml(p.job_competencies)}</div>
      <div class="card"><h3>JD 키워드</h3><div class="tags">${(p.jd_keywords || []).map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</div>
        <h3 style="margin-top:14px">선호 톤</h3><div>${esc(p.preferred_tone || "-")}</div></div>
      <div class="card"><h3>작성 전략</h3>${listHtml(p.writing_strategy)}</div>
      <div class="card"><h3>최근 동향</h3>${listHtml(p.recent_context)}</div>
      <div class="card"><h3>피해야 할 것</h3>${listHtml(p.avoid)}</div>
    </div>
    ${p.confidence_notes ? `<div class="card"><h3>신뢰도 메모</h3><div class="sub" style="margin:0">${esc(p.confidence_notes)}</div></div>` : ""}
    ${(p.sources || []).length ? `<div class="card"><h3>웹 검색 출처</h3><ul>${p.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul></div>` : ""}
    <div class="card">
      <h3>기업 맞춤 프롬프트 (자소서 작성 시 자동 적용)</h3>
      <p class="sub">API가 위 분석을 바탕으로 생성한 지침입니다. 직접 수정해도 되고, 분석 결과로 다시 생성할 수도 있습니다.</p>
      <textarea id="cPrompt" class="prompt-edit">${esc(c.system_prompt || "")}</textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn primary" id="cSave">프롬프트 저장</button>
        <button class="btn" id="cRegen">분석 결과로 다시 생성</button>
        <span class="status" id="cStatus2"></span>
      </div>
    </div>`;
  $("#cSave").onclick = async () => {
    await api(`/api/companies/${id}`, { method: "PUT", json: { system_prompt: $("#cPrompt").value } });
    await loadCompanies(); toast("저장했습니다");
  };
  $("#cRegen").onclick = async () => {
    if (!confirm("현재 프롬프트를 새로 생성한 내용으로 바꿀까요?")) return;
    $("#cStatus2").innerHTML = `<span class="spinner"></span>생성 중...`;
    try {
      const nc = await api(`/api/companies/${id}/regenerate`, { method: "POST" });
      await loadCompanies(); showCompany(id); toast(`재생성 완료 · ${fmtUsd(nc.cost_usd)}`);
    } catch (e) { $("#cStatus2").innerHTML = `<span class="err">⚠️ ${esc(e.message)}</span>`; }
    refreshCostPill();
  };
  $("#cDel").onclick = async () => {
    if (!confirm("이 기업 프로필을 삭제할까요?")) return;
    await api(`/api/companies/${id}`, { method: "DELETE" });
    state.currentCompany = null;
    await loadCompanies(); renderCompanyList();
  };
  $("#cUse").onclick = async () => {
    const s = await api("/api/sessions", { method: "POST", json: { title: `${c.name} 문항`, company_id: id, model: state.config.writer_model } });
    await loadSessions(); switchView("write"); openSession(s.id); $("#sQuestion").focus();
  };
}

// ---------------- 자료 관리 ----------------
async function loadDocs() {
  state.docs = await api("/api/documents");
  const tbody = $("#docTable tbody");
  $("#docEmpty").hidden = state.docs.length > 0;
  $("#docTable").hidden = state.docs.length === 0;
  const typeLabel = { file: "파일", url: "URL", text: "직접 입력" };
  tbody.innerHTML = state.docs.map((d) => `
    <tr class="${d.enabled ? "" : "off"}" data-id="${d.id}">
      <td><label class="switch"><input type="checkbox" data-act="toggle" ${d.enabled ? "checked" : ""}/><span></span></label></td>
      <td title="${esc(d.source || "")}">${d.source_type === "url" ? `<a href="${esc(d.source)}" target="_blank" rel="noopener">${esc(d.name)}</a>` : esc(d.name)}</td>
      <td><select data-act="cat">${state.config.categories.map((c) => `<option ${c === d.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></td>
      <td>${typeLabel[d.source_type] || d.source_type}</td>
      <td class="num">${d.chunk_count}</td>
      <td class="num">${d.char_count.toLocaleString()}</td>
      <td>${fmtDate(d.created_at)}</td>
      <td class="actions">
        <button class="btn sm ghost" data-act="view">미리보기</button>
        <button class="btn sm ghost" data-act="reindex" title="개인정보 마스킹 설정 변경 후 다시 색인">재색인</button>
        <button class="btn sm ghost danger" data-act="del">삭제</button>
      </td>
    </tr>`).join("");
  $$("tr[data-id]", tbody).forEach((tr) => {
    const id = tr.dataset.id, d = state.docs.find((x) => x.id === id);
    $("[data-act=toggle]", tr).onchange = async (e) => { await api(`/api/documents/${id}`, { method: "PATCH", json: { enabled: e.target.checked } }); tr.classList.toggle("off", !e.target.checked); };
    $("[data-act=cat]", tr).onchange = async (e) => { await api(`/api/documents/${id}`, { method: "PATCH", json: { category: e.target.value } }); toast("분류를 변경했습니다"); };
    $("[data-act=view]", tr).onclick = async () => {
      const { chunks } = await api(`/api/documents/${id}/chunks`);
      openModal(`${d.name} — ${chunks.length}개 청크 (OpenAI로 전송되는 마스킹된 텍스트)`,
        chunks.map((c, i) => `<div class="chunk"><div class="n">#${i + 1} · ${c.length}자</div>${esc(c)}</div>`).join("") || "청크 없음");
    };
    $("[data-act=reindex]", tr).onclick = async () => {
      try { await api(`/api/documents/${id}/reindex`, { method: "POST" }); toast("재색인했습니다"); loadDocs(); refreshCostPill(); }
      catch (e) { toast("⚠️ " + e.message, 5000); }
    };
    $("[data-act=del]", tr).onclick = async () => {
      if (!confirm(`'${d.name}'을(를) 삭제할까요? 벡터DB와 원본 텍스트가 모두 삭제됩니다.`)) return;
      await api(`/api/documents/${id}`, { method: "DELETE" }); toast("삭제했습니다"); loadDocs();
    };
  });
}

function setDocStatus(html) { $("#docStatus").innerHTML = html; }

$$("#addTabs .tab").forEach((t) => (t.onclick = () => {
  $$("#addTabs .tab").forEach((x) => x.classList.toggle("active", x === t));
  $$(".tab-body").forEach((b) => (b.hidden = b.dataset.body !== t.dataset.tab));
  const defaults = { file: "이력서", url: "포트폴리오", text: "경험/활동" };
  $("#docCategory").value = defaults[t.dataset.tab];
}));

async function uploadFiles(files) {
  if (!files.length) return;
  const fd = new FormData();
  [...files].forEach((f) => fd.append("files", f));
  fd.append("category", $("#docCategory").value);
  setDocStatus(`<span class="spinner"></span>${files.length}개 파일 텍스트 추출 · 색인 중...`);
  try {
    const r = await api("/api/documents/upload", { method: "POST", body: fd });
    const msg = [];
    if (r.added.length) msg.push(`<div class="ok">✅ ${r.added.map((d) => `${esc(d.name)} (${d.chunk_count}청크)`).join(", ")} 추가됨</div>`);
    r.errors.forEach((e) => msg.push(`<div class="err">⚠️ ${esc(e.file)}: ${esc(e.error)}</div>`));
    setDocStatus(msg.join(""));
    loadDocs(); refreshCostPill();
  } catch (e) { setDocStatus(`<div class="err">⚠️ ${esc(e.message)}</div>`); }
  $("#fileInput").value = "";
}
$("#fileInput").onchange = (e) => uploadFiles(e.target.files);
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));

$("#addUrl").onclick = async () => {
  const url = $("#urlInput").value.trim();
  if (!url) return;
  setDocStatus(`<span class="spinner"></span>페이지를 가져오는 중...`);
  try {
    const d = await api("/api/documents/url", { method: "POST", json: { url, name: $("#urlName").value.trim() || null, category: $("#docCategory").value } });
    setDocStatus(`<div class="ok">✅ ${esc(d.name)} (${d.char_count.toLocaleString()}자, ${d.chunk_count}청크) 추가됨</div>`);
    $("#urlInput").value = ""; $("#urlName").value = "";
    loadDocs(); refreshCostPill();
  } catch (e) { setDocStatus(`<div class="err">⚠️ ${esc(e.message)}</div>`); }
};

$("#addText").onclick = async () => {
  const text = $("#textBody").value.trim();
  if (!text) return;
  setDocStatus(`<span class="spinner"></span>색인 중...`);
  try {
    const d = await api("/api/documents/text", { method: "POST", json: { name: $("#textName").value.trim(), text, category: $("#docCategory").value } });
    setDocStatus(`<div class="ok">✅ ${esc(d.name)} 추가됨</div>`);
    $("#textName").value = ""; $("#textBody").value = "";
    loadDocs(); refreshCostPill();
  } catch (e) { setDocStatus(`<div class="err">⚠️ ${esc(e.message)}</div>`); }
};

$("#searchBtn").onclick = async () => {
  const q = $("#searchInput").value.trim();
  if (!q) return;
  $("#searchResults").innerHTML = `<span class="spinner"></span>검색 중...`;
  try {
    const { results } = await api("/api/search", { method: "POST", json: { query: q } });
    $("#searchResults").innerHTML = results.length ? results.map((s, i) => `
      <div class="src"><div class="h"><span>[${i + 1}] ${esc(s.name)} <span class="badge">${esc(s.category)}</span></span><span>유사도 ${s.score}</span></div><div class="x">${esc(s.text)}</div></div>`).join("")
      : `<div class="sub">검색 결과가 없습니다 (사용 중인 자료가 없거나 비어 있음)</div>`;
    refreshCostPill();
  } catch (e) { $("#searchResults").innerHTML = `<div class="err">⚠️ ${esc(e.message)}</div>`; }
};
$("#searchInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) $("#searchBtn").click(); });

// ---------------- 사용량 ----------------
async function loadUsage() {
  const u = await api("/api/usage");
  state.usage = u;
  const budget = u.monthly_budget_usd;
  const pct = budget ? Math.min(100, (u.month_usd / budget) * 100) : 0;
  const maxDay = Math.max(0.0001, ...u.daily.map((d) => d.cost));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 864e5);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    days.push({ day: key, cost: u.daily.find((d) => d.day === key)?.cost || 0 });
  }
  const unpriced = u.by_model.filter((m) => !m.priced).map((m) => m.model);
  $("#usageContent").innerHTML = `
    <h2>API 사용량 · 비용</h2>
    <p class="sub">이 앱이 보낸 모든 요청의 토큰 사용량 × 공식 단가(<code>app/pricing.json</code>)로 계산한 <b>실시간 추정치</b>입니다. 원화는 ${u.usd_krw.toLocaleString()}원/$ 기준.</p>
    <div class="stats">
      <div class="stat"><div class="l">오늘</div><div class="v">${fmtUsd(u.today_usd)}</div><div class="k">${fmtKrw(u.today_usd)}</div></div>
      <div class="stat"><div class="l">이번 달</div><div class="v">${fmtUsd(u.month_usd)}</div><div class="k">${fmtKrw(u.month_usd)}</div>
        ${budget ? `<div class="bar-track"><div class="bar-fill ${u.budget_exceeded ? "over" : ""}" style="width:${pct}%"></div></div><div class="k">예산 ${fmtUsd(budget)} 중 ${pct.toFixed(0)}%</div>` : ""}</div>
      <div class="stat"><div class="l">누적</div><div class="v">${fmtUsd(u.total_usd)}</div><div class="k">${fmtKrw(u.total_usd)}</div></div>
    </div>
    ${unpriced.length ? `<div class="banner" style="border-radius:8px">단가가 등록되지 않은 모델이 있어 비용이 0으로 계산됐습니다: ${unpriced.map(esc).join(", ")} → <code>app/pricing.json</code>에 추가하세요.</div>` : ""}
    <div class="card"><h3>최근 30일</h3>
      <div class="daily">${days.map((d) => `<div class="d" style="height:${(d.cost / maxDay) * 100}%" title="${d.day}: ${fmtUsd(d.cost)} (${fmtKrw(d.cost)})"></div>`).join("")}</div>
      <div class="daily-axis"><span>${days[0].day.slice(5)}</span><span>${days[29].day.slice(5)}</span></div>
    </div>
    <div class="kv">
      <div class="card"><h3>이번 달 · 기능별</h3>${tableHtml(["기능", "호출", "비용"], u.by_purpose.map((r) => [esc(r.purpose), r.calls, fmtUsd(r.cost)]))}</div>
      <div class="card"><h3>이번 달 · 모델별</h3>${tableHtml(["모델", "호출", "입력 토큰", "출력 토큰", "비용"], u.by_model.map((r) => [esc(r.model), r.calls, (r.input_tokens || 0).toLocaleString(), (r.output_tokens || 0).toLocaleString(), fmtUsd(r.cost)]))}</div>
    </div>
    <div class="card" id="officialCard"><h3>OpenAI 공식 청구 금액 (이번 달)</h3>
      ${u.official_available ? `<span class="spinner"></span>조회 중...` : `<p class="sub" style="margin:0"><code>.env</code>에 <code>OPENAI_ADMIN_KEY</code>(Admin API Key)를 넣으면 OpenAI Costs API로 <b>조직 전체</b> 공식 금액을 함께 표시합니다. 공식 금액은 일 단위로 집계되며 수 시간 늦게 반영됩니다.</p>`}
    </div>
    <div class="card"><h3>최근 호출 30건</h3>${tableHtml(["시각", "기능", "모델", "입력", "캐시", "출력", "검색", "비용"],
      u.recent.map((r) => [fmtDate(r.ts).slice(5), esc(r.purpose), esc(r.model), r.input_tokens.toLocaleString(), r.cached_tokens.toLocaleString(), r.output_tokens.toLocaleString(), r.web_search_calls || "", fmtUsd(r.cost_usd)]))}</div>`;
  if (u.official_available) {
    try {
      const o = await api("/api/usage/official");
      $("#officialCard").innerHTML = `<h3>OpenAI 공식 청구 금액 (이번 달, UTC 기준)</h3>` + (o.error ? `<div class="err">${esc(o.error)}</div>` :
        `<div class="stat" style="box-shadow:none;border:0;padding:0"><div class="v">${fmtUsd(o.month_usd)}</div><div class="k">${fmtKrw(o.month_usd)} · 이 키를 쓰는 다른 앱 사용분 포함</div></div>`);
    } catch (e) { $("#officialCard").innerHTML += `<div class="err">${esc(e.message)}</div>`; }
  }
}

function tableHtml(head, rows) {
  if (!rows.length) return `<div class="sub">기록 없음</div>`;
  return `<table class="table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i > 0 && /^[\d$,.]/.test(String(c)) ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

// ---------------- 초기화 ----------------
(async function init() {
  state.config = await api("/api/config");
  $("#keyBanner").hidden = state.config.api_key_set;
  $("#docCategory").innerHTML = state.config.categories.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#docCategory").value = "이력서";
  const pii = $("#piiPill");
  pii.textContent = state.config.pii_masking ? "🔒 개인정보\n마스킹 ON" : "개인정보\n마스킹 OFF";
  pii.style.whiteSpace = "pre-line";
  pii.classList.toggle("on", state.config.pii_masking);
  await loadCompanies();
  await loadSessions();
  refreshCostPill();
  if (state.sessions.length) openSession(state.sessions[0].id);
})();
