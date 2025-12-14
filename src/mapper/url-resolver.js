import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

export class URLResolver {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.devServerBase = options.devServerBase || 'http://localhost:3000';
    this.sourceRoot = options.sourceRoot || './src';

    // URL 패턴 -> 로컬 경로 매핑
    this.mappings = options.mappings || {};

    // 기본 매핑 규칙 (Next.js, Vite 등 일반적인 패턴)
    this.defaultMappings = [
      // Next.js (basePath 포함 가능)
      { pattern: /^(?:\/[^/]+)?\/_next\/static\/css\/(.+?)(?:\?.*)?$/, resolve: (match) => this.findNextJSSource(match[1]) },
      // Vite
      { pattern: /^\/src\/(.+\.css)$/, resolve: (match) => join(this.projectRoot, 'src', match[1]) },
      { pattern: /^\/assets\/(.+\.css)$/, resolve: (match) => this.findInProject(match[1]) },
      // 일반적인 static 폴더
      { pattern: /^\/static\/(.+\.css)$/, resolve: (match) => join(this.projectRoot, 'static', match[1]) },
      { pattern: /^\/styles\/(.+\.css)$/, resolve: (match) => join(this.projectRoot, 'styles', match[1]) },
      { pattern: /^\/css\/(.+\.css)$/, resolve: (match) => join(this.projectRoot, 'css', match[1]) },
      // public 폴더
      { pattern: /^\/(.+\.css)$/, resolve: (match) => join(this.projectRoot, 'public', match[1]) },
    ];
  }

  /**
   * URL을 로컬 파일 경로로 변환
   * @param {string} url - 스타일시트 URL
   * @returns {string|null} - 로컬 파일 경로 또는 null
   */
  resolve(url) {
    if (!url) return null;

    // file:// URL 처리
    if (url.startsWith('file://')) {
      return fileURLToPath(url);
    }

    // 절대 URL에서 경로 부분 추출
    let pathname;
    try {
      const urlObj = new URL(url, this.devServerBase);
      pathname = urlObj.pathname;
    } catch {
      pathname = url;
    }

    // 사용자 정의 매핑 먼저 확인
    for (const [pattern, replacement] of Object.entries(this.mappings)) {
      if (pathname.startsWith(pattern)) {
        const localPath = pathname.replace(pattern, replacement);
        const fullPath = resolve(this.projectRoot, localPath);
        if (existsSync(fullPath)) {
          return fullPath;
        }
      }
    }

    // 기본 매핑 규칙 적용
    for (const { pattern, resolve: resolveFn } of this.defaultMappings) {
      const match = pathname.match(pattern);
      if (match) {
        const localPath = resolveFn(match);
        if (localPath && existsSync(localPath)) {
          return localPath;
        }
      }
    }

    // 직접 경로 매칭 시도
    const directPaths = [
      join(this.projectRoot, pathname),
      join(this.projectRoot, 'src', pathname),
      join(this.projectRoot, 'public', pathname),
    ];

    for (const p of directPaths) {
      if (existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * 프로젝트 내에서 파일 이름으로 검색
   * @param {string} filename - 찾을 파일 이름
   * @returns {string|null}
   */
  findInProject(filename) {
    // 간단한 검색 - 일반적인 위치들 확인
    const searchPaths = [
      join(this.projectRoot, 'src', 'styles', filename),
      join(this.projectRoot, 'src', 'css', filename),
      join(this.projectRoot, 'styles', filename),
      join(this.projectRoot, 'css', filename),
      join(this.projectRoot, 'public', 'styles', filename),
      join(this.projectRoot, 'public', 'css', filename),
    ];

    for (const p of searchPaths) {
      if (existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Next.js CSS 소스 파일 찾기
   * @param {string} cssPath - CSS 경로 (예: app/layout.css)
   * @returns {string|null}
   */
  findNextJSSource(cssPath) {
    // 쿼리스트링 제거
    cssPath = cssPath.replace(/\?.*$/, '');

    // 1. .next 폴더의 빌드된 CSS (직접 수정용)
    const nextBuildPath = join(this.projectRoot, '.next', 'static', 'css', cssPath);
    if (existsSync(nextBuildPath)) {
      return nextBuildPath;
    }

    // 2. 소스 파일 찾기 시도 (layout.css -> globals.css 등)
    const pathParts = cssPath.split('/');
    const filename = pathParts[pathParts.length - 1];
    const dirname = pathParts.slice(0, -1).join('/');

    // layout.css -> globals.css 또는 global.scss
    if (filename === 'layout.css') {
      const globalPaths = [
        join(this.projectRoot, dirname, 'globals.css'),
        join(this.projectRoot, dirname, 'global.css'),
        join(this.projectRoot, dirname, 'globals.scss'),
        join(this.projectRoot, dirname, 'global.scss'),
        join(this.projectRoot, 'app', 'globals.css'),
        join(this.projectRoot, 'app', 'global.scss'),
        join(this.projectRoot, 'styles', 'globals.css'),
        join(this.projectRoot, 'styles', 'global.scss'),
      ];

      for (const p of globalPaths) {
        if (existsSync(p)) {
          return p;
        }
      }
    }

    // page.css -> page.module.scss 또는 page.module.css
    if (filename === 'page.css') {
      const modulePaths = [
        join(this.projectRoot, dirname, 'page.module.scss'),
        join(this.projectRoot, dirname, 'page.module.css'),
        join(this.projectRoot, dirname, 'styles.module.scss'),
        join(this.projectRoot, dirname, 'styles.module.css'),
      ];

      for (const p of modulePaths) {
        if (existsSync(p)) {
          return p;
        }
      }
    }

    return null;
  }

  /**
   * 매핑 규칙 추가
   * @param {string} urlPattern - URL 패턴
   * @param {string} localPath - 로컬 경로
   */
  addMapping(urlPattern, localPath) {
    this.mappings[urlPattern] = localPath;
  }
}
