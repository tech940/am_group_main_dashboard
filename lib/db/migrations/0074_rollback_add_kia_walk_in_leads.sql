-- Rollback of 0074. ⚠️ Drops every walk-in lead, including those captured by the form after go-live.
-- Export the section to Excel first.
DROP TABLE IF EXISTS public.kia_walk_in_leads;
