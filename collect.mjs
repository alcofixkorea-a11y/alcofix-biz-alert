// ALCOFIX 지원사업 레이더 — 공고 수집기
//
// K-Startup(창업진흥원)과 기업마당(중소벤처기업부)에서 지원사업 공고를 수집하고
// 알코픽스 조건에 맞게 필터링하여 data/programs.json 을 생성한다.
//
// 필터 기준:
//   - 모집기간: 오늘 기준 접수 중이거나 접수 예정인 공고만 (마감 공고 자동 제외)
//   - 지역: 전국(중앙부처) 또는 세종
//   - 분야: 식품·바이오 관련 공고는 태그로 표시 (일반 창업지원 공고도 포함)
//   - 자격: 업력 1년 미만(2025.8 창업), 청년 대표(1997년생) 요건 충족 여부 태그
//
// 실행: KSTARTUP_KEY=... BIZINFO_KEY=... node collect.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(ROOT, "data", "programs.json");

const KSTARTUP_KEY = process.env.KSTARTUP_KEY || "";
const BIZINFO_KEY = process.env.BIZINFO_KEY || "";

// ---------- 날짜 유틸 (KST 기준) ----------
const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
const TODAY = kstNow.toISOString().slice(0, 10); // "2026-07-20"

function toIso(d8) {
  if (!d8) return null;
  const m = String(d8).match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function isoDaysAgo(n) {
  return new Date(kstNow.getTime() - n * 86400000).toISOString().slice(0, 10);
}

// ---------- 알코픽스 맞춤 기준 ----------
const FOOD_BIO_KEYWORDS = [
  "식품", "푸드", "외식", "음료", "주류", "양조", "발효", "숙취",
  "건강기능", "기능성식품", "건기식", "바이오", "제약", "의약", "헬스케어",
  "농식품", "농산물", "식음료", "F&B", "f&b", "푸드테크", "HACCP", "해썹",
  "케어푸드", "고령친화식품", "그린바이오", "레드바이오", "화이트바이오",
];
// 세종 외 지역명 (지역 제한 공고 판별용)
// 공고 제목에 타 지역명이 들어간 공고는 사실상 해당 지역 전용이므로 제외한다.
const OTHER_SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "경기", "강원",
  "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  "충청북도", "충청남도", "전라북도", "전라남도", "경상북도", "경상남도",
  "경기도", "강원특별자치도", "전북특별자치도", "제주특별자치도",
];
const OTHER_REGION_TOKENS = [
  ...OTHER_SIDO,
  // 권역명
  "수도권", "강원권", "충청권", "호남권", "영남권", "동남권", "대경권", "부울경",
  // 주요 시·군명
  "수원", "성남", "용인", "고양", "부천", "안산", "안양", "화성", "평택", "시흥",
  "김포", "광명", "군포", "하남", "오산", "이천", "안성", "의왕", "파주", "양주",
  "구리", "남양주", "의정부", "동두천", "과천", "판교",
  "춘천", "원주", "강릉", "속초", "동해", "삼척", "태백",
  "청주", "충주", "제천", "옥천", "음성", "진천",
  "천안", "아산", "서산", "당진", "공주", "보령", "논산", "계룡", "홍성", "예산",
  "전주", "군산", "익산", "정읍", "남원", "김제", "완주",
  "목포", "여수", "순천", "나주", "광양", "무안",
  "포항", "경주", "김천", "안동", "구미", "영주", "영천", "상주", "문경", "경산",
  "창원", "진주", "통영", "사천", "김해", "밀양", "거제", "양산",
  // 서울 주요 구·지구명
  "서초", "강남", "마포", "성수", "구로", "금천", "송파", "영등포", "종로",
  "용산", "성동", "상암", "여의도", "홍릉",
  // 영문 표기
  "Seoul", "Busan", "Daegu", "Incheon", "Gwangju", "Daejeon", "Ulsan", "Jeju", "Gangwon",
];

