/* 초기 설정: 로컬 .env 편집 튜토리얼 (app.js의 $, api, esc, toast, state, switchView, applyConfig 사용) */
const setupState = { data: null, keyTest: null, failedKey: null };

const RECOMMENDED = {
  WRITER_MODEL: "gpt-5.6-terra",
  ANALYZER_MODEL: "gpt-5.6-terra",
  UTILITY_MODEL: "gpt-5.6-luna",
  EMBEDDING_MODEL: "text-embedding-3-small",
};

function modelOptions(pricing, selected, { embedding = false } = {}) {
  const names = Object.keys(pricing).filter((m) => m.startsWith("text-embedding") === embedding);
  if (selected && !names.includes(selected)) names.unshift(selected);
  const avail = setupState.keyTest?.models || {};
  return names.map((m) => {
    const p = pricing[m];
    const price = p ? (embedding ? ` — $${p.input}/1M` : ` — 입력 $${p.input} · 출력 $${p.output} /1M`) : " — 단가 미등록";
    const rec = Object.values(RECOMMENDED).includes(m) ? " ★추천" : "";
    const warn = m in avail && !avail[m] ? " ⚠ 이 키로 사용 불가" : "";
    return `<option value="${esc(m)}" ${m === selected ? "selected" : ""}>${esc(m)}${price}${rec}${warn}</option>`;
  }).join("");
}

function secretBlock(key, v, placeholder) {
  return `
    <div class="secret-row">
      <input type="password" data-key="${key}" autocomplete="off" spellcheck="false"
        placeholder="${v.set ? `현재 저장됨: ${esc(v.masked)}  (바꾸려면 새 키 붙여넣기)` : esc(placeholder)}" />
      <button class="btn sm ghost" data-reveal="${key}" title="입력값 보기">👁</button>
    </div>`;
}

function statusBadge(ok, okText, noText) {
  return `<span class="badge ${ok ? "ok" : "warn"}">${ok ? "✓ " + okText : noText}</span>`;
}

