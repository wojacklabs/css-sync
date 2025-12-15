import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import postcss from 'postcss';

export class CSSPatcher {
  constructor(options = {}) {
    this.atomicWrite = options.atomicWrite !== false;
  }

  /**
   * CSS 파일에서 특정 selector의 property 값을 변경
   * @param {string} filePath - 파일 경로
   * @param {string} selector - CSS 셀렉터
   * @param {string} prop - 속성명
   * @param {string} newValue - 새 값
   * @returns {Promise<boolean>} - 성공 여부
   */
  async patchDeclaration(filePath, selector, prop, newValue) {
    if (!existsSync(filePath)) {
      console.error(`파일을 찾을 수 없습니다: ${filePath}`);
      return false;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const root = postcss.parse(content);

      let patched = false;

      root.walkRules((rule) => {
        if (this.matchSelector(rule.selector, selector)) {
          rule.walkDecls(prop, (decl) => {
            // 값 변경
            const hasImportant = newValue.includes('!important');
            const cleanValue = newValue.replace(/\s*!important\s*$/, '').trim();

            decl.value = cleanValue;
            decl.important = hasImportant;
            patched = true;
          });
        }
      });

      if (patched) {
        await this.writeFile(filePath, root.toString());
        return true;
      }

      return false;
    } catch (error) {
      console.error(`패치 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 여러 변경사항을 한 번에 적용 (추가/수정/삭제 지원)
   * @param {string} filePath - 파일 경로
   * @param {Array<{type: string, selector: string, prop: string, newValue?: string}>} changes - 변경 목록
   * @returns {Promise<{success: number, failed: number}>}
   */
  async patchMultiple(filePath, changes) {
    if (!existsSync(filePath)) {
      console.error(`파일을 찾을 수 없습니다: ${filePath}`);
      return { success: 0, failed: changes.length };
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const root = postcss.parse(content);

      let success = 0;
      let failed = 0;

      for (const change of changes) {
        let found = false;
        let targetRule = null;

        // 해당 셀렉터의 규칙 찾기
        root.walkRules((rule) => {
          if (this.matchSelector(rule.selector, change.selector)) {
            targetRule = rule;

            if (change.type === 'delete') {
              // 삭제
              rule.walkDecls(change.prop, (decl) => {
                decl.remove();
                found = true;
              });
            } else {
              // 수정
              rule.walkDecls(change.prop, (decl) => {
                const hasImportant = change.newValue.includes('!important');
                const cleanValue = change.newValue.replace(/\s*!important\s*$/, '').trim();

                decl.value = cleanValue;
                decl.important = hasImportant;
                found = true;
              });
            }
          }
        });

        // 추가: 규칙은 있지만 속성이 없는 경우
        if (!found && targetRule && change.type === 'add' && change.newValue) {
          const hasImportant = change.newValue.includes('!important');
          const cleanValue = change.newValue.replace(/\s*!important\s*$/, '').trim();

          targetRule.append({
            prop: change.prop,
            value: cleanValue,
            important: hasImportant
          });
          found = true;
        }

        if (found) {
          success++;
        } else {
          failed++;
        }
      }

      if (success > 0) {
        await this.writeFile(filePath, root.toString());
      }

      return { success, failed };
    } catch (error) {
      console.error(`패치 실패: ${error.message}`);
      return { success: 0, failed: changes.length };
    }
  }

  /**
   * CSS 파일 전체를 새 내용으로 교체
   * @param {string} filePath - 파일 경로
   * @param {string} newContent - 새 내용
   */
  async replaceContent(filePath, newContent) {
    await this.writeFile(filePath, newContent);
  }

  /**
   * 셀렉터 매칭 (정규화 후 비교)
   */
  matchSelector(fileSelector, targetSelector) {
    const normalize = (s) => s.replace(/\s+/g, ' ').trim();
    return normalize(fileSelector) === normalize(targetSelector);
  }

  /**
   * 파일 쓰기 (atomic write 옵션)
   */
  async writeFile(filePath, content) {
    if (this.atomicWrite) {
      const tempPath = join(dirname(filePath), `.${Date.now()}.tmp`);
      await writeFile(tempPath, content, 'utf-8');
      await rename(tempPath, filePath);
    } else {
      await writeFile(filePath, content, 'utf-8');
    }
  }
}