// 시도명 (기업마당 해시태그의 지역 나열 판별용 — 전국 공고는 17개 시도를 전부 나열함)
const SIDO_TOKENS = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "경기", "강원",
  "충북", "충남", "전북", "전남", "경북", "경남", "제주", "세종",
];
function countSido(text) {
  return SIDO_TOKENS.filter((s) => text.includes(s)).length;
}

// 제목 기준 지역 판별: 세종/전국이 명시돼 있으면 통과, 타 지역명이 있으면 지역 전용으로 간주
function titleRegion(title) {
  const t = (title || "").replace(/비수도권/g, ""); // "비수도권"은 세종 포함이므로 수도권 매칭에서 제외
  if (t.includes("세종")) return "sejong";
  if (OTHER_REGION_TOKENS.some((r) => t.includes(r))) return "other";
  return "neutral";
}

function hasFoodBio(text) {
  if (!text) return false;
  return FOOD_BIO_KEYWORDS.some((k) => text.includes(k));
}
function decodeEntities(s) {
  return (s || "")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function stripHtml(s) {
  return decodeEntities((s || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// 업력 요건: 알코픽스는 2025.8 창업 → 업력 1년 미만
function checkEnyy(s) {
  if (!s) return null;
  if (/(1|2|3|5|7|10)년미만/.test(s.replace(/\s/g, ""))) return true;
  return false; // "예비창업자"만 대상인 공고 등
}
// 연령 요건: 대표 1997년생 → 만 20~39세 구간
function checkAge(s) {
  if (!s) return null;
  return s.includes("만 20세 이상") || s.replace(/\s/g, "").includes("만39세이하");
}

// ---------- K-Startup 수집 ----------
async function fetchKstartup() {
  if (!KSTARTUP_KEY) return { items: [], error: "no-key" };
  const perPage = 100;
  const maxPages = 35;
  const cutoff = isoDaysAgo(150); // 접수 시작일이 5개월 이전인 페이지까지 내려가면 중단
  const raw = [];
  for (let page = 1; page <= maxPages; page++) {
    const url =
      `https://nidapi.k-startup.go.kr/api/kisedKstartupService/v1/getAnnouncementInformation` +
      `?serviceKey=${KSTARTUP_KEY}&page=${page}&perPage=${perPage}&returnType=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`K-Startup API HTTP ${res.status}`);
    const j = await res.json();
    const data = j.data || [];
    raw.push(...data);
    if (data.length < perPage) break;
    const oldest = data
      .map((x) => toIso(x.pbanc_rcpt_bgng_dt))
      .filter(Boolean)
      .sort()[0];
    if (oldest && oldest < cutoff) break;
  }

  const items = [];
  for (const x of raw) {
    const start = toIso(x.pbanc_rcpt_bgng_dt);
    const end = toIso(x.pbanc_rcpt_end_dt);
    // 모집기간 철저 확인: 마감됐거나 조기종료된 공고는 제외
    if (end && end < TODAY) continue;
    const upcoming = start && start > TODAY;
    if (x.rcrt_prgs_yn !== "Y" && !upcoming) continue;
    // 지역: 전국 또는 세종 포함만
    const region = x.supt_regin || "";
    if (region && !region.includes("전국") && !region.includes("세종")) continue;
    // 지역 필드가 전국이어도 제목에 타 지역명이 있으면 사실상 지역 전용 공고 → 제외
    const title = decodeEntities(x.biz_pbanc_nm || "").trim();
    const tRegion = titleRegion(title);
    if (tRegion === "other") continue;
    // 지역 필드에 세종만 콕 집어 있을 때만 세종 공고로 취급 (여러 시도 나열은 전국성 공고)
    const isSejong =
      tRegion === "sejong" ||
      (region.includes("세종") && !region.includes("전국") && countSido(region) <= 3);

    const textAll = [x.biz_pbanc_nm, x.pbanc_ctnt, x.supt_biz_clsfc].join(" ");
    items.push({
      id: `kstartup-${x.pbanc_sn}`,
      source: "kstartup",
      title,
      org: x.pbanc_ntrp_nm || "",
      category: x.supt_biz_clsfc || "",
      region: isSejong ? "세종" : "전국",
      target: x.aply_trgt || "",
      applyStart: start,
      applyEnd: end,
      alwaysOpen: !end,
      status: upcoming ? "upcoming" : "open",
      url:
        x.detl_pg_url ||
        `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${x.pbanc_sn}`,
      summary: stripHtml(x.pbanc_ctnt).slice(0, 300),
      foodBio: hasFoodBio(textAll),
      youngOk: checkAge(x.biz_trgt_age),
      enyyOk: checkEnyy(x.biz_enyy),
      privateHost: x.sprv_inst === "민간",
    });
  }
  return { items };
}

// ---------- 기업마당 수집 ----------
async function fetchBizinfo() {
  if (!BIZINFO_KEY) return { items: [], error: "no-key" };
  const url =
    `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do` +
    `?crtfcKey=${BIZINFO_KEY}&dataType=json&searchCnt=800`;
  const res = await fetch(url);
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { items: [], error: `응답 파싱 실패: ${text.slice(0, 120)}` };
  }
  if (j && j.reqErr) return { items: [], error: j.reqErr };
  const arr = Array.isArray(j) ? j : j.jsonArray || j.item || [];

  const items = [];
  for (const x of arr) {
    const title = decodeEntities(x.pblancNm || x.pblancnm || "").trim();
    if (!title) continue;
    // 모집기간 파싱: "2026-07-15 ~ 2026-07-28", "20260701 ~ 20260731", "예산 소진시" 등
    const period = String(x.reqstBeginEndDe || "");
    const m = period.match(/(\d{4})-?(\d{2})-?(\d{2})\s*~\s*(\d{4})-?(\d{2})-?(\d{2})/);
    const start = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    const end = m ? `${m[4]}-${m[5]}-${m[6]}` : null;
    if (end && end < TODAY) continue; // 마감 공고 제외
    const upcoming = start && start > TODAY;

    // 지역 판별. 기업마당 해시태그는 지원 가능 지역을 나열한다:
    //   - 17개 시도 전부(또는 다수) 나열 = 전국 공고
    //   - 세종 없이 일부 시도만 나열 = 타 지역 전용 → 제외
    //   - 세종만(또는 소수와 함께) 나열 = 세종 대상 공고
    const tags = String(x.hashtags || "");
    const sidoCount = countSido(tags);
    const hasSejongTag = tags.includes("세종");
    if (sidoCount > 0 && !hasSejongTag && !tags.includes("전국")) continue;
    // 제목에 타 지역명이 있으면 지역 전용 공고로 간주하고 제외
    const tRegion = titleRegion(title);
    if (tRegion === "other") continue;
    const isSejong = tRegion === "sejong" || (hasSejongTag && sidoCount <= 3);

    const urlPath = x.pblancUrl || x.pblancurl || "";
    const textAll = [title, x.bsnsSumryCn, x.pldirSportRealmLclasCodeNm, tags].join(" ");
    items.push({
      id: `bizinfo-${x.pblancId || x.pblancSn || title.replace(/\s/g, "").slice(0, 40)}`,
      source: "bizinfo",
      title,
      org: [x.jrsdInsttNm, x.excInsttNm].filter(Boolean).join(" · "),
      category: x.pldirSportRealmLclasCodeNm || "",
      region: isSejong ? "세종" : "전국",
      target: x.trgetNm || "",
      applyStart: start,
      applyEnd: end,
      alwaysOpen: !end,
      status: upcoming ? "upcoming" : "open",
      url: urlPath.startsWith("http") ? urlPath : `https://www.bizinfo.go.kr${urlPath}`,
      summary: stripHtml(x.bsnsSumryCn).slice(0, 300),
      foodBio: hasFoodBio(textAll),
      youngOk: null,
      enyyOk: null,
      privateHost: false,
    });
  }
  return { items };
}

// ---------- 병합·중복 제거·정렬 ----------
function dedupeKey(title) {
  return title.replace(/[\s\[\]()「」『』<>【】·.,\-~]/g, "").toLowerCase();
}

async function main() {
  // 이전 수집분의 최초 확인일(firstSeen) 보존 → NEW 뱃지 판별용
  const prevSeen = new Map();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      for (const it of prev.items || []) prevSeen.set(it.id, it.firstSeen);
    } catch { /* 손상된 파일은 무시하고 새로 생성 */ }
  }

  const [kst, biz] = await Promise.all([
    fetchKstartup().catch((e) => ({ items: [], error: String(e.message || e) })),
    fetchBizinfo().catch((e) => ({ items: [], error: String(e.message || e) })),
  ]);

  const merged = new Map();
  for (const it of [...kst.items, ...biz.items]) {
    it.firstSeen = prevSeen.get(it.id) || TODAY;
    const key = dedupeKey(it.title);
    const exist = merged.get(key);
    if (!exist) {
      merged.set(key, { ...it, sources: [it.source] });
    } else {
      // 동일 공고가 양쪽에 있으면 자격정보가 풍부한 K-Startup 항목 우선
      exist.sources = [...new Set([...exist.sources, it.source])];
      if (exist.source === "bizinfo" && it.source === "kstartup") {
        merged.set(key, { ...it, sources: exist.sources, firstSeen: exist.firstSeen < it.firstSeen ? exist.firstSeen : it.firstSeen });
      }
    }
  }

  const items = [...merged.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    // 세종 공고 최우선 표시
    const aSejong = a.region === "세종" ? 0 : 1;
    const bSejong = b.region === "세종" ? 0 : 1;
    if (aSejong !== bSejong) return aSejong - bSejong;
    const ae = a.alwaysOpen ? "9999-12-31" : a.applyEnd || "9999-12-31";
    const be = b.alwaysOpen ? "9999-12-31" : b.applyEnd || "9999-12-31";
    if (ae !== be) return ae < be ? -1 : 1;
    return (a.applyStart || "") < (b.applyStart || "") ? 1 : -1;
  });

  const out = {
    generatedAt: kstNow.toISOString().replace("Z", "+09:00"),
    today: TODAY,
    sources: {
      kstartup: kst.error ? { error: kst.error } : { count: kst.items.length },
      bizinfo: biz.error ? { error: biz.error } : { count: biz.items.length },
    },
    items,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");

  // 오늘 처음 발견된 공고 요약 (이메일·이슈 알림용). 신규가 없으면 빈 파일
  const newItems = items.filter((i) => i.firstSeen === TODAY);
  let md = "";
  if (newItems.length) {
    md += `## 📬 ${TODAY} 신규 지원사업 공고 ${newItems.length}건\n\n`;
    const line = (it) =>
      `- ${it.region === "세종" ? "📍**[세종]** " : ""}[${it.title}](${it.url})` +
      ` — ${it.org}${it.applyEnd ? ` (마감 ${it.applyEnd})` : " (상시)"}` +
      (it.foodBio ? " `식품·바이오`" : "");
    const foodBio = newItems.filter((i) => i.foodBio || i.region === "세종");
    const rest = newItems.filter((i) => !i.foodBio && i.region !== "세종");
    if (foodBio.length) {
      md += `### ⭐ 세종·식품바이오 관련 (${foodBio.length}건)\n`;
      md += foodBio.map(line).join("\n") + "\n\n";
    }
    if (rest.length) {
      md += `### 일반 (${rest.length}건)\n`;
      md += rest.slice(0, 30).map(line).join("\n") + "\n";
      if (rest.length > 30) md += `\n…외 ${rest.length - 30}건\n`;
    }
    md += `\n👉 전체 공고 보기: https://alcofixkorea-a11y.github.io/alcofix-biz-alert/\n`;
  }
  writeFileSync(join(dirname(OUT_PATH), "new_today.md"), md, "utf8");

  console.log(`[${TODAY}] 수집 완료 — 총 ${items.length}건`);
  console.log(`  K-Startup: ${kst.error ? "오류/" + kst.error : kst.items.length + "건"}`);
  console.log(`  기업마당 : ${biz.error ? "오류/" + biz.error : biz.items.length + "건"}`);

  // 두 소스 모두 실패하면 Actions 에서 실패로 표시되도록 종료코드 1
  if (kst.error && biz.error && kst.error !== "no-key") process.exit(1);
}

main();
