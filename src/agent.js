import chalk from 'chalk';
import { CDPClient } from './cdp/client.js';
import { StyleSheetRegistry } from './cdp/registry.js';
import { findChangedDeclarations } from './diff/css-parser.js';
import { URLResolver } from './mapper/url-resolver.js';
import { SourceMapResolver } from './mapper/sourcemap-resolver.js';
import { SelectorResolver } from './mapper/selector-resolver.js';
import { CSSPatcher } from './patcher/css-patcher.js';
import { SCSSPatcher } from './patcher/scss-patcher.js';
import { FileQueue } from './patcher/file-queue.js';
import { LoopGuard } from './safety/loop-guard.js';

export class CSSyncAgent {
  constructor(options = {}) {
    this.options = options;

    this.cdp = new CDPClient({
      port: options.port || 9222,
      host: options.host || 'localhost',
      targetUrl: options.devServerBase || 'http://localhost:3000'
    });

    this.registry = new StyleSheetRegistry();

    this.urlResolver = new URLResolver({
      projectRoot: options.projectRoot || process.cwd(),
      devServerBase: options.devServerBase || 'http://localhost:3000',
      mappings: options.mappings || {}
    });

    this.patcher = new CSSPatcher({
      atomicWrite: true
    });

    this.scssPatcher = new SCSSPatcher({
      atomicWrite: true
    });

    this.sourceMapResolver = new SourceMapResolver({
      projectRoot: options.projectRoot || process.cwd()
    });

    this.selectorResolver = new SelectorResolver({
      projectRoot: options.projectRoot || process.cwd()
    });

    this.fileQueue = new FileQueue();

    this.loopGuard = new LoopGuard({
      ttl: options.loopGuardTTL || 2000
    });

    this.verbose = options.verbose || false;
  }

  async start() {
    this.log(chalk.cyan('CSS Sync Agent 시작 중...'));

    // 스타일시트 등록 이벤트 (connect 전에 등록해야 함!)
    this.cdp.onStyleSheetAdded(async ({ header }) => {
      this.log(chalk.dim(`[DEBUG] styleSheetAdded: ${header.sourceURL || '(inline)'}`));

      this.registry.register(header);

      const sourceURL = header.sourceURL;
      if (sourceURL && !header.isInline) {
        const localPath = this.urlResolver.resolve(sourceURL);
        const status = localPath
          ? chalk.green(`→ ${localPath}`)
          : chalk.yellow('→ (매핑 안됨)');

        this.log(`  ${chalk.dim(sourceURL)}`);
        this.log(`  ${status}`);
      }

      // 초기 텍스트 저장
      try {
        const text = await this.cdp.getStyleSheetText(header.styleSheetId);
        this.registry.updateText(header.styleSheetId, text);
        this.log(chalk.dim(`[DEBUG] 텍스트 저장됨: ${text.length}자`));
      } catch (e) {
        this.log(chalk.dim(`[DEBUG] 텍스트 가져오기 실패: ${e.message}`));
      }
    });

    // 스타일시트 변경 이벤트 - 새 세션으로 최신 텍스트 조회
    this.cdp.onStyleSheetChanged(async ({ styleSheetId }) => {
      this.log(chalk.yellow(`[EVENT] styleSheetChanged: ${styleSheetId}`));
      // 새 CDP 세션으로 최신 텍스트 가져오기
      const freshText = await this.getFreshStyleSheetText(styleSheetId);
      if (freshText) {
        const oldText = this.registry.getPreviousText(styleSheetId);
        if (oldText && oldText !== freshText) {
          this.log(chalk.green(`[EVENT] 변경 감지됨! ${oldText.length}자 → ${freshText.length}자`));
          this.registry.updateText(styleSheetId, freshText);
          await this.handleStyleSheetChange(styleSheetId);
        }
      }
    });

    // 이제 연결 (이벤트 핸들러가 이미 등록되어 있음)
    try {
      await this.cdp.connect();
      this.log(chalk.green('✓ Chrome 연결됨'));
    } catch (error) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }

    // 페이지 새로고침하여 styleSheetAdded 이벤트 수집
    this.log(chalk.dim('  페이지 새로고침 중...'));

    // 새로고침 전 레지스트리 클리어
    this.registry.clear();

