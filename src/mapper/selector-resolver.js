import { existsSync, readdirSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, basename, dirname } from 'path';

export class SelectorResolver {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.cache = new Map(); // selector -> { filePath, originalSelector }
    this.fileCache = new Map(); // filePath -> content
  }

  /**
   * CSS Module 셀렉터에서 컴포넌트명과 원본 클래스명 추출
   *
   * 지원 패턴:
   * 1. .ComponentName-module_className__hash (Next.js 기본)
   * 2. .ComponentName_className__hash (webpack 기본)
   * 3. .path_to_ComponentName_className__hash (경로 포함)
   * 4. .path-to-ComponentName-module__className--hash (BEM 스타일)
   */
  parseCSSModuleSelector(selector) {
    // 중첩 셀렉터에서 첫 번째 부분만 추출
    const parts = selector.split(/\s+/);
    const mainSelector = parts[0];
    const hasNested = parts.length > 1;
    const nestedParts = parts.slice(1);

    // 패턴 1: Next.js 기본 - .ComponentName-module_className__hash
    const nextjsMatch = mainSelector.match(/^\.([A-Za-z][A-Za-z0-9]*)-module_([a-zA-Z][a-zA-Z0-9-]*)__[a-zA-Z0-9]+$/);
    if (nextjsMatch) {
      return {
        component: nextjsMatch[1],
        className: nextjsMatch[2],
        originalSelector: '.' + nextjsMatch[2],
        hasNested,
        nestedParts
      };
    }

    // 패턴 2: 경로 포함 Next.js - .path_ComponentName-module_className__hash
    // 예: .components_playground_MenuGroup-module_article__abc123
    const pathNextjsMatch = mainSelector.match(/^\.(?:[a-zA-Z0-9]+_)*([A-Za-z][A-Za-z0-9]*)-module_([a-zA-Z][a-zA-Z0-9-]*)__[a-zA-Z0-9]+$/);
    if (pathNextjsMatch) {
      return {
        component: pathNextjsMatch[1],
        className: pathNextjsMatch[2],
        originalSelector: '.' + pathNextjsMatch[2],
        hasNested,
        nestedParts
      };
    }

    // 패턴 3: BEM 스타일 - .path-to-Component-module__className--hash
    // 예: .src-components-MenuGroup-module__article--abc12
    const bemMatch = mainSelector.match(/^\.(?:[a-zA-Z0-9]+-)*([A-Za-z][A-Za-z0-9]*)-module__([a-zA-Z][a-zA-Z0-9-]*)--[a-zA-Z0-9]+$/);
    if (bemMatch) {
      return {
        component: bemMatch[1],
        className: bemMatch[2],
        originalSelector: '.' + bemMatch[2],
        hasNested,
        nestedParts
      };
    }

    // 패턴 4: 경로 포함 일반 - .path_ComponentName_className__hash
    // 예: .components_playground_MenuGroup_article__abc123
    const pathMatch = mainSelector.match(/^\.(?:[a-zA-Z0-9]+_)*([A-Za-z][A-Za-z0-9]*)_([a-zA-Z][a-zA-Z0-9-]*)__[a-zA-Z0-9]+$/);
    if (pathMatch) {
      return {
        component: pathMatch[1],
        className: pathMatch[2],
        originalSelector: '.' + pathMatch[2],
        hasNested,
        nestedParts
      };
    }

    // 패턴 5: 일반 - .ComponentName_className__hash
    const simpleMatch = mainSelector.match(/^\.([A-Za-z][A-Za-z0-9]*)_([a-zA-Z][a-zA-Z0-9-]*)__[a-zA-Z0-9]+$/);
    if (simpleMatch) {
      return {
        component: simpleMatch[1],
        className: simpleMatch[2],
        originalSelector: '.' + simpleMatch[2],
        hasNested,
        nestedParts
      };
    }

    return null;
  }

  /**
   * 프로젝트에서 CSS Module 파일 찾기
   */
  async findModuleFiles(componentName) {
    // 컴포넌트명이 IconText이면 IconText.module.scss를 찾음
    const patterns = [
      `${componentName}.module.scss`,
      `${componentName}.module.css`,
    ];

    const results = [];
    await this.searchFiles(this.projectRoot, patterns, results, componentName);
    return results;
  }

  /**
   * 디렉토리 재귀 탐색
   */
  async searchFiles(dir, patterns, results, componentName, depth = 0) {
    if (depth > 10) return; // 최대 깊이 제한

    // 제외할 디렉토리
    const excludeDirs = ['node_modules', '.next', '.git', 'dist', 'build'];

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);

        try {
          const stat = statSync(fullPath);

          if (stat.isDirectory()) {
            if (!excludeDirs.includes(entry)) {
              await this.searchFiles(fullPath, patterns, results, componentName, depth + 1);
            }
          } else if (stat.isFile()) {
            // 정확한 패턴 매칭 (ComponentName.module.scss)
            for (const pattern of patterns) {
              if (entry === pattern) {
                results.push(fullPath);
                break;
              }
            }
          }
        } catch (e) {
          // 접근 불가 파일 무시
        }
      }
    } catch (e) {
      // 접근 불가 디렉토리 무시
    }
  }

  /**
   * 파일에서 셀렉터 존재 여부 확인
   */
  async hasSelector(filePath, className) {
    try {
      let content = this.fileCache.get(filePath);
      if (!content) {
        content = await readFile(filePath, 'utf-8');
        this.fileCache.set(filePath, content);
      }

      // .className 또는 &.className 패턴 검색
      const patterns = [
        new RegExp(`\\.${className}\\s*\\{`, 'm'),
        new RegExp(`&\\.${className}\\s*\\{`, 'm'),
        new RegExp(`\\.${className}\\s*,`, 'm'),
        new RegExp(`\\.${className}\\s*$`, 'm'),
      ];

      return patterns.some(p => p.test(content));
    } catch (e) {
      return false;
    }
  }

  /**
   * CSS Module 셀렉터의 원본 소스 파일 찾기
   * @param {string} selector - 컴파일된 셀렉터 (예: .MenuGroup_container__abc123)
   * @returns {Promise<{filePath: string, originalSelector: string} | null>}
   */
  async resolve(selector) {
    // 캐시 확인
    if (this.cache.has(selector)) {
      return this.cache.get(selector);
    }

    // CSS Module 패턴 파싱
    const parsed = this.parseCSSModuleSelector(selector);
    if (!parsed) {
      return null;
    }

    const { component, className, originalSelector } = parsed;

    // 컴포넌트명으로 파일 검색
    const moduleFiles = await this.findModuleFiles(component);

    // 각 파일에서 셀렉터 존재 여부 확인
    for (const filePath of moduleFiles) {
      const fileName = basename(filePath, '.module.scss').replace('.module.css', '');

      // 파일명이 컴포넌트명과 일치하는 경우 우선
      if (fileName.toLowerCase() === component.toLowerCase()) {
        if (await this.hasSelector(filePath, className)) {
          const result = { filePath, originalSelector };
          this.cache.set(selector, result);
          return result;
        }
      }
    }

    // 일치하는 파일명이 없으면 모든 파일에서 검색
    for (const filePath of moduleFiles) {
      if (await this.hasSelector(filePath, className)) {
        const result = { filePath, originalSelector };
        this.cache.set(selector, result);
        return result;
      }
    }

    return null;
  }

  /**
   * 캐시 클리어
   */
  clearCache() {
    this.cache.clear();
    this.fileCache.clear();
  }
}
