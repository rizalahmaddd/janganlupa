# End-to-end API checks against a running dev server with a fresh local database (see docs/getting-started.md).
import json, sys, time, urllib.request, urllib.parse, http.cookiejar

B = "http://localhost:5173/api"

def client():
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def call(method, path, body=None, headers=None, raw=False):
        h = {"content-type": "application/json", **(headers or {})}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(B + path, data=data, method=method, headers=h)
        try:
            r = op.open(req)
            txt = r.read().decode()
            return r.status, (txt if raw else (json.loads(txt) if txt else None))
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            try:
                return e.code, json.loads(txt)
            except Exception:
                return e.code, txt
    return call

def login(call, email):
    s, r = call("POST", "/auth/request", {"email": email})
    assert s == 200, r
    tok = urllib.parse.parse_qs(urllib.parse.urlparse(r["devLink"]).query)["token"][0]
    return r, tok

ok = 0
def check(name, cond, info=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"))
    ok += bool(cond)

a = client()
r, tok = login(a, "  Alice@Example.com ")
check("email normalized", r["email"] == "alice@example.com", r)
s, r2 = a("POST", "/auth/code", {"email": "alice@example.com", "code": "000000"})
check("wrong code rejected w/ attempts", s == 400 and "Sisa" in r2["error"], r2)
s, v = a("POST", "/auth/verify", {"token": tok})
check("verify token", s == 200, v)
s, v = a("POST", "/auth/verify", {"token": tok})
check("token single use", s == 410 and v["code"] == "used_token", v)
s, r = a("GET", "/links?tag=panduan")
check("demo link seeded once", len(r["items"]) == 1 and r["items"][0]["note"], r)
s, me = a("GET", "/me")
check("me", s == 200 and me["email"] == "alice@example.com", me)

s, r = a("POST", "/links", {"url": "x.com"}, {"origin": "https://evil.com"})
check("csrf blocked", s == 403, r)
s, r = a("POST", "/links", {"url": "github.com/cloudflare/workers-sdk?utm_source=x&fbclid=1", "note": "repo wrangler", "tags": ["Dev Tools", "#cloudflare"]})
check("create link", s == 201 and r["link"]["url"] == "https://github.com/cloudflare/workers-sdk" and r["link"]["tags"] == ["cloudflare", "dev-tools"], r)
gh = r["link"]["id"]
s, r = a("POST", "/links", {"url": "http://www.GitHub.com/cloudflare/workers-sdk/#readme"})
check("duplicate detected", s == 409 and r["link"]["id"] == gh, r)
s, r = a("POST", "/links", {"url": "javascript:alert(1)"})
check("javascript: rejected", s == 400, r)
s, r = a("POST", "/links", {"url": "http://127.0.0.1:8080/admin"})
check("private ip saved but not fetched", s == 201, r)
priv = r["link"]["id"]
s, r = a("POST", "/links", {"url": "https://developers.cloudflare.com/d1/", "tags": ["cloudflare"], "note": "database sqlite"})
d1 = r["link"]["id"]
s, r = a("POST", "/links/bulk", {"text": "cek ini https://example.com/a dan https://example.com/b, juga https://example.com/a lagi (https://en.wikipedia.org/wiki/Foo_(bar))"})
check("bulk dedupe", s == 200 and r["added"] == 3 and r["total"] == 3, r)

time.sleep(6)
s, r = a("GET", f"/links/{gh}")
check("metadata fetched", r["link"]["status"] == "ok" and r["link"]["title"], r["link"])
print("   title:", r["link"]["title"], "| image:", (r["link"]["image"] or "")[:70])
s, r = a("GET", f"/links/{priv}")
check("ssrf blocked -> broken", r["link"]["status"] == "broken", r["link"]["status"])

s, r = a("GET", "/links?q=wrangler")
check("fts search note", any(x["id"] == gh for x in r["items"]), [x["title"] for x in r["items"]])
s, r = a("GET", "/links?q=github.com")
check("fts search domain", any(x["id"] == gh for x in r["items"]), r)
s, r = a("GET", "/links?q=%22((")
check("fts weird syntax no 500", s == 200, r)
s, r = a("GET", "/links?tag=cloudflare")
check("filter tag", len(r["items"]) == 2, len(r["items"]))
s, r = a("GET", f"/links/{gh}/related")
check("related via tag", any(x["id"] == d1 for x in r["items"]), r)

s, r = a("PATCH", f"/links/{gh}", {"title": "Workers SDK", "remindAt": int(time.time() * 1000) - 1000, "pinned": True})
check("patch", r["link"]["title"] == "Workers SDK" and r["link"]["pinned"] and r["link"]["remindAt"] is None, r)
s, r = a("POST", f"/links/{gh}/refresh")
check("refresh keeps custom title", r["link"]["title"] == "Workers SDK", r["link"]["title"])
s, st = a("GET", "/stats")
check("stats (reminders off)", st["due"] == 0 and st["pinned"] == 1, st)

s, r = a("DELETE", f"/links/{d1}")
s, r = a("GET", "/links?view=trash")
check("trash", [x["id"] for x in r["items"]] == [d1], r)
s, r = a("POST", "/links", {"url": "https://developers.cloudflare.com/d1"})
check("re-adding trashed restores", s == 200 and r.get("restored") and r["link"]["id"] == d1, r)

s, col = a("POST", "/collections", {"name": "Riset", "color": "rose"})
cid = col["item"]["id"]
s, r = a("POST", "/links/batch", {"ids": [gh, d1], "action": "move", "value": cid})
s, r = a("GET", f"/links?collection={cid}")
check("move to collection", len(r["items"]) == 2, r)

s, r = a("POST", f"/collections/{cid}/members", {"email": "bob@example.com", "role": "viewer"})
check("invite before signup", s == 200, r)
s, r = a("POST", f"/collections/{cid}/members", {"email": "alice@example.com"})
check("invite self rejected", s == 400, r)

b = client()
_, tb = login(b, "bob@example.com")
b("POST", "/auth/verify", {"token": tb})
s, r = b("GET", "/collections")
check("bob sees shared collection", any(c["id"] == cid and c["role"] == "viewer" for c in r["items"]), r)
s, r = b("GET", f"/links?collection={cid}")
check("bob lists shared links", len(r["items"]) == 2 and not r["items"][0]["canEdit"], r)
s, r = b("PATCH", f"/links/{gh}", {"title": "hacked"})
check("viewer cannot edit", s == 403, r)
s, r = b("POST", "/links", {"url": "https://bob.dev", "collectionId": cid})
check("viewer cannot add", s == 403, r)
a("POST", f"/collections/{cid}/members", {"email": "bob@example.com", "role": "editor"})
s, r = b("PATCH", f"/links/{gh}", {"note": "catatan bob"})
check("editor can edit note", s == 200 and r["link"]["note"] == "catatan bob", r)
s, r = b("PATCH", f"/links/{gh}", {"pinned": False})
check("editor cannot pin owner link", s == 403, r)
s, r = b("POST", "/links", {"url": "https://bob.dev/post", "collectionId": cid})
check("editor can add", s == 201, r)
s, r = b("GET", f"/links/{gh}")
check("bob can view gh", s == 200, r)
s, r = b("GET", f"/links/{priv}")
check("bob cannot view private link", s == 404, r)

s, r = a("POST", f"/collections/{cid}/public", {"enabled": True})
slug = r["slug"]
anon = client()
s, r = anon("GET", f"/public/{slug}")
check("public page", s == 200 and len(r["items"]) == 3 and "note" not in r["items"][0], r)
a("POST", f"/collections/{cid}/public", {"enabled": False})
s, r = anon("GET", f"/public/{slug}")
check("public revoked", s == 404, r)
s, r = anon("GET", "/links")
check("anon 401", s == 401, r)

s, r = a("GET", "/export?format=html", raw=True)
check("export html", s == 200 and "NETSCAPE" in r, r[:100])
s, r = a("GET", "/export?format=csv", raw=True)
check("export csv", s == 200 and "url,title" in r, r[:100])

s, r = a("DELETE", f"/collections/{cid}")
s, r = b("GET", f"/links/{gh}")
check("after delete collection bob loses access", s == 404, r)
s, r = b("GET", "/links")
check("bob keeps own link", len(r["items"]) == 2, r)

# Drive-style link sharing
s, r = a("POST", f"/links/{gh}/shares", {"emails": ["carol@example.com"], "role": "viewer", "message": "cek ini"})
check("share link to unregistered", s == 200 and r["added"] == 1, r)
s, r = b("POST", f"/links/{gh}/shares", {"emails": ["x@example.com"]})
check("non-owner cannot share", s in (403, 404), r)
s, r = a("POST", f"/links/{gh}/shares", {"emails": ["alice@example.com"]})
check("share to self rejected", s == 400, r)
s, r = a("GET", f"/links/{gh}/shares")
check("list shares", [x["email"] for x in r["items"]] == ["carol@example.com"] and not r["items"][0]["joined"], r)
cc = client()
_, tc = login(cc, "carol@example.com")
cc("POST", "/auth/verify", {"token": tc})
s, st = cc("GET", "/stats")
check("carol has new share badge", st["shared"] == 1 and st["shared_new"] == 1, st)
s, r = cc("GET", "/links?view=shared")
check("carol sees shared link", len(r["items"]) == 1 and r["items"][0]["id"] == gh and r["items"][0]["shareNew"] and r["items"][0]["sharedBy"] and not r["items"][0]["canEdit"], r)
s, r = cc("GET", "/links?q=wrangler")
check("carol search finds shared link", any(x["id"] == gh for x in r["items"]), r)
s, r = cc("PATCH", f"/links/{gh}", {"note": "x"})
check("viewer share cannot edit", s == 403, r)
cc("POST", "/shared/seen")
s, st = cc("GET", "/stats")
check("seen clears badge", st["shared_new"] == 0, st)
s, r = cc("POST", f"/links/{gh}/copy")
check("save copy to my links", s == 201 and r["link"]["mine"], r)
s, r = cc("POST", f"/links/{gh}/copy")
check("copy twice is duplicate", r.get("duplicate"), r)
a("POST", f"/links/{gh}/shares", {"emails": ["carol@example.com"], "role": "editor"})
s, r = cc("PATCH", f"/links/{gh}", {"note": "catatan carol"})
check("editor share can edit", s == 200, r)
s, r = cc("DELETE", f"/links/{gh}")
check("editor share cannot delete", s == 403, r)
s, r = cc("DELETE", f"/links/{gh}/shares/carol%40example.com")
check("recipient removes from shared", s == 200, r)
s, r = cc("GET", f"/links/{gh}")
check("access gone after leave", s == 404, r)
s, r = a("GET", f"/links/{gh}")
check("owner sees share count", r["link"]["shareCount"] == 0, r["link"]["shareCount"])

c = client()
for i in range(6):
    s, r = c("POST", "/auth/request", {"email": "spam@example.com"})
check("rate limit login", s == 429, r)

print(f"\n{ok} checks passed")
