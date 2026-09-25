CREATE TYPE "public"."booking_status" AS ENUM('REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'teslapay');--> statement-breakpoint
CREATE TYPE "public"."ride_option" AS ENUM('pool', 'same_gender', 'solo');--> statement-breakpoint
CREATE TABLE "booking_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status" NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passenger_id" uuid NOT NULL,
	"pickup_lat" numeric(9, 6) NOT NULL,
	"pickup_lng" numeric(9, 6) NOT NULL,
	"pickup_label" text NOT NULL,
	"dest_lat" numeric(9, 6) NOT NULL,
	"dest_lng" numeric(9, 6) NOT NULL,
	"dest_label" text NOT NULL,
	"seats" integer NOT NULL,
	"ride_option" "ride_option" NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"direct_km" numeric(7, 3) NOT NULL,
	"distance_method" "distance_method" NOT NULL,
	"estimated_fare" numeric(10, 2) NOT NULL,
	"status" "booking_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "bookings_seats_range" CHECK ("bookings"."seats" BETWEEN 1 AND 6),
	CONSTRAINT "bookings_direct_km_positive" CHECK ("bookings"."direct_km" > 0),
	CONSTRAINT "bookings_cancelled_at" CHECK (("bookings"."status" = 'CANCELLED') = ("bookings"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_passenger_id_users_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_status_history_booking_id_idx" ON "booking_status_history" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_active_per_passenger" ON "bookings" USING btree ("passenger_id") WHERE "bookings"."status" NOT IN ('COMPLETED', 'CANCELLED');--> statement-breakpoint
-- Hand-written: drizzle-kit doesn't model triggers. History tables only grow (NFR-40);
-- phase 6 attaches the same function to the wallet ledger (NFR-39). TRUNCATE doesn't
-- fire row triggers, so tests can still reset the database.
CREATE FUNCTION "reject_update_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "booking_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "booking_status_history"
  FOR EACH ROW EXECUTE FUNCTION "reject_update_delete"();
