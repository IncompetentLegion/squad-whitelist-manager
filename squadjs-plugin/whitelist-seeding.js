import BasePlugin from './base-plugin.js';

export default class WhitelistSeeding extends BasePlugin {
  static get description() {
    return 'Reports seeding player data to the Whitelist Manager for point tracking and rewards.';
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      apiUrl: {
        required: true,
        description: 'Full URL to the seeding report endpoint (e.g. http://localhost:3000/seeding/report)',
        default: 'http://localhost:3000/seeding/report'
      },
      progressUrl: {
        required: false,
        description: 'Base URL for the seeding progress endpoint (e.g. http://localhost:3000/seeding/progress). The API key and Steam ID are appended automatically.',
        default: ''
      },
      apiKey: {
        required: true,
        description: 'API key for both the report and progress endpoints, matching the one configured in the Whitelist Manager',
        default: ''
      },
      minPlayers: {
        required: false,
        description: 'Minimum player count to consider server as seeding',
        default: 2
      },
      maxPlayers: {
        required: false,
        description: 'Maximum player count — above this, seeding stops',
        default: 50
      },
      showProgressOnJoin: {
        required: false,
        description: 'Show seeding progress message when a player joins',
        default: true
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.interval = null;
    this.onPlayerConnected = this.onPlayerConnected.bind(this);
  }

  async mount() {
    if (this.options.showProgressOnJoin) {
      this.server.on('PLAYER_CONNECTED', this.onPlayerConnected);
    }

    this.interval = setInterval(async () => {
      try {
        const playerCount = this.server.a2sPlayerCount;
        if (playerCount < this.options.minPlayers || playerCount > this.options.maxPlayers) return;

        const players = this.server.players.map(p => ({
          steamId: p.steamID,
          name: p.name
        }));

        await fetch(`${this.options.apiUrl}/${this.options.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ players })
        });
      } catch (err) {
        this.verbose(1, `Seeding report error: ${err.message}`);
      }
    }, 60 * 1000);
  }

  async unmount() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.server.off) this.server.off('PLAYER_CONNECTED', this.onPlayerConnected);
    else this.server.removeListener('PLAYER_CONNECTED', this.onPlayerConnected);
  }

  async onPlayerConnected(info) {
    try {
      const steamId = info?.steamID || info?.player?.steamID;
      if (!steamId) return;

      const baseUrl = this.options.progressUrl || this.options.apiUrl.replace(/\/report$/, '/progress');
      const url = `${baseUrl}/${this.options.apiKey}/${steamId}`;

      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();

      let msg;
      if (data.has_reward) {
        msg = `Seeding reward ACTIVE (expires ${data.reward_expires_at.split(' ')[0]}). Lifetime points: ${data.lifetime_points}`;
      } else {
        msg = `Seeding progress: ${data.points}/${data.points_needed} points toward next reward. Lifetime: ${data.lifetime_points}`;
      }

      await this.server.rcon.execute(`AdminWarn ${steamId} ${msg}`);
    } catch (err) {
      this.verbose(1, `Seeding progress warn error: ${err.message}`);
    }
  }
}
