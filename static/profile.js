/* 마스터 프로필: 대주제별 이력 항목 (app.js의 $, $$, api, esc, toast, state, switchView 사용) */
const TITLE_HINT = {
  학력: "학교명 · 전공", 경력: "회사명", 연구실적: "논문명 · 특허명", 프로젝트: "프로젝트명", 자격증: "자격증명",
  어학: "시험명 (예: TOEIC)", 수상: "대회명 · 수상명", 대외활동: "활동명", 교육이수: "교육 과정명",
  // 소주제별 (대주제보다 우선)
  논문: "논문명", 특허: "특허명", "학회 발표": "발표 제목", "연구 과제": "과제명", 인턴: "회사명", 정규직: "회사명",
  계약직: "회사명", 아르바이트: "근무처", 동아리: "동아리명", 봉사: "봉사 활동명", 공모전: "공모전명 · 작품명",
};
const nameHint = (section, subtopic) => TITLE_HINT[subtopic] || TITLE_HINT[section] || "논문명 · 프로젝트명 · 회사명 등";
const profileState = { entries: [], presets: [], subtopics: {}, current: null, prefill: null };

async function loadProfile() {
  const r = await api("/api/profile");
  profileState.entries = r.entries;
  profileState.presets = r.presets;
  profileState.subtopics = r.subtopics || {};
  return r.entries;
}

function profileSections() {
  return [...new Set([...profileState.presets, ...profileState.entries.map((e) => e.section)])];
}

function profileSubtopics(section) {
  const used = profileState.entries.filter((e) => e.section === section && e.subtopic).map((e) => e.subtopic);
  return [...new Set([...(profileState.subtopics[section] || []), ...used])];
}

async function renderProfile() {
  await loadProfile();
  renderProfileList();
  const cur = profileState.entries.find((e) => e.id === profileState.current);
  const pre = profileState.prefill;
  profileState.prefill = null;
  cur ? showProfileForm(cur) : showProfileForm(null, pre?.section || "", pre?.title || "", pre?.subtopic || "");
}

function renderProfileList() {
  const list = $("#profileList");
  if (!profileState.entries.length) {
    list.innerHTML = `<div class="empty-inline">아직 항목이 없습니다</div>`;
    return;
  }
  const groups = {};
  profileState.entries.forEach((e) => (groups[e.section] = groups[e.section] || []).push(e));
  list.innerHTML = Object.entries(groups).map(([sec, items]) => `
    <div class="group-title">${esc(sec)} <span>${items.length}</span></div>
    ${items.map((e) => `
      <div class="list-item ${profileState.current === e.id ? "active" : ""}" data-id="${e.id}">
        <div class="t">${esc(e.title)}${e.indexed ? "" : ' <span class="badge warn">검색 미등록</span>'}</div>
        <div class="m">${esc([e.subtopic, e.period, e.org].filter(Boolean).join(" · ") || "상세 정보 없음")}</div>
      </div>`).join("")}`).join("");
  $$(".list-item", list).forEach((el) => (el.onclick = () => {
    profileState.current = el.dataset.id;
    renderProfileList();
    showProfileForm(profileState.entries.find((e) => e.id === el.dataset.id));
  }));
}