    await this.cdp.reloadPage();

    // 새로고침 완료 및 스타일시트 로드 대기
    await new Promise(r => setTimeout(r, 3000));

    this.log(chalk.green('✓ 감시 시작됨'));
    this.log(chalk.dim('  DevTools에서 CSS를 수정하세요.\n'));

    // Vite inline 스타일시트 매핑
    await this.detectViteStyleSheets();

    // Next.js/webpack inline 스타일시트 매핑 (소스맵 기반)
    await this.detectWebpackStyleSheets();

    // 현재 페이지 정보 출력
    await this.printPageInfo();

    // 폴링 방식으로 변경 감지 (CDP 이벤트가 발생하지 않는 경우 대비)
    this.startPolling();
  }

  // Vite inline 스타일시트 감지 및 매핑
  async detectViteStyleSheets() {
    const allSheets = this.registry.getAll();
    const matches = await this.cdp.matchViteStyleSheets(allSheets);

    for (const { styleSheetId, viteDevId } of matches) {
      this.registry.setViteDevId(styleSheetId, viteDevId);
      this.log(chalk.cyan(`  [Vite] ${viteDevId}`));
    }

    if (matches.length > 0) {
      this.log(chalk.dim(`  ${matches.length}개 Vite 스타일시트 감지됨`));
    }
  }

  // Next.js/webpack inline 스타일시트 감지 및 매핑 (소스맵 기반)
  async detectWebpackStyleSheets() {
    const allSheets = this.registry.getAll();
    let matchCount = 0;

    for (const sheet of allSheets) {
      // 이미 Vite로 매핑된 것은 스킵
      if (sheet.viteDevId) continue;
      // 이미 원본 소스가 있으면 스킵
      if (sheet.originalSource) continue;

      const text = sheet.text;
      if (!text) continue;

      // 인라인 소스맵에서 원본 파일 경로 추출
      const originalSource = await this.sourceMapResolver.findOriginalSourceFromInline(text);

      if (originalSource) {
        this.registry.setOriginalSource(sheet.styleSheetId, originalSource);
        this.log(chalk.cyan(`  [webpack] ${originalSource}`));
        matchCount++;
      }
    }

    if (matchCount > 0) {
      this.log(chalk.dim(`  ${matchCount}개 webpack 스타일시트 감지됨`));
    }
  }

  startPolling() {
    const POLL_INTERVAL = 1000; // 1초

    this.log(chalk.dim('[POLL] 폴링 시작됨'));

    this.pollingInterval = setInterval(async () => {
      const sheets = this.registry.getFileBasedSheets();

      if (sheets.length === 0) {
        return; // 아직 스타일시트 없음
      }

      this.logVerbose(`[POLL] 체크 중... (${sheets.length}개 스타일시트)`);

      // 한 번의 세션으로 모든 최신 스타일시트 가져오기
      const freshSheets = await this.cdp.getAllFreshStyleSheets();

      if (freshSheets.length === 0) {
        this.logVerbose('[POLL] 최신 스타일시트를 가져올 수 없음');
        return;
      }

      for (const sheet of sheets) {
        try {
          // 내용 키로 매칭하여 최신 텍스트 찾기
          const oldText = sheet.text;
          const contentKey = oldText?.substring(0, 100).trim();
          const newText = this.cdp.findFreshTextByContentKey(freshSheets, contentKey)
            || freshSheets.find(f => f.text.length === oldText?.length)?.text;

          if (!newText) {
            this.logVerbose(`[POLL] 매칭되는 스타일시트 없음`);
            continue;
          }

          if (!oldText) {
            // 처음 텍스트 저장
            this.registry.updateText(sheet.styleSheetId, newText);
            continue;
          }

          this.logVerbose(`[POLL] old=${oldText?.length}, new=${newText?.length}`);

          if (oldText !== newText) {
            // 무한루프 방지 체크
            if (this.loopGuard.shouldIgnoreStyleSheet(sheet.styleSheetId, newText)) {
              this.logVerbose('[POLL] 자체 변경 무시');
              this.registry.updateText(sheet.styleSheetId, newText);
              continue;
            }

            const sourceName = sheet.viteDevId || sheet.originalSource || sheet.header?.sourceURL || '(inline)';
            this.log(chalk.yellow(`[POLL] 변경 감지: ${sourceName}`));
            // 폴링에서 가져온 새 텍스트를 전달
            await this.handleStyleSheetChange(sheet.styleSheetId, newText);
          }
        } catch (e) {
          // 스타일시트가 제거됐거나 무효화됨 - 레지스트리에서 제거
          if (e.message.includes('No style sheet with given id')) {
            this.registry.remove(sheet.styleSheetId);
            this.logVerbose(`[POLL] 무효한 스타일시트 제거: ${sheet.styleSheetId}`);
          } else {
            this.logVerbose(`[POLL] 오류: ${e.message}`);
          }
        }
      }
    }, POLL_INTERVAL);
  }

  async handleStyleSheetChange(styleSheetId, freshText = null) {
    try {
      // 새 텍스트가 전달되지 않으면 기존 세션에서 가져옴
      const newText = freshText || await this.cdp.getStyleSheetText(styleSheetId);
      const oldText = this.registry.getPreviousText(styleSheetId);

      // 무한루프 방지 체크
      if (this.loopGuard.shouldIgnoreStyleSheet(styleSheetId, newText)) {
        this.logVerbose('자체 수정으로 인한 변경 무시');
        return;
      }

      // 이전 텍스트가 없거나 같으면 스킵
      if (!oldText || oldText === newText) {
        this.registry.updateText(styleSheetId, newText);
        return;
      }

      // 변경된 declaration 찾기
      const changes = findChangedDeclarations(oldText, newText);

      if (changes.length === 0) {
        this.registry.updateText(styleSheetId, newText);
        return;
      }

      // 로컬 파일 경로 확인
      const sourceURL = this.registry.getSourceURL(styleSheetId);
      const viteDevId = this.registry.getViteDevId(styleSheetId);
      const originalSource = this.registry.getOriginalSource(styleSheetId);

      // Vite dev ID, 원본 소스, 또는 URL 매핑 순으로 파일 경로 결정
      let localPath = viteDevId || originalSource || this.urlResolver.resolve(sourceURL);

      // .next 폴더의 번들된 CSS이거나 매핑이 없으면 셀렉터 기반으로 원본 파일 찾기
      const isNextJSBundle = localPath && localPath.includes('/.next/');
      if (!localPath || isNextJSBundle) {
        const resolved = await this.handleCSSModuleChanges(styleSheetId, changes, newText);
        if (resolved) {
          return; // CSS Module로 처리됨
        }
        // CSS Module이 아니면 기존 로직으로 계속 진행
        if (!localPath) {
          this.log(chalk.yellow(`⚠ 매핑되지 않은 스타일시트: ${sourceURL}`));
          this.registry.updateText(styleSheetId, newText);
          return;
        }
      }

      // SCSS/SASS 파일인지 확인 (Vite는 원본 경로를 직접 제공)
      let useScss = localPath.match(/\.(scss|sass)$/);

      // SCSS가 아닌 경우 소스맵으로 원본 소스 찾기
      if (!useScss) {
        const firstChange = changes[0];
        if (firstChange) {
          const originalSource = await this.sourceMapResolver.findOriginalSource(
            localPath, firstChange.selector, newText
          );

          if (originalSource && originalSource.source.match(/\.(scss|sass|less)$/)) {
            this.logVerbose(`[소스맵] ${localPath} → ${originalSource.source}`);
            localPath = originalSource.source;
            useScss = true;
          }
        }
      }

      // 변경사항 로그 출력
      const timestamp = new Date().toLocaleTimeString();
      for (const change of changes) {
        if (change.type === 'change' || change.type === 'add' || change.type === 'delete') {
          this.log(
            `${chalk.dim(`[${timestamp}]`)} ` +
            `${chalk.cyan(change.selector)} ` +
            `${chalk.white(change.prop)}: ` +
            `${chalk.red(change.oldValue || '(없음)')} → ` +
            `${chalk.green(change.newValue || '(삭제)')}`
          );
        }
      }

      // 선언 단위로 패치 적용 (SCSS면 SCSS 패처 사용)
      await this.fileQueue.enqueue(localPath, async () => {
        const patcher = useScss ? this.scssPatcher : this.patcher;
        const result = await patcher.patchMultiple(localPath, changes);

        if (result.success > 0) {
          const fileType = useScss ? 'SCSS' : 'CSS';
          this.log(chalk.dim(`  └─ 저장: ${localPath} (${fileType}, ${result.success}개 변경)`));

          // 무한루프 방지 등록
          this.loopGuard.registerStyleSheetWrite(styleSheetId, newText);
          this.loopGuard.registerWrite(localPath, newText);
        }

        if (result.failed > 0) {
          this.logVerbose(`  └─ ${result.failed}개 변경 실패 (셀렉터 없음)`);
        }
      });

      // 레지스트리 업데이트
      this.registry.updateText(styleSheetId, newText);

    } catch (error) {
      console.error(chalk.red(`변경 처리 오류: ${error.message}`));
      if (this.verbose) {
        console.error(error.stack);
      }
    }
  }

  // CSS Module 변경사항 처리 (셀렉터 기반 원본 파일 찾기)
  // @returns {boolean} CSS Module로 처리된 변경이 있으면 true
  async handleCSSModuleChanges(styleSheetId, changes, newText) {
    const timestamp = new Date().toLocaleTimeString();

    // 파일별로 변경사항 그룹화
    const changesByFile = new Map();

    for (const change of changes) {
      if (change.type !== 'change' && change.type !== 'add' && change.type !== 'delete') {
        continue;
      }

      // 셀렉터 기반으로 원본 파일 찾기
      const resolved = await this.selectorResolver.resolve(change.selector);

      if (resolved) {
        const { filePath, originalSelector } = resolved;

        // 원본 셀렉터로 변경사항 복사
        const mappedChange = {
          ...change,
          selector: originalSelector,
          originalSelector: change.selector // 원본 기록 (로그용)
        };

        if (!changesByFile.has(filePath)) {
          changesByFile.set(filePath, []);
        }
        changesByFile.get(filePath).push(mappedChange);

        this.log(
          `${chalk.dim(`[${timestamp}]`)} ` +
          `${chalk.cyan(change.selector)} → ${chalk.green(originalSelector)} ` +
          `${chalk.white(change.prop)}: ` +
          `${chalk.red(change.oldValue || '(없음)')} → ` +
          `${chalk.green(change.newValue || '(삭제)')}`
        );
      } else {
        this.logVerbose(`[CSS Module] 원본 찾지 못함: ${change.selector}`);
      }
    }

    // CSS Module로 resolve된 변경이 없으면 false 반환
    if (changesByFile.size === 0) {
      return false;
    }

    // 각 파일에 패치 적용
    for (const [filePath, fileChanges] of changesByFile) {
      await this.fileQueue.enqueue(filePath, async () => {
        const useScss = filePath.match(/\.(scss|sass)$/);
        const patcher = useScss ? this.scssPatcher : this.patcher;
        const result = await patcher.patchMultiple(filePath, fileChanges);

        if (result.success > 0) {
          const fileType = useScss ? 'SCSS' : 'CSS';
          this.log(chalk.dim(`  └─ 저장: ${filePath} (${fileType}, ${result.success}개 변경)`));

          // 무한루프 방지 등록
          this.loopGuard.registerStyleSheetWrite(styleSheetId, newText);
          this.loopGuard.registerWrite(filePath, newText);
        }

        if (result.failed > 0) {
          this.logVerbose(`  └─ ${result.failed}개 변경 실패 (셀렉터 없음)`);
        }
      });
    }

    // 레지스트리 업데이트
    this.registry.updateText(styleSheetId, newText);
    return true;
  }

  async printPageInfo() {
    const sheets = this.registry.getFileBasedSheets();
    if (sheets.length > 0) {
      this.log(chalk.cyan(`스타일시트 ${sheets.length}개 감지됨:`));
    }
  }

  log(message) {
    console.log(message);
  }

  logVerbose(message) {
    if (this.verbose) {
      console.log(chalk.dim(`[verbose] ${message}`));
    }
  }

  async stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    this.loopGuard.destroy();
    this.sourceMapResolver.destroy();
    await this.cdp.closePollSession();
    await this.cdp.close();
    this.log(chalk.yellow('\nCSS Sync Agent 종료됨'));
  }
}
