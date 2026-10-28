import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const REPOSITORIES = new Map([
  ['agentic-delivery-lab/agentic-delivery', 1358455028],
  ['agentic-delivery-lab/agentic-delivery-architecture', 1380894616],
  ['agentic-delivery-lab/agentic-delivery-agent-customizations', 1380894656],
  ['agentic-delivery-lab/agentic-delivery-distribution', 1380894705],
]);

export function sourceToolEnvironment(input = process.env) {
  const allowed = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'COMSPEC'];
  const env = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)));
  return { ...env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' };
}

export async function sourceGit(root, ...args) {
  const env = sourceToolEnvironment();
  const result = await exec('git', ['--no-replace-objects', '--no-lazy-fetch', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
    env, encoding: 'buffer', timeout: 15_000, maxBuffer: MAX_BYTES, windowsHide: true,
  });
  return result.stdout;
}

async function repositoryRoot(root) {
  if (typeof root !== 'string' || await realpath(root) !== path.resolve(root)
    || !(await lstat(root)).isDirectory()) throw new Error('source root must be a canonical directory');
  const top = (await sourceGit(root, 'rev-parse', '--show-toplevel')).toString().trim();
  if (await realpath(top) !== path.resolve(root)) throw new Error('source root must identify the Git checkout root');
}

async function githubJson(route) {
  try {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`https://api.github.com${route}`, {
      headers, signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub observation returned HTTP ${response.status}`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) throw new Error('GitHub observation exceeds the supported byte bound');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // Do not include credentials, response bodies or provider diagnostics.
    throw new Error('Native source observation is unavailable or unsupported.');
  }
}

/** Observe native identity and accepted ancestry; this does not approve a release. */
export async function verifyNativeGitSource({ root, repository, repositoryId, commit }) {
  try {
    if (!REPOSITORIES.has(repository) || REPOSITORIES.get(repository) !== repositoryId
      || typeof commit !== 'string' || !SHA.test(commit)) {
      throw new Error('unsupported repository identity or commit');
    }
    await repositoryRoot(root);
    const bytes = await sourceGit(root, 'cat-file', 'commit', commit);
    const object = createHash('sha1').update(`commit ${bytes.length}\0`).update(bytes).digest('hex');
    const tree = bytes.toString('utf8').match(/^tree ([0-9a-f]{40})\n/)?.[1];
    if (object !== commit || !tree) throw new Error('source commit object is not intact');
    await sourceGit(root, 'fsck', '--strict', '--no-reflogs', '--no-dangling', commit);
    const metadata = await githubJson(`/repos/${repository}`);
    if (metadata.id !== repositoryId || metadata.full_name !== repository
      || typeof metadata.default_branch !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(metadata.default_branch)
      || metadata.default_branch.split('/').some((part) => ['', '.', '..'].includes(part))) {
      throw new Error('canonical native repository identity differs');
    }
    const head = await githubJson(`/repos/${repository}/commits/${encodeURIComponent(metadata.default_branch)}`);
    if (typeof head.sha !== 'string' || !SHA.test(head.sha)) throw new Error('native default head is not immutable');
    const comparison = await githubJson(`/repos/${repository}/compare/${commit}...${head.sha}?per_page=1`);
    if (!['ahead', 'identical'].includes(comparison.status) || comparison.behind_by !== 0
      || comparison.base_commit?.sha !== commit || comparison.merge_base_commit?.sha !== commit
      || comparison.base_commit?.commit?.tree?.sha !== tree) {
      throw new Error('source is unmerged, unrelated or has different bytes');
    }
    return { repository, repositoryId, commit, tree, observedDefaultHead: head.sha };
  } catch (error) {
    if (/^Native source /.test(error.message)) throw error;
    throw new Error('Native source binding failed: identity, immutable object or accepted ancestry differs.');
  }
}

/** Compare actual source bytes with the selected tree, without Git stat-cache trust. */
export async function verifySourceCheckout(root, commit) {
  try {
    if (!SHA.test(commit ?? '')) throw new Error('immutable checkout commit required');
    await repositoryRoot(root);
    if ((await sourceGit(root, 'rev-parse', 'HEAD')).toString().trim() !== commit
      || (await sourceGit(root, 'ls-files', '--others', '--exclude-standard', '-z')).length) {
      throw new Error('source checkout differs or contains untracked inputs');
    }
    await sourceGit(root, 'diff-index', '--cached', '--quiet', commit, '--');
    const entries = (await sourceGit(root, 'ls-tree', '-rz', '--full-tree', commit)).toString().split('\0').filter(Boolean);
    if (entries.length > 2000) throw new Error('source checkout exceeds the supported file bound');
    let size = 0;
    for (const entry of entries) {
      const separator = entry.indexOf('\t');
      const header = entry.slice(0, separator);
      const relative = entry.slice(separator + 1);
      const [mode, type, oid] = header.split(' ');
      if (!['100644', '100755'].includes(mode) || type !== 'blob' || !relative
        || !/^[A-Za-z0-9._/-]+$/.test(relative)
        || relative.split('/').some((part) => ['', '.', '..'].includes(part))) throw new Error('unsupported source tree entry');
      let filename = root;
      for (const part of relative.split('/').slice(0, -1)) {
        filename = path.join(filename, part);
        if (!(await lstat(filename)).isDirectory()) throw new Error('redirected source directory');
      }
      filename = path.join(root, relative);
      const info = await lstat(filename);
      if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES
        || Boolean(info.mode & 0o111) !== (mode === '100755')) throw new Error('unsupported source file');
      const expected = await sourceGit(root, 'cat-file', 'blob', oid);
      const actual = await readFile(filename);
      size += actual.length;
      if (size > 32 * 1024 * 1024 || !actual.equals(expected)) throw new Error('source bytes differ');
    }
    if ((await sourceGit(root, 'rev-parse', 'HEAD')).toString().trim() !== commit) throw new Error('source changed during verification');
  } catch {
    throw new Error('Source checkout is not the exact supported immutable input.');
  }
}
