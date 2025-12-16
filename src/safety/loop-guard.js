import { createHash } from 'crypto';

/**
 * 무한루프 방지를 위한 가드
 * 에이전트가 수정한 파일의 해시를 추적하여 자체 변경으로 인한 이벤트 무시
 */
export class LoopGuard {
  constructor(options = {}) {
    // 파일 경로 -> { hash, timestamp }
    this.recentWrites = new Map();

    // 해시 캐시 유지 시간 (ms)
    this.ttl = options.ttl || 2000;

    // 정리 인터벌
    this.cleanupInterval = setInterval(() => this.cleanup(), this.ttl);
  }

  /**
   * 파일 쓰기 전에 호출 - 해시 등록
   * @param {string} filePath - 파일 경로
   * @param {string} content - 파일 내용
   */
  registerWrite(filePath, content) {
    const hash = this.computeHash(content);
    this.recentWrites.set(filePath, {
      hash,
      timestamp: Date.now()
    });
  }

  /**
   * 변경 이벤트가 자체 수정으로 인한 것인지 확인
   * @param {string} filePath - 파일 경로 (URL 또는 로컬 경로)
   * @param {string} content - 변경된 내용
   * @returns {boolean} - true면 무시해야 함
   */
  shouldIgnore(filePath, content) {
    const record = this.recentWrites.get(filePath);

    if (!record) {
      return false;
    }

    // TTL 초과 확인
    if (Date.now() - record.timestamp > this.ttl) {
      this.recentWrites.delete(filePath);
      return false;
    }

    // 해시 비교
    const currentHash = this.computeHash(content);
    return record.hash === currentHash;
  }

  /**
   * 특정 styleSheetId로 무시 등록
   * @param {string} styleSheetId
   */
  registerStyleSheetWrite(styleSheetId, content) {
    const hash = this.computeHash(content);
    this.recentWrites.set(`sheet:${styleSheetId}`, {
      hash,
      timestamp: Date.now()
    });
  }

  /**
   * styleSheetId 기반 무시 확인
   * @param {string} styleSheetId
   * @param {string} content
   */
  shouldIgnoreStyleSheet(styleSheetId, content) {
    return this.shouldIgnore(`sheet:${styleSheetId}`, content);
  }

  /**
   * 해시 계산
   */
  computeHash(content) {
    return createHash('md5').update(content).digest('hex');
  }

  /**
   * 만료된 엔트리 정리
   */
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.recentWrites) {
      if (now - record.timestamp > this.ttl) {
        this.recentWrites.delete(key);
      }
    }
  }

  /**
   * 리소스 정리
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.recentWrites.clear();
  }
}
