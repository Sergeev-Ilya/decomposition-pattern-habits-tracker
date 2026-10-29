CREATE TABLE habit_owners (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES habit_owners(id),
  name varchar(120) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)),
  description varchar(2000) NOT NULL DEFAULT '' CHECK (description = btrim(description)),
  start_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX habits_user_created_idx ON habits(user_id,created_at,id);
CREATE TABLE completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  completed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT completions_habit_date_key UNIQUE(habit_id,completed_on)
);
