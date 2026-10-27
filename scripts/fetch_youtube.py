"""抓指定 YouTube 頻道最新影片（標題、縮圖、說明欄），寫入 data/youtube.json。

主要用 YouTube 公開的 RSS feed（免金鑰）。如果 RSS 抓不到、且有設定 YOUTUBE_API_KEY，
就改用 YouTube Data API。要增減頻道，改下面的 CHANNELS 即可。
"""
import os
import re
import sys
import xml.etree.ElementTree as ET

from common import load_json, now_iso, save_json, session

# handle 或 id 擇一填寫即可；只填 handle 時，第一次執行會自動查出 id 並記在 youtube.json
CHANNELS = [
    {"name": "股市老先覺", "handle": "股市老先覺"},
    {"name": "理財達人秀", "id": "UCQvsuaih5lE0n_Ne54nNezg"},
    {"name": "錢線百分百", "handle": "ustvmoney100"},
]
PER_CHANNEL = 3

NS = {
    "a": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def resolve_channel_id(handle):
    r = session.get(f"https://www.youtube.com/@{handle}", timeout=30,
                    cookies={"CONSENT": "YES+1"})
    r.raise_for_status()
    for pat in (r'"externalId":"(UC[\w-]{22})"',
                r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"',
                r'"channelId":"(UC[\w-]{22})"'):
        m = re.search(pat, r.text)
        if m:
            return m.group(1)
    raise ValueError(f"找不到 @{handle} 的頻道 ID")


def thumb(video_id):
    return f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"


def from_rss(channel_id):
    r = session.get("https://www.youtube.com/feeds/videos.xml",
                    params={"channel_id": channel_id}, timeout=30)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    videos = []
    for entry in root.findall("a:entry", NS):
        link_el = entry.find("a:link", NS)
        link = link_el.get("href") if link_el is not None else ""
        if "/shorts/" in link:
            continue  # 略過 Shorts
        vid = entry.findtext("yt:videoId", default="", namespaces=NS)
        group = entry.find("media:group", NS)
        desc = group.findtext("media:description", default="", namespaces=NS) if group is not None else ""
        videos.append({
            "id": vid,
            "title": entry.findtext("a:title", default="", namespaces=NS),
            "url": f"https://www.youtube.com/watch?v={vid}",
            "published": entry.findtext("a:published", default="", namespaces=NS),
            "thumbnail": thumb(vid),
            "description": desc.strip(),
        })
        if len(videos) == PER_CHANNEL:
            break
    return videos


def from_api(channel_id, key):
    uploads = "UU" + channel_id[2:]
    r = session.get("https://www.googleapis.com/youtube/v3/playlistItems", timeout=30, params={
        "part": "snippet", "playlistId": uploads, "maxResults": PER_CHANNEL, "key": key,
    })
    r.raise_for_status()
    videos = []
    for item in r.json().get("items", []):
        sn = item["snippet"]
        vid = sn["resourceId"]["videoId"]
        videos.append({
            "id": vid,
            "title": sn.get("title", ""),
            "url": f"https://www.youtube.com/watch?v={vid}",
            "published": sn.get("publishedAt", ""),
            "thumbnail": thumb(vid),
            "description": sn.get("description", "").strip(),
        })
    return videos


def main():
    old = load_json("youtube.json", {})
    known_ids = old.get("channel_ids", {})
    old_by_name = {c["name"]: c for c in old.get("channels", [])}
    api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()

    channels, any_ok = [], False
    for ch in CHANNELS:
        name = ch["name"]
        try:
            cid = ch.get("id") or known_ids.get(ch["handle"]) or resolve_channel_id(ch["handle"])
            if ch.get("handle"):
                known_ids[ch["handle"]] = cid
            try:
                videos = from_rss(cid)
            except Exception as e:  # noqa: BLE001
                if not api_key:
                    raise
                print(f"{name} RSS 失敗（{e}），改用 API", file=sys.stderr)
                videos = from_api(cid, api_key)
            if not videos:
                raise ValueError("沒有影片")
            url = f"https://www.youtube.com/@{ch['handle']}" if ch.get("handle") \
                else f"https://www.youtube.com/channel/{cid}"
            channels.append({"name": name, "url": url, "videos": videos})
            any_ok = True
            print(f"{name}：{len(videos)} 支")
        except Exception as e:  # noqa: BLE001 — 抓不到就沿用上次的資料
            print(f"{name} 抓取失敗：{e}", file=sys.stderr)
            if name in old_by_name:
                channels.append(old_by_name[name])

    if not any_ok:
        sys.exit(1)
    save_json("youtube.json", {"updated": now_iso(), "channel_ids": known_ids, "channels": channels})


if __name__ == "__main__":
    main()
