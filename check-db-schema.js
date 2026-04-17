// Check actual database schema
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mppgpfpjwzzezppuvtnv.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcGdwZnBqd3p6ZXpwcHV2dG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NjQ2MzQsImV4cCI6MjA4OTI0MDYzNH0.DR4dWRdTMmjqd-T1ItFr2kCB_80NgSzcNIXt1q0qNr4";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkSchema() {
  console.log("🔍 Checking actual database schema...\n");

  try {
    // Check users table structure
    console.log("👥 Users table:");
    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select("*")
      .limit(1);

    if (usersError) {
      console.log("❌ Error:", usersError.message);
    } else {
      console.log("✅ Accessible");
      if (usersData && usersData.length > 0) {
        console.log("   Sample columns:", Object.keys(usersData[0]));
      } else {
        console.log("   Table is empty - will try to insert minimal record");
      }
    }

    // Check sessions table structure
    console.log("\n📅 Sessions table:");
    const { data: sessionsData, error: sessionsError } = await supabase
      .from("sessions")
      .select("*")
      .limit(1);

    if (sessionsError) {
      console.log("❌ Error:", sessionsError.message);
    } else {
      console.log("✅ Accessible");
      if (sessionsData && sessionsData.length > 0) {
        console.log("   Sample columns:", Object.keys(sessionsData[0]));
      } else {
        console.log("   Table is empty");
      }
    }

    // Check attendance table structure
    console.log("\n📊 Attendance table:");
    const { data: attendanceData, error: attendanceError } = await supabase
      .from("attendance")
      .select("*")
      .limit(1);

    if (attendanceError) {
      console.log("❌ Error:", attendanceError.message);
    } else {
      console.log("✅ Accessible");
      if (attendanceData && attendanceData.length > 0) {
        console.log("   Sample columns:", Object.keys(attendanceData[0]));
      } else {
        console.log("   Table is empty");
      }
    }

    // Try minimal insert to see what columns are required
    console.log("\n🧪 Testing minimal user insert...");
    const crypto = require("crypto");
    const testHash = crypto
      .createHash("sha256")
      .update("test123")
      .digest("hex");

    const { data: testUser, error: testError } = await supabase
      .from("users")
      .insert({
        id_number: "test-user",
        full_name: "Test User",
        role: "cadet",
        password_hash: testHash,
      })
      .select();

    if (testError) {
      console.log("❌ Minimal insert failed:", testError.message);
      console.log("   This tells us about required columns or RLS policies");
    } else {
      console.log("✅ Minimal insert successful");
      console.log("   Columns created:", Object.keys(testUser[0]));

      // Clean up test user
      await supabase.from("users").delete().eq("id_number", "test-user");
    }
  } catch (error) {
    console.error("❌ Schema check failed:", error.message);
  }
}

checkSchema();
