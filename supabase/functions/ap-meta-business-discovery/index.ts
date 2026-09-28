import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createMetaBusinessDiscoveryHandler } from "./handler.ts";

Deno.serve(createMetaBusinessDiscoveryHandler());
