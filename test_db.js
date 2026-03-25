require('dotenv').config();
const { supabase } = require('./src/database');

async function checkRows() {
  const { data } = await supabase.from('links').select('*');
  console.log("DB Rows:", JSON.stringify(data, null, 2));
}

checkRows();
