/*
 * 베트남 진출 진단 엔진 (브라우저/Node 공용)
 * vietnam-entry-kit(Python)의 analyze·prompts·merge·render 로직을 그대로 옮긴 것.
 * 판단 기준 데이터는 kb.json(키트의 kb/*.yaml을 `python -m vnkit export-kb`로 내보낸 것)에서 읽는다.
 */
(function (root) {
  "use strict";

  const DELIVERABLES = {
    market_research: "시장조사",
    marketing_research: "마케팅 조사",
    entity_setup: "법인·지사 설립 지원",
    trade: "수출입(통관·관세·인증)",
  };
  const CRITICAL = [
    ["company.name", "고객사명"],
    ["company.industry", "업종"],
    ["company.products", "주력 제품·서비스"],
    ["vietnam.objective", "진출 목적"],
    ["vietnam.target_customers", "목표 고객"],
  ];
  const DECISION = [
    ["company.established_year", "설립연도 (사무소·지점 자격 판단)"],
    ["vietnam.needs_local_invoicing", "현지 직접 판매·인보이스 필요 여부"],
    ["vietnam.local_manufacturing", "현지 생산 계획"],
    ["vietnam.budget_usd_k", "초기 예산"],
    ["vietnam.timeline_months", "목표 시점"],
    ["vietnam.local_hiring_plan", "현지 채용 계획"],
  ];
  const LEVEL = { 3: "상", 2: "중", 1: "하" };
  const isNum = (v) => typeof v === "number" && !Number.isNaN(v);
  const empty = (v) => {
    if (v === null || v === undefined) return true;
    if (typeof v === "string") return !v.trim();
    if (Array.isArray(v)) return !v.some((x) => (x && typeof x === "object" ? Object.values(x).some((y) => !empty(y)) : !empty(x)));
    return false;
  };
  const get = (d, path) => path.split(".").reduce((c, k) => (c && typeof c === "object" ? c[k] : undefined), d);
  const fmt = (tpl, ctx) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in ctx ? ctx[k] : m));
  const cell = (x) => String(x ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
  const tbl = (header, rows) =>
    ["| " + header.join(" | ") + " |", "|" + "---|".repeat(header.length)]
      .concat(rows.map((r) => "| " + r.map(cell).join(" | ") + " |"))
      .join("\n");

  // ---------------------------------------------------------- 인테이크
  function normalize(data) {
    data = JSON.parse(JSON.stringify(data || {}));
    for (const k of ["project", "company", "vietnam", "sensitivity"]) data[k] = data[k] || {};
    const p = data.project, c = data.company, v = data.vietnam;
    p.report_audience = (p.report_audience || "external").trim();
    p.deliverables = (p.deliverables && p.deliverables.length ? p.deliverables : Object.keys(DELIVERABLES)).filter((d) => d in DELIVERABLES);
    c.products = (c.products || []).filter((x) => x && !empty(x.name));
    if (typeof v.target_cities === "string") v.target_cities = v.target_cities.split(",").map((s) => s.trim()).filter(Boolean);
    v.target_cities = v.target_cities && v.target_cities.length ? v.target_cities : ["호찌민", "하노이"];
    v.entry_stage = v.entry_stage || "exploring";
    v.current_presence = v.current_presence || "none";
    for (const k of Object.keys(data.sensitivity)) data.sensitivity[k] = !!data.sensitivity[k];
    return data;
  }
  const missingFields = (data) => ({
    critical: CRITICAL.filter(([p]) => empty(get(data, p))).map(([, l]) => l),
    decision: DECISION.filter(([p]) => empty(get(data, p))).map(([, l]) => l),
  });
  const productText = (data) => {
    const n = data.company.products.map((p) => p.name);
    return n.length ? n.join(", ") : data.company.industry || "주력 제품";
  };
  const hsText = (data) => {
    const codes = data.company.products.map((p) => String(p.hs_code || "").trim()).filter(Boolean);
    return codes.length ? "HS " + codes.join(", ") : `${productText(data)} 해당 HS코드(미확정 — 후보 HS코드 6단위 제시 요망)`;
  };

  // ---------------------------------------------------------- 진단
  function detectSectors(kb, data) {
    const c = data.company;
    const text = [c.industry || "", c.business_model || ""]
      .concat(c.products.map((p) => `${p.name || ""} ${p.description || ""}`))
      .join(" ")
      .toLowerCase();
    const sectors = kb.sector_profiles.sectors;
    const hits = sectors
      .map((s) => [s.keywords.filter((kw) => text.includes(kw.toLowerCase())).length, s])
      .filter(([n]) => n > 0)
      .sort((a, b) => b[0] - a[0]);
    const found = hits.slice(0, 2).map(([, s]) => s);
    if (data.sensitivity.defense_or_military && !found.some((s) => s.id === "defense_dual_use"))
      found.unshift(sectors.find((s) => s.id === "defense_dual_use"));
    return found.length ? found : [sectors.find((s) => s.id === "general")];
  }

  function effectiveFlags(data, sectors) {
    const f = Object.assign({}, data.sensitivity);
    for (const s of sectors) for (const x of s.force_flags || []) f[x] = true;
    if ((data.company.business_model || "").toUpperCase().includes("B2G")) f.government_customer = true;
    return f;
  }

  function keyIssues(data, flags) {
    const v = data.vietnam, c = data.company, dels = data.project.deliverables;
    const out = [];
    const add = (title, why, kind = "전략") => out.push({ title, why, kind });
    add("목표 시장의 실재성과 규모", `${productText(data)}에 대한 베트남 내 지불 의사 있는 수요가 진출 비용을 정당화할 만큼 존재하는지가 1차 판단 기준`);
    if (!c.products.some((p) => p.hs_code)) add("HS코드·업종코드 미확정", "관세·인증·시장접근 판단이 모두 HS/VSIC 코드에 의존 — 조기 확정 필요", "규제");
    if (dels.includes("entity_setup") || v.needs_local_invoicing)
      add("진출형태 선택 (매출 발생 구조)", "현지 판매·인보이스 필요 여부에 따라 대표사무소는 부적합하고 법인 설립이 필요할 수 있음");
    if (flags.regulated_health) add("제품 등록·공표 명의 전략", "등록 명의자를 파트너로 두면 브랜드 통제권과 파트너 교체 유연성 상실", "규제");
    if (flags.defense_or_military || flags.dual_use_or_strategic) {
      add("수출통제·조달 접근 경로", "한국 측 수출허가(방위사업청·전략물자)와 베트남 국방 조달 구조가 거래 가능 여부를 결정 — 일반 상업 진출 논리 적용 불가", "규제");
      add("정치·평판 리스크", "방산 거래는 외교·제재·여론 변수에 민감 — 단계별 공개 수위 관리 필요", "리스크");
    }
    if (flags.government_customer) add("B2G 영업 구조와 반부패 통제", "입찰·조달 과정의 중개인 활용이 형사 리스크로 전이될 수 있음", "리스크");
    if (flags.personal_data) add("개인정보·데이터 현지화", "개인정보보호법(2026 시행)·사이버보안법상 영향평가·국외이전 의무", "규제");
    if (v.local_manufacturing) add("생산 거점 입지·인센티브", "공단·경제구역별 인센티브·인력·물류 조건 비교 필요", "실행");
    if (dels.includes("marketing_research")) add("포지셔닝과 채널 우선순위", "한국 브랜드 프리미엄 활용 가능성과 중국산 대비 가격 경쟁력 판단", "전략");
    if (v.current_presence === "distributor") add("기존 유통 파트너와의 관계 정리", "직접 진출 시 독점권·재고·등록 명의 이관 조건이 협상 쟁점", "파트너");
    if (isNum(v.budget_usd_k) && v.budget_usd_k < 50 && dels.includes("entity_setup"))
      add("예산 대비 진출 형태 적정성", `초기 예산 ${v.budget_usd_k}천 달러는 법인 설립·1년 운영비에 부족할 가능성 (추정)`, "실행");
    add("투자 회수 가능성", "송금·환율·대금 회수 관행을 고려한 손익분기 시점 검증 필요", "리스크");
    return out;
  }

  // 진출형태별 가감 테이블: [distributor, rep_office, branch, fdi_llc, joint_venture, bcc]
  const IDS = ["distributor", "rep_office", "branch", "fdi_llc", "joint_venture", "bcc"];
  const T = (arr) => Object.fromEntries(IDS.map((id, i) => [id, arr[i]]));

  function scoreEntities(kb, data, flags) {
    const v = data.vietnam;
    const yr = parseInt(data.company.established_year, 10);
    const years = Number.isNaN(yr) ? null : new Date().getFullYear() - yr;
    const budget = v.budget_usd_k, months = v.timeline_months, hiring = v.local_hiring_plan, stage = v.entry_stage;
    const res = kb.entity_types.options.map((opt) => {
      const id = opt.id;
      let score = 5;
      const reasons = [], blockers = [];
      const adj = (table, why) => {
        const d = table[id];
        if (!d) return;
        score += d;
        reasons.push(`${d > 0 ? "+" : ""}${d} ${why}`);
      };
      if (v.needs_local_invoicing === true) adj(T([0, -4, 2, 3, 2, 1]), "현지 직접 판매·인보이스 필요");
      else if (v.needs_local_invoicing === false) adj(T([2, 2, -1, -1, -1, 0]), "현지 매출 발생 불요");
      if (v.local_manufacturing) adj(T([-3, -5, -3, 3, 2, 0]), "현지 생산 계획");
      if (stage === "exploring") adj(T([3, 2, -1, -1, -2, -1]), "타당성 검토 단계 — 가역적·저비용 형태 선호");
      else if (stage === "committed" || stage === "expanding") adj(T([-1, -1, 0, 2, 1, 0]), "진출 결정 단계 — 통제력 확보 선호");
      if (isNum(budget)) {
        if (budget < 50) adj(T([2, 1, -1, -2, -1, 0]), `초기 예산 ${budget}천 달러(소규모)`);
        else if (budget >= 300) adj(T([-1, 0, 0, 1, 1, 0]), `초기 예산 ${budget}천 달러(충분)`);
      }
      if (isNum(months) && months <= 3) adj(T([2, 1, -2, -1, -3, -2]), `목표 시점 ${months}개월 이내 — 단기 실행 가능성`);
      if (isNum(hiring) && hiring >= 5) adj(T([-2, 0, 1, 1, 1, -1]), `현지 채용 ${hiring}명 이상 계획`);
      if (flags.defense_or_military) adj(T([1, 1, -2, -2, 2, 1]), "방산 — 외국인 단독 진입 제한, 현지 국영·지정업체 협력 구조 일반적 (검증필요)");
      if (flags.government_customer && !flags.defense_or_military) adj(T([1, 0, 0, 0, 1, 0]), "B2G — 현지 파트너의 조달 자격·네트워크 활용");
      if (flags.regulated_health) adj(T([-1, 0, 0, 1, 0, 0]), "보건 규제 품목 — 등록 명의 자사 보유 시 통제력 확보");
      if (id === "rep_office" && years !== null && years < 1) blockers.push("설립 1년 미만 — 대표사무소 자격 미충족 (Decree 07/2016)");
      if (id === "branch" && years !== null && years < 5) blockers.push("설립 5년 미만 — 지점 자격 미충족 (Decree 07/2016)");
      if ((id === "rep_office" || id === "branch") && years === null) reasons.push("설립연도 미입력 — 자격 요건 확인 필요");
      if (id === "rep_office" && v.needs_local_invoicing) blockers.push("대표사무소는 영리활동·인보이스 발행 불가");
      return Object.assign({}, opt, { score: Math.round(score * 10) / 10, reasons, blockers });
    });
    // Python의 안정 정렬과 동일하게: 차단 여부 → 점수 내림차순 → 원래 순서
    return res
      .map((r, i) => [r, i])
      .sort((a, b) => (a[0].blockers.length > 0) - (b[0].blockers.length > 0) || b[0].score - a[0].score || a[1] - b[1])
      .map(([r]) => r);
  }

  function recommendation(scored) {
    const viable = scored.filter((r) => !r.blockers.length);
    const primary = viable[0] || scored[0];
    const alt = viable[1] || null;
    let phased = null;
    if (alt) {
      const ids = [primary.id, alt.id];
      const low = ids.some((i) => i === "distributor" || i === "rep_office");
      const high = ids.some((i) => i === "fdi_llc" || i === "joint_venture");
      if (low && high) {
        const [first, second] = ["distributor", "rep_office"].includes(primary.id) ? [primary, alt] : [alt, primary];
        phased = `1단계 ${first.name}로 시장 검증(6~12개월) → 성과 기준 충족 시 2단계 ${second.name} 전환`;
      }
    }
    return { primary, alternative: alt, phased };
  }

  function diagnose(kb, raw) {
    const data = normalize(raw);
    const sectors = detectSectors(kb, data);
    const flags = effectiveFlags(data, sectors);
    const entities = scoreEntities(kb, data, flags);
    const keys = new Set(data.project.deliverables.concat(Object.keys(flags).filter((k) => flags[k])));
    const modules = kb.research_modules.modules.filter((m) => m.when.some((w) => keys.has(w)));
    const c = data.company, v = data.vietnam;
    const context = {
      company: c.name || "고객사",
      products: productText(data),
      sector: sectors.map((s) => s.name).join("·"),
      cities: v.target_cities.join(", "),
      customers: v.target_customers || "목표 고객(미정의)",
      objective: v.objective || "베트남 시장 진출",
      hs_codes: hsText(data),
    };
    return {
      data, sectors, flags, entities, modules, context,
      missing: missingFields(data),
      issues: keyIssues(data, flags),
      recommendation: recommendation(entities),
      common_rules: kb.common_rules.rules,
    };
  }

  // ---------------------------------------------------------- 프롬프트
  const ROW_HEADER = "| 코드 | 항목 | 답변 | 구분 | 출처 | 기준일 |";
  const OUTPUT_RULES = `## 답변 규칙 (반드시 준수)
1. 아래 표 형식으로만 답하십시오. 질문 코드 1개당 1행, 코드는 그대로 유지합니다.
${ROW_HEADER}
|---|---|---|---|---|---|
2. **구분** 칸에는 다음 셋 중 하나만 씁니다.
   - \`확인된 사실\`: 공식 통계·법령·기관 발표·신뢰 가능한 보도로 출처 URL 제시 가능
   - \`추정\`: 출처 자료를 근거로 한 합리적 추정(계산 근거를 답변에 명시)
   - \`미확인\`: 신뢰 가능한 근거를 찾지 못함 — 추측으로 채우지 말 것
3. **출처** 칸에는 기관·매체명과 URL을 씁니다. URL이 없으면 \`확인된 사실\`로 분류할 수 없습니다.
4. 수치에는 단위·통화·연도를 반드시 붙이고, 환산했다면 환율·기준일을 밝힙니다.
5. 법령은 번호(예: Decree 31/2021/ND-CP)와 시행일·개정 여부를 함께 씁니다. 2025년 베트남 정부조직·행정구역 개편 이후 변경 사항을 반영하십시오.
6. 표 아래에 다음 두 소절을 추가합니다.
   - \`### 출처 간 상충\` — 자료마다 수치·해석이 다른 경우
   - \`### 추가 확인 권고\` — 현지 기관 문의·전문가 검토가 필요한 사항
7. 이 답변은 법률·세무 자문이 아닌 조사 자료입니다. 결론을 단정하지 말고 근거 수준을 명확히 하십시오.
`;

  function companyBrief(diag) {
    const d = diag.data, c = d.company, v = d.vietnam, ctx = diag.context;
    const lines = [
      `- 기업: ${ctx.company} (${c.country || "대한민국"}, 설립 ${c.established_year || "미상"}, 임직원 ${c.employees || "미상"}명)`,
      `- 업종: ${c.industry || "미상"} / 사업모델: ${c.business_model || "미상"}`,
      `- 주력 제품: ${ctx.products} (${ctx.hs_codes})`,
      `- 수출 경험: ${c.export_experience || "미상"}`,
      `- 보유 인증: ${(c.certifications || []).join(", ") || "미상"}`,
      `- 베트남 현황: ${v.current_presence} / 기존 파트너: ${v.existing_partners || "없음"}`,
      `- 목표: ${ctx.objective} / 목표 고객: ${ctx.customers} / 목표 지역: ${ctx.cities}`,
      `- 진출 단계: ${v.entry_stage} / 예산: ${v.budget_usd_k ?? "미상"}천 달러 / 목표 시점: ${v.timeline_months ?? "미상"}개월`,
    ];
    if (d.constraints) lines.push(`- 제약 조건: ${d.constraints}`);
    return lines.join("\n");
  }

  function modulePrompt(m, diag) {
    const qs = m.questions.map((q) => `- **${q.code}** ${fmt(q.q, diag.context)}`).join("\n");
    return `# [${m.id}] ${m.title} — 조사 요청

당신은 ${m.role}입니다. 한국 기업의 베트남 진출을 지원하는 컨설팅 보고서의 근거 자료를 조사합니다.
가능하면 웹 검색으로 최신 자료(2024~2026년)를 확인하고, 베트남어·영어 1차 자료를 우선하십시오.

## 고객사 개요
${companyBrief(diag)}

## 조사 질문
${qs}

${OUTPUT_RULES}`;
  }

  // ---------------------------------------------------------- 교차검증
  const CODE_RE = /^[A-Z]{3}-\d{2}$/;
  const FACT = "확인된 사실", EST = "추정", UNK = "미확인";
  const STATUS_ORDER = ["교차확인", "단일출처", "상충", "추정", "미확인"];

  function normClass(s) {
    s = s.replace(/\*/g, "").trim();
    const l = s.toLowerCase();
    if (s.includes("미확인") || l.includes("unknown")) return UNK;
    if (s.includes("추정") || l.includes("estimate")) return EST;
    if (s.includes("사실") || s.includes("확인") || l.includes("fact")) return FACT;
    return UNK;
  }

  function parseResponse(text) {
    const rows = {};
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (!line.startsWith("|")) continue;
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const code = (cells[0] || "").replace(/\*/g, "").trim();
      if (!CODE_RE.test(code)) continue;
      while (cells.length < 6) cells.push("");
      rows[code] = { item: cells[1], answer: cells[2], class: normClass(cells[3]), source: cells[4], as_of: cells[5], has_url: cells[4].includes("http") };
    }
    return rows;
  }

  function keyNumber(answer) {
    const vals = [];
    const re = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(answer))) {
      const x = parseFloat(m[1].replace(/,/g, ""));
      if (Number.isNaN(x)) continue;
      if (x >= 1990 && x <= 2100 && Number.isInteger(x)) continue;
      vals.push(x);
    }
    return vals.length ? Math.max(...vals) : null;
  }

  function judge(per) {
    const names = Object.keys(per), notes = [];
    if (!names.length) return ["미확인", ["답변 없음"]];
    const facts = names.filter((n) => per[n].class === FACT && per[n].has_url);
    const noUrl = names.filter((n) => per[n].class === FACT && !per[n].has_url);
    if (noUrl.length) notes.push(`출처 URL 없는 '사실' 주장: ${noUrl.join(", ")} → 추정으로 강등`);
    const nums = {};
    for (const n of names) if (per[n].class !== UNK) { const x = keyNumber(per[n].answer); if (x) nums[n] = x; }
    let conflict = false;
    const nv = Object.values(nums);
    if (nv.length >= 2) {
      const lo = Math.min(...nv), hi = Math.max(...nv);
      if (lo > 0 && hi / lo > 1.25) { conflict = true; notes.push("수치 상충: " + Object.entries(nums).map(([n, x]) => `${n}=${x}`).join(", ")); }
    }
    const classes = new Set(names.map((n) => per[n].class));
    if (classes.has(FACT) && classes.has(UNK)) notes.push("일부 LLM은 '미확인'으로 응답 — 사실 주장 출처 열람 확인 필요");
    if (conflict) return ["상충", notes];
    if (facts.length >= 2) return ["교차확인", notes];
    if (facts.length === 1) return ["단일출처", notes];
    if (names.every((n) => per[n].class === UNK)) return ["미확인", notes];
    return ["추정", notes];
  }

  function pickBest(per) {
    const e = Object.entries(per);
    if (!e.length) return null;
    const rank = (r) => [r.class === FACT && r.has_url, r.class === FACT, r.class === EST, r.answer.length].map(Number);
    let best = e[0];
    for (const cur of e.slice(1)) {
      const a = rank(cur[1]), b = rank(best[1]);
      for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { if (a[i] > b[i]) best = cur; break; } }
    }
    return Object.assign({ llm: best[0] }, best[1]);
  }

  /** responses: { 모듈ID: { LLM이름: 답변원문 } } */
  function merge(diag, responses) {
    const results = {}, llms = new Set();
    for (const m of diag.modules) {
      const parsed = {};
      for (const [llm, text] of Object.entries((responses || {})[m.id] || {})) {
        if (!text || !text.trim()) continue;
        parsed[llm] = parseResponse(text);
        llms.add(llm);
      }
      for (const q of m.questions) {
        const per = {};
        for (const [llm, rows] of Object.entries(parsed)) if (rows[q.code]) per[llm] = rows[q.code];
        const [status, notes] = judge(per);
        results[q.code] = { module: m.id, question: q.q, status, notes, answers: per, best: pickBest(per) };
      }
    }
    const summary = Object.fromEntries(STATUS_ORDER.map((s) => [s, Object.values(results).filter((r) => r.status === s).length]));
    return { llms: [...llms].sort(), summary, results };
  }

  // ---------------------------------------------------------- 리스크·로드맵
  function riskMatrix(diag) {
    const f = diag.flags, v = diag.data.vietnam, rec = diag.recommendation.primary.id;
    const risks = [
      { cat: "법률", lvl: f.defense_or_military ? 3 : 2, desc: "업종 시장접근 제한·인허가 범위 오해에 따른 무허가 영업 리스크", mit: "VSIC·시장접근 조건을 현지 로펌 서면 의견으로 확정", expert: "현지 투자 전문 변호사" },
      { cat: "세무", lvl: 2, desc: "외국계약자세(FCT)·이전가격·부가세 처리 오류, 신법인세법 전환기 해석 차이", mit: "거래 구조 확정 전 세무 자문, 본사-현지 간 계약서 정비", expert: "현지 세무사·한국 국제조세 전문가" },
      { cat: "규제", lvl: f.regulated_health || f.dual_use_or_strategic ? 3 : 2, desc: "제품 등록·인증·전문검사 지연으로 출시 일정 지연", mit: "등록 소요 기간을 일정에 버퍼로 반영, 명의자 전략 사전 결정", expert: "인허가 대행 전문기관" },
      { cat: "평판", lvl: f.defense_or_military ? 3 : 1, desc: "파트너 부정·SNS 이슈" + (f.defense_or_military ? "·방산 관련 국내외 여론" : f.regulated_health ? "·제품 안전 이슈 확산" : ""), mit: "파트너 실사, 위기 커뮤니케이션 프로토콜", expert: "PR 자문" },
      { cat: "정치", lvl: f.defense_or_military || f.government_customer ? 3 : 1, desc: "정책 변동·지정학·정부 조직개편에 따른 창구 변경", mit: "정부 관계자 직접 접촉 이력 관리, 대사관·KOTRA 채널 병행", expert: "대관 자문" },
      { cat: "파트너", lvl: rec === "distributor" || rec === "joint_venture" ? 3 : 2, desc: "파트너 의존·독점권 분쟁·이해충돌", mit: "KPI 연동 독점, 해지·명의 이관 조항, 단계적 권한 부여", expert: "국제계약 변호사" },
      { cat: "실행", lvl: isNum(v.timeline_months) && v.timeline_months <= 3 ? 3 : 2, desc: "서류 공증·영사확인·인력 채용 지연", mit: "선행 작업 병렬 진행, 주간 진척 관리", expert: "—" },
      { cat: "회수", lvl: 2, desc: "환율(VND) 변동, 이익 송금 요건(감사 완료·결손 없음), 대금 지급 지연 관행", mit: "결제 조건(선수금·L/C) 설계, 송금 요건 사전 점검", expert: "은행 외환 담당·회계법인" },
    ];
    if (f.defense_or_military || f.dual_use_or_strategic)
      risks.splice(1, 0, { cat: "수출통제", lvl: 3, desc: "한국 수출허가 미취득·재수출 통제·제3국 제재 저촉", mit: "전략물자 판정·수출허가 선행, EUC 확보", expert: "무역안보 전문 변호사·방위사업청 상담" });
    return risks;
  }

  function owner(kb, id, audience) {
    const m = kb.team.members.find((x) => x.id === id);
    if (!m) return audience === "external" ? kb.team.pm.external_name : kb.team.pm.name;
    return audience === "external" ? m.external_name : `${m.name}(${m.role})`;
  }

  function roadmapRows(kb, diag, audience) {
    const st = kb.setup_steps, rec = diag.recommendation;
    let path = [rec.primary.id];
    if (rec.phased) path = [rec.primary.id, rec.alternative.id].sort((a, b) => (["distributor", "rep_office"].includes(a) ? 0 : 1) - (["distributor", "rep_office"].includes(b) ? 0 : 1));
    let seq = [];
    if (diag.flags.defense_or_military || diag.flags.dual_use_or_strategic) seq = seq.concat(st.defense_extra.map((s) => ["수출통제 선행", s]));
    if (path.some((p) => p !== "distributor")) seq = seq.concat(st.common_pre.map((s) => ["공통 준비", s]));
    for (const pid of path) {
      const name = kb.entity_types.options.find((o) => o.id === pid).name;
      seq = seq.concat(st.steps[pid].map((s) => [name, s]));
    }
    const phases = [...new Set(seq.map(([p]) => p))];
    let week = 0;
    return seq.map(([ph, s]) => {
      const span = s.weeks === 1 ? `W${week + 1}` : `W${week + 1}–W${week + s.weeks}`;
      week += Math.max(1, Math.floor(s.weeks / 2));
      return [`${phases.indexOf(ph) + 1}. ${ph}`, s.step, owner(kb, s.owner, audience), span];
    });
  }

  // ---------------------------------------------------------- 보고서
  function report(kb, diag, merged, opts) {
    opts = opts || {};
    const ext = (opts.audience || "external") === "external";
    const author = opts.author || "강동조 · 베트남 진출 컨설팅";
    const d = diag.data, ctx = diag.context, rec = diag.recommendation, p = rec.primary;
    const today = new Date().toLocaleDateString("sv-SE");
    const dels = d.project.deliverables.map((x) => DELIVERABLES[x]).join(", ");
    const risks = riskMatrix(diag);
    const hasMerge = merged && merged.llms && merged.llms.length;

    const situation = [
      `${ctx.company}은(는) ${d.company.industry || "해당 업종"} 분야 기업으로, 주력 제품은 ${ctx.products}입니다. 베트남 진출 목적은 '${ctx.objective}'이며, 목표 고객은 ${ctx.customers}, 우선 검토 지역은 ${ctx.cities}입니다.`,
      "",
      `- 판별 업종: ${ctx.sector}`,
      `- 현재 베트남 내 거점: ${d.vietnam.current_presence} / 진출 단계: ${d.vietnam.entry_stage}`,
      `- 의뢰 범위: ${dels}`,
    ].join("\n");

    const issues = tbl(["No", "구분", "핵심 쟁점", "판단 근거"], diag.issues.map((x, i) => [i + 1, x.kind, x.title, x.why]));

    let findings = "> 조사 결과 미반영 상태입니다. 3단계 프롬프트를 여러 AI에 실행하고 4단계에서 답변을 붙여넣으면 이 섹션이 자동으로 채워집니다.";
    if (hasMerge) {
      findings = diag.modules.map((m) => {
        const rows = m.questions.map((q) => {
          const r = merged.results[q.code], b = r && r.best;
          return [q.code, b && b.item ? b.item : q.q.slice(0, 40), b ? b.answer : "조사 결과 없음", r ? r.status : "미확인", b ? b.source : "—"];
        });
        return `### ${m.title}\n\n` + tbl(["코드", "항목", "주요 내용", "검증 판정", "출처"], rows);
      }).join("\n\n");
    }

    const regRows = [];
    for (const s of diag.sectors) for (const r of s.key_rules) regRows.push([s.name, r.text, r.status]);
    for (const r of diag.common_rules) regRows.push([r.area, r.text, r.status]);

    const options = tbl(["옵션", "적합도 점수", "장점", "단점", "주요 리스크", "실행 난이도", "제약 사항"],
      diag.entities.slice(0, 4).map((r) => [r.name, r.score, r.pros.slice(0, 2).join(" / "), r.cons.slice(0, 2).join(" / "), r.risks.slice(0, 1).join(" / "), "★".repeat(r.difficulty), r.blockers.join("; ") || "—"]));

    const recBlock = [
      `**추천안: ${p.name}** — 적합도 ${p.score}점`, "", "판단 근거:",
      ...(p.reasons.length ? p.reasons.map((r) => `- ${r}`) : ["- (판단 근거 입력 부족)"]),
      ...(rec.alternative ? ["", `**대안: ${rec.alternative.name}** — 적합도 ${rec.alternative.score}점`] : []),
      ...(rec.phased ? ["", `**단계적 경로(${ext ? "권고합니다" : "추천"}):** ${rec.phased}`] : []),
      "", `- 법적 근거: ${p.legal_basis}`, `- 관할: ${p.licensing}`,
      `- 소요 기간: 법정 ${p.timeline_statutory} / 실무 ${p.timeline_practical}`, `- 자본금: ${p.capital}`,
      "", "> 적합도 점수는 입력 정보 기반 규칙 점수이며, 최종 결정 전 현지 법률 검토가 필요합니다.",
    ].join("\n");

    const facts = [], ests = [], unks = [];
    if (hasMerge) for (const [code, r] of Object.entries(merged.results)) {
      const b = r.best, t = b ? `${code} ${b.answer.slice(0, 90)}` : `${code} ${r.question.slice(0, 60)}`;
      if (r.status === "교차확인") ests.push(t + " (AI 답변 일치 · 원문 미검증)");
      else if (r.status === "단일출처" || r.status === "추정") ests.push(t + (r.status === "단일출처" ? " (단일출처)" : ""));
      else unks.push(`${t} [${r.status}]`);
    }
    for (const s of diag.sectors) for (const r of s.key_rules) (r.status === "확인" ? facts : unks).push(r.text.slice(0, 90) + " (법령 근거)");
    const n = Math.max(facts.length, ests.length, unks.length, 1);
    const pad = (xs) => xs.concat(Array(n - xs.length).fill(""));
    const F = pad(facts), E = pad(ests), U = pad(unks);
    const split = tbl(["판단 기준상 확인 표기 · 현행성 재확인 필요", "추정·AI 비교 결과 · 원문 미검증", "미확인·검증 필요"], F.map((x, i) => [x, E[i], U[i]]));

    let conflicts = "- (교차검증 전)";
    if (hasMerge) {
      const rows = Object.entries(merged.results).filter(([, r]) => r.status === "상충").map(([c, r]) => [c, r.notes.join("; ")]);
      conflicts = rows.length ? tbl(["코드", "상충 내용"], rows) : "- 자동 탐지된 출처 간 상충 없음 (원문 대조 권장)";
    }

    let acts = [
      ["HS코드·VSIC 업종코드 확정 및 시장접근 조건 서면 확인", "을", "B"],
      p.id !== "distributor" ? [`${p.name} 추진을 위한 본사 서류 공증·영사확인 착수`, "를", "B"] : ["현지 유통사 후보 롱리스트 작성 및 실사 착수", "를", "C"],
      ["목표 고객 10곳 대상 수요 검증 인터뷰(가격 수용도·구매 조건)", "를", "C"],
    ];
    if (diag.flags.defense_or_military || diag.flags.dual_use_or_strategic) acts = [["전략물자 사전판정 및 방위사업청 수출허가 사전 상담", "을", "B"]].concat(acts).slice(0, 3);
    const actText = acts.map(([a, j, o], i) => (ext ? `${i + 1}. ${a}${j} 권고합니다.` : `${i + 1}. ${a} — 담당: ${owner(kb, o, "internal")}`)).join("\n");

    let verify = diag.missing.critical.concat(diag.missing.decision).map((x) => `- ${x} (미입력)`);
    for (const s of diag.sectors) verify = verify.concat(s.key_rules.filter((r) => r.status !== "확인").map((r) => `- ${r.text}`));
    verify = verify.concat(diag.common_rules.filter((r) => r.status !== "확인").map((r) => `- ${r.text}`).slice(0, 5));
    if (hasMerge) verify = verify.concat(Object.entries(merged.results).filter(([, r]) => ["상충", "미확인"].includes(r.status)).map(([c, r]) => `- ${c}: ${r.question.slice(0, 60)} [${r.status}]`));

    const outs = ["- 고객사 제출용 시장조사 보고서(Word 서식)", "- 경영진 보고용 발표 슬라이드(10~15장 구조안)"];
    if (d.project.deliverables.includes("entity_setup")) outs.push("- 설립 서류 체크리스트 및 신청서 초안 패키지");
    outs.push("- 현지 파트너 후보 롱리스트·실사표", "- 6개월 마케팅 실행계획 및 KPI 대시보드");

    const topRisks = risks.slice().sort((a, b) => b.lvl - a.lvl).slice(0, 3).map((r) => r.cat).join(", ");
    return `# ${ctx.company} 베트남 진출 전략 보고서${ext ? "" : " (내부 검토본)"}

작성: ${author} · 작성일: ${today} · 범위: ${dels}

판단 기준 데이터: ${kb.entity_types.last_reviewed} · 검토 상태: 전문가 검토 전 초안

> ${hasMerge ? "본 보고서는 입력 정보 기반 진단에 AI 답변 비교 결과를 반영한 초안입니다. AI 답변의 일치는 사실 확인을 의미하지 않으며 원문 출처 대조가 필요합니다." : "본 보고서는 입력 정보와 사전 정의된 판단 기준으로 작성한 초기 진단 초안입니다. 외부 조사 결과는 아직 반영되지 않았습니다."} 법률·세무 자문을 대체하지 않습니다.
> 각 수치와 규정은 '확인된 사실 / 합리적 추정 / 미확인·검증 필요'로 구분 표기했습니다.

## 1. 요약
- 추천 진출형태: **${p.name}**${rec.phased ? " — " + rec.phased : ""}
- 핵심 쟁점: ${diag.issues.slice(0, 4).map((i) => i.title).join(", ")}
- 최우선 리스크: ${topRisks}

## 2. 상황 정리
${situation}

## 3. 핵심 쟁점
${issues}

## 4. 시장·마케팅 조사 결과
${findings}

## 5. 규제 환경
${tbl(["영역", "주요 내용", "검증 상태"], regRows)}

## 6. 전략 옵션 비교
${options}

## 7. 추천안
${recBlock}

## 8. 리스크 및 전문가 검토 필요 지점
${tbl(["리스크", "수준", "내용", "대응 방안", "전문가 검토"], risks.map((r) => [r.cat, LEVEL[r.lvl], r.desc, r.mit, r.expert]))}

## 9. 실행 로드맵
${tbl(["단계", "업무", ext ? "수행 조직" : "담당", "예상 주차(추정)"], roadmapRows(kb, diag, ext ? "external" : "internal"))}

> 주차는 실무 경험 기반 추정이며, 일부 단계는 병렬 진행을 가정했습니다.

## 10. 근거 수준 구분
${split}

### 출처 간 상충
${conflicts}

## 11. ${ext ? "즉시 실행 권고사항" : "지금 바로 할 수 있는 일 3가지"}
${actText}

## 12. ${ext ? "추가 확인이 필요한 사항" : "추가 검증 필요 쟁점"}
${verify.slice(0, 20).join("\n") || "- 없음"}

## 13. ${ext ? "다음 단계 제안" : "다음 단계에서 만들 수 있는 실무 산출물"}
${ext ? "후속 단계로 다음 산출물을 제공해 드릴 것을 제안드립니다.\n\n" : ""}${outs.join("\n")}
`;
  }

  const api = { normalize, diagnose, modulePrompt, parseResponse, merge, riskMatrix, roadmapRows, report, DELIVERABLES, STATUS_ORDER, LEVEL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VNEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
