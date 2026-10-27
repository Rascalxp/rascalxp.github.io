"""抓三大法人買賣金額（證交所）與散戶微台未平倉（期交所），寫入 data/chips.json。

散戶微台的算法（業界常用）：
  散戶多單 = 微台全市場未平倉 − 三大法人多單
  散戶空單 = 微台全市場未平倉 − 三大法人空單
  散戶淨未平倉 = 散戶多單 − 散戶空單 = −（三大法人多空未平倉淨額）
口數增減 = 今日散戶淨未平倉 − 前一交易日散戶淨未平倉
"""
import csv
import html
import io
import re
import sys
import time
from datetime import timedelta

from common import load_json, now_iso, now_tw, save_json, session, to_int

TWSE_URL = "https://www.twse.com.tw/rwd/zh/fund/BFI82U"
TAIFEX_CSV_URL = "https://www.taifex.com.tw/cht/3/futContractsDateDown"
TAIFEX_HTML_URL = "https://www.taifex.com.tw/cht/3/futContractsDate"
TMF = "TMF"  # 微型臺指期貨
LOOKBACK_DAYS = 12


# ---------- 證交所：三大法人買賣金額 ----------

def fetch_twse_day(day):
    params = {"type": "day", "dayDate": day.strftime("%Y%m%d"), "response": "json"}
    r = session.get(TWSE_URL, params=params, timeout=30)
    r.raise_for_status()
    js = r.json()
    if js.get("stat") != "OK" or not js.get("data"):
        return None
    fields = js.get("fields") or ["單位名稱", "買進金額", "賣出金額", "買賣差額"]
    rows = [dict(zip(fields, row)) for row in js["data"]]

    def pick(*keywords):
        buy = sell = net = 0
        found = False
        for row in rows:
            name = row.get(fields[0], "")
            if any(k in name for k in keywords):
                found = True
                buy += to_int(row.get(fields[1])) or 0
                sell += to_int(row.get(fields[2])) or 0
                net += to_int(row.get(fields[3])) or 0
        return {"buy": buy, "sell": sell, "net": net} if found else None

    foreign = pick("外資")            # 外資及陸資(不含外資自營商) + 外資自營商
    trust = pick("投信")
    dealer = None
    dealer_rows = [r for r in rows if r.get(fields[0], "").startswith("自營商")]
    if dealer_rows:
        dealer = {
            "buy": sum(to_int(r.get(fields[1])) or 0 for r in dealer_rows),
            "sell": sum(to_int(r.get(fields[2])) or 0 for r in dealer_rows),
            "net": sum(to_int(r.get(fields[3])) or 0 for r in dealer_rows),
        }
    total = pick("合計")
    if not (foreign and trust and dealer):
        raise ValueError(f"證交所欄位和預期不同：{[r.get(fields[0]) for r in rows]}")
    return {
        "date": day.strftime("%Y-%m-%d"),
        "unit": "元",
        "rows": [
            {"name": "外資", **foreign},
            {"name": "投信", **trust},
            {"name": "自營商", **dealer},
            {"name": "三大法人合計", **(total or {
                "buy": foreign["buy"] + trust["buy"] + dealer["buy"],
                "sell": foreign["sell"] + trust["sell"] + dealer["sell"],
                "net": foreign["net"] + trust["net"] + dealer["net"],
            })},
        ],
    }


def latest_institutional():
    day = now_tw()
    for _ in range(LOOKBACK_DAYS):
        if day.weekday() < 5:
            result = fetch_twse_day(day)
            if result:
                return result
            time.sleep(2)  # 證交所有頻率限制，慢慢來
        day -= timedelta(days=1)
    return None


# ---------- 期交所：微台三大法人未平倉 ----------

def _decode(content):
    for enc in ("utf-8-sig", "cp950", "big5"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def tmf_net_from_csv(day):
    d = day.strftime("%Y/%m/%d")
    data = {"queryStartDate": d, "queryEndDate": d, "commodityId": TMF}
    r = session.post(TAIFEX_CSV_URL, data=data, timeout=30)
    r.raise_for_status()
    text = _decode(r.content)
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        return None
    header = [h.strip() for h in rows[0]]
    try:
        i_name = next(i for i, h in enumerate(header) if "商品" in h)
        i_who = next(i for i, h in enumerate(header) if "身份" in h)
        i_net = next(i for i, h in enumerate(header)
                     if "未平倉" in h and "淨額" in h and "口數" in h)
    except StopIteration:
        return None
    total, count = 0, 0
    for row in rows[1:]:
        if len(row) <= i_net or "微型" not in row[i_name]:
            continue
        if any(k in row[i_who] for k in ("自營商", "投信", "外資")):
            v = to_int(row[i_net])
            if v is not None:
                total += v
                count += 1
    return total if count == 3 else None


def tmf_net_from_html(day):
    data = {"queryType": "1", "queryDate": day.strftime("%Y/%m/%d"), "commodityId": TMF}
    r = session.post(TAIFEX_HTML_URL, data=data, timeout=30)
    r.raise_for_status()
    page = _decode(r.content)
    total, count = 0, 0
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S | re.I):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)]
        who = next((c for c in cells if c in ("自營商", "投信", "外資", "外資及陸資")), None)
        if not who:
            continue
        nums = [to_int(c) for c in cells if re.fullmatch(r"-?[\d,]+", c)]
        # 每列 12 個數字：交易(多/空/淨)×(口數,金額) + 未平倉(多/空/淨)×(口數,金額)
        if len(nums) >= 12:
            total += nums[-2]
            count += 1
    return total if count == 3 else None


def tmf_inst_net(day):
    for fn in (tmf_net_from_csv, tmf_net_from_html):
        try:
            v = fn(day)
            if v is not None:
                return v
        except Exception as e:  # noqa: BLE001 — 一個方法失敗就換下一個
            print(f"  {fn.__name__} {day:%Y-%m-%d} 失敗：{e}", file=sys.stderr)
        time.sleep(1)
    return None


def latest_retail_tmf():
    found = []  # [(date, 三大法人淨未平倉)]
    day = now_tw()
    for _ in range(LOOKBACK_DAYS):
        if day.weekday() < 5:
            v = tmf_inst_net(day)
            if v is not None:
                found.append((day, v))
                if len(found) == 2:
                    break
        day -= timedelta(days=1)
    if not found:
        return None
    today_date, today_inst = found[0]
    retail_net = -today_inst
    change = None
    if len(found) == 2:
        change = retail_net - (-found[1][1])
    return {
        "date": today_date.strftime("%Y-%m-%d"),
        "net_oi": retail_net,
        "change": change,
        "prev_date": found[1][0].strftime("%Y-%m-%d") if len(found) == 2 else None,
    }


def main():
    out = load_json("chips.json", {})
    ok = False

    try:
        inst = latest_institutional()
        if inst:
            out["institutional"] = inst
            ok = True
            print(f"三大法人：{inst['date']}")
        else:
            print("三大法人：找不到資料", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"三大法人抓取失敗：{e}", file=sys.stderr)

    try:
        tmf = latest_retail_tmf()
        if tmf:
            out["retail_tmf"] = tmf
            ok = True
            print(f"散戶微台：{tmf['date']} {tmf['change']} ({tmf['net_oi']})")
        else:
            print("散戶微台：找不到資料", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"散戶微台抓取失敗：{e}", file=sys.stderr)

    if ok:
        out["updated"] = now_iso()
        save_json("chips.json", out)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
