const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  WARNING: SUPABASE_URL and SUPABASE_KEY must be set in your .env file!');
}

const supabase = createClient(supabaseUrl || 'http://localhost', supabaseKey || 'dummy');

function initDB() {
  console.log('✅ Supabase client initialized');
}

module.exports = { supabase, initDB };
