// MIT. Install the reviewed project-local Impeccable bundle through the
// trusted Woodhouse helper. This is setup, not proof of agent discovery or use.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const woodhouse = resolve(process.argv[2] || join(project, '..', 'woodhouse-new'));
const helper = join(woodhouse, 'scripts', 'impeccable-project.mjs');
const git = (...args) => execFileSync('git', ['-C', woodhouse, ...args], { encoding: 'utf8' }).trim();
const origin = git('remote', 'get-url', 'origin');
if (!/^(git@github\.com:|https:\/\/github\.com\/)loftwah\/woodhouse-new(?:\.git)?$/.test(origin))
  throw new Error('Woodhouse helper checkout has an unexpected origin.');
if (git('hash-object', helper) !== git('rev-parse', 'origin/main:scripts/impeccable-project.mjs'))
  throw new Error('Woodhouse helper differs from the locally verified origin/main; inspect it before setup.');

const temp = mkdtempSync(join(tmpdir(), 'studio-impeccable-'));
try {
  execFileSync('gh', ['release', 'download', 'skill-v4.9.1', '--repo', 'pbakaus/impeccable', '--pattern', 'universal.zip*', '--dir', temp], { stdio: 'inherit' });
  const bytes = readFileSync(join(temp, 'universal.zip'));
  const envelope = JSON.parse(readFileSync(join(temp, 'universal.zip.sig.json'), 'utf8'));
  // Pinned from upstream's release signing keyring at commit 1d0d782.
  const publicKey = createPublicKey({ key: Buffer.from('302a300506032b65700321007433133bb92da2c0da4186925f36dbd36219c11192451df56f25fd6a23dd7db9', 'hex'), format: 'der', type: 'spki' });
  const expected = 'f0e94487ffcf8e28d0d1cfb47f41918e3748c657f33f0f128ecf0a478ac85942';
  const payload = `impeccable-skill-bundle-v1\n${envelope.keyId}\nskill-v${envelope.version}\n${envelope.artifact}\n${envelope.size}\n${envelope.sha256}\n`;
  if (envelope.schema !== 1 || envelope.keyId !== 'release-2026-09' || envelope.version !== '4.9.1' || envelope.artifact !== 'universal.zip' || envelope.size !== bytes.length || bytes.length > 25_000_000 || envelope.sha256 !== expected || createHash('sha256').update(bytes).digest('hex') !== expected || !/^[0-9a-f]{128}$/.test(envelope.signature) || !verify(null, Buffer.from(payload), publicKey, Buffer.from(envelope.signature, 'hex')))
    throw new Error('The pinned Impeccable bundle did not pass size, digest and signature verification.');
  console.log('Verified signed Impeccable skill bundle 4.9.1.');
  const env = { ...process.env, IMPECCABLE_BUNDLE_PATH: join(temp, 'universal.zip'), IMPECCABLE_HOME: join(temp, 'engine-cache'), npm_config_cache: join(temp, 'npm-cache'), npm_config_registry: 'https://registry.npmjs.org/', DO_NOT_TRACK: '1' };
  // Do not let host overrides silently substitute an unrelated executable or
  // download host for the reviewed installer and its checksum-verified engine.
  delete env.IMPECCABLE_BIN;
  delete env.IMPECCABLE_DOWNLOAD_BASE;
  const result = spawnSync(process.execPath, [helper, '--setup', '--providers', 'codex', '--cli-version', '4.9.1', '--skill-version', '4.9.1', project], {
    cwd: woodhouse,
    stdio: 'inherit',
    env,
  });
  if (result.error) throw result.error;
  // The helper returns nonzero for incomplete project context as well as an
  // installation error. Preserve that status; do not report full setup.
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
