"""抓 AI 產業／AI 概念股新聞，挑 10 則並用 Claude 寫重點摘要，寫入 data/news.json。

有設定 ANTHROPIC_API_KEY 才會產生 AI 摘要；沒設定時改用新聞原文的前幾句當摘要。
模型可用 GitHub 的 Repository variable「CLAUDE_MODEL」覆寫。
"""
import hashlib
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from common import log_error, write_status, TW, load_json, now_iso, now_tw, save_json, session

TOP_N = 10
MAX_CANDIDATES = 30
MAX_AGE = timedelta(hours=48)
MODEL = os.environ.get("CLAUDE_MODEL", "").strip() or "claude-opus-5-5"
# 這幾個模型支援「被拒答時自動改用其他模型」的 fallbacks 參數
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

AI_PATTERN = re.compile(
    r"AI|人工智慧|生成式|輝達|NVIDIA|Nvidia|黃仁勳|GPU|伺服器|CoWoS|HBM|ASIC|算力|資料中心|"
    r"OpenAI|ChatGPT|大模型|機器人|AMD|超微|博通|先進封裝|液冷|散熱",
)

# 只要台股相關：新聞要提到台股、台廠或台灣個股
TW_PATTERN = re.compile(
    r"台股|台廠|台鏈|台積電|台灣|臺灣|加權指數|櫃買|上櫃|上市櫃|集中市場|漲停|跌停|焦點股|概念股|族群|"
    r"[（(]\d{4}[)）]|\d{4}-TW|鴻海|廣達|緯創|緯穎|英業達|技嘉|華碩|聯發科|日月光|台達電|奇鋐|雙鴻|健策|"
    r"川湖|勤誠|金像電|台光電|欣興|南電|景碩|創意|世芯|智原|聯亞|穩懋|聯電|南亞科|華邦電|旺宏|京元電|信驊|"
    r"貿聯|光寶|仁寶|和碩|神達|營邦|嘉澤|致茂|弘塑|辛耘|萬潤|均華|家登|帆宣|漢唐|亞翔|研華|宏達電|鴻準",
)
# 標題主角是國外市場的新聞，除非標題本身也提到台股／台廠，否則排除
FOREIGN_TITLE = re.compile(r"美股|華爾街|道瓊|那斯達克|納斯達克|標普|費半|美國|歐洲|日股|韓股|陸股|港股|中國|大陸")

GOOGLE_QUERIES = ["台股 AI概念股 when:2d", "台股 AI伺服器 OR CoWoS OR 台廠 when:2d"]
CNYES_CATEGORIES = ["tw_stock", "tech"]
YAHOO_FEEDS = ["https://tw.stock.yahoo.com/rss?category=tw-market",
               "https://tw.stock.yahoo.com/rss?category=news"]


def clean(text):
    # 有些來源把 HTML 標籤跳脫過（&lt;p&gt;），先還原再去掉標籤
    text = html.unescape(re.sub(r"<[^>]+>", " ", html.unescape(text or "")))
    return re.sub(r"\s+", " ", text).strip()


def parse_rss_date(s):
    try:
        return parsedate_to_datetime(s).astimezone(TW)
    except (TypeError, ValueError):
        return None


def from_google():
    items = []
    for q in GOOGLE_QUERIES:
        r = session.get("https://news.google.com/rss/search", timeout=30,
                        params={"q": q, "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"})
        r.raise_for_status()
        for it in ET.fromstring(r.content).iter("item"):
            title = clean(it.findtext("title"))
            source = clean(it.findtext("source")) or "Google 新聞"
            if title.endswith(" - " + source):
                title = title[: -len(source) - 3]
            items.append({
                "title": title, "url": it.findtext("link", ""), "source": source,
                "published": parse_rss_date(it.findtext("pubDate")), "snippet": "",
            })
    return items


def from_cnyes():
    items = []
    for cat in CNYES_CATEGORIES:
        r = session.get(f"https://api.cnyes.com/media/api/v1/newslist/category/{cat}",
                        params={"limit": 30}, timeout=30)
        r.raise_for_status()
        for n in r.json().get("items", {}).get("data", []):
            items.append({
                "title": clean(n.get("title")),
                "url": f"https://news.cnyes.com/news/id/{n.get('newsId')}",
                "source": "鉅亨網",
                "published": datetime.fromtimestamp(n.get("publishAt", 0), tz=timezone.utc).astimezone(TW),
                "snippet": clean(n.get("summary") or n.get("content"))[:400],
            })
    return items


def from_yahoo():
    items = []
    for url in YAHOO_FEEDS:
        r = session.get(url, timeout=30)
        r.raise_for_status()
        for it in ET.fromstring(r.content).iter("item"):
            items.append({
                "title": clean(it.findtext("title")), "url": it.findtext("link", ""),
                "source": "Yahoo 股市", "published": parse_rss_date(it.findtext("pubDate")),
                "snippet": clean(it.findtext("description"))[:400],
            })
    return items


