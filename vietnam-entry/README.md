# 베트남 진출 진단 (웹 앱)

강동조 이력서 페이지에 연결된 고객용 셀프 진단 도구입니다. 회사 정보를 입력하면 진출형태 비교, 핵심 쟁점, 리스크, 실행 로드맵,
AI 조사 프롬프트, 여러 AI 답변 교차검증, 보고서 초안(고객 제출본/내부 검토본)을 생성합니다.

- 모든 처리는 브라우저 안에서 이루어지며 입력 정보는 서버로 전송되지 않습니다. (임시 저장은 해당 브라우저 localStorage만 사용)
- `engine.js` — 진단 엔진. `Korea-Defense-Industry-Council-in-Vietnam/vietnam-entry-kit`(Python)과 동일한 로직이며 결과 일치를 검증했습니다.
- `kb.json` — 판단 기준 데이터. 원본은 키트의 `kb/*.yaml`입니다. 법령을 갱신한 뒤 아래 명령으로 다시 내보내십시오.

```bash
cd vietnam-entry-kit
python -m vnkit export-kb ../../dongjo_kang_resume/vietnam-entry/kb.json
```
