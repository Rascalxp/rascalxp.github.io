"""抓財經節目最新內容（YouTube 頻道影片、Podcast 單集），寫入 data/media.json。

- YouTube 的 RSS 會擋 GitHub 的主機，所以改讀頻道「影片」分頁的資料（不含 Shorts、會員專屬）；
  如果有設定 YOUTUBE_API_KEY，頁面讀不到時會改用 YouTube Data API。
- Podcast 用 Apple Podcasts 的公開查詢 API，填 Apple Podcasts 網址裡的 id 即可。
要增減節目，改下面的 SOURCES。
"""
import json
import os
import re
from datetime import datetime

from common import TW, load_json, log_error, now_iso, save_json, session, write_status

SOURCES = [
    {"kind": "youtube", "name": "理財達人秀", "channel_id": "UCQvsuaih5lE0n_Ne54nNezg",
     "url": "https://www.youtube.com/@EBCmoneyshow"},
    # 錢線百分百每天會切成好幾段上傳，只抓標題有「完整版」的
    {"kind": "youtube", "name": "錢線百分百", "channel_id": "UC_ObC9O0ZQ2FhW6u9_iFlZA",
     "url": "https://www.youtube.com/@ustvmoney100", "title_contains": "完整版"},
    {"kind": "podcast", "name": "股癌 Gooaye", "apple_id": "1500839292",
     "url": "https://podcasts.apple.com/tw/podcast/id1500839292"},
]
PER_SOURCE = 3

YT_COOKIES = {"CONSENT": "YES+1"}


def to_tw(s):
    """各種 ISO 時間字串統一轉成台灣時間；無法解析就原樣回傳。"""
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TW).isoformat()
    except (ValueError, AttributeError):
        return s or ""


# ---------- YouTube ----------

def _json_after(html, var):
    m = re.search(r"(?:var |window\[\"|)" + re.escape(var) + r"\"?\]?\s*=\s*(\{.*?\});\s*(?:var |</script>)", html, re.S)
    return json.loads(m.group(1)) if m else None


def _walk(obj, fn):
    if isinstance(obj, dict):
        fn(obj)
        for v in obj.values():
            _walk(v, fn)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, fn)


