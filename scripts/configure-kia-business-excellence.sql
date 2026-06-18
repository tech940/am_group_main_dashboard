INSERT INTO dashboard_settings (key, value, category, description)
VALUES (
  'kiaBusinessExcellenceHolidays',
  '["2026-06-05"]'::jsonb,
  'general',
  'Dates excluded from completed working-day KPIs in AM KIA Business Excellence.'
)
ON CONFLICT (key) DO NOTHING;
