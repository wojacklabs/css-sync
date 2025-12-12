import CDP from 'chrome-remote-interface';

export class CDPClient {
  constructor(options = {}) {
    this.port = options.port || 9222;
    this.host = options.host || 'localhost';
    this.targetUrl = options.targetUrl || null;
    this.client = null;
    this.CSS = null;
    this.Page = null;
    this.Runtime = null;
    this._pendingCallbacks = [];

    // 폴링용 세션 (재사용)
    this._pollClient = null;
    this._pollCSS = null;
    this._pollSheets = new Map(); // styleSheetId -> header
  }

  onStyleSheetAdded(callback) {
    if (this.CSS) {
      this.CSS.on('styleSheetAdded', callback);
    } else {
      this._pendingCallbacks.push({ event: 'styleSheetAdded', callback });
    }
  }

  onStyleSheetChanged(callback) {
    if (this.CSS) {
      this.CSS.on('styleSheetChanged', callback);
    } else {
      this._pendingCallbacks.push({ event: 'styleSheetChanged', callback });
    }
  }

  async connect() {
    try {
      // 타겟 URL이 지정된 경우 해당 탭 찾기
      let target = null;
      if (this.targetUrl) {
        const targets = await CDP.List({ host: this.host, port: this.port });
        target = targets.find(t =>
          t.type === 'page' &&
          t.url.startsWith(this.targetUrl)
        );

        if (!target) {
          console.log('사용 가능한 탭:', targets.filter(t => t.type === 'page').map(t => t.url).join('\n  '));
          throw new Error(`타겟 URL을 찾을 수 없습니다: ${this.targetUrl}`);
        }
        console.log(`타겟 탭 찾음: ${target.title} (${target.url})`);
      }

      this.client = await CDP({
        host: this.host,
        port: this.port,
        target: target?.id
      });

      this.CSS = this.client.CSS;
      this.Page = this.client.Page;
      this.DOM = this.client.DOM;
      this.Runtime = this.client.Runtime;

      // 대기 중인 콜백들을 먼저 등록 (CSS.enable 전에!)
      for (const { event, callback } of this._pendingCallbacks) {
        this.CSS.on(event, callback);
      }
      this._pendingCallbacks = [];

      // DOM을 먼저 활성화해야 CSS가 동작함
      await this.DOM.enable();
      await this.CSS.enable();
      await this.Page.enable();

      return true;
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(
          `Chrome에 연결할 수 없습니다.\n` +
          `다음 명령으로 Chrome을 디버깅 모드로 실행하세요:\n\n` +
          `macOS:\n` +
          `  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${this.port}\n\n` +
          `Linux:\n` +
          `  google-chrome --remote-debugging-port=${this.port}\n\n` +
          `Windows:\n` +
          `  chrome.exe --remote-debugging-port=${this.port}`
        );
      }
      throw error;
    }
  }

  async getStyleSheetText(styleSheetId) {
    const result = await this.CSS.getStyleSheetText({ styleSheetId });
    return result.text;
  }

  // 페이지 새로고침
  async reloadPage() {
    await this.Page.reload();
  }

  // 폴링용 세션 초기화/재사용
  async ensurePollSession() {
    if (this._pollClient) {
      try {
        // 연결 상태 확인
        await this._pollCSS.getStyleSheetText({ styleSheetId: 'test' }).catch(() => {});
        return true;
      } catch (e) {
        // 연결이 끊어졌으면 재연결
        await this.closePollSession();
      }
    }

    try {
      const targets = await CDP.List({ host: this.host, port: this.port });
      const target = targets.find(t =>
        t.type === 'page' && t.url.startsWith(this.targetUrl)
      );

      if (!target) return false;

      this._pollClient = await CDP({
        host: this.host,
        port: this.port,
        target: target.id
      });

      this._pollSheets.clear();
      this._pollCSS = this._pollClient.CSS;

      this._pollCSS.on('styleSheetAdded', ({ header }) => {
        this._pollSheets.set(header.styleSheetId, header);
      });

      await this._pollClient.DOM.enable();
      await this._pollCSS.enable();

      // 스타일시트 수집 대기
      await new Promise(r => setTimeout(r, 300));

      return true;
    } catch (e) {
      this._pollClient = null;
      return false;
    }
  }

  // 모든 스타일시트의 최신 텍스트를 한 번에 가져오기
  // CDP 세션 캐싱 문제로 인해 매번 새 세션 생성
  async getAllFreshStyleSheets() {
    let client = null;
    try {
      const targets = await CDP.List({ host: this.host, port: this.port });
      const target = targets.find(t =>
        t.type === 'page' && t.url.startsWith(this.targetUrl)
      );

      if (!target) return [];

      client = await CDP({
        host: this.host,
        port: this.port,
        target: target.id
      });

      // 새 스타일시트 수집
      const freshSheets = [];
      client.CSS.on('styleSheetAdded', ({ header }) => {
        freshSheets.push(header);
      });

      await client.DOM.enable();
      await client.CSS.enable();

      // 스타일시트 수집 대기
      await new Promise(r => setTimeout(r, 200));

      // 모든 스타일시트 텍스트 가져오기
      const results = [];
      for (const sheet of freshSheets) {
        try {
          const { text } = await client.CSS.getStyleSheetText({ styleSheetId: sheet.styleSheetId });
          results.push({
            styleSheetId: sheet.styleSheetId,
            text,
            // 내용 앞부분을 키로 사용 (매칭용)
            contentKey: text.substring(0, 100).trim()
          });
        } catch {}
      }

      await client.close();
      return results;
    } catch (e) {
      if (client) {
        try { await client.close(); } catch {}
      }
      return [];
    }
  }

  // 내용 키로 스타일시트 텍스트 찾기
  findFreshTextByContentKey(freshSheets, contentKey) {
    const match = freshSheets.find(s => s.contentKey === contentKey);
    return match ? match.text : null;
  }

  // 하위 호환성을 위한 래퍼
  async getFreshStyleSheetText(styleSheetId) {
    // 이 메서드는 더 이상 직접 사용하지 않음
    // getAllFreshStyleSheets를 사용하도록 권장
    return null;
  }

  async closePollSession() {
    if (this._pollClient) {
      try {
        await this._pollClient.close();
      } catch (e) {}
      this._pollClient = null;
      this._pollCSS = null;
      this._pollSheets.clear();
    }
  }

  // Vite inline 스타일의 data-vite-dev-id 조회
  async getViteDevIds() {
    try {
      const doc = await this.DOM.getDocument({ depth: -1 });
      const { nodeIds } = await this.DOM.querySelectorAll({
        nodeId: doc.root.nodeId,
        selector: 'style[data-vite-dev-id]'
      });

      const viteIds = new Map(); // styleSheetId -> viteDevId

      for (const nodeId of nodeIds) {
        const { node } = await this.DOM.describeNode({ nodeId });
        const attrs = node.attributes || [];

        // data-vite-dev-id 속성 찾기
        let viteDevId = null;
        for (let i = 0; i < attrs.length; i += 2) {
          if (attrs[i] === 'data-vite-dev-id') {
            viteDevId = attrs[i + 1];
            break;
          }
        }

        if (viteDevId) {
          // 이 style 노드의 관련 스타일시트 찾기
          try {
            const { inlineStyle, matchedCSSRules } = await this.CSS.getMatchedStylesForNode({ nodeId });
            // 인라인 스타일은 없지만 style 태그 자체의 스타일시트 ID를 찾아야 함
            // 다른 방법: getStyleSheetText로 내용 비교
          } catch (e) {}

          // 임시: style 태그의 순서로 매핑 (추후 개선 필요)
          viteIds.set(nodeId, viteDevId);
        }
      }

      return viteIds;
    } catch (e) {
      return new Map();
    }
  }

  // 스타일시트 ID와 Vite dev ID 매핑
  async matchViteStyleSheets(sheets) {
    try {
      const doc = await this.DOM.getDocument({ depth: -1 });
      const { nodeIds } = await this.DOM.querySelectorAll({
        nodeId: doc.root.nodeId,
        selector: 'style[data-vite-dev-id]'
      });

      const matches = [];

      for (const nodeId of nodeIds) {
        const { node } = await this.DOM.describeNode({ nodeId });
        const attrs = node.attributes || [];

        // data-vite-dev-id 속성 찾기
        let viteDevId = null;
        for (let i = 0; i < attrs.length; i += 2) {
          if (attrs[i] === 'data-vite-dev-id') {
            viteDevId = attrs[i + 1];
            break;
          }
        }

        if (viteDevId) {
          // style 태그의 내용 가져오기
          const { outerHTML } = await this.DOM.getOuterHTML({ nodeId });
          const contentMatch = outerHTML.match(/<style[^>]*>([\s\S]*?)<\/style>/);
          const styleContent = contentMatch ? contentMatch[1].trim() : '';

          // 같은 내용을 가진 스타일시트 찾기 (isInline 무관)
          for (const sheet of sheets) {
            if (sheet.text) {
              const sheetText = sheet.text.trim();
              // 앞부분이 같으면 매칭 (Vite가 변환한 CSS와 원본은 동일)
              if (sheetText.substring(0, 100) === styleContent.substring(0, 100)) {
                matches.push({
                  styleSheetId: sheet.styleSheetId,
                  viteDevId
                });
                break;
              }
            }
          }
        }
      }

      return matches;
    } catch (e) {
      return [];
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
    }
  }
}
