const { fetchAndNormalize } = require('./src/crawler');

async function test() {
  try {
    const res = await fetchAndNormalize('https://github.com/sarthak1pandey/student-portal-backend');
    console.log("Length:", res.contentLength);
    console.log("Text:", res.text.substring(0, 500));
  } catch(e) {
    console.error(e);
  }
}
test();
