# WhitelistSeeding (SquadJS Plugin)

Reports online player data to the Squad Whitelist Manager every interval tick. Players who accumulate enough seeding minutes automatically receive a temporary reserved slot. Optionally warns players with their seeding progress on join.

## What it does

- Every 60 seconds, sends all online players to the Whitelist Manager's seeding report endpoint
- The server decides whether to award points based on player count (configured in the admin panel under **Seeding Config**)
- The Whitelist Manager tracks minutes, awards whitelist slots when thresholds are met, and handles expiry
- On `PLAYER_CONNECTED`, queries the player's seeding progress and sends an `AdminWarn` with their status

## Requirements

- SquadJS with RCON working
- A running instance of Squad Whitelist Manager
- The seeding API key from the Whitelist Manager's **API** page

## Installation

1. Copy `whitelist-seeding.js` into your SquadJS plugins directory:
   ```
   SquadJS/squad-server/plugins/
   ```
2. Add the plugin to your SquadJS `config.json`
3. Restart SquadJS

## Configuration

| Option | Type | Required | Default | Description |
|---|---|:---:|---|---|
| `apiUrl` | `string` | Yes | `http://localhost:3000/seeding/report` | Base URL to the seeding report endpoint (without the API key) |
| `apiKey` | `string` | Yes | `''` | API key for both the report and progress endpoints, matching the one configured in the Whitelist Manager |
| `progressUrl` | `string` | No | `''` | Base URL for the progress endpoint. If empty, derived from `apiUrl` by replacing `/report` with `/progress` |
| `showProgressOnJoin` | `boolean` | No | `true` | Warn players with their seeding progress when they connect |

### Example config

```json
{
  "plugin": "WhitelistSeeding",
  "enabled": true,
  "apiUrl": "http://your-whitelist-host:36419/seeding/report",
  "apiKey": "abc123",
  "showProgressOnJoin": true
}
```

## How it works

1. The plugin runs on a fixed 60-second timer (1 tick = 1 minute of seeding credit)
2. Each tick, it POSTs all online players to `{apiUrl}/{apiKey}`
3. The Whitelist Manager checks the player count against its min/max config and awards points if within range
5. When a player reaches the configured threshold, they get a temporary whitelist slot and their points reset
6. On player connect, the plugin queries `{progressUrl}/{apiKey}/{steamId}` and sends an RCON warn with their progress or active reward status

## Endpoints used

| Method | URL | Purpose |
|---|---|---|
| `POST` | `{apiUrl}/{apiKey}` | Report online players for point tracking |
| `GET` | `{progressUrl}/{apiKey}/{steamId}` | Query a player's seeding progress |

Both endpoints and the API key are configured in the Whitelist Manager admin panel under **API**.
