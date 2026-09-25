CREATE TABLE "digest_sends" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"digest_date" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_sends_membership_id_digest_date_pk" PRIMARY KEY("membership_id","digest_date")
);
