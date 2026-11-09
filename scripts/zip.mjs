// Packs the theme into dist/<name>-<version>.zip for upload in Ghost Admin (Settings → Design & branding → Change theme → Upload theme).
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, readFileSync} from 'node:fs';

const {name, version} = JSON.parse(readFileSync('package.json', 'utf8'));
const out = `dist/${name}-${version}.zip`;
mkdirSync('dist', {recursive: true});
rmSync(out, {force: true});
execFileSync('zip', ['-rq', out, '.', '-x', 'node_modules/*', '.git/*', 'dist/*', 'dev/*', 'scripts/*', 'docs/*', 'CHANGELOG.md', '.claude/*', '.DS_Store'], {stdio: 'inherit'});
console.log(`Wrote ${out}`);
