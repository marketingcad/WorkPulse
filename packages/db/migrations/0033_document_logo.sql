-- The logo printed on invoices and pay stubs (uncropped). Re-runnable, like every migration here.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "document_logo" text;
