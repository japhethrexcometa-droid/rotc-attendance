// Test local Supabase database
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabaseUrl = "http://127.0.0.1:54321";
const supabaseAnonKey = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg__3BJgxAaH";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testLocalDatabase() {
  console.log("🧪 Testing Local Supabase Database...\n");

  try {
    // 1. Test connection
    console.log("🔌 Testing connection...");
    const { error } = await supabase
      .from("users")
      .select("count")
      .limit(1);

    if (error) {
      console.log("❌ Connection failed:", error.message);
      return;
    }
    console.log("✅ Connection successful!");

    // 2. Check if admin user exists
    console.log("\n👤 Checking admin user...");
    const { data: adminUser, error: adminError } = await supabase
      .from("users")
      .select("*")
      .eq("id_number", "admin")
      .single();

    if (adminError && adminError.code !== "PGRST116") {
      console.log("❌ Error checking admin:", adminError.message);
    } else if (adminUser) {
      console.log("✅ Admin user exists!");
      console.log(`   Name: ${adminUser.full_name}`);
      console.log(`   Role: ${adminUser.role}`);
    } else {
      console.log("ℹ️  Admin user not found, will be created by migration");
    }

    // 3. Test authentication
    console.log("\n🔐 Testing authentication...");
    const adminPasswordHash = crypto
      .createHash("sha256")
      .update("admin123")
      .digest("hex");

    const { error: loginError } = await supabase
      .from("users")
      .select("id, id_number, full_name, role, platoon, qr_token, photo_url")
      .eq("id_number", "admin")
      .eq("password_hash", adminPasswordHash)
      .single();

    if (loginError) {
      console.log("❌ Authentication test failed:", loginError.message);
    } else {
      console.log("✅ Authentication test successful!");
      console.log("   Ready for app login with admin/admin123");
    }

    // 4. Check tables
    console.log("\n📊 Checking database tables...");
    const tables = ["users", "sessions", "attendance", "announcements"];

    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .select("count")
        .limit(1);
      if (error) {
        console.log(`❌ Table '${table}': ${error.message}`);
      } else {
        console.log(`✅ Table '${table}': accessible`);
      }
    }

    console.log("\n🎉 Local database is ready!");
    console.log("\n📱 To use local database in your app:");
    console.log("   1. Import from lib/supabase-local.ts");
    console.log("   2. Use supabaseDev instead of supabase");
    console.log("   3. Login with: admin / admin123");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testLocalDatabase();
