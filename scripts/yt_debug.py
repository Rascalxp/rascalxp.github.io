import json, re
from common import session, save_json
ids = {"老先覺": "UCmmwEtaTI22K7o2IJFedS5w", "達人秀": "UCQvsuaih5lE0n_Ne54nNezg", "錢線": "UC_ObC9O0ZQ2FhW6u9_iFlZA"}
out = {}
for name, cid in ids.items():
    d = {}
    for label, params in (("ch", {"channel_id": cid}), ("UULF", {"playlist_id": "UULF" + cid[2:]}), ("UULV", {"playlist_id": "UULV" + cid[2:]})):
        try:
            r = session.get("https://www.youtube.com/feeds/videos.xml", params=params, timeout=30)
            d[label] = {"status": r.status_code, "len": len(r.content), "entries": r.text.count("<entry>"),
                        "shorts": r.text.count("/shorts/"), "head": r.text[:200]}
        except Exception as e:
            d[label] = str(e)
    for tab in ("videos", "streams"):
        try:
            r = session.get(f"https://www.youtube.com/channel/{cid}/{tab}", timeout=30, cookies={"CONSENT": "YES+1"})
            t = r.text
            i = t.find('"videoId"')
            d[tab] = {"status": r.status_code, "len": len(t), "title": re.search(r"<title>(.*?)</title>", t).group(1) if "<title>" in t else None,
                      "videoRenderer": t.count('"videoRenderer"'), "lockupViewModel": t.count('"lockupViewModel"'),
                      "richItemRenderer": t.count('"richItemRenderer"'), "sample": t[max(0, i-300): i+1500] if i >= 0 else t[:500]}
        except Exception as e:
            d[tab] = str(e)
    out[name] = d
save_json("yt_debug.json", out)
