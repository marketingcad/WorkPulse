CREATE TABLE "member_details" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"birth_date" text,
	"personal_email" text,
	"phone" text,
	"country" text,
	"region" text,
	"city" text,
	"postal_code" text,
	"address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"education" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "brief" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "document_language" text;--> statement-breakpoint
ALTER TABLE "worker_profiles" ADD COLUMN "end_date" text;--> statement-breakpoint
ALTER TABLE "member_details" ADD CONSTRAINT "member_details_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;