def collect():
    cutoff = now_tw() - MAX_AGE
    raw = []
    for fn in (from_cnyes, from_yahoo, from_google):
        try:
            got = fn()
            print(f"{fn.__name__}：{len(got)} 則")
            raw.extend(got)
        except Exception as e:  # noqa: BLE001 — 單一來源失敗不影響其他來源
            log_error(f"{fn.__name__} 失敗：{e}")

    seen, out = set(), []
    for it in sorted(raw, key=lambda x: x["published"] or cutoff, reverse=True):
        if not it["title"] or not it["url"]:
            continue
        if it["published"] and it["published"] < cutoff:
            continue
        text = it["title"] + " " + it["snippet"]
        if not AI_PATTERN.search(text) or not TW_PATTERN.search(text):
            continue
        if FOREIGN_TITLE.search(it["title"]) and not TW_PATTERN.search(it["title"]):
            continue
        key = re.sub(r"[\W_]+", "", it["title"])[:18]
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out[:MAX_CANDIDATES]


SYSTEM = """你是台灣財經網站的新聞編輯，讀者是關心台股的一般投資人。
請用繁體中文、台灣慣用說法撰寫，語氣清楚直接，不要翻譯腔。"""

INSTRUCTIONS = """以下是最近的新聞清單（JSON），每則有 id、標題、來源和內文片段。

請挑出和「台股的 AI 產業、台灣 AI 相關個股或供應鏈」最相關、最值得台股投資人知道的 {n} 則：
- 只選和台股、台灣公司直接相關的新聞；主角是國外公司或國外市場、和台股沒有直接關係的不要選。
- 同一事件只留一則，盡量涵蓋不同主題。
- 每則寫一段 2～3 句、60～90 字的重點摘要，說明發生什麼事、對哪些產業或個股可能有影響。
- 摘要只能根據提供的標題和片段，不要補充片段裡沒有的數字或事實；片段不足時就寫短一點。
- 不要給買賣建議。
- tags 給 1～3 個短標籤，優先放相關的台股個股，其次是題材（如「台積電」、「AI伺服器」）。
- 依重要性由高到低排列。

新聞清單：
{items}"""

SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "summary": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["id", "summary", "tags"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


def summarize(candidates):
    import anthropic

    payload = [{"id": i, "title": c["title"], "source": c["source"], "snippet": c["snippet"]}
               for i, c in enumerate(candidates)]
    kwargs = {}
    if MODEL in FALLBACK_MODELS:
        kwargs = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    client = anthropic.Anthropic()
    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": INSTRUCTIONS.format(
            n=TOP_N, items=json.dumps(payload, ensure_ascii=False))}],
        **kwargs,
    )
    if resp.stop_reason != "end_turn":
        raise RuntimeError(f"Claude 未正常完成：stop_reason={resp.stop_reason}")
    text = next(b.text for b in resp.content if b.type == "text")
    picked = []
    for p in json.loads(text)["items"]:
        if 0 <= p["id"] < len(candidates):
            c = candidates[p["id"]]
            picked.append({**c, "summary": p["summary"].strip(), "tags": p["tags"][:3]})
    return picked[:TOP_N]


def to_output(it):
    return {
        "title": it["title"],
        "url": it["url"],
        "source": it["source"],
        "published": it["published"].isoformat(timespec="minutes") if it["published"] else None,
        "summary": it.get("summary", ""),
        "tags": it.get("tags", []),
    }


def main():
    old = load_json("news.json", {})
    candidates = collect()
    if not candidates:
        log_error("沒有抓到任何 AI 相關新聞，保留上次資料")
        write_status("news", False)
        sys.exit(1)

    sig = hashlib.sha1("|".join(c["url"] for c in candidates).encode()).hexdigest()
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())
    if sig == old.get("candidates_sig") and old.get("ai_summary") == has_key:
        print("新聞清單沒有變化，不重新產生摘要")
        write_status("news", True)
        return

    items, ai = None, False
    if has_key:
        try:
            items = summarize(candidates)
            ai = bool(items)
        except Exception as e:  # noqa: BLE001 — AI 摘要失敗就改用原文片段
            log_error(f"AI 摘要失敗，改用原文片段：{e}")
    if not items:
        items = [{**c, "summary": c["snippet"][:120], "tags": []} for c in candidates[:TOP_N]]

    save_json("news.json", {
        "updated": now_iso(),
        "ai_summary": ai,
        "model": MODEL if ai else None,
        "candidates_sig": sig,
        "items": [to_output(it) for it in items],
    })
    write_status("news", True)
    print(f"已寫入 {len(items)} 則（AI 摘要：{'是' if ai else '否'}）")


if __name__ == "__main__":
    main()
