import json, sys
d = json.load(open(sys.argv[1]))
st = lambda s: "—" if s is None else f"{s['status']} {s['on_hand']}/{s['reserved']}/{s['on_hand']-s['reserved']}"
esc = lambda t: str(t).replace("|", "\\|")
def inp(c):
    i = {k: v for k, v in c["input"].items() if k != "idempotency_key"}
    parts = [f"{k}={v}" for k, v in i.items() if k not in ("food",)]
    if "food" in i: parts.append("food metadata")
    if "idempotency_key" in c["input"]: parts.append(f"key `{c['input']['idempotency_key']}`")
    return esc(", ".join(parts))
groups = [("pledge","Pledges"),("receipt","Receipts"),("reserve","Reservations"),("cancel","Cancellation"),("expiry","Expiry"),
          ("pickup","Pickup"),("correction","Corrections"),("removal","Removal of unsafe stock"),("auth","Unauthorized operations")]
out = []
w = out.append
w("# Inventory test cases\n")
w("Test matrix and concurrency specification for the `inventory-test-cases` task. It turns the invariants in [DOMAIN.md](DOMAIN.md) into expected outcomes **before** implementation; `inventory-core` implements executable PostgreSQL tests from them.\n")
w("**Status:** proposal for review. The machine-readable source is [inventory-test-vectors.json](inventory-test-vectors.json); the tables below are generated from it, so change the JSON and regenerate rather than editing tables by hand. Error code names are placeholders until the app-foundation API contract is published.\n")
w("## Conventions\n")
for k, v in d["conventions"].items(): w(f"- **{k}:** {v}")
w("\nState columns read `status on_hand/reserved/available`. *Starts after* names the case whose end state this case starts from. Every rejected operation leaves state unchanged and writes no inventory event, except `RESERVATION_EXPIRED`, which releases the stale hold exactly once.\n")
w("## Error outcomes\n\n| Code | Meaning |\n| --- | --- |")
for k, v in d["error_codes"].items(): w(f"| `{k}` | {esc(v)} |")
w("\n## Fixtures\n\nAll data is fictional. Pledged and received lots are separate fixtures so no test can confuse an offered item with stock.\n")
w("| Campus | Name | Email domains |\n| --- | --- | --- |")
for c in d["fixtures"]["campuses"]: w(f"| `{c['id']}` | {c['name']} | {', '.join(c['email_domains'])} |")
w("\n| Location | Campus | Name |\n| --- | --- | --- |")
for l in d["fixtures"]["locations"]: w(f"| `{l['id']}` | `{l['campus']}` | {l['name']} |")
w("\n| User | Campus | Role | Verified | Staff at |\n| --- | --- | --- | --- | --- |")
for u in d["fixtures"]["users"]: w(f"| `{u['id']}` | `{u['campus']}` | {u['role']} | {'yes' if u['verified'] else 'no'} | {', '.join(u.get('staff_locations', [])) or '—'} |")
w("\n| Lot | Location | Title | Pledged | Start state |\n| --- | --- | --- | --- | --- |")
for l in d["fixtures"]["lots"]:
    extra = f" (allergens: {l['food']['allergens']})" if "food" in l else ""
    w(f"| `{l['id']}` | `{l['location']}` | {l['title']}{extra} | {l['pledged_quantity']} | {st(l)} |")
for g, title in groups:
    cs = [c for c in d["cases"] if c["group"] == g]
    w(f"\n## {title}\n\n| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for c in cs:
        e = c["expect"]
        actor = ", ".join(f"`{a}`" for a in c.get("actor_cases", [c.get("actor")]))
        op = ", ".join(c.get("op_cases", [c.get("op")]))
        title_ = esc(c["title"]) + (f"<br>*Setup:* {esc(c['setup'])}" if "setup" in c else "") + (f"<br>*Check:* {esc(e['notes'])}" if "notes" in e else "")
        w(f"| {c['id']} | {title_} | {actor} | `{op}` {inp(c)} | {c.get('after_case','—')} | {st(c['before'])} | `{e['result']}` | {st(e['after'])} | {esc(e.get('reservation','—'))} | {e['events_added']} |")
q = d["concurrency"]
w("\n## Concurrency specification\n\n### Harness\n")
for h in q["harness"]: w(f"- {h}")
w("\n### Invariant checks after every iteration\n")
for h in q["invariant_checks"]: w(f"- {h}")
w("\n### Scenarios\n\n| ID | Race | Start | Racers | Required outcome |\n| --- | --- | --- | --- | --- |")
for s in q["scenarios"]:
    start = st(s["start"]) + f" on `{s['start']['lot']}`" + (f"; held by {s['start']['holder']}" if "holder" in s["start"] else "")
    racers = s["racers"] if isinstance(s["racers"], str) else "<br>".join(f"`{r['actor']}` {r['op']}" + (f" key `{r['idempotency_key']}`" if "idempotency_key" in r else "") for r in s["racers"])
    w(f"| {s['id']} | {esc(s['title'])} | {esc(start)} | {esc(racers)} | {esc(s['expect'])} |")
w(f"\n### Negative control\n\n{q['negative_control']}\n")
w("Q1 is the acceptance gate for this task's concurrency requirement: one available unit, independent clients, exactly one successful reservation.\n")
w("## Open questions for the team\n")
for o in d["open_questions"]: w(f"- {o}")
w("\n## Regenerating\n\nRun from the repository root (Python 3.9+, no dependencies):\n\n```bash\npython3 docs/tools/check_inventory_vectors.py docs/inventory-test-vectors.json\npython3 docs/tools/render_inventory_cases.py docs/inventory-test-vectors.json docs/INVENTORY_TEST_CASES.md\n```\n\nThe check confirms `0 <= reserved <= on_hand` for every state, that rejected cases change nothing, and that each chained case starts from its predecessor's end state.")
open(sys.argv[2], "w").write("\n".join(out) + "\n")
