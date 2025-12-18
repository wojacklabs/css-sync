# cssback

Chrome DevTools에서 수정한 CSS를 소스 파일(CSS/SCSS)에 자동으로 반영합니다.

## 설치

```bash
npm install -g cssback
```

## 사용법

```bash
# 프로젝트 폴더에서 실행
cssback http://localhost:5174

# 또는 다른 포트
cssback http://localhost:3000
```

### 옵션

```
-p, --port <port>  Chrome 디버깅 포트 (기본: 자동 감지)
-d, --dir <path>   프로젝트 디렉토리 (기본: 현재 폴더)
-v, --verbose      상세 로그 출력
```

## 사전 준비

Chrome을 디버깅 모드로 실행해야 합니다:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222

# Windows
chrome.exe --remote-debugging-port=9222
```

## 지원 기능

- CSS/SCSS 파일 자동 업데이트
- Vite, Next.js, React 프로젝트 지원
- 인라인 소스맵 기반 원본 파일 매핑 (webpack)
- SCSS 변수/중첩 구문 보존
- 선언 단위 패치 (전체 덮어쓰기 X)
- Chrome 디버깅 포트 자동 감지

## 작동 방식

1. Chrome DevTools Protocol(CDP)로 브라우저 연결
2. DevTools에서 CSS 변경 감지
3. 변경된 선언만 소스 파일에 패치

## 라이선스

MIT
