import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../src');

/** Extract import targets from a file */
function getImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: string[] = [];
  const regex = /^import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

/** Check if an import target belongs to a layer */
function isTranslateImport(target: string): boolean {
  return target.includes('translate/') || target.includes('../translate/') || target.includes('../../translate/');
}

function isRequestUtilImport(target: string): boolean {
  return target.includes('request') || target === './request' || target === '../request' || target === '../../request';
}

function isRouterImport(target: string): boolean {
  return target === './index' || target === '../index';
}

describe('Architecture boundaries', () => {
  // L1: Translate modules must NOT import from request.ts or index.ts
  describe('L1 — Translate modules isolation', () => {
    const translateDirs = [
      'translate/request',
      'translate/response',
      'translate/stream',
    ];

    translateDirs.forEach(dir => {
      const fullDir = path.join(SRC, dir);
      if (!fs.existsSync(fullDir)) return;

      fs.readdirSync(fullDir).filter(f => f.endsWith('.ts')).forEach(file => {
        it(`${dir}/${file} must not import request or index`, () => {
          const imports = getImports(path.join(fullDir, file));
          const violations = imports.filter(i => isRequestUtilImport(i) || isRouterImport(i));
          expect(violations, `Found forbidden imports: ${violations.join(', ')}`).toEqual([]);
        });
      });
    });
  });

  // L2: request.ts must NOT import from any translate module
  describe('L2 — request.ts isolation', () => {
    it('request.ts must not import translate modules', () => {
      const imports = getImports(path.join(SRC, 'request.ts'));
      const violations = imports.filter(i => isTranslateImport(i));
      expect(violations, `Found translate imports in request.ts: ${violations.join(', ')}`).toEqual([]);
    });
  });

  // L3: Utilities must NOT import from translate, request, or index
  describe('L3 — Utilities isolation', () => {
    const utilityFiles = ['routing.ts', 'auth.ts', 'vision.ts', 'backpressure.ts', 'think-tag-stripper.ts'];

    utilityFiles.forEach(file => {
      it(`${file} must not import from translate, request, or index`, () => {
        const filePath = path.join(SRC, file);
        if (!fs.existsSync(filePath)) return;
        const imports = getImports(filePath);
        const violations = imports.filter(i => isTranslateImport(i) || isRequestUtilImport(i) || isRouterImport(i));
        expect(violations, `Found forbidden imports in ${file}: ${violations.join(', ')}`).toEqual([]);
      });
    });
  });

  // L5: Entry points must ONLY import index.ts
  describe('L5 — Entry point isolation', () => {
    const entries = [
      path.resolve(__dirname, '../scripts/build-entry.ts'),
    ];

    entries.forEach(entry => {
      it(`${path.basename(entry)} must only import src/index.ts directly (utilities like logger/config are allowed)`, () => {
        if (!fs.existsSync(entry)) return;
        const imports = getImports(entry);
        // Allow `../src/index` or `./src/index`
        const allowed = imports.filter(i => i.includes('src/index') || i.includes('./index'));
        // Any non-index import from src/ is a violation (except utility modules)
        const allowedSrc = ['src/index', 'src/logger', 'src/config', 'src/auth', 'src/version',
                            'src/cache', 'src/backpressure', 'src/translate/type-guards'];
        const violations = imports.filter(i => i.includes('src/') && !allowedSrc.some(a => i.includes(a)));
        expect(violations, `Found non-index src imports in entry point: ${violations.join(', ')}`).toEqual([]);
      });
    });
  });

  // Barrel: translate/index.ts must remain pure re-export (no imports)
  describe('Translation barrel integrity', () => {
    it('translate/index.ts must have no imports (pure barrel)', () => {
      const filePath = path.join(SRC, 'translate/index.ts');
      if (!fs.existsSync(filePath)) return;
      const imports = getImports(filePath);
      expect(imports, 'translate/index.ts is a barrel file and must not import').toEqual([]);
    });
  });

  // M3: File size limit
  describe('M3 — File size', () => {
    const MAX_LINES = 500;

    function getTsFiles(dir: string): string[] {
      const files: string[] = [];
      fs.readdirSync(dir).forEach(entry => {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          files.push(...getTsFiles(full));
        } else if (entry.endsWith('.ts')) {
          files.push(full);
        }
      });
      return files;
    }

    const srcFiles = getTsFiles(SRC);
    srcFiles.forEach(file => {
      const relative = path.relative(SRC, file);
      it(`${relative} must not exceed ${MAX_LINES} lines`, () => {
        const lines = fs.readFileSync(file, 'utf-8').split('\n').length;
        expect(lines, `${relative} has ${lines} lines (max ${MAX_LINES})`).toBeLessThanOrEqual(MAX_LINES);
      });
    });
  });

  // M4: Import count limit
  describe('M4 — Import count', () => {
    const MAX_IMPORTS = 10;

    function getTsFiles(dir: string): string[] {
      const files: string[] = [];
      fs.readdirSync(dir).forEach(entry => {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          files.push(...getTsFiles(full));
        } else if (entry.endsWith('.ts')) {
          files.push(full);
        }
      });
      return files;
    }

    const srcFiles = getTsFiles(SRC);
    srcFiles.forEach(file => {
      const relative = path.relative(SRC, file);
      it(`${relative} must not exceed ${MAX_IMPORTS} imports`, () => {
        const imports = getImports(file);
        expect(imports.length, `${relative} has ${imports.length} imports (max ${MAX_IMPORTS})`).toBeLessThanOrEqual(MAX_IMPORTS);
      });
    });
  });

  // D1: Translation functions must be pure — no fetch or I/O
  describe('D1 — Pure translation functions', () => {
    const translateDirs = [
      'translate/request',
      'translate/response',
      'translate/stream',
    ];

    translateDirs.forEach(dir => {
      const fullDir = path.join(SRC, dir);
      if (!fs.existsSync(fullDir)) return;

      fs.readdirSync(fullDir).filter(f => f.endsWith('.ts')).forEach(file => {
        it(`${dir}/${file} must not contain fetch or I/O calls`, () => {
          const content = fs.readFileSync(path.join(fullDir, file), 'utf-8');
          const hasFetch = content.includes('fetch(');
          const hasFs = content.includes('fs.');
          expect(hasFetch || hasFs, `${dir}/${file} contains fetch() or fs.* — violates pure function invariant`).toBe(false);
        });
      });
    });
  });
});
