CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY,
	"status" text DEFAULT 'new' NOT NULL,
	"name" text,
	"whatsapp" text,
	"interest" text,
	"dob" text,
	"ethnicity" text,
	"consent" boolean DEFAULT false NOT NULL,
	"package" text,
	"language" text DEFAULT 'en' NOT NULL,
	"amount_cents" integer,
	"currency" text,
	"customer_email" text,
	"stripe_session_id" text UNIQUE,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"fbclid" text,
	"landing_url" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checkout_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" ("created_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" ("status");