def channel_videos(channel_id):
    """讀頻道「影片」分頁上的影片（新到舊），略過會員專屬影片。"""
    r = session.get(f"https://www.youtube.com/channel/{channel_id}/videos", timeout=30, cookies=YT_COOKIES)
    r.raise_for_status()
    data = _json_after(r.text, "ytInitialData")
    if not data:
        raise ValueError("影片分頁讀不到資料")

    selected, found = [], []

    def visit(o):
        t = o.get("tabRenderer")
        if t and t.get("selected"):
            selected.append(t.get("endpoint", {}).get("commandMetadata", {})
                            .get("webCommandMetadata", {}).get("url", ""))
        lv = o.get("lockupViewModel")
        if lv and lv.get("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO" and lv.get("contentId"):
            if "BADGE_MEMBERS_ONLY" in json.dumps(lv):
                return
            title = (lv.get("metadata", {}).get("lockupMetadataViewModel", {})
                     .get("title", {}).get("content", ""))
            found.append({"id": lv["contentId"], "title": title})

    _walk(data, visit)
    # 頻道沒有「影片」分頁時，YouTube 會導回首頁或 Shorts，那些不算
    if not selected or not selected[0].endswith("/videos"):
        raise ValueError("這個頻道沒有一般影片（可能只有 Shorts）")
    return found


def watch_details(video_id):
    """從影片頁讀發布日期與說明欄。

    YouTube 會擋 GitHub 主機讀播放資料，但頁面上的 ytInitialData 還在，
    日期（例如「2026年10月22日」）和說明欄從那裡取；讀不到就留空。
    """
    try:
        r = session.get("https://www.youtube.com/watch", params={"v": video_id}, timeout=30, cookies=YT_COOKIES)
        r.raise_for_status()
        data = _json_after(r.text, "ytInitialData") or {}
        info = {"date": "", "description": ""}

        def visit(o):
            prim = o.get("videoPrimaryInfoRenderer")
            if prim and not info["date"]:
                m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", prim.get("dateText", {}).get("simpleText", ""))
                if m:
                    info["date"] = f"{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3]):02d}"
            sec = o.get("videoSecondaryInfoRenderer")
            if sec and not info["description"]:
                desc = sec.get("attributedDescription", {}).get("content")
                if desc is None:
                    desc = "".join(x.get("text", "") for x in sec.get("description", {}).get("runs", []))
                info["description"] = (desc or "").strip()

        _walk(data, visit)
        return info
    except Exception as e:  # noqa: BLE001
        log_error(f"影片 {video_id} 詳細資料讀取失敗：{e}")
        return {"date": "", "description": ""}


def youtube_from_pages(src):
    videos = channel_videos(src["channel_id"])
    if src.get("title_contains"):
        videos = [v for v in videos if src["title_contains"] in v["title"]]
    items = []
    for v in videos[:PER_SOURCE]:
        d = watch_details(v["id"])
        items.append({
            "id": v["id"],
            "title": v["title"],
            "url": f"https://www.youtube.com/watch?v={v['id']}",
            "published": d["date"],  # 只有日期（YYYY-MM-DD）
            "thumbnail": f"https://i.ytimg.com/vi/{v['id']}/mqdefault.jpg",
            "description": d["description"],
        })
    return items


def youtube_from_api(src, key):
    uploads = "UULF" + src["channel_id"][2:]  # 一般影片（不含 Shorts）
    r = session.get("https://www.googleapis.com/youtube/v3/playlistItems", timeout=30, params={
        "part": "snippet", "playlistId": uploads, "maxResults": PER_SOURCE, "key": key,
    })
    r.raise_for_status()
    items = []
    for it in r.json().get("items", []):
        sn = it["snippet"]
        vid = sn["resourceId"]["videoId"]
        items.append({
            "id": vid, "title": sn.get("title", ""),
            "url": f"https://www.youtube.com/watch?v={vid}",
            "published": to_tw(sn.get("publishedAt", "")),
            "thumbnail": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
            "description": sn.get("description", "").strip(),
        })
    return items


def fetch_youtube(src):
    items = youtube_from_pages(src)
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not items and key:
        log_error(f"{src['name']} 頁面讀不到影片，改用 API")
        items = youtube_from_api(src, key)
    return items


# ---------- Podcast ----------

def fetch_podcast(src):
    r = session.get("https://itunes.apple.com/lookup", timeout=30, params={
        "id": src["apple_id"], "entity": "podcastEpisode", "country": "tw", "limit": 10,
    })
    r.raise_for_status()
    results = r.json().get("results", [])
    show = next((x for x in results if x.get("wrapperType") == "track"), {})
    episodes = [x for x in results if x.get("wrapperType") == "podcastEpisode"]
    episodes.sort(key=lambda x: x.get("releaseDate", ""), reverse=True)
    items = []
    for ep in episodes[:PER_SOURCE]:
        items.append({
            "id": str(ep.get("trackId", "")),
            "title": ep.get("trackName", ""),
            "url": ep.get("trackViewUrl") or src["url"],
            "published": to_tw(ep.get("releaseDate", "")),
            "thumbnail": ep.get("artworkUrl600") or show.get("artworkUrl600") or "",
            "description": (ep.get("description") or ep.get("shortDescription") or "").strip(),
        })
    return items


def main():
    old = load_json("media.json", {})
    old_by_name = {s["name"]: s for s in old.get("sources", [])}

    sources, any_ok = [], False
    for src in SOURCES:
        name = src["name"]
        try:
            items = fetch_youtube(src) if src["kind"] == "youtube" else fetch_podcast(src)
            if not items:
                raise ValueError("沒有抓到任何內容")
            sources.append({"kind": src["kind"], "name": name, "url": src["url"], "items": items})
            any_ok = True
            print(f"{name}：{len(items)} 則")
        except Exception as e:  # noqa: BLE001 — 抓不到就沿用上次的資料
            log_error(f"{name} 抓取失敗：{e}")
            if name in old_by_name:
                sources.append(old_by_name[name])

    write_status("media", any_ok)
    if any_ok:
        save_json("media.json", {"updated": now_iso(), "sources": sources})


if __name__ == "__main__":
    main()
