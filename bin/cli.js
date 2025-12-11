#!/usr/bin/env node

import { program } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import CDP from 'chrome-remote-interface';
import { CSSyncAgent } from '../src/agent.js';

// package.json에서 버전 읽기
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

// Chrome 디버깅 포트 자동 감지
async function detectChromePort() {
  const commonPorts = [9222, 9333, 9229, 9230];

  for (const port of commonPorts) {
    try {
      const targets = await CDP.List({ port, timeout: 500 });
      if (targets.length > 0) {
        return port;
      }
    } catch {
      // 이 포트는 사용 불가
    }
  }
  return null;
}

program
  .name('cssback')
  .description('Sync CSS changes from Chrome DevTools back to source files')
  .version(pkg.version)
  .argument('<url>', '개발 서버 URL (예: http://localhost:5174)')
  .option('-p, --port <port>', 'Chrome 디버깅 포트 (자동 감지)')
  .option('-d, --dir <path>', '프로젝트 디렉토리', process.cwd())
  .option('-v, --verbose', '상세 로그 출력')
  .action(async (url, options) => {
    // URL 검증
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }

    // Chrome 포트 감지
    let port = options.port ? parseInt(options.port) : null;

    if (!port) {
      console.log(chalk.dim('Chrome 디버깅 포트 탐색 중...'));
      port = await detectChromePort();

      if (!port) {
        console.error(chalk.red('\n❌ Chrome 디버깅 모드를 찾을 수 없습니다.\n'));
        console.log('Chrome을 디버깅 모드로 실행하세요:\n');
        console.log(chalk.cyan('  # macOS'));
        console.log('  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n');
        console.log(chalk.cyan('  # Linux'));
        console.log('  google-chrome --remote-debugging-port=9222\n');
        console.log(chalk.cyan('  # Windows'));
        console.log('  chrome.exe --remote-debugging-port=9222\n');
        process.exit(1);
      }
    }

    const projectRoot = resolve(options.dir);

    // 프로젝트 디렉토리 확인
    if (!existsSync(projectRoot)) {
      console.error(chalk.red(`디렉토리를 찾을 수 없습니다: ${projectRoot}`));
      process.exit(1);
    }

    // 배너 출력
    console.log(chalk.bold.cyan('\n🔄 cssback\n'));
    console.log(`  ${chalk.dim('서버:')} ${url}`);
    console.log(`  ${chalk.dim('프로젝트:')} ${projectRoot}`);
    console.log(`  ${chalk.dim('Chrome:')} localhost:${port}\n`);

    // 에이전트 시작
    const agent = new CSSyncAgent({
      port,
      host: 'localhost',
      projectRoot,
      devServerBase: url,
      verbose: options.verbose || false
    });

    // 종료 처리
    const cleanup = async () => {
      await agent.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      await agent.start();
    } catch (error) {
      console.error(chalk.red(`\n❌ ${error.message}`));
      process.exit(1);
    }
  });

program.parse();
