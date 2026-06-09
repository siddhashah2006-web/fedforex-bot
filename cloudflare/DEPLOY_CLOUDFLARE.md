# Deploy Fed Forex alerts to Cloudflare (free, 24/7, no PC needed)

All steps are in the **web dashboard** — no command line. ~15 minutes, one time.

## 1. Create a free Cloudflare account
Go to https://dash.cloudflare.com/sign-up — sign up (free, no card).

## 2. Create the KV storage (for de-dup state)
- Left sidebar → **Storage & Databases → KV** → **Create a namespace**.
- Name it `FF_STATE` → Add.

## 3. Create the Worker
- Left sidebar → **Compute (Workers) → Workers & Pages** → **Create** → **Create Worker**.
- Name it `fedforex-alerts` → **Deploy** (it makes a hello-world first).
- Click **Edit code** → delete everything → paste the entire contents of **`worker.js`** (in this folder) → **Deploy**.

## 4. Bind the KV namespace
- In the worker → **Settings → Bindings → Add → KV namespace**.
- Variable name: **`STATE`**  ·  KV namespace: **`FF_STATE`** → Save/Deploy.

## 5. Add the secrets & variables
In the worker → **Settings → Variables and Secrets → Add**:
| Name | Type | Value |
|---|---|---|
| `TG_TOKEN` | Secret | your bot token (from `telegram.json` → botToken) |
| `TG_CHAT` | Secret | `5945486829` |
| `SUPABASE_KEY` | Secret | the anon key (from `.env` → REACT_APP_SUPABASE_ANON_KEY) |
| `SUPABASE_URL` | Text | `https://hcavvfmunwjxxkwsmmaw.supabase.co` |
Deploy.

## 6. Add the cron schedules
In the worker → **Settings → Triggers → Cron Triggers → Add Cron Trigger**. Add these **four** (times are UTC; they map to your IST):
| Cron (UTC) | What it does | IST time |
|---|---|---|
| `*/5 * * * *` | Liquidity levels + HTF POIs | every 5 min (self-limits to 06:00–22:00 IST) |
| `43 5 * * *` | Continuation scan (London) | 11:13 |
| `27 10 * * *` | Continuation scan (NY-AM) | 15:57 |
| `47 7,15,20 * * *` | Supabase new-trade sync | 13:17 / 21:17 / 02:17 |
Deploy.

## 7. Test it
- Open your worker URL (shown at the top, like `https://fedforex-alerts.<you>.workers.dev`) with `?run=levels` appended:
  `https://fedforex-alerts.<you>.workers.dev/?run=levels`
- You should get a Telegram message within a few seconds. (`?run=scan` and `?run=sync` also work.)

## 8. Turn OFF the office-PC version (so you don't get doubles)
Once Telegram is arriving from Cloudflare, disable the Windows tasks. In PowerShell on the PC:
```
Get-ScheduledTask FedForex_* | Disable-ScheduledTask
```
(Re-enable later with `Enable-ScheduledTask` if you ever want them back.)

---
**That's it — it now runs forever in Cloudflare's cloud, free, with nothing of yours powered on.**
Notes: data is ~15-min delayed (Yahoo). If any run errors, the worker Telegrams you "⚠️ worker error". KV free tier (100k reads / 1k writes a day) is far more than this uses.
