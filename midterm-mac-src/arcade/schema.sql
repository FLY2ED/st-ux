-- 간판 오락실 D1 스키마. `wrangler d1 execute st-arcade --remote --file schema.sql` 로 넣는다
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  -- 다른 기기에서 이어 하기용 암호(PBKDF2). 암호 없이 만든 이름은 비어 있다
  pass_hash TEXT,
  pass_salt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS players_name ON players (name COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS players_token ON players (token_hash);

-- 암호로 들어온 다른 기기의 출입증. 처음 기기의 출입증은 players.token_hash 에 그대로 둔다
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player);

-- 이름마다 틀린 암호 횟수. 5번 틀리면 10분 동안 막는다
CREATE TABLE IF NOT EXISTS login_fails (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  n INTEGER NOT NULL,
  until INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  player TEXT NOT NULL,
  game TEXT NOT NULL,
  score INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (player, game)
);
CREATE INDEX IF NOT EXISTS scores_board ON scores (game, score DESC);

CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  game TEXT NOT NULL,
  score INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_recent ON plays (player, game, at DESC);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  day TEXT NOT NULL,
  round INTEGER NOT NULL,
  cards TEXT NOT NULL,
  rank TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tickets_day ON tickets (day, rank);
CREATE INDEX IF NOT EXISTS tickets_player ON tickets (player, day);

CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  name TEXT NOT NULL,
  cat TEXT NOT NULL,
  emoji TEXT NOT NULL,
  lng REAL NOT NULL,
  lat REAL NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shops_recent ON shops (at DESC);

-- 간판 거리(2D) 같이 하기: 누가 어떤 간판을 담았는지, 간판 쪽지, 오늘 다녀간 사람
-- key = "<경도×1e5>_<위도×1e5>|<상호>", tile = 0.01° 조각(간판 자료 조각과 같다)
CREATE TABLE IF NOT EXISTS street_finds (
  player TEXT NOT NULL,
  key TEXT NOT NULL,
  tile TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (player, key)
);
CREATE INDEX IF NOT EXISTS street_finds_tile ON street_finds (tile, player);
CREATE INDEX IF NOT EXISTS street_finds_key ON street_finds (key);

CREATE TABLE IF NOT EXISTS street_signs (
  key TEXT PRIMARY KEY,
  tile TEXT NOT NULL,
  n INTEGER NOT NULL,
  first TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS street_signs_tile ON street_signs (tile);

CREATE TABLE IF NOT EXISTS street_notes (
  key TEXT PRIMARY KEY,
  tile TEXT NOT NULL,
  player TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS street_notes_tile ON street_notes (tile);
CREATE INDEX IF NOT EXISTS street_notes_player ON street_notes (player, at DESC);

CREATE TABLE IF NOT EXISTS street_days (
  tile TEXT NOT NULL,
  day TEXT NOT NULL,
  player TEXT NOT NULL,
  PRIMARY KEY (tile, day, player)
);
