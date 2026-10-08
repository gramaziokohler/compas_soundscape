# Multi-user load test

`run.py` simulates N concurrent users (default 20) against a running deployment. Each virtual
user (`vu-01` … `vu-20`) has **its own identity and workspace** and does the following, all at the
same time:

1. **Page load:** `GET /`, then the `/_next/static/*` JS/CSS chunks, then the bootstrap burst
   (`/api/me`, `/api/workspaces`, `/api/me/preferences`, `/api/versions`, `/api/tokens`, `/api/jobs`).
2. **Presence heartbeat:** every 25 s.
3. **Browsing:** materials, IRs, TTS dialects and library search, with a 2–5 s pause between requests.
4. **Soundscape persistence:** a save/load round-trip on `loadtest-vu-NN` every ~15 s, with
   optimistic-concurrency revisions.
5. **Jobs**, started at random times in the first half of the run:
   - pyroomacoustics box-room simulations (CPU queue);
   - text-to-audio generations (SA3/GPU queue, ≤ 3 per user);
   - LLM SSE streams (`/api/generate-prompts-stream`).

It then runs these checks:
- every user got a **distinct workspace**;
- users resolved to `loadtest-*` identities;
- `GET /api/jobs` never shows another user's jobs;
- there were no 5xx or transport errors;
- every job completed.

It prints p50/p95/p99 latency per endpoint, job timings and peak queue depths, and writes
`results/<timestamp>.json` plus a per-request CSV.

## One-time setup for soundisblue.com (behind Cloudflare Access)

1. **Create a service token.** In Cloudflare Zero Trust, go to *Access → Service credentials →
   Service Tokens → Create*. Copy the **Client ID** and **Client Secret**.
2. **Allow it through Access.** Open the soundisblue.com Access application and add a policy with
   **Action: Service Auth** and **Include: Service Token = <that token>**.
3. **Allow it in the backend.** On the server, add the token's Client ID to the backend env (`.env`):
   ```
   LOADTEST_SERVICE_TOKEN_IDS=<client id>
   ```
   Restart the backend. The Client ID ends in `.access`; paste all of it, since it must match the JWT `common_name`.
4. **On your machine (PowerShell)**, set the credentials as environment variables only, never in a file:
   ```powershell
   $env:CF_ACCESS_CLIENT_ID="<client id>"
   $env:CF_ACCESS_CLIENT_SECRET="<client secret>"
   ```

## Run

```powershell
mamba activate compas-toy        # needs httpx (already in requirements)

# 1. Smoke test: 1 user, no GPU/LLM. Should print "Preflight OK: vu-01 resolves to loadtest-vu-01@loadtest.local"
python scripts/loadtest/run.py --users 1 --duration 30 --sounds 0 --llm 0

# 2. Full test: 20 users arriving over 60 s, each active for 10 min
python scripts/loadtest/run.py --users 20 --ramp 60 --duration 600

# Options
#   --base-url http://localhost:8000   local backend (no token needed; users become anonymous workspaces)
#   --pyroom N --sounds N --llm N       total jobs of each kind (defaults 20 / 5 / 5)
#   --audio-model tangoflux             override the server's default text-to-audio model
```

Exit code `0` means every blocking check passed, `1` means a check failed, and `2` means the
preflight failed (usually a Cloudflare or token problem).

A `[WARN] job fetch-by-id isolation` result means `GET /api/jobs/{id}` is not scoped to the
session. Anyone who has a job id can read that job's status. Job ids are random UUIDs, so this is
informational, not a test failure.

## Clean up afterwards

- **Turn the bypass off:** unset `LOADTEST_SERVICE_TOKEN_IDS` and restart the backend, or revoke
  the service token in Cloudflare.
- **Remove the synthetic users** on the server, with the backend stopped:
  ```powershell
  python scripts/loadtest/cleanup_db.py                  # dry run: lists users, workspaces and folders
  python scripts/loadtest/cleanup_db.py --apply --files  # delete DB rows and workspace folders
  ```
