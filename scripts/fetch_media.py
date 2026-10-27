"""抓財經節目最新內容（YouTube 頻道影片、Podcast 單集），寫入 data/media.json。

- YouTube 的 RSS 會擋 GitHub 的主機，所以改讀頻道「影片」「直播」分頁的資料；
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
    {"kind": "youtube", "name": "錢線百分百", "channel_id": "UC_ObC9O0ZQ2FhW6u9_iFlZA",
     "url": "https://www.youtube.com/@ustvmoney100"},
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


def tab_videos(channel_id, tab):
    """讀頻道某個分頁（videos / streams）上的影片 id 與標題，依頁面順序（新到舊）。"""
    r = session.get(f"https://www.youtube.com/channel/{channel_id}/{tab}", timeout=30, cookies=YT_COOKIES)
    r.raise_for_status()
    data = _json_after(r.text, "ytInitialData")
    if not data:
        raise ValueError(f"{tab} 分頁讀不到資料")

    selected, found = [], []

    def visit(o):
        t = o.get("tabRenderer")
        if t and t.get("selected"):
            selected.append(t.get("endpoint", {}).get("commandMetadata", {})
                            .get("webCommandMetadata", {}).get("url", ""))
        lv = o.get("lockupViewModel")
        if lv and lv.get("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO" and lv.get("contentId"):
            title = (lv.get("metadata", {}).get("lockupMetadataViewModel", {})
                     .get("title", {}).get("content", ""))
            found.append({"id": lv["contentId"], "title": title})
        vr = o.get("videoRenderer")  # 舊版頁面格式
        if vr and vr.get("videoId"):
            runs = vr.get("title", {}).get("runs", [{}])
            found.append({"id": vr["videoId"], "title": runs[0].get("text", "")})

    _walk(data, visit)
    # 頻道沒有這個分頁時，YouTube 會導回首頁，首頁上的影片不算
    if not selected or not selected[0].endswith("/" + tab):
        return []
    return found


def watch_details(video_id):
    """從影片頁讀精確發布時間與說明欄；讀不到時回傳 None。"""
    try:
        r = session.get("https://www.youtube.com/watch", params={"v": video_id}, timeout=30, cookies=YT_COOKIES)
        r.raise_for_status()
        player = _json_after(r.text, "ytInitialPlayerResponse") or {}
        vd = player.get("videoDetails", {})
        mf = player.get("microformat", {}).get("playerMicroformatRenderer", {})
        return {
            "title": vd.get("title"),
            "description": (vd.get("shortDescription") or mf.get("description", {}).get("simpleText", "")).strip(),
            "published": mf.get("publishDate") or mf.get("uploadDate") or "",
            "upcoming": bool(vd.get("isUpcoming")),
        }
    except Exception as e:  # noqa: BLE001
        log_error(f"影片 {video_id} 詳細資料讀取失敗：{e}")
        return None


def youtube_from_pages(src):
    candidates, seen = [], set()
    for tab in ("videos", "streams"):
        try:
            for v in tab_videos(src["channel_id"], tab)[:PER_SOURCE + 2]:
                if v["id"] not in seen:
                    seen.add(v["id"])
                    candidates.append(v)
        except Exception as e:  # noqa: BLE001
            log_error(f"{src['name']} {tab} 分頁失敗：{e}")

    items = []
    for v in candidates:
        d = watch_details(v["id"]) or {}
        if d.get("upcoming"):
            continue  # 還沒開播的預告直播
        items.append({
            "id": v["id"],
            "title": d.get("title") or v["title"],
            "url": f"https://www.youtube.com/watch?v={v['id']}",
            "published": to_tw(d.get("published", "")),
            "thumbnail": f"https://i.ytimg.com/vi/{v['id']}/mqdefault.jpg",
            "description": d.get("description", ""),
        })
    # 有精確時間的依時間排序；沒有的維持頁面順序排在後面
    items.sort(key=lambda x: x["published"] or "", reverse=True)
    return items[:PER_SOURCE]


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
