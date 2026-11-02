const userAgent = process.env.npm_config_user_agent || '';
if (!userAgent.startsWith('pnpm/')) {
  console.error(
    'Dự án này dùng pnpm. Chạy corepack enable, corepack install, rồi pnpm install --frozen-lockfile.',
  );
  process.exit(1);
}
