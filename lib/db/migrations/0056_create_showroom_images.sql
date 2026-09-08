-- 0056_create_showroom_images.sql
-- Create showroom_images table for multi-brand showroom photo capture and gallery

CREATE TABLE IF NOT EXISTS "showroom_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL,
  "brand" text NOT NULL,
  "location" text NOT NULL,
  "bucket_id" text NOT NULL,
  "storage_path" text NOT NULL,
  "file_size" integer,
  "width" integer,
  "height" integer,
  "mime_type" text DEFAULT 'image/webp',
  "uploader_name" text,
  "captured_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_showroom_images_brand_location" ON "showroom_images" ("brand", "location");
CREATE INDEX IF NOT EXISTS "idx_showroom_images_session" ON "showroom_images" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_showroom_images_captured_at" ON "showroom_images" ("captured_at" DESC);