function showProfileForm(e, presetSection = "", presetTitle = "", presetSub = "") {
  const v = e || { section: presetSection, title: presetTitle, subtopic: presetSub };
  const unindexed = profileState.entries.filter((x) => !x.indexed).length;
  $("#profileContent").innerHTML = `
    <h2>${e ? "항목 수정" : "새 항목"}</h2>
    <div class="card tip">🗂 <b>마스터 프로필</b>은 지원서에 반복해서 쓰는 이력(경력, 연구실적, 프로젝트 등)을 <b>한 번만 정리해 두는 곳</b>입니다.
      저장하면 <b>기타 문항 작성</b>에서 최우선 근거로 쓰이고, <b>자소서 작성</b> 검색에도 자동으로 포함됩니다(검색 등록 비용은 거의 0원).
      <div style="margin-top:8px">💡 이력서·논문을 이미 올렸다면 <button class="btn sm" id="pExtract">✨ 자료에서 자동 추출</button>로 항목 초안을 한 번에 만들 수 있습니다.</div>
      ${unindexed ? `<div style="margin-top:8px">⚠️ 검색에 등록되지 않은 항목이 ${unindexed}개 있습니다. <button class="btn sm" id="pReindex">다시 등록</button></div>` : ""}</div>
    <div class="card">
      <div class="grid2">
        <label>대주제 *<input id="pSection" value="${esc(v.section)}" placeholder="예) 경력, 연구실적, 프로젝트" /></label>
        <label>소주제 (구분, 선택)<input id="pSub" value="${esc(v.subtopic || "")}" placeholder="예) 논문, 특허, 인턴" /></label>
      </div>
      <label>이름 * <span class="hint-i">지원서에 적는 실제 명칭</span><input id="pTitle" value="${esc(v.title)}" placeholder="예) ${esc(nameHint(v.section, v.subtopic))}" /></label>
      <div class="grid2">
        <label>기간<input id="pPeriod" value="${esc(v.period || "")}" placeholder="예) 2023.03 ~ 2023.12" /></label>
        <label>소속 · 기관<input id="pOrg" value="${esc(v.org || "")}" placeholder="예) OO대학교 OO연구실, 담당교수" /></label>
        <label>역할<input id="pRole" value="${esc(v.role || "")}" placeholder="예) 제1저자, 백엔드 인턴, 팀장" /></label>
        <label>기술 · 키워드<input id="pKeywords" value="${esc(v.keywords || "")}" placeholder="예) PyTorch, CNN, 결함 검출" /></label>
      </div>
      <label>성과 · 수치<textarea id="pAchieve" rows="2" placeholder="예) 검출 정확도 12% 향상, 학회 우수논문상">${esc(v.achievements || "")}</textarea></label>
      <label>상세 내용 <span class="hint-i">배경 → 내가 한 일 → 방법 → 결과 → 배운 점 순서로 자세히 적을수록 결과가 좋아집니다</span>
        <textarea id="pDetails" rows="10" placeholder="자유롭게 자세히 적어주세요.">${esc(v.details || "")}</textarea></label>
      <label>🔒 AI에 보내지 않는 메모 <span class="hint-i">연봉, 개인 사정 등. 이 칸은 저장만 되고 AI 요청과 검색에 절대 포함되지 않습니다</span>
        <textarea id="pPrivate" rows="2">${esc(v.private_note || "")}</textarea></label>
      <div class="row">
        <button class="btn primary" id="pSave">저장</button>
        ${e ? `<button class="btn" id="pToExtra">🧩 이 항목으로 기타 문항 작성 →</button><button class="btn ghost danger" id="pDelete">삭제</button>` : ""}
        <span class="status" id="pStatus"></span>
      </div>
    </div>`;

  const updHint = () => ($("#pTitle").placeholder = `예) ${nameHint($("#pSection").value.trim(), $("#pSub").value.trim())}`);
  $("#pSection").addEventListener("input", updHint);
  $("#pSub").addEventListener("input", updHint);
  combo($("#pSection"), () => profileSections());
  combo($("#pSub"), () => profileSubtopics($("#pSection").value.trim()));
  $("#pExtract").onclick = () => showExtract();
  $("#pReindex") && ($("#pReindex").onclick = async () => {
    const r = await api("/api/profile/reindex", { method: "POST" });
    toast(r.failed ? `⚠️ ${r.error}` : `${r.count}개 항목을 검색에 등록했습니다`, 4000);
    renderProfile();
  });
  $("#pSave").onclick = async () => {
    const body = {
      section: $("#pSection").value, subtopic: $("#pSub").value, title: $("#pTitle").value, period: $("#pPeriod").value, org: $("#pOrg").value,
      role: $("#pRole").value, keywords: $("#pKeywords").value, achievements: $("#pAchieve").value,
      details: $("#pDetails").value, private_note: $("#pPrivate").value,
    };
    $("#pStatus").innerHTML = `<span class="spinner"></span>저장 중...`;
    try {
      const saved = await api(e ? `/api/profile/${e.id}` : "/api/profile", { method: e ? "PUT" : "POST", json: body });
      profileState.current = saved.id;
      toast(saved.warning ? `⚠️ ${saved.warning}` : "저장했습니다 (검색 등록 완료)", saved.warning ? 5000 : 2600);
      await renderProfile();
      refreshCostPill();
    } catch (err) { $("#pStatus").innerHTML = `<span class="err">✗ ${esc(err.message)}</span>`; }
  };
  $("#pDelete") && ($("#pDelete").onclick = async () => {
    if (!confirm(`'${e.title}' 항목을 삭제할까요?`)) return;
    await api(`/api/profile/${e.id}`, { method: "DELETE" });
    profileState.current = null;
    toast("삭제했습니다");
    renderProfile();
  });
  $("#pToExtra") && ($("#pToExtra").onclick = () => openExtraFor(e.section, e.title, e.subtopic));
}

