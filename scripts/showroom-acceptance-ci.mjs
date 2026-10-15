import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Never run configuration/reset helpers against a developer's services or env.
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) {
  throw new Error('This helper runs only on an ephemeral GitHub Actions runner');
}
const container = 'supabase_db_aladdin_pr84_ci';
const output = '.artifacts/showroom';
mkdirSync(output, { recursive: true });
const sql = statement => execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], { encoding: 'utf8', timeout: 30000 }).trim();
const configFile = 'supabase/config.toml';
const requireOwnConfig = () => {
  if (!readFileSync(configFile, 'utf8').includes('project_id = "aladdin_pr84_ci"')) throw new Error('Refuse non-acceptance project');
};
const redact = text => text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
  .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-local-key]')
  .replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted-local-db-url]');
const phase = process.argv[2];
if (phase === 'configure') {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== process.env.EXPECTED_HEAD) throw new Error('Checkout does not match exact PR head');
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
  if (dirty.trim()) throw new Error('Candidate checkout has tracked modifications before configuration');
  let config = readFileSync(configFile, 'utf8');
  config = config.replace(/^project_id = "aladdin"$/m, 'project_id = "aladdin_pr84_ci"')
    .replace(/^port = 54321$/m, 'port = 65521')
    .replace(/^port = 54322$/m, 'port = 65522')
    .replace(/^shadow_port = 54320$/m, 'shadow_port = 65520');
  writeFileSync(configFile, config);
  requireOwnConfig();
  writeFileSync(process.env.GITHUB_ENV, `SHOWROOM_ACCEPTANCE_ENV_FILE=${process.env.SHOWROOM_ACCEPTANCE_ENV_FILE}\n`, { flag: 'a' });
  writeFileSync(`${output}/candidate.json`, JSON.stringify({ head, source: 'exact committed PR head; no developer working-tree files', configOnlyRunnerOverride: true }, null, 2));
} else if (phase === 'verify') {
  requireOwnConfig();
  const files = readdirSync('supabase/migrations').filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const versions = sql('select version from supabase_migrations.schema_migrations order by version').split('\n');
  const missing = files.filter(name => !versions.includes(name.split('_')[0]));
  const feature = ['20261014085731', '20261014123000', '20261014133000', '20261014160000', '20261014163431', '20261014163435'];
  if (missing.length || feature.some(version => !versions.includes(version))) throw new Error('Migration history incomplete');
  const contracts = sql("select proname || ':' || pronargs from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('business_draft_save','business_draft_save_v2','business_draft_submit','business_draft_submit_v2') order by proname").split('\n');
  for (const contract of ['business_draft_save:9', 'business_draft_save_v2:13', 'business_draft_submit:1', 'business_draft_submit_v2:1']) {
    if (!contracts.includes(contract)) throw new Error('Required old/v2 RPC contract missing: ' + contract);
  }
  const status = JSON.parse(readFileSync(resolve(process.env.RUNNER_TEMP, 'showroom-status.json'), 'utf8'));
  if (status.API_URL !== 'http://127.0.0.1:65521' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('Unexpected isolated API status');
  for (const value of [status.ANON_KEY, status.SERVICE_ROLE_KEY, status.JWT_SECRET]) if (value) console.log('::add-mask::' + value);
  const env = {
    NEXT_PUBLIC_APP_ENV: 'local', NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    AUTH_PASSWORD_PREVIEW_GRANT_SECRET: randomBytes(32).toString('hex'),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    TURNSTILE_ALLOWED_HOSTNAMES: 'localhost,127.0.0.1',
  };
  console.log('::add-mask::' + env.AUTH_PASSWORD_PREVIEW_GRANT_SECRET);
  const text = Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  writeFileSync(process.env.SHOWROOM_ACCEPTANCE_ENV_FILE, text, { mode: 0o600 });
  writeFileSync(process.env.GITHUB_ENV, text, { flag: 'a' });
  writeFileSync(`${output}/migrations.json`, JSON.stringify({ recorded: versions.length, missing, feature, contracts, files: files.map(name => ({ name, sha256: createHash('sha256').update(readFileSync('supabase/migrations/' + name)).digest('hex') })) }, null, 2));
} else if (phase === 'diagnostics') {
  requireOwnConfig();
  const startup = resolve(process.env.RUNNER_TEMP, 'showroom-stack.log');
  if (existsSync(startup)) writeFileSync(`${output}/stack.log`, redact(readFileSync(startup, 'utf8')));
  const inventory = spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 10000 });
  for (const name of (inventory.stdout || '').split('\n').filter(name => /^supabase_[a-z_]+_aladdin_pr84_ci$/.test(name))) {
    const logs = spawnSync('docker', ['logs', '--tail', '150', name], { encoding: 'utf8', timeout: 10000 });
    writeFileSync(`${output}/${name}.log`, redact((logs.stdout || '') + (logs.stderr || '')));
  }
  for (const name of ['build.log', 'browser.log']) if (existsSync(`${output}/${name}`)) writeFileSync(`${output}/${name}`, redact(readFileSync(`${output}/${name}`, 'utf8')));
} else throw new Error('Unknown acceptance phase');
