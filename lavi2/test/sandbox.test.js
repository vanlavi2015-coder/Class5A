const test = require('node:test');
const assert = require('node:assert/strict');

test('sandbox safety contract is documented and uses synthetic records only', async () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /syntheticDataOnly: true/);
  assert.match(server, /LAVI_DEMO_MODE/);
  assert.match(server, /owner_user_id = \?/);
  assert.doesNotMatch(server, /Hoàng Tuệ An|Tô Nguyễn Tâm An/);
});

test('UI warns against real student data and uses demo accounts', async () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /Chỉ sử dụng dữ liệu giả lập/);
  assert.match(html, /teacher1/);
  assert.match(html, /teacher2/);
});
