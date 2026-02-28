import { createClient } from "npm:@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "https://gyooxmpyxncrezjiljrj.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (hidden, need real key)";
// The key is in the env but I'll grab it from the secrets list outputs manually
