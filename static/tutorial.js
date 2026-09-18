/* 튜토리얼: 구조·안전성·비용·페이지별 사용법 안내 (app.js의 $, esc, state, switchView, fmtUsd, fmtKrw 사용) */

function tutorialSeen() {
  try { return localStorage.getItem("tutorialSeen") === "1"; } catch { return true; }
}
function markTutorialSeen() {
  try { localStorage.setItem("tutorialSeen", "1"); } catch { /* 저장 불가 환경 무시 */ }
}

// 작업 1회당 대략적인 토큰 사용량 (실측 평균 기반 추정치)
const USAGE_PROFILE = {
  draft: { label: "초안 작성·수정 1회", writer: [10000, 2500], utility: [500, 150], embed: 300 },
  review: { label: "첨삭·평가 1회", writer: [11000, 2000], utility: [500, 150], embed: 300 },
  company: { label: "기업 분석 1회 (웹 검색 포함)", analyzer: [15000, 3500], search: 3 },
  docs: { label: "자료 등록 (A4 10쪽 분량)", embed: 8000 },
};

function estimate(kind, writerModel) {
  const c = state.config, P = c.pricing, p = USAGE_PROFILE[kind];
  const cost = (model, [inp, out]) => { const m = P[model]; return m ? (inp * m.input + out * m.output) / 1e6 : 0; };
  let usd = 0;
  if (p.writer) usd += cost(writerModel || c.writer_model, p.writer);
  if (p.utility) usd += cost(c.utility_model, p.utility);
  if (p.analyzer) usd += cost(c.analyzer_model, p.analyzer);
  if (p.embed) usd += cost(c.embedding_model, [p.embed, 0]);
  if (p.search) usd += p.search * (c.web_search_per_call || 0.01);
  return usd;
}

function costTable() {
  const c = state.config;
  const rows = Object.keys(USAGE_PROFILE).map((k) => {
    const usd = estimate(k);
    return `<tr><td>${USAGE_PROFILE[k].label}</td><td class="num">${fmtUsd(usd)}</td><td class="num">${fmtKrw(usd)}</td></tr>`;
  }).join("");
  const models = c.models.filter((m) => c.pricing[m]);
  const cmp = models.map((m) => {
    const usd = estimate("draft", m), p = c.pricing[m];
    return `<tr><td>${esc(m)}${m === c.writer_model ? ' <span class="badge ok">현재 기본</span>' : ""}</td>
      <td class="num">$${p.input} / $${p.output}</td><td class="num">${fmtUsd(usd)}</td><td class="num">${fmtKrw(usd)}</td></tr>`;
  }).join("");
  return `
    <h4>현재 설정 기준 예상 비용</h4>
    <div class="table-wrap"><table class="table compact"><thead><tr><th>작업</th><th class="num">USD</th><th class="num">원화</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h4>작성 모델별 비교 (초안 1회 기준)</h4>
    <div class="table-wrap"><table class="table compact"><thead><tr><th>모델</th><th class="num">단가 입력/출력 (1M 토큰)</th><th class="num">1회 (USD)</th><th class="num">1회 (원화)</th></tr></thead><tbody>${cmp}</tbody></table></div>
    <p class="note">※ 실제 사용량 평균으로 잡은 <b>대략적인 추정치</b>입니다. 자료 양, 대화 길이, 추론 강도(현재 <code>${esc(c.reasoning_effort || "medium")}</code>)에 따라 달라집니다. 추론 모델은 답변에 보이지 않는 '생각' 토큰도 출력 요금으로 청구됩니다. 정확한 금액은 <b>💰 사용량</b> 페이지에서 확인하세요.</p>`;
}

