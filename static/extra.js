/* 기타 문항 작성: 대주제·소주제·출력 항목 → 항목별 서술 (app.js / profile.js 전역 사용) */
const EXTRA_SUGGEST = {
  경력: ["담당업무", "주요 성과", "직무연관성", "퇴사(이직) 사유"],
  연구실적: ["주요 내용", "본인 역할·기여도", "직무연관성"],
  프로젝트: ["프로젝트 개요", "본인 역할·기여도", "주요 성과", "직무연관성"],
  대외활동: ["활동 내용", "배운 점", "직무연관성"],
  수상: ["수상 내용", "직무연관성"],
  교육이수: ["교육 내용", "직무연관성"],
  학력: ["주요 이수 과목", "졸업 논문·프로젝트"],
  자격증: ["취득 과정·활용"],
  어학: ["활용 경험"],
};
const extraState = { list: [], current: null, draft: null };

async function renderExtra() {
  await loadProfile();
  extraState.list = await api("/api/extra");
  renderExtraList();
  if (extraState.current) {
    const rec = await api(`/api/extra/${extraState.current}`).catch(() => null);
    if (rec) return showExtra(rec);
  }
  showExtra(null, extraState.draft);
}

function renderExtraList() {
  const list = $("#extraList");
  list.innerHTML = extraState.list.length ? extraState.list.map((r) => `
    <div class="list-item ${extraState.current === r.id ? "active" : ""}" data-id="${r.id}">
      <div class="t">${esc(r.title)}</div>
      <div class="m">${esc([r.section, r.subtopic].filter(Boolean).join(" > "))} · ${esc(r.company_name || "기업 미지정")} · ${fmtDate(r.updated_at).slice(5)}</div>
    </div>`).join("") : `<div class="empty-inline">작성 이력이 없습니다</div>`;
  $$(".list-item", list).forEach((el) => (el.onclick = async () => {
    extraState.current = el.dataset.id;
    renderExtraList();
    showExtra(await api(`/api/extra/${el.dataset.id}`));
  }));
}

// 마스터 프로필에서 "이 항목으로 기타 문항 작성"
function openExtraFor(section, title, subtopic = "") {
  extraState.current = null;
  extraState.draft = { section, title, subtopic };
  switchView("extra");
}

function itemRow(it = {}) {
  return `<div class="item-row">
    <input class="i-label" placeholder="출력할 내용 (예: 주요 내용)" value="${esc(it.label || "")}" />
    <input class="i-min" type="number" min="0" step="50" placeholder="최소" value="${it.min || ""}" />
    <span class="range-sep">~</span>
    <input class="i-max" type="number" min="0" step="50" placeholder="최대" value="${it.max || ""}" />
    <button class="btn sm ghost i-del" title="삭제">✕</button>
  </div>`;
}

