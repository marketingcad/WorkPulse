import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorizationMatrixMarkdown } from '../src/permissions';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/security/authorization-matrix.md');
writeFileSync(out, authorizationMatrixMarkdown());
console.log(`wrote ${out}`);