async function renderSetup() {
  const box = $("#setupContent");
  if (!setupState.data) box.innerHTML = `<span class="spinner"></span>불러오는 중...`;
  const d = (setupState.data = await api("/api/setup"));
  const v = d.values, P = d.pricing;
  const availList = (v.AVAILABLE_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const textModels = Object.keys(P).filter((m) => !m.startsWith("text-embedding"));
  const steps = [
    { n: 1, t: "API 키", done: v.OPENAI_API_KEY.set },
    { n: 2, t: "모델", done: v.OPENAI_API_KEY.set },
    { n: 3, t: "개인정보", done: v.OPENAI_API_KEY.set },
    { n: 4, t: "비용 관리", done: v.OPENAI_API_KEY.set },
  ];

  box.innerHTML = `
    <h2>⚙️ 초기 설정</h2>
    <p class="sub">이 화면에서 입력한 값은 <code>.env</code> 파일에 저장되고 <b>서버 재시작 없이 바로 적용</b>됩니다. 처음이라면 1번부터 차례대로 진행하세요.</p>

    <div class="stepper">${steps.map((s) => `<a href="#step${s.n}" class="step ${s.done ? "done" : ""}"><span class="num">${s.done ? "✓" : s.n}</span>${s.t}</a>`).join('<span class="step-line"></span>')}</div>

    <div class="card safe">
      <h3>🔒 입력한 정보는 이 PC의 .env 파일에만 저장됩니다</h3>
      <ul>
        <li>이 웹은 <b>내 컴퓨터(127.0.0.1)에서만 실행되는 서버</b>입니다. <b>저장</b>을 누르면 아래 경로의 파일에 직접 기록되며, 개발자나 외부 서버로 전송되지 않습니다.<br/><code>${esc(d.env_path)}</code></li>
        <li><b>키 확인</b> 버튼은 키가 유효한지 <b>OpenAI(api.openai.com)에 직접</b> 확인만 합니다. 모델 목록 조회라서 요금이 들지 않습니다.</li>
        <li>저장된 키는 화면에 <b>앞뒤 일부만</b> 표시되고, 브라우저로 전체 키를 다시 보내지 않습니다.</li>
        <li><code>.env</code>는 <code>.gitignore</code>에 포함되어 GitHub에 올라가지 않으며, 파일 권한은 본인만 읽을 수 있게(600) 저장됩니다.</li>
        <li>다른 웹사이트가 이 설정을 몰래 바꾸지 못하도록, 이 PC에서 온 요청만 받습니다.</li>
      </ul>
    </div>

    <!-- STEP 1 -->
    <div class="card step-card" id="step1">
      <div class="step-head"><h3>1. OpenAI API 키 <span class="req">필수</span></h3>${statusBadge(v.OPENAI_API_KEY.set, "설정됨", "미설정")}</div>
      <details class="guide" ${v.OPENAI_API_KEY.set ? "" : "open"}>
        <summary>📖 API 키 발급 방법 (약 5분)</summary>
        <ol>
          <li><a href="https://platform.openai.com/" target="_blank" rel="noopener">platform.openai.com</a>에 접속해 로그인하거나 가입합니다.
            <div class="note">ChatGPT 계정으로 로그인할 수 있지만, <b>ChatGPT Plus 구독과 API 요금은 별개</b>입니다. API는 쓴 만큼 따로 결제합니다.</div></li>
          <li><a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener">Settings → Billing</a>에서 결제수단을 등록하고 <b>크레딧을 충전</b>합니다(최소 $5).
            <div class="note">크레딧이 없으면 키가 있어도 호출이 실패합니다. 과금이 걱정되면 <b>자동 충전(Auto recharge)을 끄세요</b>. 이 앱으로는 $5로도 자소서 수십~수백 건을 쓸 수 있습니다.</div></li>
          <li><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">API keys</a> 페이지에서 <b>+ Create new secret key</b>를 누릅니다.</li>
          <li>Name은 <code>ResumeAssistant</code>처럼 알아보기 쉽게, Project는 <code>Default project</code>, Permissions는 <code>All</code>로 두고 <b>Create secret key</b>를 누릅니다.</li>
          <li>표시된 키(<code>sk-proj-…</code>)를 <b>바로 복사</b>합니다. <b>창을 닫으면 다시 볼 수 없으니</b>, 잃어버렸다면 새로 발급하세요.</li>
          <li>아래 칸에 붙여넣고 <b>키 확인</b>을 누른 뒤, 맨 아래 <b>저장</b>을 누르면 끝입니다.</li>
        </ol>
        <div class="note">💡 <a href="https://platform.openai.com/settings/organization/limits" target="_blank" rel="noopener">Limits</a> 메뉴에서 월 사용 한도를 걸어두면 예상치 못한 과금을 막을 수 있습니다. 키가 유출됐다면 API keys 페이지에서 즉시 <b>Revoke</b>하세요.</div>
      </details>
      ${secretBlock("OPENAI_API_KEY", v.OPENAI_API_KEY, "sk-proj-로 시작하는 키를 붙여넣으세요")}
      <div class="row" style="margin-top:8px">
        <button class="btn" id="testKey">키 확인 (무료)</button>
        ${v.OPENAI_API_KEY.set ? `<button class="btn ghost danger" data-clear="OPENAI_API_KEY">저장된 키 삭제</button>` : ""}
        <span class="status" id="keyResult"></span>
      </div>
    </div>

    <!-- STEP 2 -->
    <div class="card step-card" id="step2">
      <div class="step-head"><h3>2. 사용할 모델</h3><span class="badge">★추천값 그대로 두어도 됩니다</span></div>
      <p class="sub">가격은 100만 토큰당 USD입니다. 자소서 한 번 작성에는 보통 입력 1~2만, 출력 1~3천 토큰 정도가 듭니다. <b>키 확인</b>을 먼저 하면 이 키로 쓸 수 없는 모델에 ⚠ 표시가 붙습니다.</p>
      <div class="grid2">
        <label>자소서 작성 모델 <span class="hint-i">품질이 가장 중요</span><select data-key="WRITER_MODEL">${modelOptions(P, v.WRITER_MODEL)}</select></label>
        <label>기업 분석 · 맞춤 프롬프트 모델<select data-key="ANALYZER_MODEL">${modelOptions(P, v.ANALYZER_MODEL)}</select></label>
        <label>보조 작업 모델 <span class="hint-i">검색어 생성 등, 저렴한 모델 추천</span><select data-key="UTILITY_MODEL">${modelOptions(P, v.UTILITY_MODEL)}</select></label>
        <label>임베딩 모델 <span class="hint-i">⚠ 바꾸면 등록한 자료를 모두 다시 올려야 함</span><select data-key="EMBEDDING_MODEL">${modelOptions(P, v.EMBEDDING_MODEL, { embedding: true })}</select></label>
        <label>추론 강도 (reasoning effort)
          <select data-key="REASONING_EFFORT">${["low", "medium", "high"].map((e) => `<option value="${e}" ${e === v.REASONING_EFFORT ? "selected" : ""}>${{ low: "low — 빠르고 저렴", medium: "medium — 균형 (추천)", high: "high — 느리지만 꼼꼼" }[e]}</option>`).join("")}</select></label>
      </div>
      <label>작성 화면에서 고를 수 있는 모델</label>
      <div class="checks" id="availModels">${textModels.map((m) => `<label class="check"><input type="checkbox" value="${esc(m)}" ${availList.includes(m) ? "checked" : ""}/> ${esc(m)}</label>`).join("")}</div>
    </div>

    <!-- STEP 3 -->
    <div class="card step-card" id="step3">
      <div class="step-head"><h3>3. 개인정보 보호</h3>${statusBadge(v.PII_MASKING === "true", "마스킹 켜짐", "마스킹 꺼짐")}</div>
      <p class="sub">OpenAI로 보내기 전에 주민번호, 전화번호, 이메일, 상세주소를 자동으로 <code>[전화번호]</code>처럼 가립니다. 자소서 내용에는 필요 없는 정보라 켜두는 것을 권장합니다.</p>
      <label class="check"><input type="checkbox" data-key="PII_MASKING" ${v.PII_MASKING === "true" ? "checked" : ""}/> 개인정보 자동 마스킹 사용</label>
      <label>추가로 가릴 단어 (쉼표로 구분, 예: 본인 이름) → <code>[지원자]</code>로 바뀜
        <input data-key="PII_CUSTOM_TERMS" value="${esc(v.PII_CUSTOM_TERMS)}" placeholder="예) 홍길동, 길동" /></label>
      <div class="note">설정을 바꾼 뒤에는 이미 등록한 자료를 <b>자료 관리 → 재색인</b>해야 새 설정이 적용됩니다.</div>
    </div>

    <!-- STEP 4 -->
    <div class="card step-card" id="step4">
      <div class="step-head"><h3>4. 비용 관리</h3><span class="badge">선택</span></div>
      <div class="grid2">
        <label>월 예산 (USD) <span class="hint-i">넘으면 사이드바 금액이 빨갛게 표시, 0이면 끔</span><input type="number" step="1" min="0" data-key="MONTHLY_BUDGET_USD" value="${esc(v.MONTHLY_BUDGET_USD)}" /></label>
        <label>원화 환율 (원/$)<input type="number" step="10" min="1" data-key="USD_KRW" value="${esc(v.USD_KRW)}" /></label>
      </div>
      <label>OpenAI Admin API 키 (선택) — 공식 청구 금액 조회용</label>
      <details class="guide">
        <summary>📖 Admin 키가 필요한가요? 발급 방법</summary>
        <p>없어도 됩니다. 이 앱은 매 요청의 토큰 사용량으로 <b>실시간 추정 비용</b>을 계산합니다. Admin 키를 넣으면 <b>OpenAI가 실제로 청구한 금액</b>(조직 전체, 일 단위, 수 시간 지연)을 함께 볼 수 있습니다.</p>
        <ol>
          <li><a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noopener">Settings → Organization → Admin keys</a>로 이동합니다. 조직 <b>Owner</b>만 발급할 수 있습니다.</li>
          <li><b>Create new admin key</b>를 누르고 이름을 입력한 뒤 만들면 <code>sk-admin-…</code> 키가 나옵니다. 복사해서 아래에 붙여넣으세요.</li>
        </ol>
        <div class="note">⚠ Admin 키는 조직 전체를 관리할 수 있는 <b>강력한 키</b>입니다. 절대 공유하지 말고, 필요 없으면 비워두세요.</div>
      </details>
      ${secretBlock("OPENAI_ADMIN_KEY", v.OPENAI_ADMIN_KEY, "sk-admin-… (선택)")}
      <div class="row" style="margin-top:8px">
        <button class="btn" id="testAdmin">Admin 키 확인</button>
        ${v.OPENAI_ADMIN_KEY.set ? `<button class="btn ghost danger" data-clear="OPENAI_ADMIN_KEY">저장된 Admin 키 삭제</button>` : ""}
        <span class="status" id="adminResult"></span>
      </div>
    </div>

    <!-- 고급 -->
    <details class="card step-card">
      <summary><b>고급 설정 (RAG 검색)</b> — 잘 모르겠다면 기본값 그대로 두세요</summary>
      <div class="grid2" style="margin-top:12px">
        <label>검색할 청크 수 (RAG_TOP_K)<input type="number" min="1" max="30" data-key="RAG_TOP_K" value="${esc(v.RAG_TOP_K)}" /></label>
        <label>함께 보낼 최근 대화 턴 수<input type="number" min="0" max="50" data-key="HISTORY_TURNS" value="${esc(v.HISTORY_TURNS)}" /></label>
        <label>청크 크기 (문자) <span class="hint-i">변경 시 재색인 필요</span><input type="number" min="200" max="3000" data-key="CHUNK_SIZE" value="${esc(v.CHUNK_SIZE)}" /></label>
        <label>청크 겹침 (문자)<input type="number" min="0" max="1000" data-key="CHUNK_OVERLAP" value="${esc(v.CHUNK_OVERLAP)}" /></label>
      </div>
      <label class="check"><input type="checkbox" data-key="RAG_QUERY_EXPANSION" ${v.RAG_QUERY_EXPANSION === "true" ? "checked" : ""}/> 검색어 확장 (문항·기업 정보로 검색어를 여러 개 만들어 더 정확히 검색)</label>
    </details>

    <details class="card step-card">
      <summary><b>직접 .env 파일을 수정하고 싶다면</b></summary>
      <ol style="margin-top:10px">
        <li>프로젝트 폴더의 <code>.env</code> 파일을 텍스트 편집기(VS Code, 메모장 등)로 엽니다. 파일이 없으면 <code>.env.example</code>을 복사해 이름을 <code>.env</code>로 바꿉니다.<br/>
          macOS 터미널: <code>open -e "${esc(d.env_path)}"</code></li>
        <li><code>OPENAI_API_KEY=sk-proj-…</code>처럼 <code>=</code> 뒤에 값을 공백 없이 적습니다.</li>
        <li>저장한 뒤 이 화면을 새로고침하면 반영됩니다. <code>HOST</code>, <code>PORT</code>, <code>DATA_DIR</code>를 바꿨다면 서버를 재시작하세요(<code>Ctrl+C</code> 후 <code>./run.sh</code>).</li>
      </ol>
    </details>

    <div class="save-bar">
      <span class="sub" style="margin:0">🔒 저장 위치: <code>.env</code> (이 PC)</span>
      <span class="status" id="saveResult"></span>
      <button class="btn primary" id="saveSetup">저장</button>
    </div>
    <div id="setupDone"></div>`;

  bindSetup();
}

function collectSetup() {
  const values = {};
  $$("#setupContent [data-key]").forEach((el) => {
    const k = el.dataset.key;
    if (el.type === "checkbox") values[k] = el.checked ? "true" : "false";
    else if (el.type === "password") { if (el.value.trim()) values[k] = el.value.trim(); }
    else values[k] = el.value.trim();
  });
  const avail = $$("#availModels input:checked").map((x) => x.value);
  const writer = values.WRITER_MODEL;
  if (writer && !avail.includes(writer)) avail.unshift(writer); // 기본 작성 모델은 항상 포함
  values.AVAILABLE_MODELS = avail.join(",");
  return values;
}

function bindSetup() {
  $$("#setupContent [data-reveal]").forEach((b) => (b.onclick = () => {
    const inp = $(`#setupContent input[data-key="${b.dataset.reveal}"]`);
    inp.type = inp.type === "password" ? "text" : "password";
  }));

  $("#testKey").onclick = async () => {
    const key = $('#setupContent input[data-key="OPENAI_API_KEY"]').value.trim();
    const models = ["WRITER_MODEL", "ANALYZER_MODEL", "UTILITY_MODEL", "EMBEDDING_MODEL"].map((k) => $(`#setupContent [data-key="${k}"]`).value)
      .concat($$("#availModels input:checked").map((x) => x.value));
    $("#keyResult").innerHTML = `<span class="spinner"></span>OpenAI에 확인 중...`;
    const r = await api("/api/setup/test-key", { method: "POST", json: { key, models } });
    setupState.keyTest = r.ok ? r : null;
    setupState.failedKey = r.ok ? null : key;
    if (!r.ok) { $("#keyResult").innerHTML = `<span class="err">✗ ${esc(r.error)}</span>`; return; }
    const bad = Object.entries(r.models).filter(([, ok]) => !ok).map(([m]) => m);
    $("#keyResult").innerHTML = `<span class="ok">✓ 유효한 키입니다 (사용 가능 모델 ${r.model_count}개)</span>` +
      (bad.length ? `<div class="err" style="margin-top:4px">⚠ 이 키로 쓸 수 없는 모델: ${bad.map(esc).join(", ")} → 2단계에서 다른 모델을 고르세요.</div>` : "") +
      (key ? `<div class="sub" style="margin:4px 0 0">아직 저장되지 않았습니다. 맨 아래 <b>저장</b>을 눌러주세요.</div>` : "");
    // 모델 선택지에 사용 가능 여부 표시 갱신
    const P = setupState.data.pricing;
    ["WRITER_MODEL", "ANALYZER_MODEL", "UTILITY_MODEL"].forEach((k) => { const s = $(`#setupContent [data-key="${k}"]`); s.innerHTML = modelOptions(P, s.value); });
    const e = $('#setupContent [data-key="EMBEDDING_MODEL"]'); e.innerHTML = modelOptions(P, e.value, { embedding: true });
  };

  $("#testAdmin").onclick = async () => {
    const key = $('#setupContent input[data-key="OPENAI_ADMIN_KEY"]').value.trim();
    $("#adminResult").innerHTML = `<span class="spinner"></span>확인 중...`;
    const r = await api("/api/setup/test-admin-key", { method: "POST", json: { key } });
    $("#adminResult").innerHTML = r.ok ? `<span class="ok">✓ 유효한 Admin 키입니다</span>` : `<span class="err">✗ ${esc(r.error)}</span>`;
  };

  $$("#setupContent [data-clear]").forEach((b) => (b.onclick = async () => {
    if (!confirm("저장된 키를 .env에서 삭제할까요?")) return;
    await api("/api/setup", { method: "PUT", json: { values: { [b.dataset.clear]: { __clear__: true } } } });
    await applyConfig(); toast("삭제했습니다"); renderSetup();
  }));

  $("#saveSetup").onclick = async () => {
    const wasSet = setupState.data.values.OPENAI_API_KEY.set;
    const newKey = $('#setupContent input[data-key="OPENAI_API_KEY"]').value.trim();
    if (newKey && newKey === setupState.failedKey &&
        !confirm("이 키는 '키 확인'에 실패했습니다. 그래도 저장할까요?")) return;
    const btn = $("#saveSetup");
    btn.disabled = true;
    $("#saveResult").innerHTML = `<span class="spinner"></span>저장 중...`;
    try {
      await api("/api/setup", { method: "PUT", json: { values: collectSetup() } });
      await applyConfig();
      await renderSetup();
      toast("✓ .env에 저장했습니다. 바로 적용됩니다.");
      if (!wasSet && state.config.api_key_set) {
        $("#setupDone").innerHTML = `
          <div class="card safe">
            <h3>🎉 설정 완료! 이제 이렇게 시작하세요</h3>
            <ol>
              <li><b>자료 관리</b>: 이력서, 포트폴리오, 노션 내보내기 ZIP을 올립니다.</li>
              <li><b>기업 분석</b>: 지원할 회사의 JD를 넣어 맞춤 프롬프트를 만듭니다.</li>
              <li><b>작성</b>: 문항을 만들고 초안 작성을 누릅니다.</li>
            </ol>
            <button class="btn primary" id="goDocs">자료 올리러 가기 →</button>
          </div>`;
        $("#goDocs").onclick = () => switchView("docs");
        $("#setupDone").scrollIntoView({ behavior: "smooth" });
      }
    } catch (e) {
      $("#saveResult").innerHTML = `<span class="err">✗ ${esc(e.message)}</span>`;
    } finally {
      btn.disabled = false;
    }
  };
}
