export const migrations = [
  `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE players (
 id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER UNIQUE NOT NULL, nickname TEXT NOT NULL,
 steam_name TEXT, avatar_url TEXT, roles_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
 is_profile_private INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE teams (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tag TEXT NOT NULL DEFAULT '',
 color TEXT NOT NULL DEFAULT '#38bdf8', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE team_members (
 id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, slot INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(team_id, slot), UNIQUE(team_id, player_id)
);
CREATE TABLE heroes (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, localized_name TEXT NOT NULL, cn_name TEXT NOT NULL DEFAULT '',
 aliases_json TEXT NOT NULL DEFAULT '[]', primary_attr TEXT NOT NULL DEFAULT '', attack_type TEXT NOT NULL DEFAULT '',
 roles_json TEXT NOT NULL DEFAULT '[]', img TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE api_cache (cache_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE draft_sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '',
 our_side TEXT NOT NULL CHECK(our_side IN ('radiant','dire')) DEFAULT 'radiant',
 first_pick_side TEXT NOT NULL CHECK(first_pick_side IN ('radiant','dire')) DEFAULT 'radiant',
 radiant_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL, dire_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
 patch TEXT NOT NULL DEFAULT '7.42', cm_order_version TEXT NOT NULL DEFAULT '7.42-standard',
 status TEXT NOT NULL DEFAULT 'prep', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE draft_actions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES draft_sessions(id) ON DELETE CASCADE,
 step_index INTEGER NOT NULL CHECK(step_index BETWEEN 1 AND 24), phase INTEGER NOT NULL CHECK(phase BETWEEN 1 AND 3),
 action_type TEXT NOT NULL CHECK(action_type IN ('ban','pick')), side TEXT NOT NULL CHECK(side IN ('radiant','dire')),
 is_first_pick_team INTEGER NOT NULL CHECK(is_first_pick_team IN (0,1)), hero_id INTEGER REFERENCES heroes(id) ON DELETE SET NULL,
 assigned_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL, role_hint INTEGER CHECK(role_hint IS NULL OR role_hint BETWEEN 1 AND 5),
 created_at TEXT NOT NULL, UNIQUE(session_id,step_index)
);
CREATE TABLE matches (
 match_id INTEGER PRIMARY KEY, source TEXT NOT NULL DEFAULT 'tournament' CHECK(source IN ('tournament','pub')),
 tag TEXT NOT NULL DEFAULT '', patch TEXT, start_time INTEGER, duration INTEGER, radiant_win INTEGER,
 has_parsed INTEGER NOT NULL DEFAULT 0, raw_json TEXT, imported_at TEXT NOT NULL
);
CREATE TABLE match_players (
 id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
 player_slot INTEGER NOT NULL, account_id INTEGER, hero_id INTEGER NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('radiant','dire')), is_radiant INTEGER NOT NULL CHECK(is_radiant IN (0,1)),
 draft_order INTEGER, pick_order INTEGER, kills INTEGER DEFAULT 0, deaths INTEGER DEFAULT 0, assists INTEGER DEFAULT 0,
 gpm INTEGER DEFAULT 0, xpm INTEGER DEFAULT 0, lane INTEGER, lane_role INTEGER, items_json TEXT NOT NULL DEFAULT '[]',
 obs_log_json TEXT NOT NULL DEFAULT '[]', sen_log_json TEXT NOT NULL DEFAULT '[]', lane_pos_json TEXT NOT NULL DEFAULT '{}',
 UNIQUE(match_id,player_slot)
);
CREATE TABLE match_picks_bans (
 id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
 order_index INTEGER NOT NULL, is_pick INTEGER NOT NULL CHECK(is_pick IN (0,1)), hero_id INTEGER NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('radiant','dire')), is_first_pick_team INTEGER CHECK(is_first_pick_team IN (0,1)),
 UNIQUE(match_id,order_index)
);
CREATE TABLE hero_matchups (
 hero_id INTEGER NOT NULL, against_hero_id INTEGER NOT NULL, games_played INTEGER NOT NULL DEFAULT 0,
 wins INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(hero_id,against_hero_id)
);
`,
  `
ALTER TABLE match_players ADD COLUMN personaname TEXT;
ALTER TABLE match_players ADD COLUMN hero_damage INTEGER;
ALTER TABLE match_players ADD COLUMN tower_damage INTEGER;
ALTER TABLE match_players ADD COLUMN last_hits INTEGER;
ALTER TABLE matches ADD COLUMN radiant_name TEXT;
ALTER TABLE matches ADD COLUMN dire_name TEXT;
CREATE INDEX match_players_account ON match_players(account_id, match_id);
CREATE TABLE player_pub_heroes (
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, hero_id INTEGER NOT NULL,
 games INTEGER NOT NULL CHECK(games >= 0), wins INTEGER NOT NULL CHECK(wins BETWEEN 0 AND games),
 last_played INTEGER, with_games INTEGER NOT NULL, with_wins INTEGER NOT NULL,
 against_games INTEGER NOT NULL, against_wins INTEGER NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(player_id, hero_id)
);
CREATE TABLE player_pub_matches (
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, match_id INTEGER NOT NULL,
 hero_id INTEGER NOT NULL, player_slot INTEGER NOT NULL CHECK(player_slot BETWEEN 0 AND 255),
 side TEXT NOT NULL CHECK(side IN ('radiant','dire')), is_radiant INTEGER NOT NULL CHECK(is_radiant IN (0,1)),
 win INTEGER NOT NULL CHECK(win IN (0,1)), start_time INTEGER NOT NULL, duration INTEGER,
 kills INTEGER, deaths INTEGER, assists INTEGER, gpm INTEGER, xpm INTEGER, lane INTEGER,
 lane_role INTEGER, game_mode INTEGER, lobby_type INTEGER, party_size INTEGER,
 PRIMARY KEY(player_id, match_id),
 CHECK(is_radiant = (player_slot < 128) AND is_radiant = (side = 'radiant'))
);
CREATE INDEX pub_player_time ON player_pub_matches(player_id, start_time DESC);
`,
  `
ALTER TABLE draft_sessions ADD COLUMN radiant_players_json TEXT NOT NULL DEFAULT '[null,null,null,null,null]';
ALTER TABLE draft_sessions ADD COLUMN dire_players_json TEXT NOT NULL DEFAULT '[null,null,null,null,null]';
ALTER TABLE draft_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE INDEX matchup_opponent ON hero_matchups(against_hero_id,hero_id);
CREATE TRIGGER clear_draft_slot AFTER DELETE ON players BEGIN
  UPDATE draft_sessions SET radiant_players_json=json_set(radiant_players_json,
    (SELECT fullkey FROM json_each(radiant_players_json) WHERE value=OLD.id),NULL), revision=revision+1
    WHERE EXISTS(SELECT 1 FROM json_each(radiant_players_json) WHERE value=OLD.id);
  UPDATE draft_sessions SET dire_players_json=json_set(dire_players_json,
    (SELECT fullkey FROM json_each(dire_players_json) WHERE value=OLD.id),NULL), revision=revision+1
    WHERE EXISTS(SELECT 1 FROM json_each(dire_players_json) WHERE value=OLD.id);
END;
`,
  `
CREATE TABLE patch_matchups (hero_id INTEGER NOT NULL REFERENCES heroes(id),against_hero_id INTEGER NOT NULL REFERENCES heroes(id),
 games_played INTEGER NOT NULL,wins INTEGER NOT NULL,PRIMARY KEY(hero_id,against_hero_id));
CREATE INDEX patch_matchups_opponent ON patch_matchups(against_hero_id,hero_id);
CREATE TABLE hero_meta (hero_id INTEGER PRIMARY KEY REFERENCES heroes(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE items (id INTEGER PRIMARY KEY, key TEXT NOT NULL, cnName TEXT NOT NULL, localizedName TEXT NOT NULL, imgUrl TEXT NOT NULL);
ALTER TABLE draft_sessions RENAME COLUMN patch TO previous_patch;
ALTER TABLE draft_sessions RENAME COLUMN cm_order_version TO previous_order;
ALTER TABLE draft_sessions ADD COLUMN patch TEXT NOT NULL DEFAULT '7.42';
ALTER TABLE draft_sessions ADD COLUMN cm_order_version TEXT NOT NULL DEFAULT '7.42-standard';
UPDATE draft_sessions SET patch=previous_patch WHERE previous_patch NOT LIKE '%x';
UPDATE draft_sessions SET cm_order_version='classic' WHERE EXISTS(SELECT 1 FROM draft_actions WHERE session_id=draft_sessions.id);
ALTER TABLE draft_sessions DROP COLUMN previous_patch;
ALTER TABLE draft_sessions DROP COLUMN previous_order;
`,
  `
ALTER TABLE player_pub_matches ADD COLUMN patch INTEGER;
ALTER TABLE player_pub_heroes ADD COLUMN patch_games INTEGER NOT NULL DEFAULT 0 CHECK(patch_games >= 0);
ALTER TABLE player_pub_heroes ADD COLUMN patch_wins INTEGER NOT NULL DEFAULT 0 CHECK(patch_wins BETWEEN 0 AND patch_games);
`,
];
