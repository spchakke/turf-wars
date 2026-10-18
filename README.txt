TURF WARS

Static cricket scoring app for GitHub Pages. No build step or npm dependencies.

FILES TO DEPLOY
- index.html: home
- scorer.html: match setup and scoring
- live.html: spectator scoreboard (live.html?id=MATCH_ID)
- history.html: public match list
- theme.css: shared visual styling
- firebase-client.js: shared Firebase initialization
- boundary-effects.js: four/six animations and spectator event detection
Keep all seven files together at the repository root. Do not deploy only index.html.
scorer-backup.html is a legacy local-only scorer and is not linked by the app.

LOCAL PREVIEW
  python3 -m http.server 8765 --bind 127.0.0.1
Open http://127.0.0.1:8765/ in your browser. Use HTTP rather than opening HTML
files directly, because JavaScript modules require a web server.

CHECKS
  node --test tests/*.test.cjs
  git diff --check
Tests use isolated Firebase and DOM substitutes; they do not contact production.

SCORING
Run buttons consume a legal ball. Wide/no-ball adds one run without a legal ball.
Wickets consume a legal ball. Regulation innings use ten wickets and the selected
overs limit. Team 1 bats first. End innings switches to the chase. Finish match is
available during the chase and confirms an early result based on recorded scores.
A tie offers a Super Over: six legal balls and two wickets per team. The previous
chasing team bats first. Further tied rounds offer another Super Over. Regulation
and earlier Super Over scores remain available. Undo reverses an action together
with its automatic transition. Up to 100 actions and their messages are retained.
This is a team-total scorer, without player statistics, dismissal types, combined
no-ball/bat runs, byes/leg-byes, or configurable team size.

DATA AND RECOVERY
The current match and Undo stack are stored under turfWarsScorerV3 in localStorage.
Four/six overlays appear for new boundaries; old deliveries do not animate on
initial spectator load. Reduced motion uses a small static notification.
All deliveries are retained for matches scored with this version. Previously
truncated deliveries cannot be recovered. Download match backup exports a JSON
copy; automatic backup import is not implemented. Another tab changing browser
storage locks scoring until reload. This is best-effort local conflict protection,
not a cross-device scoring lock. Do not score the same match from multiple devices.

Anonymous Firebase Authentication identifies the scorer. Each save atomically
updates matches/ID and history/ID. Both contain the score and result; history is a
current snapshot, not an immutable audit log. updatedAt uses Firebase server time.
Spectators subscribe to matches/ID; history loads the newest 50 push IDs initially,
with older batches available. Search/filter apply to loaded matches. Older matches
that were recently updated can appear after loading more; loaded records sort by
update time. A finished match restored on another page load retains its result.
Offline score changes remain in browser storage and sync after reconnect/sign-in.
If browser storage fails, keep the page open and download a JSON backup.

FIREBASE / DEPLOYMENT VALIDATION
The existing project settings and SDK version are preserved in firebase-client.js.
Anonymous sign-in and suitable Realtime Database rules must already be deployed.
Client ownership checks and public flags are not substitutes for server rules.
Deployed rules are not included here and have not been verified or changed.
Before deployment, verify owner-only writes, immutable ownership, score validation,
public match reads and bounded public history queries in a non-production project.
Never make rules broadly writable to resolve an error. Atomic saves also require
both destination writes to be authorized; if either fails, neither is committed.

SMOKE TEST AFTER DEPLOYMENT
1. Start a match with two distinct names; score runs, extras, wickets and Undo.
2. End first innings; verify target, remaining balls and first-innings summary.
3. Finish by target, final ball, and all-out; verify winner and exact margin.
4. Tie, start Super Over, tie again, then win; check Undo at each boundary.
5. Reload a tied/finished match and a Super Over in progress.
6. Open its spectator link and verify live updates, result and innings summaries.
7. Disconnect/reconnect; verify local continuity and final cloud score/history.
8. Open scorer in a second tab; verify the first tab asks for reload after changes.
9. Check history search/status/older batches and generic Live Score entry.
10. Check mobile and desktop layouts, keyboard focus and backup download.

GitHub Pages: deploy the root of the selected branch. Publish changes only after
review and the checks above. A passing isolated test suite does not guarantee
production permissions, network availability, mobile layout, or absence of bugs.
