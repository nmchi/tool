import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Store } from '../../server/store.js';
import { createVault } from '../../server/vault.js';
import { createApp } from '../../server/app.js';
import { Connectors } from '../../server/connectors.js';
import { Worker } from '../../server/worker.js';

test(
  'browser: multi-project, manual handoff, API update, public verification, import and CSV export',
  { timeout: 90000 },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'entity-ui-'));
    const store = new Store(path.join(dir, 'test.sqlite'));
    store.run('UPDATE platforms SET interval_ms=0');
    const vault = createVault(dir);
    let user = {
      id: 42,
      login: 'mocstudio',
      html_url: 'https://github.com/mocstudio',
      name: 'Old name',
      bio: 'Old bio',
      blog: '',
    };
    let writes = 0;
    const network = {
      request: async (url, options) => {
        if (url.startsWith('https://api.github.com/')) {
          if (options.method === 'PATCH') {
            writes++;
            user = { ...user, ...JSON.parse(options.body) };
          }
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(user),
          };
        }
        if (url === 'https://about.me/mocstudio')
          return {
            status: 200,
            headers: { 'content-type': 'text/html' },
            body: '<title>Mộc Studio</title><body><h1>Mộc Studio</h1><a href="https://moc.example.com">Website</a></body>',
          };
        throw new Error('E2E attempted an unexpected external request');
      },
    };
    const connectors = new Connectors(network);
    const worker = new Worker(store, connectors, vault, { tickMs: 40 });
    const server = http.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    server.on('request', createApp({ store, vault, connectors, port }));
    worker.start();
    let browser;
    const resultDir = path.resolve('test-results');
    mkdirSync(resultDir, { recursive: true });
    try {
      browser = await chromium.launch({
        executablePath:
          process.env.CHROMIUM_PATH ||
          (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
        headless: true,
        args: ['--no-sandbox'],
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
        locale: 'vi-VN',
        acceptDownloads: true,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // All platform traffic is a test fixture; this test creates no remote accounts.
      await page.route('**/*', (route) =>
        route.request().url().startsWith(`http://127.0.0.1:${port}`)
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`http://127.0.0.1:${port}`);
      await page.getByRole('heading', { name: 'Hệ hồ sơ của bạn, trong tầm kiểm soát.' }).waitFor();
      await page.screenshot({ path: path.join(resultDir, 'overview-empty.png'), fullPage: true });
      await page.getByRole('button', { name: 'Tạo dự án đầu tiên', exact: true }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByLabel('Tên thương hiệu *').fill('Mộc Studio');
      await dialog.getByLabel('Website chính thức *').fill('https://moc.example.com');
      await dialog.getByLabel('Username mong muốn *').fill('mocstudio');
      await dialog.getByLabel('Email của website *').fill('contact@moc.example.com');
      await dialog.getByLabel('Mô tả thương hiệu').fill('Thiết kế thương hiệu và trải nghiệm số.');
      const usernameInput = dialog.getByLabel('Username mong muốn *');
      await usernameInput.focus();
      await page.waitForResponse((response) => response.url().endsWith('/api/state'));
      assert.equal(await usernameInput.evaluate((el) => document.activeElement === el), true);
      await dialog.getByRole('button', { name: 'Lưu dự án', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.locator('.nav-item').filter({ hasText: 'Dự án' }).click();
      await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('Tên thương hiệu *').fill('Sông Coffee');
      await dialog.getByLabel('Website chính thức *').fill('https://song.example.com');
      await dialog.getByLabel('Username mong muốn *').fill('songcoffee');
      await dialog.getByLabel('Email của website *').fill('contact@song.example.com');
      await dialog.getByRole('button', { name: 'Lưu dự án', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(store.all('SELECT * FROM projects').length, 2);
      const mocCard = page.locator('.project-card').filter({ hasText: 'Mộc Studio' });
      await mocCard.getByRole('button', { name: 'Tạo công việc' }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('Tên lô *').fill('Hồ sơ Mộc Studio');
      await dialog
        .locator('.selection-row')
        .filter({ hasText: 'about.me' })
        .locator('input')
        .check();
      await dialog.getByRole('button', { name: 'Tạo và chạy lô' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.locator('.nav-item').filter({ hasText: 'Cần xử lý' }).click();
      await page.getByRole('button', { name: 'Xử lý', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('URL hồ sơ công khai').fill('https://about.me/mocstudio');
      await dialog.getByRole('button', { name: 'Lưu & tiếp tục' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('.inbox-grid') === null);
      await page.locator('.nav-item').filter({ hasText: 'Hồ sơ & báo cáo' }).click();
      await page.getByText('Đang hoạt động', { exact: true }).waitFor();
      assert.equal(store.all('SELECT * FROM profiles')[0].status, 'healthy');
      await page.getByRole('button', { name: 'Chi tiết', exact: false }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('Email quản lý tài khoản').fill('owner@example.com');
      await dialog.getByLabel('Email đã xác minh').selectOption('yes');
      await dialog.getByLabel('Bảo mật hai lớp (2FA)').selectOption('enabled');
      await dialog.getByLabel('Tôi đã kiểm tra và còn quyền quản lý tài khoản này.').check();
      await dialog.getByRole('button', { name: 'Lưu thông tin quản lý' }).click();
      await dialog.getByText('Đã lưu thông tin do bạn xác nhận.').waitFor();
      assert.equal(store.all('SELECT * FROM profiles')[0].owner_confirmed, 1);
      assert.equal(store.all('SELECT * FROM profile_checks').length, 1);
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).last().click();
      await page.locator('.nav-item').filter({ hasText: 'Dự án' }).click();
      const healthyUrl = store.all('SELECT url FROM profiles')[0].url;
      await page
        .locator('.project-card')
        .filter({ hasText: 'Mộc Studio' })
        .getByRole('button', { name: 'Schema' })
        .click();
      dialog = page.getByRole('dialog');
      await dialog.locator('.schema-code').waitFor();
      const schemaText = await dialog.locator('.schema-code').textContent();
      assert.match(schemaText, /"sameAs"/);
      assert.ok(schemaText.includes(healthyUrl));
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
      await page
        .locator('.project-card')
        .filter({ hasText: 'Mộc Studio' })
        .getByRole('button', { name: 'Tài khoản' })
        .click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('Access token *').fill('test-ui-token-123');
      await dialog.getByRole('button', { name: 'Xác minh & kết nối' }).click();
      await dialog.getByText('GitHub · @mocstudio', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).last().click();
      await page
        .locator('.project-card')
        .filter({ hasText: 'Mộc Studio' })
        .getByRole('button', { name: 'Tạo công việc' })
        .click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Cập nhật qua API', exact: false }).click();
      await dialog.locator('.selection-row').filter({ hasText: 'GitHub' }).locator('input').check();
      await dialog.getByRole('button', { name: 'Tạo và chạy lô' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByText('Đã xác minh', { exact: true }).first().waitFor();
      assert.equal(writes, 1);
      assert.equal(user.name, 'Mộc Studio');
      assert.equal(user.blog, 'https://moc.example.com/');
      const other = store.get("SELECT id FROM projects WHERE name='Sông Coffee'");
      assert.equal(store.all('SELECT * FROM profiles WHERE project_id=?', other.id).length, 0);
      await page.locator('.nav-item').filter({ hasText: 'Hồ sơ & báo cáo' }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Xuất CSV' }).click();
      const download = await downloadPromise;
      const csv = readFileSync(await download.path(), 'utf8');
      assert.match(csv, /Mộc Studio/);
      assert.equal(csv.includes('test-ui-token-123'), false);
      await page.locator('.nav-item').filter({ hasText: 'Nền tảng' }).click();
      await page.getByRole('button', { name: 'Nhập URL mẫu' }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Nạp danh sách tham khảo' }).click();
      await page.waitForFunction(() =>
        document.querySelector('textarea')?.value.includes('https://www.facebook.com/'),
      );
      await dialog
        .getByLabel('Dán URL hoặc chọn tệp TXT / CSV')
        .fill(
          'https://new-community.example.com/users/sample-brand\nhttps://github.com/sample-brand\nhttps://www.easycounter.com/report/example.com',
        );
      await dialog.getByRole('button', { name: 'Phân tích danh sách' }).click();
      await dialog.getByText('Dạng hồ sơ', { exact: true }).first().waitFor();
      await dialog.getByRole('button', { name: 'Nhập nền tảng', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(
        store.get("SELECT enabled FROM platforms WHERE host_key='new-community.example.com'")
          .enabled,
        0,
      );
      assert.equal(store.all('SELECT * FROM profiles').length, 2);
      await page.locator('.nav-item').filter({ hasText: 'Tổng quan' }).click();
      if (await page.getByRole('button', { name: 'Đóng thông báo' }).count())
        await page.getByRole('button', { name: 'Đóng thông báo' }).click();
      await page.screenshot({
        path: path.join(resultDir, 'overview-populated.png'),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Mở menu' }).click();
      await page.locator('.nav-item').filter({ hasText: 'Hồ sơ & báo cáo' }).click();
      await page.waitForFunction(() => {
        const sidebar = document.querySelector('.sidebar');
        const selected = document.querySelector('.nav-active');
        return (
          sidebar &&
          !sidebar.classList.contains('sidebar-open') &&
          new DOMMatrix(getComputedStyle(sidebar).transform).m41 <= -240 &&
          selected?.textContent?.includes('Hồ sơ & báo cáo')
        );
      });
      await page.screenshot({ path: path.join(resultDir, 'profiles-mobile.png'), fullPage: true });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await worker.stop();
      await new Promise((resolve) => server.close(resolve));
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