$("#extractProfile").onclick = () => showExtract();
$("#newProfile").onclick = () => {
  profileState.current = null;
  renderProfileList();
  showProfileForm(null);
  $("#pSection").focus();
};

// ---------------- 자료에서 자동 추출 ----------------
const extractState = { candidates: [] };

function estimateExtract(docs) {
  const p = state.config.pricing[state.config.analyzer_model];
  if (!p) return null;
  const inTok = docs.reduce((a, d) => a + Math.min(d.char_count, 15000) + 1200, 0); // 한국어 ≈ 1자 1토큰 + 지침
  return (inTok * p.input + docs.length * 2500 * p.output) / 1e6;
}

async function showExtract() {
  profileState.current = null;
  renderProfileList();
  const docs = await api("/api/documents");
  const box = $("#profileContent");
  if (!docs.length) {
    box.innerHTML = `<h2>✨ 자료에서 자동 추출</h2><div class="card tip">먼저 <b>📚 자료 관리</b>에서 이력서·논문·포트폴리오를 올려주세요.
      <button class="btn sm" id="goDocs2">자료 관리로 이동</button></div>`;
    $("#goDocs2").onclick = () => switchView("docs");
    return;
  }
  box.innerHTML = `
    <h2>✨ 자료에서 자동 추출</h2>
    <p class="sub">자료 관리에 올린 이력서·논문·포트폴리오에서 AI가 경력·연구실적·프로젝트 등을 찾아 <b>마스터 프로필 항목 초안</b>을 만듭니다.
      결과를 검토·수정한 뒤 원하는 항목만 저장할 수 있고, 저장 전에는 아무것도 바뀌지 않습니다.</p>
    <div class="card">
      <h3>1. 추출할 자료 선택</h3>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th><input type="checkbox" id="exAll" checked /></th><th>이름</th><th>분류</th><th class="num">글자수</th></tr></thead>
        <tbody>${docs.map((d) => `<tr><td><input type="checkbox" class="exDoc" value="${d.id}" ${d.enabled ? "checked" : ""} /></td>
          <td>${esc(d.name)}</td><td>${esc(d.category)}</td><td class="num">${d.char_count.toLocaleString()}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="note">자료에 적힌 사실만 추출합니다. 개인정보는 마스킹한 뒤 보내며, 1만 5천 자가 넘는 긴 자료(논문 등)는 제목·초록·결론이 있는 앞·뒤 부분만 사용합니다.</p>
      <div class="row" style="align-items:center;margin-top:10px">
        <button class="btn primary" id="exRun">추출 시작</button>
        <span class="sub" id="exEst" style="margin:0"></span>
        <span class="status" id="exStatus"></span>
      </div>
    </div>`;
  const selected = () => $$(".exDoc").filter((x) => x.checked).map((x) => docs.find((d) => d.id === x.value));
  const upd = () => {
    const sel = selected(), usd = estimateExtract(sel);
    $("#exEst").innerHTML = sel.length ? `${sel.length}개 자료 · 예상 비용 약 ${usd === null ? "(단가 미등록)" : `${fmtUsd(usd)} (${fmtKrw(usd)})`} · 모델 ${esc(state.config.analyzer_model)}` : "자료를 선택하세요";
  };
  $$(".exDoc").forEach((x) => (x.onchange = upd));
  $("#exAll").onchange = (e) => { $$(".exDoc").forEach((x) => (x.checked = e.target.checked)); upd(); };
  upd();
  $("#exRun").onclick = async () => {
    const ids = selected().map((d) => d.id);
    if (!ids.length) return toast("자료를 1개 이상 선택하세요");
    $("#exRun").disabled = true;
    $("#exStatus").innerHTML = `<span class="spinner"></span>추출 중... (자료 수에 따라 30초~2분)`;
    try {
      const r = await api("/api/profile/extract", { method: "POST", json: { doc_ids: ids } });
      extractState.candidates = r.candidates.map((c) => ({ ...c, checked: true, mode: c.exists_id ? "merge" : "new" }));
      toast(`후보 ${r.candidates.length}개 추출 · ${fmtUsd(r.cost_usd)} (${fmtKrw(r.cost_usd)})`, 3500);
      showCandidates(r.notes);
    } catch (e) {
      $("#exStatus").innerHTML = `<span class="err">✗ ${esc(e.message)}</span>`;
      $("#exRun").disabled = false;
    }
    refreshCostPill();
  };
}

function showCandidates(notes = []) {
  const cands = extractState.candidates;
  const box = $("#profileContent");
  if (!cands.length) {
    box.innerHTML = `<h2>✨ 추출 결과</h2><div class="card tip">추출된 항목이 없습니다. 이력이 담긴 자료(이력서 등)를 선택했는지 확인해 주세요.</div>
      <button class="btn" id="exBack">← 자료 다시 선택</button>`;
    $("#exBack").onclick = showExtract;
    return;
  }
  const f = (label, v) => (v ? `<span><b>${label}</b> ${esc(v)}</span>` : "");
  box.innerHTML = `
    <h2>✨ 추출 결과 검토 <span class="sub">${cands.length}개 후보</span></h2>
    <p class="sub">저장할 항목을 고르고, 대주제·소주제·이름과 상세 내용은 바로 고칠 수 있습니다. <b>이미 있음</b> 항목은 기본으로 <b>기존 항목에 병합</b>(빈 칸만 채우고 상세 내용은 뒤에 덧붙임)됩니다.</p>
    ${notes.length ? `<div class="card tip">${notes.map((n) => `<div>ℹ️ ${esc(n)}</div>`).join("")}</div>` : ""}
    <div class="row" style="margin-bottom:8px"><button class="btn sm" id="cAll">전체 선택</button><button class="btn sm" id="cNone">전체 해제</button></div>
    ${cands.map((c, i) => `
      <div class="card cand ${c.checked ? "" : "off"}" data-i="${i}">
        <div class="cand-head">
          <input type="checkbox" class="c-check" ${c.checked ? "checked" : ""} />
          <input class="c-f" data-k="section" value="${esc(c.section)}" title="대주제" />
          <span class="range-sep">›</span>
          <input class="c-f" data-k="subtopic" value="${esc(c.subtopic)}" placeholder="소주제" title="소주제" />
          <span class="range-sep">›</span>
          <input class="c-f c-title" data-k="title" value="${esc(c.title)}" title="이름" />
          ${c.exists_id ? `<span class="badge warn">이미 있음</span>
            <select class="c-mode"><option value="merge" ${c.mode === "merge" ? "selected" : ""}>기존 항목에 병합</option><option value="new" ${c.mode === "new" ? "selected" : ""}>새 항목으로 추가</option></select>` : `<span class="badge ok">새 항목</span>`}
        </div>
        <div class="cand-meta">${[f("기간", c.period), f("소속", c.org), f("역할", c.role), f("성과", c.achievements), f("키워드", c.keywords)].filter(Boolean).join("")}</div>
        <details><summary>상세 내용 ${c.details ? `(${c.details.length}자)` : "(없음)"} · 출처: ${esc((c.sources || []).join(", "))}</summary>
          <textarea class="c-f" data-k="details" rows="6">${esc(c.details)}</textarea></details>
      </div>`).join("")}
    <div class="save-bar">
      <button class="btn ghost" id="cBack">← 자료 다시 선택</button>
      <span class="sub" style="margin:0" id="cCount"></span>
      <button class="btn primary" id="cSave">선택한 항목 저장</button>
    </div>`;

  const count = () => { $("#cCount").textContent = `${cands.filter((c) => c.checked).length}개 선택 · 저장 시 검색 등록(거의 0원)`; };
  $$(".cand", box).forEach((card) => {
    const c = cands[+card.dataset.i];
    $(".c-check", card).onchange = (e) => { c.checked = e.target.checked; card.classList.toggle("off", !c.checked); count(); };
    $$(".c-f", card).forEach((inp) => (inp.oninput = () => (c[inp.dataset.k] = inp.value)));
    $(".c-mode", card) && ($(".c-mode", card).onchange = (e) => (c.mode = e.target.value));
  });
  const setAll = (v) => { cands.forEach((c) => (c.checked = v)); showCandidates(notes); };
  $("#cAll").onclick = () => setAll(true);
  $("#cNone").onclick = () => setAll(false);
  $("#cBack").onclick = showExtract;
  count();
  $("#cSave").onclick = async () => {
    const pick = cands.filter((c) => c.checked);
    if (!pick.length) return toast("저장할 항목을 선택하세요");
    if (pick.some((c) => !c.section.trim() || !c.title.trim())) return toast("대주제와 이름이 비어 있는 항목이 있습니다");
    $("#cSave").disabled = true;
    try {
      const r = await api("/api/profile/import", { method: "POST", json: { entries: pick } });
      toast(r.warning ? `⚠️ ${r.warning}` : `새 항목 ${r.added}개 추가, ${r.merged}개 병합했습니다`, 4000);
      extractState.candidates = [];
      await renderProfile();
      refreshCostPill();
    } catch (e) { toast("✗ " + e.message, 5000); $("#cSave").disabled = false; }
  };
}
