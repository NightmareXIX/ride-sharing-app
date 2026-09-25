CREATE TYPE "public"."wallet_transaction_type" AS ENUM('top_up', 'fare_payment', 'driver_credit', 'cash_earning', 'fine');--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "wallet_transactions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"wallet_id" uuid NOT NULL,
	"booking_id" uuid,
	"type" "wallet_transaction_type" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"balance_after" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transactions_seq_unique" UNIQUE("seq"),
	CONSTRAINT "wallet_transactions_amount_sign" CHECK (CASE WHEN "wallet_transactions"."type" IN ('fare_payment', 'fine') THEN "wallet_transactions"."amount" < 0 ELSE "wallet_transactions"."amount" > 0 END),
	CONSTRAINT "wallet_transactions_booking" CHECK (("wallet_transactions"."type" = 'top_up') = ("wallet_transactions"."booking_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_transactions_wallet_seq_idx" ON "wallet_transactions" USING btree ("wallet_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_one_per_booking_type" ON "wallet_transactions" USING btree ("booking_id","type") WHERE "wallet_transactions"."booking_id" IS NOT NULL;--> statement-breakpoint
-- Hand-written: drizzle-kit doesn't model triggers. The ledger only grows (NFR-39); a
-- mistake is fixed by adding a correcting entry. reject_update_delete() comes from 0005.
CREATE TRIGGER "wallet_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION "reject_update_delete"();
