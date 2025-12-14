import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { SourceMapConsumer } from 'source-map';

export class SourceMapResolver {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.cache = new Map(); // cssPath -> SourceMapConsumer
    this.inlineCache = new Map(); // contentHash -> { consumer, sources }
  }

  /**
   * 인라인 CSS 텍스트에서 소스맵 추출 및 원본 파일 경로 찾기
   * @param {string} cssText - 인라인 CSS 텍스트
   * @returns {Promise<{sources: string[], consumer: SourceMapConsumer} | null>}
   */
  async parseInlineSourceMap(cssText) {
    if (!cssText) return null;

    // 캐시 키 생성 (텍스트 시작 부분 해시)
    const cacheKey = cssText.substring(0, 200);
    if (this.inlineCache.has(cacheKey)) {
      return this.inlineCache.get(cacheKey);
    }

    // sourceMappingURL 추출
    const inlineMatch = cssText.match(/\/\*#\s*sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)\s*\*\//);
    if (!inlineMatch) return null;

    try {
      const sourceMapJson = Buffer.from(inlineMatch[1], 'base64').toString('utf-8');
      const sourceMap = JSON.parse(sourceMapJson);
      const consumer = await new SourceMapConsumer(sourceMap);

      // sources 배열에서 원본 파일 경로 추출
      const sources = (sourceMap.sources || []).map(source => {
        // webpack:// 또는 webpack-internal:// 프리픽스 제거
        let cleanPath = source
          .replace(/^webpack:\/\/[^/]*\//, '')
          .replace(/^webpack-internal:\/\/\//, '')
          .replace(/^\.\//g, '')
          .replace(/\?.*$/, ''); // 쿼리스트링 제거

        // 절대 경로 생성
        if (!cleanPath.startsWith('/')) {
          cleanPath = resolve(this.projectRoot, cleanPath);
        }

        return cleanPath;
      }).filter(p => p && existsSync(p));

      const result = { sources, consumer };
      this.inlineCache.set(cacheKey, result);
      return result;
    } catch (e) {
      return null;
    }
  }

  /**
   * 인라인 CSS에서 원본 소스 파일 찾기 (Next.js/webpack용)
   * @param {string} cssText - 인라인 CSS 텍스트
   * @returns {Promise<string | null>} - 원본 파일 경로
   */
  async findOriginalSourceFromInline(cssText) {
    const parsed = await this.parseInlineSourceMap(cssText);
    if (!parsed || parsed.sources.length === 0) return null;

    // 첫 번째 유효한 소스 반환
    return parsed.sources[0];
  }

  /**
   * CSS 파일에서 소스맵 URL 추출
   */
  async extractSourceMapUrl(cssPath) {
    if (!existsSync(cssPath)) return null;

    const content = await readFile(cssPath, 'utf-8');

    // /*# sourceMappingURL=... */ 형식
    const inlineMatch = content.match(/\/\*#\s*sourceMappingURL=(.+?)\s*\*\//);
    if (inlineMatch) {
      return inlineMatch[1].trim();
    }

    // //# sourceMappingURL=... 형식
    const commentMatch = content.match(/\/\/#\s*sourceMappingURL=(.+)/);
    if (commentMatch) {
      return commentMatch[1].trim();
    }

    return null;
  }

  /**
   * 소스맵 로드 및 캐싱
   */
  async loadSourceMap(cssPath) {
    if (this.cache.has(cssPath)) {
      return this.cache.get(cssPath);
    }

    const sourceMapUrl = await this.extractSourceMapUrl(cssPath);
    if (!sourceMapUrl) return null;

    try {
      let sourceMapContent;

      if (sourceMapUrl.startsWith('data:')) {
        // 인라인 소스맵 (base64)
        const base64Match = sourceMapUrl.match(/base64,(.+)/);
        if (base64Match) {
          sourceMapContent = Buffer.from(base64Match[1], 'base64').toString('utf-8');
        }
      } else {
        // 외부 소스맵 파일
        const sourceMapPath = resolve(dirname(cssPath), sourceMapUrl);
        if (existsSync(sourceMapPath)) {
          sourceMapContent = await readFile(sourceMapPath, 'utf-8');
        }
      }

      if (sourceMapContent) {
        const consumer = await new SourceMapConsumer(JSON.parse(sourceMapContent));
        this.cache.set(cssPath, consumer);
        return consumer;
      }
    } catch (e) {
      console.error(`소스맵 로드 실패: ${e.message}`);
    }

    return null;
  }

  /**
   * CSS 위치를 원본 소스(SCSS 등) 위치로 역매핑
   * @param {string} cssPath - CSS 파일 경로
   * @param {number} line - CSS 라인 번호 (1-based)
   * @param {number} column - CSS 컬럼 번호 (0-based)
   * @returns {Promise<{source: string, line: number, column: number, name: string} | null>}
   */
  async getOriginalPosition(cssPath, line, column) {
    const consumer = await this.loadSourceMap(cssPath);
    if (!consumer) return null;

    const original = consumer.originalPositionFor({ line, column });

    if (original.source) {
      // 소스 경로를 절대 경로로 변환
      let sourcePath = original.source;
      if (!sourcePath.startsWith('/')) {
        sourcePath = resolve(dirname(cssPath), sourcePath);
      }

      return {
        source: sourcePath,
        line: original.line,
        column: original.column,
        name: original.name
      };
    }

    return null;
  }

  /**
   * CSS 셀렉터의 원본 소스 파일 찾기
   * @param {string} cssPath - CSS 파일 경로
   * @param {string} selector - CSS 셀렉터
   * @param {string} cssContent - CSS 내용
   * @returns {Promise<{source: string, line: number} | null>}
   */
  async findOriginalSource(cssPath, selector, cssContent) {
    const consumer = await this.loadSourceMap(cssPath);
    if (!consumer) return null;

    // CSS에서 셀렉터 위치 찾기
    const lines = cssContent.split('\n');
    const selectorPattern = new RegExp(`^\\s*${this.escapeRegex(selector)}\\s*\\{`);

    for (let i = 0; i < lines.length; i++) {
      if (selectorPattern.test(lines[i])) {
        const original = consumer.originalPositionFor({
          line: i + 1,
          column: lines[i].indexOf(selector)
        });

        if (original.source) {
          let sourcePath = original.source;
          if (!sourcePath.startsWith('/')) {
            sourcePath = resolve(dirname(cssPath), sourcePath);
          }

          return {
            source: sourcePath,
            line: original.line
          };
        }
      }
    }

    return null;
  }

  /**
   * 정규식 특수문자 이스케이프
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 캐시 정리
   */
  destroy() {
    for (const consumer of this.cache.values()) {
      consumer.destroy();
    }
    this.cache.clear();

    // 인라인 소스맵 캐시 정리
    for (const item of this.inlineCache.values()) {
      if (item.consumer) {
        item.consumer.destroy();
      }
    }
    this.inlineCache.clear();
  }
}
