# Zalo bridge

A small daemon for an always-on machine - a mini PC, a spare phone, or a small VPS -
running Node, that keeps the business's Zalo account connected to Hausto. It
does two things:

- **Sends what was approved.** When an operator (or the AI operator, once its
  gate allows) approves a message to an agent, it waits in Hausto's outbox. The
  device claims it, sends it from the Zalo account, and reports back. Only then
  does Hausto's log say the agent was contacted.
- **Forwards what agents say.** Replies from agents Hausto is talking to are
  sent to Hausto, where the AI operator reads them and proposes (or, behind its
  gate, records) the outcome.

This is stage 3 of the AI operator plan. The owner chose it on 2026-09-27.

## The risk, stated once

This automates a personal Zalo account through **zca-js**, an unofficial,
reverse-engineered client. Zalo's terms do not allow that, and an account
caught doing it can be restricted or banned - and it is the business's only
line to agents. That risk was accepted knowingly. Nothing here tries to hide
the automation from Zalo. The limits below exist to cap the damage a mistake
can do, not to look human.

## What it will and will not do

- It only forwards messages from numbers on Hausto's **watch list**: agents on
  requests from the last three weeks. Anything else on the account - friends,
  family, other clients - never leaves the device.
- It sends only what Hausto hands it, to the agent's own number. It has no
  way to message anyone else.
- At most `DAILY_CAP` messages per day (Ho Chi Minh City time, default 60),
  with at least `MIN_GAP_MS` between two (default 20 s). The count survives a
  restart.
- Each message is sent once. The device journals every send to
  `journal.jsonl` before acknowledging it, so a crash between the two acks the
  message on restart instead of sending it again.
- **Pause sending** on the console's AI operator screen stops the outbox
  within one poll. The device keeps forwarding replies while paused.

## Where to run it

Any always-on Linux machine with Node 22.7 or newer: a mini PC, a spare
phone, or a small VPS. It needs very little - 1 vCPU and 1 GB of RAM is
plenty - but it needs a persistent disk, because `journal.jsonl` is what stops
a message being sent twice.

Two things decide where:

- **Close to where the account is normally used.** Zalo challenges or signs
  out sessions that appear from an unfamiliar country, and a challenged
  session stops the bridge until someone exports fresh credentials. A machine
  in Vietnam is best; Singapore is the next closest, and is where Hausto's
  Supabase project already runs (`ap-southeast-1`).
- **A private disk.** `credentials.json` is a login to the business's Zalo
  account. Use SSH keys only, no shared users, and a provider you would trust
  with that login.

## Deploying to a VPS

Everything after "create the server" is scripted (`deploy/`).

1. **Create the server** in the provider's console: Ubuntu 24.04, 1 vCPU,
   1 GB RAM, a Vietnam or Singapore location.
   - SSH key: paste the public key (`~/.ssh/hausto_bridge_ed25519.pub` on the
     machine this repo was set up from).
   - User data / cloud-init: paste `deploy/cloud-init.yaml`. It installs Node
     22, creates the `hausto` service user and its directories, allows SSH in
     and nothing else, and turns on automatic security updates. Give it a
     couple of minutes after the server boots.
2. **Deploy** from the repo:

   ```bash
   bash bridge/deploy/deploy.sh root@SERVER_IP -i ~/.ssh/hausto_bridge_ed25519
   ```

   The first run prints a **ZALO_BRIDGE_TOKEN** it generated on the server.
   Set it as that edge-function secret in the Supabase dashboard. It is shown
   once and stored only in `/opt/hausto-bridge/.env` on the server.
3. **Put the Zalo login on the server** (see "The Zalo session" below), then
   run the same deploy command again. It starts the service this time.
4. **Watch it come up:**
   `ssh -i ~/.ssh/hausto_bridge_ed25519 root@SERVER_IP 'journalctl -u hausto-zalo-bridge -f'`,
   and check the console's AI operator screen shows the device online. Then
   do the first-run check below, then switch Hausto over.

Updates are the same deploy command: it replaces the code, keeps `.env`, the
Zalo login and the journal, and restarts the service.

