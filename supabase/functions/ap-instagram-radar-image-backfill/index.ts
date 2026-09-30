import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createInstagramRadarImageBackfillHandler } from "./handler.ts";

Deno.serve(createInstagramRadarImageBackfillHandler());
