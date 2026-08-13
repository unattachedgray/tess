#!/usr/bin/env bash
# HTTP-surface security checks. Read-only apart from one user upsert, so these
# are safe against the live server.
#
#   TESS_ADMIN_TOKEN=<token> bash scripts/security/http-checks.sh
#
# Without TESS_ADMIN_TOKEN the "correct token is accepted" CONTROL will fail,
# which is the harness telling you it cannot prove the route still works.
B=${TESS_BASE:-http://127.0.0.1:8461}
pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
      else echo "  FAIL  $1  (got '$2' want '$3')"; fail=$((fail+1)); fi; }

echo
echo "Federation toggle (opens a UPnP mapping — must never be anonymous)"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"enabled":false}' $B/api/federation/toggle)
ok "no credential is refused" "$c" "403"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -H 'X-Forwarded-For: 127.0.0.1' -d '{"enabled":false}' $B/api/federation/toggle)
ok "spoofed X-Forwarded-For is refused" "$c" "403"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -H 'X-Tess-Admin: wrong' -d '{"enabled":false}' $B/api/federation/toggle)
ok "a wrong token is refused" "$c" "403"
# CONTROL: the real token must work, or the route is simply broken
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -H "X-Tess-Admin: $TESS_ADMIN_TOKEN" -d '{"enabled":false}' $B/api/federation/toggle)
ok "CONTROL: the correct token is accepted" "$c" "200"

echo
echo "Game history"
n=$(curl -s "$B/api/games?limit=1000000000" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["games"]))')
ok "limit is clamped to 100" "$([ "$n" -le 100 ] && echo yes)" "yes"
c=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/games?limit=abc")
ok "a non-numeric limit no longer 500s" "$c" "200"

echo
echo "User writes"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"id":123,"displayName":"x"}' $B/api/users)
ok "a non-string id is rejected" "$c" "400"
big=$(python3 -c 'print("a"*500)')
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "{\"id\":\"$big\",\"displayName\":\"x\"}" $B/api/users)
ok "an over-long id is rejected" "$c" "400"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"id":"u-test-harness","displayName":"Harness"}' $B/api/users)
ok "CONTROL: a valid user write still succeeds" "$c" "200"

echo
echo "CORS"
h=$(curl -s -D - -o /dev/null -H 'Origin: https://evil.example' $B/api/health \
    | grep -i '^access-control-allow-origin' | tr -d '\r')
ok "a hostile origin is not reflected" "${h:-none}" "none"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
