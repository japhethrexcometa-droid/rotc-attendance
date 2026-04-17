// Supabase Database Setup Script
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabaseUrl = "https://mppgpfpjwzzezppuvtnv.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcGdwZnBqd3p6ZXpwcHV2dG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NjQ2MzQsImV4cCI6MjA4OTI0MDYzNH0.DR4dWRdTMmjqd-T1ItFr2kCB_80NgSzcNIXt1q0qNr4";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function setupDatabase() {
  console.log("🚀 Setting up ROTC Attendance System Database...\n");

  try {
    // 1. Check existing schema
    console.log("📋 Checking database schema...");
    const { error: usersError } = await supabase
      .from("users")
      .select("count")
      .limit(1);
    const { error: sessionsError } = await supabase
      .from("sessions")
      .select("count")
      .limit(1);
    const { error: attendanceError } = await supabase
      .from("attendance")
      .select("count")
      .limit(1);

    console.log(`   Users table: ${usersError ? "❌ Missing" : "✅ Exists"}`);
    console.log(
      `   Sessions table: ${sessionsError ? "❌ Missing" : "✅ Exists"}`,
    );
    console.log(
      `   Attendance table: ${attendanceError ? "❌ Missing" : "✅ Exists"}`,
    );

    if (usersError || sessionsError || attendanceError) {
      console.log(
        "\n⚠️  Some tables are missing. Please run the database migrations first.",
      );
      console.log(
        "   You may need to set up the database schema in Supabase dashboard.",
      );
      return;
    }

    // 2. Create admin user
    console.log("\n👤 Creating admin user...");
    const adminPasswordHash = crypto
      .createHash("sha256")
      .update("admin123")
      .digest("hex");
    const adminQrToken = crypto
      .createHash("sha256")
      .update("admin-token")
      .digest("hex");

    // Try to insert admin user (will fail if RLS is enabled without proper policies)
    const { error: adminError } = await supabase
      .from("users")
      .upsert(
        {
          id_number: "admin",
          full_name: "S1 Admin",
          role: "admin",
          password_hash: adminPasswordHash,
          qr_token: adminQrToken,
          is_active: true,
          platoon: null,
          year_level: null,
          gender: null,
          photo_url: null,
        },
        {
          onConflict: "id_number",
          ignoreDuplicates: false,
        },
      )
      .select();

    if (adminError) {
      console.log("❌ Failed to create admin user:", adminError.message);

      if (adminError.code === "42501") {
        console.log("\n🔒 Row Level Security (RLS) is blocking the insert.");
        console.log("   This is normal for production. You may need to:");
        console.log("   1. Temporarily disable RLS on users table");
        console.log(
          "   2. Or create the admin user through Supabase dashboard",
        );
        console.log("   3. Or use the service role key instead of anon key");
      }

      // Try to check if admin already exists
      const { data: existingAdmin, error: checkError } = await supabase
        .from("users")
        .select("*")
        .eq("id_number", "admin")
        .single();

      if (!checkError && existingAdmin) {
        console.log("✅ Admin user already exists!");
        console.log(`   Name: ${existingAdmin.full_name}`);
        console.log(`   Role: ${existingAdmin.role}`);
      }
    } else {
      console.log("✅ Admin user created successfully!");
      console.log(`   ID: admin`);
      console.log(`   Password: admin123`);
    }

    // 3. Test authentication
    console.log("\n🔐 Testing authentication...");
    const { data: loginTest, error: loginError } = await supabase
      .from("users")
      .select("id, id_number, full_name, role, platoon, qr_token, photo_url")
      .eq("id_number", "admin")
      .eq("password_hash", adminPasswordHash)
      .single();

    if (loginError) {
      console.log("❌ Authentication test failed:", loginError.message);
    } else {
      console.log("✅ Authentication test successful!");
      console.log("   Ready for app login");
    }

    // 4. Create sample session for testing
    console.log("\n📅 Creating sample session...");
    const today = new Date().toISOString().split("T")[0];

    const { error: sessionError } = await supabase
      .from("sessions")
      .upsert(
        {
          session_date: today,
          session_type: "AM",
          status: "OPEN",
          start_time: "07:00",
          late_time: "07:15",
          cutoff_time: "08:00",
          created_by: loginTest?.id || null,
        },
        {
          onConflict: "session_date,session_type",
          ignoreDuplicates: true,
        },
      )
      .select();

    if (sessionError) {
      console.log("❌ Failed to create sample session:", sessionError.message);
    } else {
      console.log("✅ Sample session created for today");
    }

    console.log("\n🎉 Database setup complete!");
    console.log("\n📱 Ready to test the app with:");
    console.log("   ID: admin");
    console.log("   Password: admin123");
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
  }
}

setupDatabase();
