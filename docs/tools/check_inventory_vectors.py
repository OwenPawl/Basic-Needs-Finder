import json, sys
d = json.load(open(sys.argv[1]))
cases = {c["id"]: c for c in d["cases"]}
codes = set(d["error_codes"])
users = {u["id"] for u in d["fixtures"]["users"]} | {"system", "anonymous"}
lots = {l["id"]: l for l in d["fixtures"]["lots"]}
errs = []
def inv(s, where):
    if s is None: return
    if not (0 <= s["reserved"] <= s["on_hand"]): errs.append(f"{where}: invariant broken {s}")
    if s["status"] not in ("pledged", "received", "removed"): errs.append(f"{where}: bad status")
    if s["status"] == "pledged" and (s["on_hand"] or s["reserved"]): errs.append(f"{where}: pledged lot has stock")
    if s["status"] == "removed" and (s["on_hand"] or s["reserved"]): errs.append(f"{where}: removed lot has stock")
for l in lots.values(): inv(l, "fixture " + l["id"])
for c in d["cases"]:
    e = c["expect"]; i = c["id"]
    inv(c["before"], i + " before"); inv(e["after"], i + " after")
    for a in c.get("actor_cases", [c.get("actor")]):
        if a not in users: errs.append(f"{i}: unknown actor {a}")
    lot = c["input"].get("lot")
    if lot and lot not in lots: errs.append(f"{i}: unknown lot {lot}")
    if lot and "after_case" not in c and "setup" not in c and c["before"]:
        f = lots[lot]
        if {k: f[k] for k in ("status", "on_hand", "reserved")} != c["before"]: errs.append(f"{i}: before != fixture {lot}")
    head = e["result"].split()[0]
    rejected = head != "ok"
    if rejected:
        for code in [x.strip(" ();,") for x in e["result"].replace("(", " ").split()]:
            if code.isupper() and code not in codes: errs.append(f"{i}: unknown code {code}")
    if rejected and head != "RESERVATION_EXPIRED":
        if e["after"] != c["before"]: errs.append(f"{i}: rejected but state changed")
        if e["events_added"]: errs.append(f"{i}: rejected but events written")
    if "replayed" in e["result"] and e["events_added"]: errs.append(f"{i}: replay wrote events")
    if not rejected and "replayed" not in e["result"] and c["before"] and e["after"] != c["before"] and not e["events_added"]:
        errs.append(f"{i}: state changed without an event")
    if "after_case" in c:
        p = cases.get(c["after_case"])
        if not p: errs.append(f"{i}: missing after_case"); continue
        if p["expect"]["after"] != c["before"]: errs.append(f"{i}: before {c['before']} != {p['id']} after {p['expect']['after']}")
for q in d["concurrency"]["scenarios"]:
    s = q["start"]; inv({k: s[k] for k in ("status", "on_hand", "reserved")}, q["id"])
print(f"{len(d['cases'])} cases, {len(d['concurrency']['scenarios'])} concurrency scenarios")
print("\n".join(errs) if errs else "all checks passed"); sys.exit(1 if errs else 0)
