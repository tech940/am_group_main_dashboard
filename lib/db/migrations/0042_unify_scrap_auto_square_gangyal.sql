-- Unify scrap location names for Auto Square Gangyal
-- Merges 'AM HYUNDAI AUTO SQUARE GANGYAL', 'AM HYUNDAI AUTO SQUARE- GANGYAL', etc. into 'AM HYUNDAI AUTO SQUARE - GANGYAL'

UPDATE public.scrap_transactions
SET location_name = 'AM HYUNDAI AUTO SQUARE - GANGYAL'
WHERE location_name ILIKE '%AUTO SQUARE%GANGYAL%'
   OR location_name ILIKE '%AUTO SQUARE%-%GANGYAL%'
   OR location_name ILIKE 'AM HYUNDAI AUTO SQUARE GANGYAL';
