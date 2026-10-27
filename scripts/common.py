"""各抓資料腳本共用的小工具。"""
import json
import os
from datetime import datetime, timedelta, timezone

import requests

TW = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9"})


def now_tw():
    return datetime.now(TW)


def now_iso():
    return now_tw().isoformat(timespec="seconds")


def load_json(name, default):
    path = os.path.join(DATA_DIR, name)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(name, data):
    path = os.path.join(DATA_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def to_int(text):
    """'1,234' / '-5,678' / '' → int；無法轉換時回傳 None。"""
    s = str(text).replace(",", "").replace(" ", "").strip()
    if not s or s in ("-", "--"):
        return None
    try:
        return int(float(s))
    except ValueError:
        return None