function renderTutorial() {
  markTutorialSeen();
  const c = state.config;
  const budget = c.monthly_budget_usd ? `${fmtUsd(c.monthly_budget_usd)} (${fmtKrw(c.monthly_budget_usd)})` : "설정 안 됨";
  const pageCard = (ico, title, view, what, steps, tips) => `
    <div class="card guide-card">
      <div class="step-head"><h3>${ico} ${title}</h3><button class="btn sm" data-go="${view}">이 페이지로 이동 →</button></div>
      <p>${what}</p>
      <h4>사용 방법</h4><ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      ${tips.length ? `<h4>팁</h4><ul>${tips.map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}
    </div>`;

  $("#tutorialContent").innerHTML = `
    <h2>📘 자소서 도우미 튜토리얼</h2>
    <p class="sub">처음 사용하신다면 이 페이지를 끝까지 읽어주세요. 프로그램 구조, API 키 안전성, <b>비용 부담</b>, 페이지별 사용법을 설명합니다.</p>

    <div class="toc">
      <a href="#t-cost">⚠️ 비용 안내</a><a href="#t-arch">🏠 구조와 안전성</a><a href="#t-flow">🧭 사용 흐름</a>
      <a href="#t-pages">📄 페이지별 가이드</a><a href="#t-faq">❓ 자주 묻는 질문</a>
    </div>

    <!-- 비용 -->
    <div class="card cost-warn" id="t-cost">
      <h3>⚠️ API 사용 비용은 전적으로 본인 부담입니다</h3>
      <p class="lead">이 프로그램은 무료 오픈소스(MIT)지만, 자소서 작성·기업 분석·자료 등록처럼 <b>AI 기능을 쓸 때마다 OpenAI API 사용료가 발생</b>합니다.
        이 비용은 <b>초기 설정에 입력한 API 키의 소유자(본인)의 OpenAI 계정으로 직접 청구</b>되며, 프로그램 개발자는 비용을 대신 내거나 책임지지 않습니다.</p>
      <ul>
        <li><b>비용이 달라지는 요인</b>
          <ul>
            <li>선택한 모델: 모델마다 단가가 크게 다르며, 비싼 모델은 수십 배까지 차이 납니다.</li>
            <li>요청 횟수, 대화 길이, 참고 자료 양</li>
            <li>웹 검색 사용 여부, 추론 강도</li>
          </ul></li>
        <li><b>OpenAI 쪽 한도 설정</b>: 이 앱의 예산 표시는 <b>알림일 뿐 결제를 막지는 않습니다.</b> 확실한 상한은 OpenAI에서 거세요.
          <ul>
            <li><a href="https://platform.openai.com/settings/organization/limits" target="_blank" rel="noopener">Limits</a>에서 월 사용 한도를 설정합니다.</li>
            <li><a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener">Billing</a>에서 <b>자동 충전(Auto recharge)을 끄세요.</b></li>
          </ul></li>
        <li><b>현재 이 앱의 월 예산 알림</b>: ${budget} (초기 설정에서 변경)</li>
      </ul>
      ${costTable()}
      <label class="check ack"><input type="checkbox" id="ackCost" /> 모델 선택과 사용량에 따라 발생하는 API 비용은 본인이 부담한다는 것을 이해했습니다.</label>
    </div>

    <!-- 구조 -->
    <div class="card" id="t-arch">
      <h3>🏠 프로그램 구조: 모든 것이 내 컴퓨터에서 동작합니다</h3>
      <div class="arch">
        <div class="arch-pc">
          <div class="arch-title">💻 내 컴퓨터 (로컬)</div>
          <div class="arch-row">
            <div class="arch-box">🌐 브라우저<small>이 화면</small></div>
            <div class="arch-arrow">⇄<small>127.0.0.1</small></div>
            <div class="arch-box strong">⚙️ 로컬 서버<small>./run.sh로 실행한 FastAPI</small></div>
          </div>
          <div class="arch-store">
            <div class="arch-box">🔑 <code>.env</code><small>API 키·설정 (권한 600)</small></div>
            <div class="arch-box">🗂 <code>data/app.db</code><small>문항·대화·기업 분석·사용량</small></div>
            <div class="arch-box">🧭 <code>data/chroma</code><small>자료 벡터 (RAG)</small></div>
            <div class="arch-box">📄 <code>data/raw</code><small>자료에서 추출한 텍스트</small></div>
          </div>
        </div>
        <div class="arch-link">
          <div class="arch-arrow big">→</div>
          <small>HTTPS · 마스킹된 텍스트<br/>+ API 키(인증용)</small>
        </div>
        <div class="arch-cloud">
          <div class="arch-box openai">☁️ OpenAI API<small>api.openai.com</small></div>
          <div class="arch-box none">🚫 개발자 서버 · 제3자<small>존재하지 않음</small></div>
        </div>
      </div>
      <h4>🔒 API 키와 개인 자료가 안전한 이유</h4>
      <ul>
        <li><b>개발자 서버가 없습니다.</b> 이 프로그램은 내 PC에서만 실행되고, 인터넷으로 나가는 요청은 <b>OpenAI(api.openai.com)로 직접</b> 가는 것뿐입니다. 예외로 자료 관리·기업 분석에 입력한 URL의 페이지를 읽어올 때만 해당 사이트에 접속합니다.</li>
        <li><b>API 키는 <code>.env</code> 파일에만</b> 저장됩니다. 파일 권한은 본인만 읽을 수 있고(600), <code>.gitignore</code>에 포함되어 GitHub에 올라가지 않습니다.</li>
        <li><b>브라우저에는 키 전체를 보내지 않습니다.</b> 화면에는 <code>sk-proj…abcd</code>처럼 일부만 보입니다.</li>
        <li><b>다른 웹사이트는 이 서버를 조작할 수 없습니다.</b> 이 PC에서 온 요청만 허용해서, 악성 사이트가 설정을 바꾸거나 키를 빼내지 못합니다.</li>
        <li><b>개인정보는 전송 전에 마스킹됩니다.</b> 주민번호, 전화번호, 이메일, 주소, 지정한 이름을 가립니다(초기 설정 3단계).</li>
        <li><b>OpenAI 쪽 보관</b>: 모든 요청을 <code>store=false</code>로 보내 응답이 저장되지 않습니다. API 데이터는 기본적으로 모델 학습에 쓰이지 않지만, 부정 사용 모니터링을 위해 최대 30일간 보관될 수 있습니다.</li>
      </ul>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>데이터</th><th>저장 위치</th><th>OpenAI로 전송</th></tr></thead>
        <tbody>
          <tr><td>API 키</td><td><code>.env</code> (내 PC)</td><td>요청마다 인증 헤더로만 (HTTPS)</td></tr>
          <tr><td>업로드한 원본 파일</td><td>저장 안 함 (텍스트만 추출)</td><td>❌</td></tr>
          <tr><td>추출 텍스트</td><td><code>data/raw</code></td><td>임베딩 시 <b>마스킹된 조각만</b></td></tr>
          <tr><td>자소서 대화·초안</td><td><code>data/app.db</code></td><td>작성 요청 시 최근 대화를 <b>마스킹 후</b></td></tr>
          <tr><td>기업 분석 결과</td><td><code>data/app.db</code></td><td>작성 요청 시 맞춤 지침으로 포함</td></tr>
          <tr><td>마스터 프로필</td><td><code>data/app.db</code>, <code>data/chroma</code></td><td>검색 등록·작성 시 <b>마스킹 후</b> (🔒 메모 칸은 ❌)</td></tr>
        </tbody></table></div>
    </div>

    <!-- 흐름 -->
    <div class="card" id="t-flow">
      <h3>🧭 추천 사용 흐름</h3>
      <div class="flow">
        <div class="flow-step"><b>1</b>⚙️ 초기 설정<small>API 키 입력</small></div>
        <div class="flow-step"><b>2</b>📚 자료 관리<small>이력서·포트폴리오 업로드</small></div>
        <div class="flow-step"><b>3</b>🗂 마스터 프로필<small>이력 정리 (선택, 추천)</small></div>
        <div class="flow-step"><b>4</b>🏢 기업 분석<small>JD·URL로 맞춤 프롬프트</small></div>
        <div class="flow-step"><b>5</b>✍️ 작성 · 🧩 기타 문항<small>자소서 문항·항목별 칸</small></div>
        <div class="flow-step"><b>6</b>💰 사용량<small>비용 확인</small></div>
      </div>
    </div>

    <!-- 페이지별 -->
    <h3 id="t-pages" style="margin-top:24px">📄 페이지별 가이드</h3>
    ${pageCard("⚙️", "초기 설정", "setup",
      "OpenAI API 키와 모델, 개인정보 마스킹, 비용 알림을 설정합니다. 저장하면 <code>.env</code>에 기록되고 서버 재시작 없이 바로 적용됩니다.",
      ["안내에 따라 OpenAI에서 API 키를 발급받아 붙여넣고 <b>키 확인 (무료)</b>를 누릅니다.",
       "모델은 ★추천값을 그대로 두어도 됩니다. 비용을 줄이려면 작성 모델을 저렴한 모델로 바꾸세요. 위 비용 비교표를 참고하세요.",
       "개인정보 마스킹을 켜두고, 추가로 가릴 단어에 본인 이름을 넣으면 더 안전합니다.",
       "월 예산 알림을 설정하고 맨 아래 <b>저장</b>을 누릅니다."],
      ["키가 유출됐다면 OpenAI의 API keys 페이지에서 즉시 <b>Revoke</b>(폐기)하고 새로 발급하세요."])}
    ${pageCard("📚", "자료 관리", "docs",
      "AI가 참고할 <b>내 경험 자료</b>를 등록합니다(RAG). 자소서를 쓸 때 여기서 관련 내용을 찾아 근거로 씁니다. 자료가 구체적일수록 초안이 좋아집니다.",
      ["분류(이력서, 자기소개서, 포트폴리오, 프로젝트, 논문 등)를 고르고 파일을 끌어다 놓습니다. PDF, DOCX, MD, TXT, HTML, ZIP을 지원합니다.",
       "노션 자료: 페이지 <code>···</code> → 내보내기 → <b>Markdown &amp; CSV</b>로 받은 ZIP을 압축을 풀지 말고 그대로 올립니다.",
       "포트폴리오 사이트는 <b>URL</b> 탭, 문서에 없는 경험(수치, 에피소드)은 <b>직접 입력</b> 탭으로 추가합니다.",
       "<b>미리보기</b>로 OpenAI에 보내지는(마스킹된) 텍스트를, <b>검색 테스트</b>로 원하는 경험이 잘 검색되는지 확인합니다."],
      ["<b>⚠ 추출 품질</b> 배지가 붙은 PDF는 글자가 깨졌거나 스캔본일 수 있습니다. 미리보기로 확인하고 필요하면 직접 입력으로 보충하세요.",
       "<b>사용</b> 스위치를 끄면 삭제하지 않고 검색에서만 뺄 수 있습니다. 지난 자소서 등 이번 지원과 무관한 자료를 잠시 끌 때 유용합니다.",
       "자료 등록 비용은 매우 적습니다(10쪽에 1원 미만)."])}
    ${pageCard("🏢", "기업 분석", "company",
      "지원 기업의 인재상, 직무 역량, 키워드를 분석하고, 그 결과로 <b>이 기업 전용 작성 지침(맞춤 프롬프트)</b>을 자동으로 만듭니다.",
      ["회사명, 지원 직무, 채용공고(JD) 전문을 붙여넣습니다.",
       "<b>참고 URL</b>에 회사 인재상 페이지나 채용공고 페이지 주소를 넣으면 서버가 본문을 직접 읽어 가장 정확해집니다.",
       "웹 검색을 켜면 최신 사업 동향도 조사합니다(1회당 약 $0.01~0.03 추가).",
       "생성된 <b>기업 맞춤 프롬프트</b>를 검토하고 필요하면 직접 고쳐 저장한 뒤, <b>이 기업으로 새 문항</b>을 누릅니다."],
      ["분석 결과의 '신뢰도 메모'에 불확실하다고 표시된 내용은 직접 확인하세요.",
       "같은 회사의 다른 직무는 새로 분석하는 것이 정확합니다."])}
    ${pageCard("✍️", "작성", "write",
      "문항별로 AI와 대화하며 자소서를 작성하고 첨삭합니다. 등록한 자료와 기업 맞춤 지침이 자동으로 반영됩니다.",
      ["<b>+ 새 문항</b>을 누르고 오른쪽에서 지원 기업, 문항, <b>최소·최대 글자수</b>(공백 포함), 작성 모델을 설정합니다. 최소를 비우면 최대의 90%가 하한입니다.",
       "<b>소재 추천</b>으로 쓸 경험을 정하고 <b>초안 작성</b>을 누릅니다.",
       "답변 끝의 <b>보완 질문</b>(<code>[확인 필요]</code>)에 답하면 실제 수치와 디테일이 채워집니다.",
       "<b>더 구체적으로</b>, <b>다른 소재로</b>, <b>첨삭·평가</b>로 다듬고, <b>초안 복사</b>로 본문만 복사합니다."],
      ["답변 아래 배지에서 <b>글자수(목표 범위 대비)</b>, <b>참고한 자료</b>, <b>이번 요청 비용</b>을 확인할 수 있습니다.",
       "글자수가 범위를 벗어나면 자동으로 한 번 보정합니다(오른쪽 체크박스로 끌 수 있음). 보정도 1회 요청이라 비용이 듭니다.",
       "내가 쓴 초안을 붙여넣고 “첨삭해줘”라고 요청해도 됩니다.",
       "대화가 길어질수록 매 요청의 입력 토큰(비용)이 늘어납니다. 방향을 바꿀 때는 <b>대화 비우기</b>나 새 문항을 쓰세요."])}
    ${pageCard("🧩", "기타 문항", "extra",
      "지원서의 <b>경력·연구실적·프로젝트 같은 항목별 칸</b>(예: 주요 내용, 직무연관성, 담당업무)을 작성합니다. 회사마다 칸이 달라도 칸 이름과 글자수만 입력하면 됩니다.",
      ["<b>대주제</b>(예: 연구실적), <b>소주제</b>(예: 논문, 선택), <b>이름</b>(예: 실제 논문명)을 입력합니다. 이름 칸을 누르면 마스터 프로필 항목이 목록으로 나오고, 고르면 대주제·소주제가 자동으로 채워지며 ✅ 연결됨으로 표시됩니다.",
       "<b>지원 기업</b>을 선택하면 기업 분석 결과가 반영됩니다. 직무연관성을 쓸 때는 꼭 선택하세요.",
       "<b>출력할 내용</b>에 지원서 칸 이름과 최소·최대 글자수를 입력합니다. 대주제에 맞는 추천 칩을 눌러 빠르게 추가할 수 있습니다.",
       "<b>✨ 작성하기</b>를 누르면 모든 항목을 한 번에, 서로 내용이 겹치지 않게 작성합니다. 칸마다 <b>복사</b>, <b>다시 쓰기</b>, 직접 고친 뒤 <b>수정 저장</b>을 할 수 있습니다."],
      ["근거 순서: ① 마스터 프로필(최우선) → ② 등록한 자료(RAG) → ③ 기업 맞춤 지침. 마스터 프로필이 없어도 자료만으로 작성할 수 있지만, 정리해 두면 훨씬 정확합니다.",
       "<b>보완 질문</b>에 나온 정보를 마스터 프로필 '상세 내용'에 추가하고 다시 작성하면 반영됩니다.",
       "비용은 항목 2개 기준 1회 약 $0.02~0.04입니다(작성 모델에 따라 다름). 작성 이력은 왼쪽 목록에 저장됩니다."])}
    ${pageCard("🗂", "마스터 프로필", "profile",
      "지원서에 반복해서 쓰는 이력을 <b>대주제(연구실적) → 소주제(논문, 선택) → 이름(실제 논문명)</b>으로 한 번만 정리해 두는 곳입니다.",
      ["<b>✨ 추출</b>을 누르면 자료 관리에 올린 이력서·논문에서 항목 초안을 한 번에 만들어 줍니다. 검토·수정한 뒤 원하는 항목만 저장하세요(이미 있는 항목은 빈 칸만 채워 병합).",
       "직접 추가하려면 <b>+ 새 항목</b>을 누르고 대주제, 소주제(추천 목록에서 선택 가능), 이름(논문명·프로젝트명·회사명 등)을 입력합니다.",
       "기간, 소속·기관, 역할, 기술·키워드, 성과·수치를 채우고, <b>상세 내용</b>에 배경 → 한 일 → 방법 → 결과 → 배운 점을 자세히 적습니다.",
       "<b>저장</b>하면 검색에 자동 등록되어 기타 문항 작성의 최우선 근거가 되고, 자소서 작성 검색에도 포함됩니다.",
       "<b>🧩 이 항목으로 기타 문항 작성</b>을 누르면 바로 작성 화면으로 이동합니다."],
      ["🔒 <b>AI에 보내지 않는 메모</b> 칸(연봉 등)은 저장만 되고 AI 요청이나 검색에 절대 포함되지 않습니다.",
       "검색 등록에는 임베딩만 쓰므로 비용이 거의 들지 않습니다(항목 20개에 약 0.3원). 자소서 작성 시 보내는 양도 늘지 않습니다.",
       "자동 추출은 자료 1개당 약 $0.02~0.05가 들며, 시작 전에 예상 비용을 보여줍니다."])}
    ${pageCard("💰", "사용량", "usage",
      "이 앱이 보낸 모든 요청의 토큰 사용량으로 계산한 <b>실시간 추정 비용</b>을 보여줍니다.",
      ["오늘, 이번 달, 누적 비용과 월 예산 사용률을 확인합니다.",
       "기능별·모델별 표에서 어디에 비용이 많이 쓰이는지 확인합니다.",
       "초기 설정에 Admin 키를 넣으면 OpenAI가 실제로 청구한 공식 금액도 함께 볼 수 있습니다."],
      ["추정치는 이 앱에서 쓴 비용만 포함합니다. 같은 API 키를 다른 곳에서도 쓴다면 OpenAI 대시보드에서 전체 금액을 확인하세요."])}

    <!-- FAQ -->
    <div class="card" id="t-faq">
      <h3>❓ 자주 묻는 질문</h3>
      <details><summary>프로그램을 업데이트하면 기존 기록이 사라지나요?</summary><p>아니요. 기록은 <code>data/</code> 폴더에 따로 저장되어 코드 업데이트(git pull)와 무관하게 유지됩니다. 불안하면 업데이트 전에 <code>cp -R data data_backup</code>으로 백업하세요.</p></details>
      <details><summary>ChatGPT Plus를 구독 중인데 API 요금이 따로 나오나요?</summary><p>네. ChatGPT 구독과 OpenAI API는 별개 상품이며, API는 사용한 만큼 별도로 청구됩니다.</p></details>
      <details><summary>비용을 줄이려면?</summary><p>① 작성 모델을 저렴한 모델로 바꾸기, ② 추론 강도를 low로, ③ 필요 없는 자료의 '사용' 끄기, ④ 긴 대화는 비우고 새로 시작하기, ⑤ 기업 분석은 웹 검색 대신 참고 URL 쓰기.</p></details>
      <details><summary>"이 키로 사용 불가" 모델이 있어요</summary><p>계정 등급이나 지역에 따라 일부 모델을 쓸 수 없습니다. 초기 설정에서 다른 모델을 고르세요.</p></details>
      <details><summary>PDF 내용이 깨져 보여요</summary><p>폰트 정보가 없는 PDF나 스캔본은 텍스트 추출이 어렵습니다. 원본을 DOCX나 텍스트 PDF로 다시 저장해 올리거나, 핵심 내용을 '직접 입력'으로 추가하세요.</p></details>
    </div>

    <div class="save-bar static">
      <span class="sub" style="margin:0">다음 단계: ${c.api_key_set ? "✅ API 키가 설정되어 있습니다. 바로 자료를 올려보세요." : "API 키를 설정해야 AI 기능을 쓸 수 있습니다."}</span>
      <button class="btn primary" id="tutorialNext">${c.api_key_set ? "📚 자료 관리로 이동 →" : "⚙️ 초기 설정 시작하기 →"}</button>
    </div>`;

  const box = $("#tutorialContent");
  box.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => switchView(b.dataset.go)));
  box.querySelectorAll(".toc a").forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    $(a.getAttribute("href")).scrollIntoView({ behavior: "smooth" });
  }));
  $("#tutorialNext").onclick = () => switchView(c.api_key_set ? "docs" : "setup");
  const ack = $("#ackCost");
  try { ack.checked = localStorage.getItem("costAck") === "1"; } catch { /* 무시 */ }
  ack.onchange = () => { try { localStorage.setItem("costAck", ack.checked ? "1" : "0"); } catch { /* 무시 */ } };
}