function showExtra(rec, draft = null) {
  const v = rec || draft || {};
  const items = rec?.items || draft?.items || [{ label: "주요 내용", max: 1000 }, { label: "직무연관성", max: 1000 }];
  const models = state.config.models;
  $("#extraContent").innerHTML = `
    <div class="input-row" style="justify-content:space-between;align-items:center">
      <h2>${rec ? `${esc(rec.title)} <span class="sub">${esc([rec.section, rec.subtopic].filter(Boolean).join(" > "))}</span>` : "🧩 기타 문항 작성"}</h2>
      ${rec ? `<div class="row"><button class="btn" id="xNew">+ 새 작성</button><button class="btn ghost danger" id="xDel">삭제</button></div>` : ""}
    </div>
    <p class="sub">지원서의 경력·연구실적 같은 항목별 칸을 작성합니다. <b>대주제</b>(예: 연구실적), <b>소주제</b>(예: 논문, 선택), <b>이름</b>(예: 실제 논문명), <b>출력할 내용</b>(예: 주요 내용, 직무연관성)을 정하면
      마스터 프로필을 최우선 근거로, 등록한 자료(RAG)를 보충 근거로 작성합니다.</p>

    <div class="card">
      <div class="grid2">
        <label>대주제 *<input id="xSection" value="${esc(v.section || "")}" placeholder="예) 경력, 연구실적, 프로젝트" /></label>
        <label>소주제 (구분, 선택)<input id="xSub" value="${esc(v.subtopic || "")}" placeholder="예) 논문, 특허, 인턴" /></label>
      </div>
      <label>이름 * <span class="hint-i">논문명·프로젝트명·회사명 등 실제 명칭. 마스터 프로필 항목은 목록에서 고를 수 있어요</span>
        <input id="xTitle" value="${esc(v.title || "")}" placeholder="예) 논문명 · 프로젝트명 · 회사명" /></label>
      <div class="grid2">
        <label>지원 기업 <span class="hint-i">직무연관성을 쓰려면 선택 추천</span><select id="xCompany"></select></label>
        <label>작성 모델<select id="xModel">${models.map((m) => `<option ${m === (v.model || state.config.writer_model) ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
      </div>
      <div id="xLink" class="link-status"></div>

      <label>출력할 내용 <span class="hint-i">지원서 칸 이름과 글자수(공백 포함). 최소를 비우면 최대의 90%가 하한</span></label>
      <div id="xItems">${items.map(itemRow).join("")}</div>
      <div class="row" style="margin:6px 0 12px;align-items:center">
        <button class="btn sm" id="xAddItem">+ 항목 추가</button>
        <span class="chips" id="xSuggest"></span>
      </div>
      <label>추가 요청 (선택)<textarea id="xRequest" rows="2" placeholder="예) 개조식으로, 협업 경험을 강조해줘, 수치를 앞에 배치">${esc(v.request || "")}</textarea></label>
      <label class="check"><input type="checkbox" id="xAuto" checked /> 글자수가 범위를 벗어나면 자동 보정(1회)</label>
      <div class="row" style="align-items:center">
        <button class="btn primary" id="xRun">✨ ${rec ? "같은 설정으로 새로 작성" : "작성하기"}</button>
        <span class="status" id="xStatus"></span>
      </div>
    </div>
    <div id="xResults"></div>`;

  fillCompanySelect($("#xCompany"), v.company_id);
  const refreshTitle = () => {
    const sec = $("#xSection").value.trim();
    $("#xTitle").placeholder = `예) ${nameHint(sec, $("#xSub").value.trim())}`;
    const sug = EXTRA_SUGGEST[sec] || ["주요 내용", "직무연관성"];
    $("#xSuggest").innerHTML = "추천: " + sug.map((s) => `<button data-s="${esc(s)}">${esc(s)}</button>`).join("");
    $$("#xSuggest button").forEach((b) => (b.onclick = () => addItem({ label: b.dataset.s, max: 1000 })));
    updateLink();
  };
  const updateLink = () => {
    const e = profileState.entries.find((x) => norm(x.section) === norm($("#xSection").value) && norm(x.title) === norm($("#xTitle").value));
    $("#xLink").innerHTML = !$("#xTitle").value.trim() ? "" : e
      ? `✅ <b>마스터 프로필 연결됨</b>: 이 항목의 정리된 이력을 최우선 근거로 사용합니다.`
      : `ℹ️ 마스터 프로필에 없는 항목입니다. 등록한 자료(RAG)만으로 작성하며, 부족한 사실은 <code>[확인 필요]</code>로 표시됩니다.
         <a href="#" id="xGoProfile">마스터 프로필에 추가하기</a>`;
    $("#xGoProfile") && ($("#xGoProfile").onclick = (ev) => {
      ev.preventDefault();
      profileState.current = null;
      profileState.prefill = { section: $("#xSection").value.trim(), subtopic: $("#xSub").value.trim(), title: $("#xTitle").value.trim() };
      switchView("profile");
    });
  };
  const norm = (s) => (s || "").replace(/\s/g, "").toLowerCase();
  const addItem = (it) => {
    $("#xItems").insertAdjacentHTML("beforeend", itemRow(it));
    bindItemRows();
  };
  const bindItemRows = () => $$("#xItems .i-del").forEach((b) => (b.onclick = () => {
    if ($$("#xItems .item-row").length > 1) b.closest(".item-row").remove();
  }));
  bindItemRows();
  $("#xSection").addEventListener("input", refreshTitle);
  $("#xSub").addEventListener("input", refreshTitle);
  $("#xTitle").addEventListener("input", updateLink);
  combo($("#xSection"), () => profileSections());
  combo($("#xSub"), () => profileSubtopics($("#xSection").value.trim()));
  // 이름: 마스터 프로필 항목 (대주제·소주제로 좁힘). 고르면 대주제·소주제도 채움
  combo($("#xTitle"), () => {
    const sec = $("#xSection").value.trim(), sub = $("#xSub").value.trim();
    return profileState.entries.filter((e) => (!sec || e.section === sec) && (!sub || !e.subtopic || e.subtopic === sub))
      .map((e) => ({ value: e.title, sub: [e.section, e.subtopic].filter(Boolean).join(" > "), entry: e }));
  }, (o) => {
    if (!o.entry) return;
    $("#xSection").value = o.entry.section;
    if (o.entry.subtopic) $("#xSub").value = o.entry.subtopic;
    refreshTitle();
  });
  $("#xAddItem").onclick = () => addItem({});
  refreshTitle();

  $("#xRun").onclick = async () => {
    const body = {
      section: $("#xSection").value, subtopic: $("#xSub").value, title: $("#xTitle").value, company_id: $("#xCompany").value || null,
      model: $("#xModel").value, request: $("#xRequest").value, auto_adjust: $("#xAuto").checked,
      items: $$("#xItems .item-row").map((r) => ({
        label: $(".i-label", r).value.trim(), min: parseInt($(".i-min", r).value) || null, max: parseInt($(".i-max", r).value) || null,
      })).filter((x) => x.label),
    };
    if (!body.section.trim() || !body.title.trim()) return toast("대주제와 이름(논문명·프로젝트명·회사명 등)을 입력하세요");
    if (!body.items.length) return toast("출력할 내용을 1개 이상 입력하세요");
    const bad = body.items.find((x) => x.min && x.max && x.min > x.max);
    if (bad) return toast(`'${bad.label}'의 최소 글자수가 최대보다 큽니다`);
    $("#xRun").disabled = true;
    $("#xStatus").innerHTML = `<span class="spinner"></span>근거를 찾고 작성하는 중... (항목 수에 따라 20초~1분)`;
    try {
      const r = await api("/api/extra", { method: "POST", json: body });
      extraState.current = r.id;
      extraState.draft = null;
      extraState.list = await api("/api/extra");
      renderExtraList();
      showExtra(r);
      toast(`작성 완료 · ${fmtUsd(r.meta.cost_usd)} (${fmtKrw(r.meta.cost_usd)})`);
    } catch (e) {
      $("#xStatus").innerHTML = `<span class="err">✗ ${esc(e.message)}</span>`;
      $("#xRun").disabled = false;
    }
    refreshCostPill();
  };

  if (rec) {
    renderExtraResults(rec);
    $("#xNew").onclick = () => {
      extraState.current = null;
      extraState.draft = { section: rec.section, subtopic: rec.subtopic, title: rec.title, company_id: rec.company_id, items: rec.items, model: rec.model };
      renderExtraList();
      showExtra(null, extraState.draft);
    };
    $("#xDel").onclick = async () => {
      if (!confirm("이 작성 이력을 삭제할까요?")) return;
      await api(`/api/extra/${rec.id}`, { method: "DELETE" });
      extraState.current = null;
      renderExtra();
    };
  }
}

function renderExtraResults(rec) {
  const m = rec.meta || {};
  const srcs = m.sources || [];
  $("#xResults").innerHTML = `
    <h3 style="margin-top:20px">작성 결과 <span class="sub">${m.profile_used ? "✅ 마스터 프로필 기반" : "ℹ️ 자료(RAG) 기반"} · 누적 비용 ${fmtUsd(m.cost_usd)} (${fmtKrw(m.cost_usd)})</span></h3>
    ${rec.items.map((it) => `
      <div class="card result-card" data-label="${esc(it.label)}">
        <div class="step-head"><h3>${esc(it.label)}</h3><span class="x-badge"></span></div>
        <textarea class="x-text" rows="${Math.min(14, Math.max(4, Math.ceil((rec.results[it.label] || "").length / 60)))}">${esc(rec.results[it.label] || "")}</textarea>
        <div class="row" style="margin-top:8px;align-items:center">
          <button class="btn sm" data-act="copy">복사</button>
          <button class="btn sm" data-act="regen">다시 쓰기</button>
          <button class="btn sm primary" data-act="save" hidden>수정 저장</button>
          <span class="status x-status"></span>
        </div>
      </div>`).join("")}
    ${(m.questions || []).length ? `<div class="card tip"><b>보완 질문</b> <span class="hint-i">답을 마스터 프로필 '상세 내용'에 추가하고 다시 작성하면 반영됩니다</span>
      <ul>${m.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}
    ${srcs.length ? `<details class="sources card"><summary>참고한 자료 ${srcs.length}개</summary>${srcs.map((s, i) => `
      <div class="src"><div class="h"><span>[${i + 1}] ${esc(s.name)} <span class="badge">${esc(s.category)}</span></span><span>유사도 ${s.score}</span></div>
      <div class="x">${esc(s.text)}</div></div>`).join("")}</details>` : ""}`;

  $$("#xResults .result-card").forEach((card) => {
    const label = card.dataset.label;
    const it = rec.items.find((x) => x.label === label);
    const ta = $(".x-text", card);
    const upd = () => ($(".x-badge", card).innerHTML = charBadge(countChars(ta.value), it.min, it.max).replace("본문 ", ""));
    upd();
    ta.oninput = () => { upd(); $("[data-act=save]", card).hidden = false; };
    $("[data-act=copy]", card).onclick = async () => { await navigator.clipboard.writeText(ta.value); toast(`'${label}' 복사했습니다`); };
    $("[data-act=save]", card).onclick = async () => {
      const r = await api(`/api/extra/${rec.id}`, { method: "PUT", json: { results: { [label]: ta.value } } });
      rec.results = r.results;
      $("[data-act=save]", card).hidden = true;
      toast("저장했습니다");
    };
    $("[data-act=regen]", card).onclick = async () => {
      const instruction = prompt(`'${label}'을(를) 다시 씁니다. 원하는 방향이 있으면 적어주세요 (비워두면 다른 관점으로 재작성)`, "");
      if (instruction === null) return;
      $(".x-status", card).innerHTML = `<span class="spinner"></span>다시 쓰는 중...`;
      try {
        const r = await api(`/api/extra/${rec.id}/regenerate`, { method: "POST", json: { label, instruction } });
        toast(`다시 썼습니다 · ${fmtUsd(r.last_cost_usd)}`);
        showExtra(r);
      } catch (e) { $(".x-status", card).innerHTML = `<span class="err">✗ ${esc(e.message)}</span>`; }
      refreshCostPill();
    };
  });
}

$("#newExtra").onclick = () => {
  extraState.current = null;
  extraState.draft = null;
  renderExtraList();
  showExtra(null);
  $("#xSection").focus();
};
