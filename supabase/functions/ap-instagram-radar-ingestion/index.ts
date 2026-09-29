import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createInstagramRadarIngestionHandler } from "./worker.ts";

Deno.serve(createInstagramRadarIngestionHandler());
