/**
 * Generates data/changelog.json from the git commit log, for the menu's
 * "Latest Updates" panel. Run before deploy:  node scripts/gen-changelog.mjs
 * No build step in the game itself — this is just a deploy-time data refresh.
 */
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const VERSION = 'v0.8.0-dev';
const N = 14;

const raw = execSync(`git log -${N} --date=short --pretty=format:%h%x1f%ad%x1f%s`, { encoding: 'utf8' });
const commits = raw.split('\n').filter(Boolean).map(line => {
    const [hash, date, subjectRaw] = line.split('\x1f');
    // Drop the conventional-commit type prefix and keep the first clause, so the
    // menu shows short, readable "what changed" lines.
    let subject = (subjectRaw || '')
        .replace(/^(feat|fix|refactor|chore|docs|ui|copy|perf|style|test|build|revert)(\([^)]*\))?:\s*/i, '');
    // Drop a leading "stage N - " dev marker so the player-facing note keeps the
    // readable "what changed" clause.
    subject = subject.replace(/^stage\s+\d+\s*[-:–—]\s*/i, '');
    // Keep the first clause (split on ; or em-dash); a plain hyphen is left intact
    // so multi-feature subjects survive.
    subject = subject.split(/;|\s—\s/)[0].trim();
    if (subject.length > 96) subject = subject.slice(0, 93) + '…';
    return { hash, date, subject };
});

const out = {
    version: VERSION,
    build: commits[0] ? commits[0].hash : '',
    generated: commits[0] ? commits[0].date : '',
    commits,
};
writeFileSync('data/changelog.json', JSON.stringify(out, null, 1) + '\n');
console.log(`wrote data/changelog.json — ${commits.length} commits, build ${out.build} (${out.generated})`);
