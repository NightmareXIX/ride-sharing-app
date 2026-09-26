CREATE TABLE "route_path_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_lat" numeric(9, 6) NOT NULL,
	"origin_lng" numeric(9, 6) NOT NULL,
	"dest_lat" numeric(9, 6) NOT NULL,
	"dest_lng" numeric(9, 6) NOT NULL,
	"polyline" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_path_cache_pair" UNIQUE("origin_lat","origin_lng","dest_lat","dest_lng")
);
