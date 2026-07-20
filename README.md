# 📢 ALCOFIX 지원사업 알리미

**사이트**: https://alcofixkorea-a11y.github.io/alcofix-biz-alert/

세종시·중앙부처의 식품·바이오 분야 지원사업 공고를 매일 자동 수집하여 보여주는 알코픽스 내부용 통합 알리미 사이트입니다.

## 동작 방식

1. **매일 아침 7시(KST)** GitHub Actions가 `collect.mjs`를 실행
2. K-Startup(창업지원포털)과 기업마당 API에서 공고 수집
3. 알코픽스 조건으로 필터링:
   - 모집기간이 유효한 공고만 (마감 공고 자동 제외)
   - 지역: 전국(중앙부처) 또는 세종
   - 자격 태그: 업력 1년 미만(2025.8 창업), 청년 대표(1997년생)
   - 식품·바이오 관련 공고는 별도 태그 표시
4. 결과를 `data/programs.json`에 저장 → GitHub Pages 사이트에 자동 반영

## 설정 (최초 1회)

1. GitHub 저장소 → Settings → Secrets and variables → Actions에서 등록:
   - `KSTARTUP_KEY`: 공공데이터포털 인증키
   - `BIZINFO_KEY`: 기업마당에서 발급받은 인증키 ([발급 페이지](https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi))
2. Settings → Pages → Source를 `main` 브랜치 `/ (root)`로 설정

## 수동 실행

Actions 탭 → "공고 자동 수집" → Run workflow

로컬 실행:

```
KSTARTUP_KEY=발급키 BIZINFO_KEY=발급키 node collect.mjs
```

## 데이터 출처

- [K-Startup 창업지원포털](https://www.k-startup.go.kr) — 창업진흥원
- [기업마당](https://www.bizinfo.go.kr) — 중소벤처기업부

> ⚠️ 지원 자격, 수행기간 등 세부 요건은 반드시 공고 원문에서 최종 확인하세요.
