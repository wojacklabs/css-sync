export class StyleSheetRegistry {
  constructor() {
    // styleSheetId -> { header, text, lastModified }
    this.sheets = new Map();
  }

  register(header) {
    const { styleSheetId } = header;

    if (!this.sheets.has(styleSheetId)) {
      this.sheets.set(styleSheetId, {
        header,
        text: null,
        lastModified: null
      });
    }

    return this.sheets.get(styleSheetId);
  }

  get(styleSheetId) {
    return this.sheets.get(styleSheetId);
  }

  updateText(styleSheetId, text) {
    const sheet = this.sheets.get(styleSheetId);
    if (sheet) {
      sheet.text = text;
      sheet.lastModified = Date.now();
    }
  }

  getPreviousText(styleSheetId) {
    const sheet = this.sheets.get(styleSheetId);
    return sheet?.text || null;
  }

  getSourceURL(styleSheetId) {
    const sheet = this.sheets.get(styleSheetId);
    // Vite inline 스타일의 경우 viteDevId 사용
    return sheet?.viteDevId || sheet?.header?.sourceURL || null;
  }

  // Vite dev ID 설정 (inline 스타일시트용)
  setViteDevId(styleSheetId, viteDevId) {
    const sheet = this.sheets.get(styleSheetId);
    if (sheet) {
      sheet.viteDevId = viteDevId;
    }
  }

  // Vite dev ID 조회
  getViteDevId(styleSheetId) {
    const sheet = this.sheets.get(styleSheetId);
    return sheet?.viteDevId || null;
  }

  // 원본 소스 경로 설정 (소스맵에서 추출한 경로, Next.js/webpack용)
  setOriginalSource(styleSheetId, sourcePath) {
    const sheet = this.sheets.get(styleSheetId);
    if (sheet) {
      sheet.originalSource = sourcePath;
    }
  }

  // 원본 소스 경로 조회
  getOriginalSource(styleSheetId) {
    const sheet = this.sheets.get(styleSheetId);
    return sheet?.originalSource || null;
  }

  getSourceMapURL(styleSheetId) {
    const sheet = this.sheets.get(styleSheetId);
    return sheet?.header?.sourceMapURL || null;
  }

  isInline(styleSheetId) {
    const sheet = this.sheets.get(styleSheetId);
    return sheet?.header?.isInline || false;
  }

  getAll() {
    return Array.from(this.sheets.entries()).map(([id, data]) => ({
      styleSheetId: id,
      ...data
    }));
  }

  // 파일 기반 스타일시트만 필터링
  // Vite inline 스타일도 viteDevId가 있으면 포함
  // Next.js/webpack inline 스타일도 originalSource가 있으면 포함
  getFileBasedSheets() {
    return this.getAll().filter(sheet => {
      // Vite dev id가 있으면 포함 (inline이지만 파일 매핑 가능)
      if (sheet.viteDevId) {
        return true;
      }

      // 소스맵에서 추출한 원본 소스가 있으면 포함 (Next.js/webpack)
      if (sheet.originalSource) {
        return true;
      }

      const sourceURL = sheet.header?.sourceURL;
      return sourceURL &&
             !sheet.header?.isInline &&
             (sourceURL.startsWith('http') || sourceURL.startsWith('file'));
    });
  }

  // 특정 스타일시트 제거 (무효화된 경우)
  remove(styleSheetId) {
    this.sheets.delete(styleSheetId);
  }

  // 모든 스타일시트 제거
  clear() {
    this.sheets.clear();
  }
}