On the server:

| Path | |
|---|---|
| `/opt/hausto-bridge/app` | The code. Replaced on every deploy. |
| `/opt/hausto-bridge/.env` | Token and settings. Created once, never overwritten. |
| `/opt/hausto-bridge/state/credentials.json` | The Zalo login. Yours to put there. |
| `/opt/hausto-bridge/state/journal.jsonl` | The send journal. Do not delete it. |

The service runs as `hausto` with a read-only system, writing only to `state/`
(`deploy/hausto-zalo-bridge.service`). If zca-js turns out to need to write
elsewhere, the logs will say `EROFS`; add that path to `ReadWritePaths`.

## Setup by hand

The steps below are what the deploy scripts do, for a machine set up without
them. Node 22.7 or newer.

```bash
cd bridge
npm install
```

### 1. The token

Generate a long random secret (at least 32 characters), for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set it as the **`ZALO_BRIDGE_TOKEN`** edge-function secret in the Supabase
dashboard (`https://supabase.com/dashboard/project/gbgrwjdmytaksrztcyzs/settings/functions`),
and give the device the same value. Set secrets in the dashboard, not from a
shell - see CLAUDE.md. Check it landed with
`npx supabase secrets list --project-ref gbgrwjdmytaksrztcyzs`: its digest must
not be `e3b0c442...`, the digest of an empty string.

### 2. The Zalo session

zca-js logs in with the session of a browser already signed in to
`chat.zalo.me` as the business account. Follow zca-js's own login guide for the
installed version to export the three values it needs - the **cookie**, the
**imei**, and the **userAgent** - and save them as `credentials.json` next to
this README:

```json
{ "cookie": [ ... ], "imei": "...", "userAgent": "..." }
```

`credentials.json` is a login to the business's Zalo account. It is in
`.gitignore`; keep it on the device only, readable by the user the daemon runs
as.

### 3. Run it

```bash
ZALO_BRIDGE_TOKEN=... DEVICE_LABEL=office-mini-pc npm start
```

| Variable | Default | |
|---|---|---|
| `ZALO_BRIDGE_TOKEN` | required | Same value as the Supabase secret. |
| `HAUSTO_BRIDGE_URL` | the production `zalo-bridge` function | |
| `ZALO_CREDENTIALS_FILE` | `./credentials.json` | |
| `JOURNAL_FILE` | `./journal.jsonl` | Keep it; it is what stops double sends. |
| `DEVICE_LABEL` | `zalo-bridge` | Shown on the console. |
| `DAILY_CAP` | `60` | Messages per day. |
| `MIN_GAP_MS` | `20000` | Between two sends. |
| `POLL_MS` | `30000` | How often it checks in. |

Run it under a supervisor that restarts it - systemd on a mini PC, for
example:

```ini
[Service]
WorkingDirectory=/opt/hausto/bridge
EnvironmentFile=/opt/hausto/bridge/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=30
```

After ten failed passes in a row it exits, so the supervisor starts it with a
fresh Zalo session rather than looping on a broken one.

### 4. Switch Hausto over

Only once the device shows **online** on the console's AI operator screen, set
the **`REALTOR_CHANNEL`** edge-function secret to `bridge`. From then on,
approving a message to an agent queues it for the device instead of meaning "I
sent it by hand", and the console's buttons say so. Setting it back to
`manual` (or deleting it) returns to sending by hand; anything already queued
stays queued until the device sends it.

## First run

`src/zca-js.d.ts` describes the parts of zca-js the bridge uses, written from
the library's documentation - **nothing in the Hausto repo installs or runs
zca-js**. On the device's first run, check it against the installed version
(`node_modules/zca-js`): the login call, `findUser`, `sendMessage` and the
message listener's shape. Anything that differs is fixed in
`src/zalo-zca.ts`, which is the only file that touches the library.

Then send one message to a number you control that is set up as an agent on a
test request, and confirm on the console that it shows as sent, that
"contacted" appears on the item, and that a reply from that number arrives in
the agent conversation.
