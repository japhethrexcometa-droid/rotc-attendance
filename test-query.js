const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  const { data, error } = await supabase
      .from("attendance")
      .select("id, status, scan_time, cadet_id, users!inner(full_name, id_number, platoon)")
      .limit(1);
  console.log("Error:", error?.message);
  console.log("Data:", data);
}
test();
