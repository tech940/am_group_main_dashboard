-- 0056_rollback_create_showroom_images.sql
-- Rollback showroom_images table

DROP INDEX IF EXISTS "idx_showroom_images_captured_at";
DROP INDEX IF EXISTS "idx_showroom_images_session";
DROP INDEX IF EXISTS "idx_showroom_images_brand_location";
DROP TABLE IF EXISTS "showroom_images";
